import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class ProcessesTests: XCTestCase {
    private func alert(_ kind: String, node: String? = nil, pid: Int? = nil, value: Double? = nil) -> ProcessAlert {
        ProcessWire.alert(kind, node: node, pid: pid, value: value).processAlert
    }

    func testNumbersThatCouldNotBeReadShowAsADashRatherThanZero() {
        XCTAssertEqual(ProcessesText.percent(nil), "-")
        XCTAssertEqual(ProcessesText.percent(4.26), "4.3%")
        XCTAssertEqual(ProcessesText.percent(42.4), "42%")
        XCTAssertEqual(ProcessesText.rate(nil), "-")
        XCTAssertNil(ProcessesText.disk(read: nil, write: nil))
        XCTAssertEqual(ProcessesText.disk(read: 2, write: nil), 2)
    }

    func testAWarningReadsAsOneSentenceWithTheButtonThatFits() {
        XCTAssertEqual(ProcessesText.alert(alert("silent"), now: 120_000), "Working, but silent for 2m")
        XCTAssertEqual(ProcessesText.alert(alert("memory", value: 2048), now: 0), "bun uses 2 KB")
        XCTAssertEqual(ProcessesText.actions(alert("busy-after-turn")), [.show, .terminate])
        XCTAssertEqual(ProcessesText.actions(alert("agent-gone")), [.resume])
        XCTAssertEqual(ProcessesText.actions(alert("orphan")), [.terminate])
    }

    func testAGroupIsNamedAfterItsNodeAndAWarningSitsUnderItsGroup() {
        let groups = [
            ProcessWire.group("g1", node: "t1", rows: [ProcessWire.row(10)]).processGroup,
            ProcessWire.group("g2", node: "elsewhere", rows: [ProcessWire.row(20)]).processGroup,
            ProcessWire.group("g3", node: "launch", label: "dev", rows: [ProcessWire.row(30)]).processGroup,
            ProcessWire.group("g4", kind: "other", rows: [ProcessWire.row(40, readable: false)]).processGroup,
        ]
        let titles = ["t1": "Shell"]
        XCTAssertTrue(ProcessesText.groupTitle(groups[0], titles: titles) == ("Shell", true))
        XCTAssertTrue(ProcessesText.groupTitle(groups[1], titles: titles) == ("Terminal", false))
        XCTAssertTrue(ProcessesText.groupTitle(groups[2], titles: titles) == ("dev", true))
        XCTAssertTrue(ProcessesText.groupTitle(groups[3], titles: titles) == ("Other processes", true))
        XCTAssertEqual(ProcessesText.placement(alert("silent", node: "t1"), groups: groups), "g1")
        XCTAssertEqual(ProcessesText.placement(alert("orphan", pid: 20), groups: groups), "g2")
        XCTAssertNil(ProcessesText.placement(alert("orphan", pid: 99), groups: groups))
        XCTAssertNotNil(groups[0].signalableRoot)
        XCTAssertNil(groups[3].signalableRoot)
        XCTAssertFalse(groups[3].processes[0].signalable)
    }

    @MainActor func testASampleOfTheScopeBeforeKeepsItsPointsButNotItsRows() async {
        let machine = ProcessesMachine()
        let model = ProcessesModel(client: machine, defaults: defaults())
        machine.subscribeResult = ProcessWire.subscribed(
            sample: ProcessWire.sample(scope: "ruimte", at: 1, groups: [ProcessWire.group("g1", node: "t1")]))
        await model.subscribe()
        XCTAssertEqual(model.supported, true)
        XCTAssertEqual(model.sample?.groups.map(\.id), ["g1"])
        XCTAssertEqual(machine.sent.first?.1, .object(["scope": .string("ruimte"), "sort": .string("cpu")]))
        model.apply(ProcessWire.sample(scope: "all", at: 2, groups: []).processSample)
        XCTAssertEqual(model.sample?.groups.map(\.id), ["g1"])
        XCTAssertEqual(model.fine.count, 1)
        model.apply(ProcessWire.sample(scope: "ruimte", at: 3, groups: [], reset: true).processSample)
        XCTAssertEqual(model.sample?.groups.count, 0)
        XCTAssertEqual(model.fine.map(\.at), [3])
    }

    @MainActor func testARefusedSubscriptionShowsTheMachinesMessage() async {
        let machine = ProcessesMachine()
        machine.refusal = "forbidden"
        let model = ProcessesModel(client: machine, defaults: defaults())
        await model.subscribe()
        XCTAssertEqual(model.problem, "forbidden")
    }

    @MainActor func testASignalNamesTheProcessByItsStartTimeAndAChatIsInterruptedThroughItsTurn() async {
        let machine = ProcessesMachine()
        let model = ProcessesModel(client: machine, defaults: defaults())
        model.receive(
            ProcessWire.subscribed(
                sample: ProcessWire.sample(
                    scope: "ruimte", at: 1,
                    groups: [ProcessWire.group("g1", kind: "chat", node: "c1", rows: [ProcessWire.row(10)])])
            ).processSubscribed)
        await model.signal(ProcessTarget(pid: 10, startTime: 100, name: "bun"), .kill)
        XCTAssertEqual(machine.sent.last?.0, .processesSignal)
        XCTAssertEqual(
            machine.sent.last?.1,
            .object(["pid": .number(10), "startTime": .number(100), "signal": .string("SIGKILL")]))
        await model.act(alert("silent", node: "c1", pid: 10), .interrupt)
        XCTAssertEqual(machine.sent.last?.0, .chatCancel)
        await model.act(alert("orphan", pid: 10), .terminate)
        XCTAssertEqual(machine.sent.last?.1["signal"], .string("SIGTERM"))
        await model.act(alert("busy-after-turn", node: "c1", pid: 10), .show)
        XCTAssertTrue(model.opened.contains("g1"))
        XCTAssertEqual(model.highlight?.pid, 10)
    }

    private func defaults() -> UserDefaults {
        let name = "processes-tests-\(UUID().uuidString)"
        return UserDefaults(suiteName: name) ?? .standard
    }
}

@MainActor private final class ProcessesMachine: MachineRequesting {
    var sent: [(WireRequest, JSONValue)] = []
    var refusal: String?
    var subscribeResult: JSONValue = ProcessWire.subscribed(supported: false)

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        if let refusal { throw MachineClientError.server(code: refusal, message: refusal) }
        switch type {
        case .processesSubscribe: return subscribeResult
        case .processesListAlerts: return .object(["alerts": .array([])])
        default: return .object([:])
        }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
