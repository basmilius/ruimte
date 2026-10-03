import RuimtePulsar
import XCTest

@testable import Ruimte

final class NowBoardTests: XCTestCase {
    private func project(
        _ id: String, name: String, opened: Double, scratch: Bool = false, views: [JSONValue]?
    ) -> JSONValue {
        var summary: [String: JSONValue] = [
            "projectId": .string(id), "name": .string(name), "lastOpenedAt": .number(opened),
        ]
        if scratch { summary["scratch"] = .bool(true) }
        return .object(["summary": .object(summary), "views": views.map(JSONValue.array) ?? .null])
    }

    private func view(_ id: String, kind: String, name: String = "", nodes: [JSONValue] = []) -> JSONValue {
        .object(["id": .string(id), "kind": .string(kind), "name": .string(name), "nodes": .array(nodes)])
    }

    private func node(_ id: String, kind: String, title: String) -> JSONValue {
        .object(["id": .string(id), "kind": .string(kind), "title": .string(title)])
    }

    func testSectionsFollowStatusAndUnseen() {
        let projects = [
            project(
                "app", name: "Recept Maker", opened: 10,
                views: [
                    view("chat-a", kind: "chat", name: "Refactor reconnect loop"),
                    view(
                        "canvas", kind: "canvas", name: "Main canvas",
                        nodes: [
                            node("term", kind: "terminal", title: "bun dev"),
                            node("chat-b", kind: "chat", title: "Add shopping list"),
                        ]),
                    view("chat-c", kind: "chat", name: "Update case study"),
                    view("chat-d", kind: "chat", name: "Idle"),
                ])
        ]
        let board = NowBoard.build([
            NowMachineInput(
                machineID: "mac", machineName: "MacBook Pro", projects: projects,
                attention: NowAttention(
                    statuses: ["chat-a": .needsYou, "term": .running, "chat-b": .running, "chat-c": .idle],
                    unseen: ["chat-c", "chat-a"]))
        ])
        XCTAssertEqual(board.needsYou.map(\.target.itemID), ["chat-a"])
        XCTAssertEqual(board.working.map(\.target.itemID), ["term", "chat-b"])
        XCTAssertEqual(board.finished.map(\.target.itemID), ["chat-c"])
        XCTAssertFalse(board.namesMachines)
        XCTAssertEqual(board.working.first?.target.viewID, "canvas")
        XCTAssertEqual(board.working.first?.title, "bun dev")
        XCTAssertEqual(board.needsYou.first?.projectName, "Recept Maker")
    }

    func testProjectsOpenedLastComeFirstAndMachinesAreNamedOnlyWhenSeveral() {
        let mac = NowMachineInput(
            machineID: "mac", machineName: "MacBook Pro",
            projects: [project("old", name: "Old", opened: 1, views: [view("one", kind: "chat")])],
            attention: NowAttention(statuses: ["one": .running]))
        let studio = NowMachineInput(
            machineID: "studio", machineName: "Studio",
            projects: [
                project("chats", name: "scratch", opened: 5, scratch: true, views: [view("two", kind: "terminal")])
            ],
            attention: NowAttention(statuses: ["two": .running]))
        let board = NowBoard.build([mac, studio])
        XCTAssertEqual(board.working.map(\.target.itemID), ["two", "one"])
        XCTAssertEqual(board.working.first?.projectName, "Chats")
        XCTAssertEqual(board.working.first?.title, "Terminal")
        XCTAssertTrue(board.namesMachines)
    }

    func testDividersUnreadableProjectsAndUnknownSessionsStayOut() {
        let input = NowMachineInput(
            machineID: "mac", machineName: "MacBook Pro",
            projects: [
                project(
                    "app", name: "App", opened: 1,
                    views: [view("line", kind: "separator"), view("chat", kind: "chat", name: "Chat")]),
                project("broken", name: "Broken", opened: 2, views: nil),
            ],
            attention: NowAttention(statuses: ["line": .running, "elsewhere": .needsYou, "chat": .exited]))
        let board = NowBoard.build([input])
        XCTAssertTrue(board.isEmpty)
        XCTAssertEqual(NowBoard.entries([input]).map(\.target.itemID), ["chat"])
    }

