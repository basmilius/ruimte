import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class AttentionStoreTests: XCTestCase {
    @MainActor func testUnreadEntriesFromWhenTheMachineMarksBecomeMarks() async {
        let machine = AttentionMachine(
            snapshot: .object([
                "marksFrom": .number(100),
                "entries": .array([
                    entry("failed-task", issued: 150, read: 0),
                    entry("read-turn", issued: 160, read: 160),
                    entry("before-marks", issued: 50, read: 0),
                ]),
            ]))
        let store = AttentionStore(client: machine)
        store.start()
        defer { store.stop() }
        await machine.waitForLists()
        XCTAssertEqual(store.unseen, ["failed-task"])
        machine.push?(entry("failed-task", issued: 150, read: 150))
        XCTAssertTrue(store.unseen.isEmpty)
    }

    @MainActor func testAMachineThatNeverSaysWhenMarksStartLeavesEntriesUnmarked() async {
        let machine = AttentionMachine(snapshot: .object(["entries": .array([entry("old", issued: 150, read: 0)])]))
        let store = AttentionStore(client: machine)
        store.start()
        defer { store.stop() }
        await machine.waitForLists()
        XCTAssertTrue(store.unseen.isEmpty)
    }

    private func entry(_ id: String, issued: Double, read: Double) -> JSONValue {
        .object(["nodeId": .string(id), "issuedAt": .number(issued), "readThrough": .number(read)])
    }
}

@MainActor private final class AttentionMachine: MachineRequesting {
    let snapshot: JSONValue
    var push: (@MainActor @Sendable (JSONValue) -> Void)?
    private var listed = false
    private var waiter: CheckedContinuation<Void, Never>?

    init(snapshot: JSONValue) { self.snapshot = snapshot }

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        switch type {
        case "push.attention": return snapshot
        case "session.list": return .object(["sessions": .array([])])
        default:
            defer {
                listed = true
                waiter?.resume()
                waiter = nil
            }
            return .object(["chats": .array([])])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        if event == "push.attention" { push = handler }
        return {}
    }

    func waitForLists() async {
        if !listed { await withCheckedContinuation { waiter = $0 } }
        // The chat list answer is applied after the request returns.
        for _ in 0..<5 { await Task.yield() }
    }
}

final class SessionReadingTests: XCTestCase {
    func testALiveAgentSaysWhatTheSessionIsDoing() {
        XCTAssertEqual(reading(agent: agent("running", live: true)).status, "running")
        XCTAssertEqual(reading(agent: agent("needs-you", live: true)).status, "needs-you")
    }

    func testARecordLeftBehindByARestartedDaemonIsNotRunning() {
        XCTAssertNil(reading(agent: agent("running", live: false)).status)
        XCTAssertEqual(reading(agent: agent("exited", live: false)).status, "exited")
        XCTAssertEqual(reading(agent: agent("running", live: false), shellExited: true).status, "error")
    }

    func testAShellWithoutAnAgentReadsFromItself() {
        XCTAssertNil(reading().status)
        XCTAssertEqual(reading(attached: true).status, "running")
        XCTAssertEqual(reading(shellExited: true).status, "error")
    }

    @MainActor func testTheStoreStopsCallingADeadAgentRunning() {
        let store = AttentionStore(client: AttentionMachine(snapshot: .object([:])))
        store.read("terminal") { $0.agent = agent("running", live: true) }
        XCTAssertEqual(store.statuses["terminal"], "running")
        store.read("terminal") { $0.agent = agent("running", live: false) }
        XCTAssertEqual(store.statuses["terminal"], "idle")
    }

    private func reading(agent: JSONValue? = nil, shellExited: Bool = false, attached: Bool = false) -> SessionReading {
        SessionReading(agent: agent, shellExited: shellExited, attached: attached)
    }

    private func agent(_ status: String, live: Bool) -> JSONValue {
        .object(["kind": .string("claude"), "status": .string(status), "live": .bool(live)])
    }
}
