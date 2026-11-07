import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class SessionEndingTests: XCTestCase {
    private let canvas = ProjectWire.item(
        .object([
            "id": .string("v1"), "kind": .string("canvas"),
            "nodes": .array([
                .object(["id": .string("n1"), "kind": .string("chat")]),
                .object(["id": .string("n2"), "kind": .string("terminal")]),
                .object(["id": .string("n3"), "kind": .string("note")]),
            ]),
        ]))

    func testAViewOrACanvasTakesItsChatsAndTerminalsAlongWhenItGoes() {
        let chat = ProjectWire.item(.object(["id": .string("c1"), "kind": .string("chat")]))
        let terminal = ProjectWire.item(.object(["id": .string("t1"), "kind": .string("terminal")]))
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
                + "Also ends the agent it opened. Its node and work so far stay on the canvas.")
    }

    @MainActor func testTheQuestionCountsTheAgentsOfEveryGoingSessionOnce() async {
        let machine = ScriptedMachine.ending()
        let question = await SessionEnding.question(for: canvas, client: machine)
        XCTAssertEqual(question.chats, ["n1"])
        XCTAssertEqual(question.terminals, ["n2"])
        XCTAssertEqual(
            question.warning,
            "The chat ends on this machine, and its conversation is gone. "
                + "The terminal ends on this machine, with everything running in it. "
                + "Also ends the agent it opened. Its node and work so far stay on the canvas.")
        XCTAssertEqual(machine.payloads(of: .agentChildren, key: "nodeId"), ["n1", "n2"])
    }

    @MainActor func testAViewWithoutSessionsAsksNothingOfTheMachine() async {
        let machine = ScriptedMachine.ending()
        let question = await SessionEnding.question(
            for: ProjectWire.item(.object(["id": .string("d1"), "kind": .string("drawing")])), client: machine)
        XCTAssertEqual(question, SessionEnding.Question())
        XCTAssertTrue(machine.sent.isEmpty)
    }

    @MainActor func testEndingTerminalsKillsEachSessionAndShrugsOffAShellThatIsGone() async {
        let machine = ScriptedMachine.ending(gone: ["t1"])
        await SessionEnding.endTerminals(["t1", "t2"], client: machine)
        XCTAssertEqual(machine.payloads(of: .sessionKill, key: "sessionId"), ["t1", "t2"])
    }
}

extension ScriptedMachine {
    /// A machine whose agents all name the same child, and whose chat names the terminal that goes with it.
    fileprivate static func ending(gone: Set<String> = []) -> ScriptedMachine {
        ScriptedMachine([
            .agentChildren: { _ in .object(["nodeIds": .array([.string("child"), .string("n2")])]) },
            .sessionKill: { payload in
                if gone.contains(payload.text("sessionId")) {
                    throw MachineClientError.server(code: "not-found", message: "No such session")
                }
                return .object([:])
            },
        ])
    }

    fileprivate func payloads(of type: WireRequest, key: String) -> [String] {
        sent.filter { $0.type == type }.map { $0.payload.text(key) }
    }
}
