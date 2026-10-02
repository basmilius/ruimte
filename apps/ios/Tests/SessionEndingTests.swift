import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class SessionEndingTests: XCTestCase {
    private let canvas = JSONValue.object([
        "id": .string("v1"), "kind": .string("canvas"),
        "nodes": .array([
            .object(["id": .string("n1"), "kind": .string("chat")]),
            .object(["id": .string("n2"), "kind": .string("terminal")]),
            .object(["id": .string("n3"), "kind": .string("note")]),
        ]),
    ])

    func testAViewOrACanvasTakesItsChatsAndTerminalsAlongWhenItGoes() {
        let chat = JSONValue.object(["id": .string("c1"), "kind": .string("chat")])
        let terminal = JSONValue.object(["id": .string("t1"), "kind": .string("terminal")])
        XCTAssertEqual(SessionEnding.chats(in: chat), ["c1"])
        XCTAssertEqual(SessionEnding.terminals(in: chat), [])
        XCTAssertEqual(SessionEnding.terminals(in: terminal), ["t1"])
        XCTAssertEqual(SessionEnding.chats(in: canvas), ["n1"])
        XCTAssertEqual(SessionEnding.terminals(in: canvas), ["n2"])
    }

    func testADeleteSaysWhatEndsAndCountsTheAgentsTheyOpened() {
        XCTAssertNil(SessionEnding.warning(chats: 0, terminals: 0, agents: 3))
        XCTAssertEqual(
            SessionEnding.warning(chats: 1, agents: 0), "The chat ends on this machine, and its conversation is gone.")
        XCTAssertEqual(
            SessionEnding.warning(chats: 0, terminals: 1, agents: 0),
            "The terminal ends on this machine, with everything running in it.")
        XCTAssertEqual(
            SessionEnding.warning(chats: 2, terminals: 2, agents: 1),
            "Its 2 chats end on this machine, and their conversations are gone. "
                + "Its 2 terminals end on this machine, with everything running in them. "
                + "Also ends the agent it opened. Its node stays on the canvas with what it did so far.")
    }

    @MainActor func testTheQuestionCountsTheAgentsOfEveryGoingSessionOnce() async {
        let machine = EndingMachine()
        let question = await SessionEnding.question(for: canvas, client: machine)
        XCTAssertEqual(question.chats, ["n1"])
        XCTAssertEqual(question.terminals, ["n2"])
        XCTAssertEqual(
            question.warning,
            "The chat ends on this machine, and its conversation is gone. "
                + "The terminal ends on this machine, with everything running in it. "
                + "Also ends the agent it opened. Its node stays on the canvas with what it did so far.")
        XCTAssertEqual(machine.asked, ["n1", "n2"])
    }

    @MainActor func testAViewWithoutSessionsAsksNothingOfTheMachine() async {
        let machine = EndingMachine()
        let question = await SessionEnding.question(
            for: .object(["id": .string("d1"), "kind": .string("drawing")]), client: machine)
        XCTAssertEqual(question, SessionEnding.Question())
        XCTAssertTrue(machine.asked.isEmpty)
    }

    @MainActor func testEndingTerminalsKillsEachSessionAndShrugsOffAShellThatIsGone() async {
        let machine = EndingMachine()
        machine.gone = ["t1"]
        await SessionEnding.endTerminals(["t1", "t2"], client: machine)
        XCTAssertEqual(machine.killed, ["t1", "t2"])
    }
}

@MainActor private final class EndingMachine: MachineRequesting {
    var asked: [String] = []
    var killed: [String] = []
    var gone: Set<String> = []

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        switch type {
        case "agent.children":
            let node = payload.text("nodeId")
            asked.append(node)
            // Both sessions name the same child, and the chat names the terminal that goes with it.
            return .object(["nodeIds": .array([.string("child"), .string("n2")])])
        case "session.kill":
            let id = payload.text("sessionId")
            killed.append(id)
            if gone.contains(id) { throw MachineClientError.server(code: "not-found", message: "No such session") }
            return .object([:])
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
