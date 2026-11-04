import Foundation
import RuimteTransport
import Synchronization
import XCTest

@testable import Ruimte

@MainActor final class AppMetricsTests: XCTestCase {
    private func shape(_ metric: AppMetric) -> String { Self.describe(metric) }

    nonisolated private static func describe(_ metric: AppMetric) -> String {
        let attributes = metric.attributes.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }
        return "\(metric.kind) \(metric.name) \(metric.value) \(attributes.joined(separator: ","))"
    }

    // The names, kinds and attributes of `PageMetric` in `apps/client/src/telemetry/metrics.ts`.
    func testAMeasurementIsTheDesktopsMetric() {
        XCTAssertEqual(
            shape(AppMetric(.connected(path: .lan, outcome: .ok, milliseconds: 812))),
            "distribution link.connect 812.0 outcome=ok,path=lan")
        XCTAssertEqual(
            shape(AppMetric(.connected(path: .turn, outcome: .failed, milliseconds: -3))),
            "distribution link.connect 0.0 outcome=failed,path=turn")
        XCTAssertEqual(shape(AppMetric(.reconnecting(.switch))), "count link.reconnect 1.0 reason=switch")
        XCTAssertEqual(
            shape(AppMetric(.answered(path: .direct, milliseconds: 40))),
            "distribution request.duration 40.0 path=direct")
        XCTAssertEqual(shape(.workspaceLoad(milliseconds: 260)), "distribution workspace.load 260.0 ")
    }

    func testEveryAttributeOfAMetricIsOneItMayCarry() {
        let metrics = [
            AppMetric(.connected(path: .direct, outcome: .ok, milliseconds: 1)), AppMetric(.reconnecting(.dropped)),
            AppMetric(.answered(path: .lan, milliseconds: 1)),
        ]
        for metric in metrics {
            XCTAssertTrue(Set(metric.attributes.keys).isSubset(of: AppMetrics.attributes), metric.name)
        }
        XCTAssertFalse(AppMetrics.attributes.contains("user.id"))
    }

    func testAQuarterSendsACountsSumAGaugesLastAndADistributionsMedianAndMaximum() {
        let sent = Mutex<[[String]]>([])
        var tick: (@Sendable () -> Void)?
        var every: Duration?
        let meter = QuarterMeter(
            sink: { items in sent.withLock { $0.append(items.map(Self.describe)) } },
            schedule: { interval, run in
                every = interval
                tick = run
            })
        XCTAssertEqual(every, .seconds(900))
        for value in [40.0, 10, 30, 200] {
            meter.record(AppMetric(.answered(path: .direct, milliseconds: value)))
        }
        meter.record(AppMetric(.answered(path: .lan, milliseconds: 12)))
        meter.record(AppMetric(.reconnecting(.dropped)))
        meter.record(AppMetric(.reconnecting(.dropped)))
        meter.record(AppMetric(.reconnecting(.switch)))
        meter.record(AppMetric(kind: .gauge, name: "queue", value: 3, attributes: [:]))
        meter.record(AppMetric(kind: .gauge, name: "queue", value: 1, attributes: [:]))
        XCTAssertTrue(sent.withLock { $0.isEmpty }, "nothing goes out before the quarter ends")

        tick?()
        XCTAssertEqual(
            sent.withLock { $0 },
            [
                [
                    "distribution request.duration 35.0 path=direct", "distribution request.duration 200.0 path=direct",
                    "distribution request.duration 12.0 path=lan", "count link.reconnect 2.0 reason=dropped",
                    "count link.reconnect 1.0 reason=switch", "gauge queue 1.0 ",
                ]
            ])
        tick?()
        XCTAssertEqual(sent.withLock { $0.count }, 1, "an empty quarter sends nothing")
        meter.record(AppMetric(.answered(path: .direct, milliseconds: 7)))
        meter.flush()
        XCTAssertEqual(sent.withLock { $0.last }, ["distribution request.duration 7.0 path=direct"])
    }

    func testADistributionKeepsABoundedShareOfItsValuesAndEveryMaximum() {
        var window = MetricWindow()
        for index in 0..<(MetricWindow.maxValues + 10) {
            window.record(AppMetric(.answered(path: .direct, milliseconds: Double(index % 3))))
        }
        window.record(AppMetric(.answered(path: .direct, milliseconds: 9_000)))
        XCTAssertEqual(window.drain().map(\.value), [1, 9_000])
        XCTAssertTrue(window.drain().isEmpty)
        XCTAssertEqual(MetricWindow.median([3, 1, 2]), 2)
    }

    func testAnOpeningIsTimedToTheFrameAfterItsPageShowedIt() {
        var clock = 1_000.0
        var frames: [@MainActor () -> Void] = []
        var recorded: [AppMetric] = []
        let load = WorkspaceLoad(now: { clock }, nextFrame: { frames.append($0) }, record: { recorded.append($0) })
        clock += 300
        load.shown()
        clock += 16
        for frame in frames { frame() }
        load.shown()
        XCTAssertEqual(frames.count, 1)
        XCTAssertEqual(recorded, [.workspaceLoad(milliseconds: 316)])
    }
}
