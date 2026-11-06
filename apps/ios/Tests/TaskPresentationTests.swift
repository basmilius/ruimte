import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class TaskPresentationTests: XCTestCase {
    @MainActor func testAWakeTurnSaysHowManyTasksWokeIt() {
        let turn: [String: JSONValue] = ["kind": .string("turn"), "label": .string("Tests")]
        XCTAssertEqual(ChatPresentation.agentTurnLabel(Self.turn(turn)), "Background task finished: Tests")
        XCTAssertEqual(
            ChatPresentation.agentTurnLabel(Self.turn(turn.merging(["taskToolUseId": .string("spawn")]) { $1 })),
            "Sub-agent finished: Tests")
        XCTAssertEqual(
            ChatPresentation.agentTurnLabel(Self.turn(turn.merging(["taskIds": .array([.string("a")])]) { $1 })),
            "Woken by a task: Tests")
        XCTAssertEqual(
            ChatPresentation.agentTurnLabel(
                Self.turn(["kind": .string("turn"), "taskIds": .array([.string("a"), .string("b")])])),
            "Woken by 2 tasks")
        XCTAssertEqual(ChatPresentation.agentTurnLabel(Self.turn(["kind": .string("turn")])), "Continued on its own")
    }

    @MainActor func testAWakeTurnSaysHowManyMessagesWokeItAndFromWhom() {
        let from = { (ids: [String], label: String) in
            Self.turn([
                "kind": .string("turn"), "label": .string(label), "messageFrom": .array(ids.map(JSONValue.string)),
            ])
        }
        XCTAssertEqual(
            ChatPresentation.agentTurnLabel(from(["chat-2"], "Message from Lexer")),
            "Woken by a message: Message from Lexer")
        XCTAssertEqual(
            ChatPresentation.agentTurnLabel(from(["chat-2", "chat-3"], "Messages from Lexer, Docs")),
            "Woken by 2 messages: Messages from Lexer, Docs")
        XCTAssertEqual(
            ChatPresentation.agentTurnLabel(
                Self.turn(["kind": .string("turn"), "messageFrom": .array([.string("chat-2")])])),
            "Woken by a message")
    }

    @MainActor func testATurnTheMachineCouldNotResumeIsNotStoppedByYou() {
        let turn = Self.turn([
            "id": .string("t1"), "turnId": .string("t1"), "kind": .string("turn"), "state": .string("aborted"),
            "createdAt": .number(0), "endedAt": .number(4000),
        ])
        XCTAssertEqual(ChatPresentation.turnLabel(turn), "You stopped after 4s")
        let note = ChatWire.item([
            "kind": .string("note"), "turnId": .string("t1"), "level": .string("warning"),
            "text": .string("This turn could not be resumed after the machine restarted: gone"),
        ])
        XCTAssertEqual(ChatPresentation.turnLabel(turn, items: [note.chatItem]), "Stopped after 4s")
        XCTAssertEqual(
            ChatPresentation.turnLabel(turn, items: [note.setting("turnId", .string("other")).chatItem]),
            "You stopped after 4s")
    }

    private static func turn(_ fields: [String: JSONValue]) -> ChatTurnItem {
        ChatWire.item(fields).chatItem.turnItem!
    }

    @MainActor func testAChildShowsItsNewestTaskAndAProjectAnswerReplacesItsOwn() {
        let store = TaskStore(client: TaskListMachine())
        store.put(TaskWire.task("old", project: "p", child: "c", created: 1, status: "done"))
        store.put(TaskWire.task("new", project: "p", child: "c", created: 2, status: "open"))
        store.put(TaskWire.task("other", project: "q", child: "d", created: 1, status: "failed"))
        XCTAssertEqual(store.childTask("c")?.id, "new")
        store.setProjectTasks("p", [TaskWire.task("only", project: "p", child: "c", created: 3, status: "cancelled")])
        XCTAssertEqual(Set(store.tasks.keys), ["only", "other"])
        XCTAssertEqual(store.childTask("c")?.status, .cancelled)
    }
}

@MainActor private final class TaskListMachine: MachineRequesting {
    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        throw MachineClientError.server(code: "internal", message: "Failed")
    }
    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
