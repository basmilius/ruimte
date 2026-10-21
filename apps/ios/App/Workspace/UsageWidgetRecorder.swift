import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import WidgetKit

/// The machine's accounts as the limit rows know them: not asked yet, the list it gave, or a list it could not give,
/// which says nothing about which accounts are there.
enum UsageAccounts: Equatable {
    case unknown
    case loaded(ProviderAccountList)
    case failed
}

/// Keeps the usage widgets' snapshot of one machine current while the app holds a connection to it. The machines list
/// draws its limits from the same reading, with the machine's accounts beside it.
@MainActor @Observable
final class UsageWidgetRecorder {
    private static let costLifetime: TimeInterval = 5 * 60
    /// The limits per account as last read, also from an earlier launch while the machine is away.
    private(set) var providers: [UsageWidgetSnapshot.Provider]
    /// The `usage.limits` reading as it came, newest first: an event is taken at once, also while a load still waits on
    /// the day's cost. Held for this connection only; the widgets keep their snapshot.
    private(set) var limits: JSONValue?
    private(set) var accounts: UsageAccounts = .unknown
    @ObservationIgnored private let machineID: String
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private var unsubscribe: (() -> Void)?
    @ObservationIgnored private var unsubscribeAccounts: (() -> Void)?
    @ObservationIgnored private var unobserve: (() -> Void)?
    @ObservationIgnored private var running: Task<Void, Never>?
    @ObservationIgnored private var revision = 0
    /// Limits that came while a load ran, which the snapshot takes once that load is done.
    @ObservationIgnored private var pending: JSONValue?
    /// Counts every reading of the limits and of the accounts taken, so an answer asked for before a newer event leaves
    /// that event standing.
    @ObservationIgnored private var limitsRevision = 0
    @ObservationIgnored private var accountsRevision = 0
    @ObservationIgnored private var listing: Task<Void, Never>?

    init(machineID: String, client: any MachineRequesting) {
        self.machineID = machineID
        self.client = client
        providers = UsageWidgetStore.snapshot(machineID: machineID)?.providers ?? []
    }

    func start() {
        guard unobserve == nil else { return }
        unsubscribe = client.subscribe(WireEvent.usageLimitsChanged.rawValue) { [weak self] value in
            guard let self, let limits = try? WireEvent.usageLimitsChanged.validatePayload(value) else { return }
            take(limits)
            if running == nil { begin(limits: limits) } else { pending = limits }
        }
        unsubscribeAccounts = client.subscribe(WireEvent.accountsChanged.rawValue) { [weak self] value in
            guard let self else { return }
            accountsRevision += 1
            accounts = .loaded(ProviderAccountList(value))
        }
        unobserve = client.observeConnection { [weak self] connected in
            guard let self else { return }
            if connected {
                begin()
                listAccounts()
            } else {
                cancel()
            }
        }
    }

    func stop() {
        cancel()
        unsubscribe?()
        unsubscribeAccounts?()
        unobserve?()
        unsubscribe = nil
        unsubscribeAccounts = nil
        unobserve = nil
        limits = nil
        accounts = .unknown
    }

    func refresh() async { await begin().value }

    @discardableResult private func begin(limits: JSONValue? = nil) -> Task<Void, Never> {
        if let running { return running }
        revision += 1
        let operation = revision
        let task = Task { [weak self] in
            await self?.load(limits: limits)
            guard let self, revision == operation else { return }
            running = nil
            if let next = pending {
                pending = nil
                begin(limits: next)
            }
        }
        running = task
        return task
    }

    private func cancel() {
        revision += 1
        running?.cancel()
        running = nil
        pending = nil
        listing?.cancel()
        listing = nil
    }

    private func take(_ limits: JSONValue) {
        limitsRevision += 1
        self.limits = limits
    }

