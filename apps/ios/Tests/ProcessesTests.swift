import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class ProcessesTests: XCTestCase {
    private func row(_ pid: Int, start: Double = 100, readable: Bool = true) -> JSONValue {
        .object([
            "pid": .number(Double(pid)), "startTime": .number(start), "ppid": .number(1), "name": .string("bun"),
            "path": .null, "readable": .bool(readable), "cpu": .number(3), "memory": .number(2048),
            "diskRead": .null, "diskWrite": .null, "family": .null, "depth": .number(0),
        ])
    }

    private func group(_ id: String, kind: String, node: String?, rows: [JSONValue], label: String? = nil) -> JSONValue {
        var fields: [String: JSONValue] = [
            "id": .string(id), "kind": .string(kind), "nodeId": node.map(JSONValue.string) ?? .null,
            "cpu": .number(3), "memory": .number(2048), "diskRead": .null, "diskWrite": .null,
            "processes": .array(rows), "hidden": .number(0),
        ]
        if let label { fields["label"] = .string(label) }
        return .object(fields)
    }

    private func sample(scope: String, at: Double, groups: [JSONValue], point: Bool = true, reset: Bool = false)
        -> JSONValue
    {
        .object([
            "at": .number(at), "scope": .string(scope),
            "machine": .object(["cores": .number(8), "cpu": .number(12), "memoryUsed": .number(1), "memoryTotal": .number(2)]),
            "groups": .array(groups), "fine": point ? .object(["at": .number(at), "cpu": .number(12)]) : .null,
            "coarse": .null, "reset": .bool(reset),
        ])
    }

    private func alert(_ kind: String, node: String? = nil, pid: Int? = nil, value: Double? = nil) -> ProcessAlert {
        ProcessAlert(
            json: .object([
                "id": .string("a1"), "kind": .string(kind), "nodeId": node.map(JSONValue.string) ?? .null,
                "pid": pid.map { .number(Double($0)) } ?? .null, "startTime": pid == nil ? .null : .number(100),
                "name": .string("bun"), "since": .number(0), "value": value.map(JSONValue.number) ?? .null,
            ]))
    }

    func testNumbersThatCouldNotBeReadShowAsADashRatherThanZero() {
        XCTAssertEqual(ProcessesText.percent(nil), "-")
        XCTAssertEqual(ProcessesText.percent(4.26), "4.3%")
        XCTAssertEqual(ProcessesText.percent(42.4), "42%")
        XCTAssertEqual(ProcessesText.rate(nil), "-")
        XCTAssertNil(ProcessesText.disk(read: nil, write: nil))
        XCTAssertEqual(ProcessesText.disk(read: 2, write: nil), 2)
        XCTAssertEqual(ProcessesText.duration(3_725_000), "1h 2m")
        XCTAssertEqual(ProcessesText.duration(65_000), "1m 5s")
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
            ProcessGroup(json: group("g1", kind: "terminal", node: "t1", rows: [row(10)])),
            ProcessGroup(json: group("g2", kind: "terminal", node: "elsewhere", rows: [row(20)])),
            ProcessGroup(json: group("g3", kind: "terminal", node: "launch", rows: [row(30)], label: "dev")),
            ProcessGroup(json: group("g4", kind: "other", node: nil, rows: [row(40, readable: false)])),
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
        machine.subscribeResult = .object([
            "supported": .bool(true), "fineIntervalMs": .number(2000), "coarseIntervalMs": .number(300_000),
            "fine": .array([]), "coarse": .array([]),
            "sample": sample(scope: "ruimte", at: 1, groups: [group("g1", kind: "terminal", node: "t1", rows: [])]),
        ])
        await model.subscribe()
        XCTAssertEqual(model.supported, true)
        XCTAssertEqual(model.sample?.groups.map(\.id), ["g1"])
        XCTAssertEqual(machine.sent.first?.1, .object(["scope": .string("ruimte"), "sort": .string("cpu")]))
        model.apply(ProcessSample(json: sample(scope: "all", at: 2, groups: [])))
        XCTAssertEqual(model.sample?.groups.map(\.id), ["g1"])
        XCTAssertEqual(model.fine.count, 1)
        model.apply(ProcessSample(json: sample(scope: "ruimte", at: 3, groups: [], reset: true)))
        XCTAssertEqual(model.sample?.groups.count, 0)
        XCTAssertEqual(model.fine.map(\.at), [3])
    }

    @MainActor func testAnOlderMachineSaysItNeedsAnUpdate() async {
        let machine = ProcessesMachine()
        machine.refusal = "unknown-request"
        let model = ProcessesModel(client: machine, defaults: defaults())
        await model.subscribe()
        XCTAssertTrue(model.unsupportedMachine)
        XCTAssertNil(model.problem)
    }

    @MainActor func testASignalNamesTheProcessByItsStartTimeAndAChatIsInterruptedThroughItsTurn() async {
        let machine = ProcessesMachine()
        let model = ProcessesModel(client: machine, defaults: defaults())
        model.receive(
            .object([
                "supported": .bool(true), "fine": .array([]), "coarse": .array([]),
                "sample": sample(scope: "ruimte", at: 1, groups: [group("g1", kind: "chat", node: "c1", rows: [row(10)])]),
            ]))
        await model.signal(ProcessTarget(pid: 10, startTime: 100, name: "bun"), .kill)
        XCTAssertEqual(machine.sent.last?.0, "processes.signal")
        XCTAssertEqual(
            machine.sent.last?.1,
            .object(["pid": .number(10), "startTime": .number(100), "signal": .string("SIGKILL")]))
        await model.act(alert("silent", node: "c1", pid: 10), .interrupt)
        XCTAssertEqual(machine.sent.last?.0, "chat.cancel")
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
    var sent: [(String, JSONValue)] = []
    var refusal: String?
    var subscribeResult: JSONValue = .object(["supported": .bool(false), "fine": .array([]), "coarse": .array([])])

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        if let refusal { throw MachineClientError.server(code: refusal, message: refusal) }
        switch type {
        case "processes.subscribe": return subscribeResult
        case "processes.listAlerts": return .object(["alerts": .array([])])
        default: return .object([:])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
