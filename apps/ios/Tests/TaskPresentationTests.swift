import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class TaskPresentationTests: XCTestCase {
    @MainActor func testAWakeTurnSaysHowManyTasksWokeIt() {
        let turn = JSONValue.object(["kind": .string("turn"), "label": .string("Tests")])
        XCTAssertEqual(ChatPresentation.agentTurnLabel(turn), "Sub-agent finished: Tests")
        XCTAssertEqual(
            ChatPresentation.agentTurnLabel(turn.setting("taskIds", .array([.string("a")]))), "Woken by a task: Tests")
        XCTAssertEqual(
            ChatPresentation.agentTurnLabel(
                .object(["kind": .string("turn"), "taskIds": .array([.string("a"), .string("b")])])),
            "Woken by 2 tasks")
        XCTAssertEqual(ChatPresentation.agentTurnLabel(.object(["kind": .string("turn")])), "Continued on its own")
    }

    @MainActor func testATurnTheMachineCouldNotResumeIsNotStoppedByYou() {
        let turn = JSONValue.object([
            "id": .string("t1"), "turnId": .string("t1"), "kind": .string("turn"), "state": .string("aborted"),
            "createdAt": .number(0), "endedAt": .number(4000),
        ])
        XCTAssertEqual(ChatPresentation.turnLabel(turn), "You stopped after 4s")
        let note = JSONValue.object([
            "kind": .string("note"), "turnId": .string("t1"), "level": .string("warning"),
            "text": .string("This turn could not be resumed after the machine restarted: gone"),
        ])
        XCTAssertEqual(ChatPresentation.turnLabel(turn, items: [note]), "Stopped after 4s")
        XCTAssertEqual(
            ChatPresentation.turnLabel(turn, items: [note.setting("turnId", .string("other"))]),
            "You stopped after 4s")
    }

    @MainActor func testAChildShowsItsNewestTaskAndAProjectAnswerReplacesItsOwn() {
        let store = TaskStore(client: TaskListMachine())
        store.put(task("old", project: "p", child: "c", created: 1, status: "done"))
        store.put(task("new", project: "p", child: "c", created: 2, status: "open"))
        store.put(task("other", project: "q", child: "d", created: 1, status: "failed"))
        XCTAssertEqual(store.childTask("c")?.text("id"), "new")
        store.setProjectTasks("p", [task("only", project: "p", child: "c", created: 3, status: "cancelled")])
        XCTAssertEqual(Set(store.tasks.keys), ["only", "other"])
        XCTAssertEqual(store.childTask("c")?.text("status"), "cancelled")
    }

    private func task(_ id: String, project: String, child: String, created: Double, status: String) -> JSONValue {
        .object([
            "id": .string(id), "projectId": .string(project), "childId": .string(child),
            "createdAt": .number(created), "status": .string(status),
        ])
    }
}

@MainActor private final class TaskListMachine: MachineRequesting {
    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        throw MachineClientError.server(code: "unknown-request", message: "Unknown request")
    }
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
