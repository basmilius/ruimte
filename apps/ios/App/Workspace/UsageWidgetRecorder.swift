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
                let usd = summary.list("models").reduce(0) { $0 + $1.number("costUsd") }
                snapshot.cost = UsageWidgetSnapshot.Cost(day: day, usd: usd, rate: summary["rate"], fetchedAt: now)
            }
        }
        guard !Task.isCancelled else { return }
        UsageWidgetStore.save(snapshot, machineID: machineID)
        WidgetCenter.shared.reloadTimelines(ofKind: UsageWidgetStore.kind)
    }

    private static func providers(_ limits: JSONValue) -> [UsageWidgetSnapshot.Provider] {
        limits.list("providers").map { provider in
            UsageWidgetSnapshot.Provider(
                kind: provider.text("kind"),
                windows: provider.list("windows").map { window in
                    UsageWidgetSnapshot.Window(
                        kind: window["kind"]?.stringValue, label: window.text("label"), used: window.number("used"),
                        resetsAt: window["resetsAt"]?.numberValue.map { Date(timeIntervalSince1970: $0 / 1000) })
                })
        }
    }
}
