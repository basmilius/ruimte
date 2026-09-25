import Foundation
import RuimtePulsar
import RuimteTransport
import WidgetKit

/// Keeps the usage widgets' snapshot of one machine current while the app holds a connection to it.
@MainActor
final class UsageWidgetRecorder {
    private static let costLifetime: TimeInterval = 5 * 60
    private let machineID: String
    private let client: any MachineRequesting
    private var unsubscribe: (() -> Void)?
    private var unobserve: (() -> Void)?
    private var running: Task<Void, Never>?
    private var revision = 0

    init(machineID: String, client: any MachineRequesting) {
        self.machineID = machineID
        self.client = client
    }

    func start() {
        guard unobserve == nil else { return }
        unsubscribe = client.subscribe(WireEvent.usageLimitsChanged.rawValue) { [weak self] value in
            guard let self, let limits = try? WireEvent.usageLimitsChanged.validatePayload(value) else { return }
            begin(limits: limits)
        }
        unobserve = client.observeConnection { [weak self] connected in
            guard let self else { return }
            if connected { begin() } else { cancel() }
        }
    }

    func stop() {
        cancel()
        unsubscribe?()
        unobserve?()
        unsubscribe = nil
        unobserve = nil
    }

    func refresh() async { await begin().value }

    @discardableResult private func begin(limits: JSONValue? = nil) -> Task<Void, Never> {
        if let running { return running }
        revision += 1
        let operation = revision
        let task = Task { [weak self] in
            await self?.load(limits: limits)
            if self?.revision == operation { self?.running = nil }
        }
        running = task
        return task
    }

    private func cancel() {
        revision += 1
        running?.cancel()
        running = nil
    }

    private func load(limits known: JSONValue?) async {
        let limits: JSONValue
        if let known {
            limits = known
        } else {
            do {
                limits = try await client.request(WireRequest.usageLimits.rawValue, payload: .object([:]))
            } catch {
                // An unreachable machine leaves its last snapshot standing; that is what the widget shows offline.
                return
            }
        }
        let now = Date.now
        var snapshot = UsageWidgetStore.snapshot(machineID: machineID) ?? UsageWidgetSnapshot()
        snapshot.providers = Self.providers(limits)
        snapshot.updatedAt = now
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

    private static func providers(_ limits: JSONValue) -> [UsageWidgetSnapshot.Provider] {
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
