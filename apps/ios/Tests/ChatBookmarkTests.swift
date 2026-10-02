import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor final class ChatBookmarkTests: XCTestCase {
    private func bookmark(_ id: String, name: String? = nil, at createdAt: Double = 0) -> JSONValue {
        var values: [String: JSONValue] = [
            "itemId": .string(id), "excerpt": .string("Start of \(id)"), "createdAt": .number(createdAt),
        ]
        if let name { values["name"] = .string(name) }
        return .object(values)
    }

    func testABookmarkGoesByItsNameOrTheStartOfItsMessage() {
        let named = ChatBookmark(bookmark("a", name: "Plan"))
        let unnamed = ChatBookmark(bookmark("b"))
        XCTAssertEqual(named?.label, "Plan")
        XCTAssertEqual(unnamed?.label, "Start of b")
        XCTAssertNil(ChatBookmark(.object(["itemId": .string("")])))
    }

    func testBookmarksFollowTheThreadAndOnesNotLoadedGoLast() {
        let bookmarks = ChatBookmarks.parse([
            bookmark("missing", at: 1), bookmark("third", at: 2), bookmark("first", at: 3), bookmark("gone", at: 0),
        ])
        XCTAssertEqual(
            ChatBookmarks.inThreadOrder(bookmarks, order: ["first", "second", "third"]).map(\.itemID),
            ["first", "third", "gone", "missing"])
    }

    func testOnlyAMessageOfTheChatsOwnThreadTakesABookmark() {
        XCTAssertTrue(ChatBookmarks.markable(.object(["kind": .string("user")])))
        XCTAssertTrue(ChatBookmarks.markable(.object(["kind": .string("assistant")])))
        XCTAssertFalse(ChatBookmarks.markable(.object(["kind": .string("tool")])))
        XCTAssertFalse(
            ChatBookmarks.markable(.object(["kind": .string("assistant"), "parentToolUseId": .string("t1")])))
        XCTAssertFalse(ChatBookmarks.markable(.object(["kind": .string("assistant"), "streaming": .bool(true)])))
    }

    func testANameIsSentOnlyWhenItChangedAndAnEmptyOneTakesItAway() {
        XCTAssertNil(ChatBookmarks.naming("  Plan ", previous: "Plan"))
        XCTAssertNil(ChatBookmarks.naming("", previous: nil))
        XCTAssertEqual(ChatBookmarks.naming(" Plan ", previous: nil)?.request, "chat.addBookmark")
        XCTAssertEqual(ChatBookmarks.naming(" Plan ", previous: nil)?.name, "Plan")
        XCTAssertEqual(ChatBookmarks.naming(" ", previous: "Plan")?.request, "chat.renameBookmark")
        XCTAssertEqual(ChatBookmarks.naming(String(repeating: "x", count: 200), previous: nil)?.name.count, 120)
    }

    func testPlacingNamingAndRemovingKeepWhatTheMachineAnswers() async {
        let machine = BookmarkMachine()
        let model = ChatModel(client: machine, chatID: "chat")
        let added = await model.addBookmark("m1")
        XCTAssertTrue(added)
        XCTAssertEqual(model.presentation.bookmarks["m1"]?.label, "Start of m1")
        await model.nameBookmark("m1", name: "Plan")
        XCTAssertEqual(model.presentation.bookmarks["m1"]?.name, "Plan")
        await model.nameBookmark("m1", name: "Plan")
        await model.nameBookmark("m1", name: "")
        XCTAssertNil(model.presentation.bookmarks["m1"]?.name)
        await model.removeBookmark("m1")
        XCTAssertTrue(model.presentation.bookmarks.isEmpty)
        XCTAssertEqual(
            machine.requests.map(\.0),
            ["chat.addBookmark", "chat.addBookmark", "chat.renameBookmark", "chat.removeBookmark"])
        XCTAssertEqual(machine.requests[1].1["name"], .string("Plan"))
        XCTAssertEqual(machine.requests[0].1["chatId"], .string("chat"))
    }

    func testAMachineWithoutBookmarksSaysItNeedsAnUpdate() async {
        let machine = BookmarkMachine()
        machine.unknown = true
        let model = ChatModel(client: machine, chatID: "chat")
        let added = await model.addBookmark("m1")
        XCTAssertFalse(added)
        XCTAssertEqual(model.error, "Update Ruimte on this machine to keep bookmarks.")
    }

    func testTheListOfAnotherClientArrivesAsAnEvent() {
        let machine = BookmarkMachine()
        let model = ChatModel(client: machine, chatID: "chat")
        model.start()
        defer { model.stop() }
        machine.emit("chat.bookmarks", .object(["chatId": .string("other"), "bookmarks": .array([bookmark("x")])]))
        XCTAssertTrue(model.presentation.bookmarks.isEmpty)
        machine.emit("chat.bookmarks", .object(["chatId": .string("chat"), "bookmarks": .array([bookmark("x")])]))
        XCTAssertEqual(model.presentation.bookmarks.keys.sorted(), ["x"])
    }

    func testAJumpUnfoldsTheTurnThatHidesTheMessage() {
        let presentation = ChatPresentation()
        presentation.replace(
            [
                .object(["id": .string("u1"), "kind": .string("user"), "turnId": .string("t1"), "text": .string("Hi")]),
                .object([
                    "id": .string("t1"), "kind": .string("turn"), "turnId": .string("t1"), "state": .string("done"),
                    "createdAt": .number(0),
                ]),
                .object([
                    "id": .string("a1"), "kind": .string("assistant"), "turnId": .string("t1"),
                    "text": .string("Early"),
                ]),
                .object([
                    "id": .string("x1"), "kind": .string("tool"), "turnId": .string("t1"), "state": .string("done"),
                ]),
                .object([
                    "id": .string("a2"), "kind": .string("assistant"), "turnId": .string("t1"), "text": .string("Last"),
                ]),
            ], info: .object([:]))
        XCTAssertFalse(presentation.entries.contains { $0.id == "a1" })
        XCTAssertTrue(presentation.revealItem("a1"))
        XCTAssertTrue(presentation.entries.contains { $0.id == "a1" })
        XCTAssertEqual(presentation.requestedItemID, "a1")
        XCTAssertFalse(presentation.revealItem("not-loaded"))
    }
}

@MainActor private final class BookmarkMachine: MachineRequesting {
    var requests: [(String, JSONValue)] = []
    var unknown = false
    private var bookmarks: [String: JSONValue] = [:]
    private var handlers: [String: [@MainActor @Sendable (JSONValue) -> Void]] = [:]

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if unknown { throw MachineClientError.server(code: "unknown-request", message: "Unknown request") }
        let id = payload["itemId"]?.stringValue ?? ""
        switch type {
        case "chat.addBookmark", "chat.renameBookmark":
            var values: [String: JSONValue] = [
                "itemId": .string(id), "excerpt": .string("Start of \(id)"), "createdAt": .number(1),
            ]
            if let name = payload["name"]?.stringValue, !name.isEmpty { values["name"] = .string(name) }
            bookmarks[id] = .object(values)
        case "chat.removeBookmark":
            bookmarks[id] = nil
        default:
            break
        }
        return .object(["bookmarks": .array(Array(bookmarks.values))])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        handlers[event, default: []].append(handler)
        return {}
    }

    func emit(_ event: String, _ payload: JSONValue) {
        for handler in handlers[event] ?? [] { handler(payload) }
    }
}