    func testLocateFindsAViewOrTheCanvasHoldingANode() {
        let projects = [
            project("a", name: "A", opened: 1, views: [view("chat", kind: "chat")]),
            project(
                "b", name: "B", opened: 2,
                views: [view("canvas", kind: "canvas", nodes: [node("term", kind: "terminal", title: "Shell")])]),
        ]
        XCTAssertEqual(
            NowBoard.locate("chat", machineID: "mac", in: projects),
            ProjectViewTarget(machineID: "mac", projectID: "a", viewID: "chat", itemID: "chat"))
        XCTAssertEqual(
            NowBoard.locate("term", machineID: "mac", in: projects),
            ProjectViewTarget(machineID: "mac", projectID: "b", viewID: "canvas", itemID: "term"))
        XCTAssertNil(NowBoard.locate("gone", machineID: "mac", in: projects))
        XCTAssertNil(NowBoard.locate("", machineID: "mac", in: projects))
    }

    func testViewSearchMatchesTitleOrProject() {
        let input = NowMachineInput(
            machineID: "mac", machineName: "MacBook Pro",
            projects: [
                project(
                    "app", name: "Recept Maker", opened: 1,
                    views: [view("chat", kind: "chat", name: "Refactor pool"), view("doc", kind: "file", name: "README")])
            ])
        let entries = NowBoard.entries([input])
        XCTAssertEqual(ViewSearch.views(entries, query: "pool").map(\.target.itemID), ["chat"])
        XCTAssertEqual(ViewSearch.views(entries, query: "recept").count, 2)
        XCTAssertTrue(ViewSearch.views(entries, query: "  ").isEmpty)
    }
    func testAChatWithWorkStillOutIsWorkingNotFinished() {
        let projects = [
            project(
                "app", name: "App", opened: 1,
                views: [
                    view("subagents", kind: "chat"), view("parent", kind: "chat"), view("asks", kind: "chat"),
                    view("done", kind: "chat"),
                ])
        ]
        let board = NowBoard.build([
            NowMachineInput(
                machineID: "mac", machineName: "MacBook Pro", projects: projects,
                attention: NowAttention(
                    statuses: ["subagents": .idle, "asks": .needsYou, "done": .idle],
                    unseen: ["subagents", "parent", "done"], delegating: ["subagents", "parent", "asks"]))
        ])
        XCTAssertEqual(board.working.map(\.target.itemID), ["subagents", "parent"])
        XCTAssertTrue(board.working.allSatisfy(\.delegating))
        XCTAssertEqual(board.needsYou.map(\.target.itemID), ["asks"])
        XCTAssertFalse(board.needsYou[0].delegating)
        XCTAssertEqual(board.finished.map(\.target.itemID), ["done"])
    }

    func testASnoozedWaitLeavesNeedsYouAndTheFirstToWakeComesFirst() {
        let later = Date(timeIntervalSince1970: 2000)
        let sooner = Date(timeIntervalSince1970: 1000)
        let projects = [
            project(
                "app", name: "App", opened: 1,
                views: [view("a", kind: "chat"), view("b", kind: "chat"), view("c", kind: "terminal")])
        ]
        let board = NowBoard.build([
            NowMachineInput(
                machineID: "mac", machineName: "MacBook Pro", projects: projects,
                attention: NowAttention(statuses: ["a": .needsYou, "b": .needsYou, "c": .needsYou]),
                snoozes: ["a": later, "b": sooner])
        ])
        XCTAssertEqual(board.needsYou.map(\.target.itemID), ["c"])
        XCTAssertEqual(board.snoozed.map(\.target.itemID), ["b", "a"])
        XCTAssertEqual(board.snoozed.first?.snoozedUntil, sooner)
    }

    func testACardCarriesItsChatsRequestsAndWhetherADenialTakesAMessage() throws {
        let request = try XCTUnwrap(
            NowRequest(
                .object([
                    "requestId": .string("r1"), "itemId": .string("i1"), "kind": .string("question"),
                    "createdAt": .number(1),
                    "question": .object([
                        "questions": .array([
                            .object([
                                "id": .string("q"), "header": .string(""), "question": .string("Which?"),
                                "choices": .array([]), "multiSelect": .bool(false),
                            ])
                        ])
                    ]),
                ])))
        let projects = [project("app", name: "App", opened: 1, views: [view("a", kind: "chat"), view("b", kind: "chat")])]
        let board = NowBoard.build([
            NowMachineInput(
                machineID: "mac", machineName: "MacBook Pro", projects: projects,
                attention: NowAttention(
                    statuses: ["a": .needsYou, "b": .needsYou], requests: ["a": [request]],
                    providers: ["a": "claude", "b": "codex"]),
                denyReason: ["claude"])
        ])
        XCTAssertEqual(board.needsYou.map(\.requests), [[request], []])
        XCTAssertEqual(board.needsYou.map(\.repliesWithMessage), [true, false])
    }
}
