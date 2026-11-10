import Foundation
import RuimteTransport
// `SentrySDK.metrics` is a static var the SDK sets once at its start and never again.
@preconcurrency import Sentry
import Synchronization

/// A metric with exactly the name, unit and attributes of the desktop client's (`apps/client/src/telemetry/metrics.ts`),
/// so Observatory's Connections dashboard draws the phone beside the desktop. Durations are in milliseconds.
struct AppMetric: Equatable, Sendable {
    enum Kind: Equatable, Hashable, Sendable {
        case count
        case gauge
        case distribution
    }

    let kind: Kind
    let name: String
    let value: Double
    let attributes: [String: String]

    init(_ measure: LinkMeasure) {
        switch measure {
        case .connected(let path, let outcome, let milliseconds):
            self.init(
                kind: .distribution, name: "link.connect", value: milliseconds,
                attributes: ["path": path.rawValue, "outcome": outcome.rawValue])
        case .reconnecting(let reason):
            self.init(kind: .count, name: "link.reconnect", value: 1, attributes: ["reason": reason.rawValue])
        case .answered(let path, let milliseconds):
            self.init(
                kind: .distribution, name: "request.duration", value: milliseconds, attributes: ["path": path.rawValue])
        }
    }

    /// From opening a project to the first frame its page drew.
    static func workspaceLoad(milliseconds: Double) -> AppMetric {
        AppMetric(kind: .distribution, name: "workspace.load", value: milliseconds, attributes: [:])
    }

    init(kind: Kind, name: String, value: Double, attributes: [String: String]) {
        self.kind = kind
        self.name = name
        self.value = max(0, value)
        self.attributes = attributes
    }
}

/// Metrics gathered for a quarter of an hour and sent as a few items, as `MetricWindow` in `packages/telemetry` does:
/// per name and attributes a counter's sum, a gauge's last value, and of a distribution the median and the maximum,
/// or its one value when it had one.
struct MetricWindow {
    /// What one group keeps of a distribution; past it only the maximum still moves, so memory stays bounded.
    static let maxValues = 2_000

    private struct Key: Hashable {
        let kind: AppMetric.Kind
        let name: String
        let attributes: [String: String]
    }

    private struct Group {
        var values: [Double]
        var sum: Double
        var last: Double
        var max: Double
    }

    private var groups: [Key: Group] = [:]
    /// The keys in the order they first came, so a drain sends in a stable order.
    private var order: [Key] = []

    mutating func record(_ metric: AppMetric) {
        let key = Key(kind: metric.kind, name: metric.name, attributes: metric.attributes)
        guard var group = groups[key] else {
            groups[key] = Group(values: [metric.value], sum: metric.value, last: metric.value, max: metric.value)
            order.append(key)
            return
        }
        group.sum += metric.value
        group.last = metric.value
        group.max = Swift.max(group.max, metric.value)
        if group.values.count < Self.maxValues { group.values.append(metric.value) }
        groups[key] = group
    }

    mutating func drain() -> [AppMetric] {
        defer {
            groups = [:]
            order = []
        }
        return order.flatMap { key -> [AppMetric] in
            guard let group = groups[key] else { return [] }
            let item = { (value: Double) in
                AppMetric(kind: key.kind, name: key.name, value: value, attributes: key.attributes)
            }
            switch key.kind {
            case .count: return [item(group.sum)]
            case .gauge: return [item(group.last)]
            case .distribution:
                return group.values.count == 1 ? [item(group.max)] : [item(Self.median(group.values)), item(group.max)]
            }
        }
    }

    static func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        let middle = sorted.count / 2
        return sorted.count % 2 == 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
    }
}

/// A window that sends itself every quarter of an hour and when the app leaves the screen. A test passes its own
/// `schedule`, which hands back the drain to run on its clock.
final class QuarterMeter: Sendable {
    static let interval: Duration = .seconds(15 * 60)

    private let window = Mutex(MetricWindow())
    private let sink: @Sendable ([AppMetric]) -> Void

    init(
        sink: @escaping @Sendable ([AppMetric]) -> Void,
        schedule: (Duration, @escaping @Sendable () -> Void) -> Void = QuarterMeter.repeating
    ) {
        self.sink = sink
        schedule(Self.interval) { [weak self] in self?.flush() }
    }

    static func repeating(every interval: Duration, _ run: @escaping @Sendable () -> Void) {
        Task.detached(priority: .utility) {
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                run()
            }
        }
    }

    func record(_ metric: AppMetric) {
        window.withLock { $0.record(metric) }
    }

    func flush() {
        let items = window.withLock { $0.drain() }
        if !items.isEmpty { sink(items) }
    }
}

enum AppMetrics {
    /// The attributes a metric may carry: its own and what the SDK adds to describe the build and the device. The
    /// SDK also names the install as `user.id`, which never goes along.
    static let attributes: Set<String> = [
        "path", "outcome", "reason", "surface", "sentry.sdk.name", "sentry.sdk.version", "sentry.environment",
        "sentry.release", "os.name", "os.version", "device.brand", "device.model", "device.family",
    ]

    /// Nil outside a build that ships, so nothing is gathered there.
    private static let meter: QuarterMeter? = CrashReports.enabled ? QuarterMeter { send($0) } : nil

    static func record(_ metric: AppMetric) { meter?.record(metric) }

    static func flush() { meter?.flush() }

    private static func send(_ items: [AppMetric]) {
        for item in items {
            let attributes = item.attributes.mapValues { $0 as any SentryAttributeValue }
            switch item.kind {
            case .count:
                SentrySDK.metrics.count(key: item.name, value: UInt(item.value), attributes: attributes)
            case .gauge:
                SentrySDK.metrics.gauge(key: item.name, value: item.value, unit: nil, attributes: attributes)
            case .distribution:
                SentrySDK.metrics.distribution(
                    key: item.name, value: item.value, unit: .millisecond, attributes: attributes)
            }
        }
    }
}

/// `workspace.load` for one opening of a project: from the moment it opens to the first frame its page drew once the
/// project was there. A page that shows the same opening again measures nothing.
@MainActor final class WorkspaceLoad {
    private var openedAt: Double?
    private let now: @MainActor () -> Double
    private let nextFrame: @MainActor (@escaping @MainActor () -> Void) -> Void
    private let record: @MainActor (AppMetric) -> Void

    init(
        now: @escaping @MainActor () -> Double = { ProcessInfo.processInfo.systemUptime * 1_000 },
        nextFrame: @escaping @MainActor (@escaping @MainActor () -> Void) -> Void = { run in
            DispatchQueue.main.async { MainActor.assumeIsolated(run) }
        },
        record: @escaping @MainActor (AppMetric) -> Void = { AppMetrics.record($0) }
    ) {
        self.now = now
        self.nextFrame = nextFrame
        self.record = record
        openedAt = now()
    }

    /// The project is there and its page shows it; the measurement ends at the turn of the run loop after, once the
    /// frame was committed.
    func shown() {
        guard let started = openedAt else { return }
        openedAt = nil
        nextFrame { [now, record] in record(.workspaceLoad(milliseconds: now() - started)) }
    }
}