    /// The accounts once per connection; after that `accounts.changed` keeps them, also while this answer is on its
    /// way.
    private func listAccounts() {
        listing?.cancel()
        let seen = accountsRevision
        listing = Task { [weak self] in
            guard let client = self?.client else { return }
            let next: UsageAccounts
            do {
                next = .loaded(ProviderAccountList(try await client.request(WireRequest.accountsList.rawValue)))
            } catch {
                next = .failed
            }
            guard !Task.isCancelled, let self, accountsRevision == seen else { return }
            accounts = next
        }
    }

    private func load(limits known: JSONValue?) async {
        var limits: JSONValue
        if let known {
            limits = known
        } else {
            let seen = limitsRevision
            do {
                limits = try await client.request(WireRequest.usageLimits.rawValue, payload: .object([:]))
            } catch {
                // An unreachable machine leaves its last snapshot standing; that is what the widget shows offline.
                return
            }
            guard !Task.isCancelled else { return }
            if limitsRevision == seen { take(limits) } else if let newer = self.limits { limits = newer }
        }
        let now = Date.now
        var snapshot = UsageWidgetStore.snapshot(machineID: machineID) ?? UsageWidgetSnapshot()
        snapshot.providers = Self.providers(limits)
        snapshot.updatedAt = now
        providers = snapshot.providers
        if known == nil || snapshot.cost.map({ now.timeIntervalSince($0.fetchedAt) > Self.costLifetime }) ?? true {
            let day = UsageWidgetSnapshot.day(of: now)
            let payload = JSONValue.object([
                "from": .string(day), "to": .string(day), "resolution": .string("day"),
                "timeZone": .string(TimeZone.current.identifier),
            ])
            if let summary = try? await client.request(WireRequest.usageSummary.rawValue, payload: payload) {
                let models = summary.list("models")
                let byProvider = Dictionary(
                    models.map { ($0.text("provider"), $0.number("costUsd")) }, uniquingKeysWith: +)
                snapshot.cost = UsageWidgetSnapshot.Cost(
                    day: day, usd: models.reduce(0) { $0 + $1.number("costUsd") }, usdByProvider: byProvider,
                    usdByAccount: await costByAccount(snapshot, payload: payload), rate: summary["rate"],
                    fetchedAt: now)
            }
        }
        guard !Task.isCancelled else { return }
        UsageWidgetStore.save(snapshot, machineID: machineID)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Only a CLI with several accounts needs the cost split per account, which a second summary asks for; the first
    /// keeps the machine's total, which also counts the accounts that are gone.
    private func costByAccount(_ snapshot: UsageWidgetSnapshot, payload: JSONValue) async -> [String: Double]? {
        guard snapshot.providers.contains(where: { snapshot.accountCount($0.kind) > 1 }) else { return nil }
        let ids = snapshot.providers.compactMap(\.account?.id)
        let split = payload.setting("accounts", .array(ids.map(JSONValue.string)))
        guard let summary = try? await client.request(WireRequest.usageSummary.rawValue, payload: split) else {
            return nil
        }
        let models = summary.list("models").filter { $0["account"]?.stringValue != nil }
        // A machine that ignores the filter folds every account into one, which says nothing per account.
        guard !models.isEmpty || summary.list("models").isEmpty else { return nil }
        return Dictionary(models.map { ($0.text("account"), $0.number("costUsd")) }, uniquingKeysWith: +)
    }

    static func providers(_ limits: JSONValue) -> [UsageWidgetSnapshot.Provider] {
        limits.list("providers").map { provider in
            UsageWidgetSnapshot.Provider(
                kind: provider.text("kind"),
                account: provider["account"].flatMap { account in
                    account["id"]?.stringValue.map {
                        UsageWidgetSnapshot.Account(
                            id: $0, label: account.text("label", fallback: $0), color: account["color"]?.stringValue)
                    }
                },
                windows: provider.list("windows").map { window in
                    UsageWidgetSnapshot.Window(
                        kind: window["kind"]?.stringValue, label: window.text("label"), used: window.number("used"),
                        resetsAt: window["resetsAt"]?.numberValue.map { Date(timeIntervalSince1970: $0 / 1000) })
                })
        }
    }
}
