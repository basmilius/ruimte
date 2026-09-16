import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class ChatForkingTests: XCTestCase {
    private let info: JSONValue = .object([
        "provider": .string("claude"), "agentSessionId": .string("session"), "activeTurnId": .null,
        "selection": .object(["model": .string("opus"), "options": .object([:])]),
    ])

    func testRefusesATurnThatCannotBeForkedYet() {
        let turn = self.turn("t1", state: "done")
        XCTAssertNil(ChatForking.refusal(info: info, turn: turn))
        XCTAssertEqual(ChatForking.refusal(info: .null, turn: turn), "This turn is not in the conversation")
        XCTAssertEqual(ChatForking.refusal(info: info, turn: nil), "This turn is not in the conversation")
        XCTAssertEqual(
            ChatForking.refusal(info: info.setting("provider", .string("gemini")), turn: turn),
            "This CLI has no conversation to fork")
        XCTAssertEqual(
            ChatForking.refusal(info: info.setting("agentSessionId", .null), turn: turn),
            "The CLI never started a conversation here")
        XCTAssertEqual(
            ChatForking.refusal(info: info, turn: self.turn("t2", state: "running")), "Wait for the turn to end")
        XCTAssertEqual(
            ChatForking.refusal(info: info.setting("activeTurnId", .string("t2")), turn: turn),
            "Wait for the turn to end")
    }

    func testSummaryWaitsForTheOriginalAndAnIdleFork() {
        XCTAssertNil(ChatForking.summaryRefusal(info: info, originalPresent: true))
        XCTAssertEqual(
            ChatForking.summaryRefusal(info: info, originalPresent: false), "The original is no longer in this project")
        XCTAssertEqual(
            ChatForking.summaryRefusal(info: info.setting("activeTurnId", .string("t")), originalPresent: true),
            "Wait for the turn to end")
    }

    @MainActor func testForkPointNamesTheTurnAndCountsOnlyAWholeHistory() {
        let items = [
            turn("t1", state: "done"), user("u1", turn: "t1", text: "\n  First question  \nmore"),
            turn("t2", state: "done"), user("u2", turn: "t2", text: String(repeating: "a", count: 80)),
            turn("t3", state: "done"),
        ]
        let first = ChatForking.point(items: items, turnID: "t1", counted: true)
        XCTAssertEqual(first?.label, "After turn 1 of 3: \"First question\"")
        XCTAssertEqual(
            ChatForking.point(items: items, turnID: "t2", counted: false)?.label,
            "After this turn: \"\(String(repeating: "a", count: 57))...\"")
        XCTAssertEqual(ChatForking.point(items: items, turnID: "t3", counted: true)?.label, "After the last turn")
        XCTAssertNil(ChatForking.point(items: items, turnID: "missing", counted: true))
        let presentation = ChatPresentation()
        presentation.replace(items + [turn("t4", state: "running")], info: .null)
        XCTAssertEqual(presentation.lastSettledTurnID, "t3")
    }

    func testPayloadSendsOnlyWhatDiffersFromTheOriginal() {
        let selection = info["selection"]!
        let same = ChatForking.payload(
            chatID: "chat", turnID: "t1", title: "  Chat (fork) ", shape: .node, origin: .node, worktree: nil,
            original: ("claude", selection), chosen: ("claude", selection))
        XCTAssertEqual(
            same, .object(["chatId": .string("chat"), "turnId": .string("t1"), "title": .string("Chat (fork)")]))

        let codex: JSONValue = .object(["model": .string("gpt"), "options": .object([:])])
        let other = ChatForking.payload(
            chatID: "chat", turnID: "t1", title: "Fork", shape: .view, origin: .node,
            worktree: (branch: " fork-branch ", filesAfterTurn: true), original: ("claude", selection),
            chosen: ("codex", codex))
        XCTAssertEqual(other["asView"], .bool(true))
        XCTAssertEqual(other["provider"], .string("codex"))
        XCTAssertEqual(other["selection"], codex)
        XCTAssertEqual(other["worktree"], .object(["branch": .string("fork-branch")]))
        XCTAssertEqual(other["filesAfterTurn"], .bool(true))

        // A view forks into a view by default, so nothing asks for one.
        let view = ChatForking.payload(
            chatID: "chat", turnID: "t1", title: "Fork", shape: .view, origin: .view,
            worktree: (branch: "b", filesAfterTurn: false), original: ("claude", selection),
            chosen: ("claude", .null))
        XCTAssertNil(view["asView"])
        XCTAssertNil(view["selection"])
        XCTAssertNil(view["filesAfterTurn"])
    }

    func testShapesOriginsAndBranches() {
        XCTAssertEqual(ChatForking.shapes(origin: .node), [.node, .view])
        XCTAssertEqual(ChatForking.shapes(origin: .view), [.view])
        XCTAssertEqual(ChatForking.shapes(origin: nil), [])
        let views: [JSONValue] = [
            .object(["id": .string("chat-view"), "kind": .string("chat"), "name": .string("Research")]),
            .object([
                "id": .string("canvas"), "kind": .string("canvas"),
                "nodes": .array([.object(["id": .string("node"), "kind": .string("chat"), "title": .string("Build")])]),
            ]),
        ]
        XCTAssertEqual(ChatForking.origin(in: views, chatID: "chat-view")?.shape, .view)
        XCTAssertEqual(ChatForking.origin(in: views, chatID: "node")?.title, "Build")
        XCTAssertNil(ChatForking.origin(in: views, chatID: "gone"))
        XCTAssertEqual(ChatForking.branchRefusal("  ", taken: []), "Name the branch")
        XCTAssertEqual(ChatForking.branchRefusal("main ", taken: ["main"]), "A branch with this name exists already")
        XCTAssertNil(ChatForking.branchRefusal("fork", taken: ["main"]))
    }

    func testCountsForksPerTurnOfThisChat() {
        let chats: [JSONValue] = [
            fork(of: "chat", after: "t1"), fork(of: "chat", after: "t1"), fork(of: "chat", after: "t2"),
            fork(of: "other", after: "t1"), .object(["chatId": .string("plain")]),
        ]
        XCTAssertEqual(ChatForking.forkCounts(chats: chats, chatID: "chat"), ["t1": 2, "t2": 1])
        XCTAssertEqual(ChatForking.forkedLabel(1), "Forked")
        XCTAssertEqual(ChatForking.forkedLabel(3), "Forked 3x")
    }

    func testSummaryNoteFoldsAfterItsFirstLine() {
        let parts = ChatForking.noteParts("Summary from fork Build (node n)\n\nChanged the parser.\n")
        XCTAssertEqual(parts.head, "Summary from fork Build (node n)")
        XCTAssertEqual(parts.rest, "Changed the parser.")
        XCTAssertEqual(ChatForking.noteParts("One line").rest, "")
    }

    func testAnOlderMachineIsAskedToUpdate() {
        let old = MachineClientError.server(code: "unknown-request", message: "Unknown request type: chat.fork")
        XCTAssertTrue(ChatForking.isUnknownRequest(old))
        XCTAssertEqual(
            ChatForking.message(for: old, action: "fork conversations"),
            "Update Ruimte on this machine to fork conversations.")
        XCTAssertFalse(ChatForking.isUnknownRequest(MachineClientError.server(code: "chat-busy", message: "Busy")))
    }

    @MainActor func testChatModelMarksTurnsWithTheForksItFinds() async {
        let machine = ForkListMachine()
        let model = ChatModel(client: machine, chatID: "chat")
        XCTAssertTrue(model.presentation.forkable)
        await model.refreshForks()
        XCTAssertEqual(model.presentation.forkCounts, ["t1": 1])
        machine.fails = true
        await model.refreshForks()
        XCTAssertEqual(model.presentation.forkCounts, ["t1": 1])
    }

    private func turn(_ id: String, state: String) -> JSONValue {
        .object([
            "id": .string(id), "kind": .string("turn"), "turnId": .string(id), "state": .string(state),
            "createdAt": .number(1),
        ])
    }

    private func user(_ id: String, turn: String, text: String) -> JSONValue {
        .object([
            "id": .string(id), "kind": .string("user"), "turnId": .string(turn), "text": .string(text),
            "createdAt": .number(1),
        ])
    }

    private func fork(of chatID: String, after turnID: String) -> JSONValue {
        .object([
            "chatId": .string(UUID().uuidString),
            "forkOf": .object(["chatId": .string(chatID), "turnId": .string(turnID), "at": .number(1)]),
        ])
    }
}

@MainActor private final class ForkListMachine: MachineRequesting {
    var fails = false

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        XCTAssertEqual(type, "chat.list")
        if fails { throw MachineClientError.server(code: "unknown-request", message: "Unknown") }
        return .object([
            "chats": .array([
                .object([
                    "chatId": .string("fork"),
                    "forkOf": .object(["chatId": .string("chat"), "turnId": .string("t1"), "at": .number(1)]),
                ])
            ])
        ])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
