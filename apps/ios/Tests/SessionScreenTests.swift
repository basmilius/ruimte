import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class SessionScreenTests: XCTestCase {
    @MainActor func testChatDeltasAppendToTextAndToolProgressWithoutLosingOrder() {
        let model = ChatModel(client: SessionClientFake(), chatID: UUID().uuidString)
        model.replace(
            .object([
                "items": .array([
                    .object(["id": .string("reply"), "kind": .string("assistant"), "text": .string("Hello")]),
                    .object([
                        "id": .string("tool"), "kind": .string("tool"),
                        "progress": .object(["output": .string("first")]),
                    ]),
                ])
            ]))
        model.receive(.object(["type": .string("delta"), "itemId": .string("reply"), "text": .string(" 🌍")]))
        model.receive(.object(["type": .string("delta"), "itemId": .string("tool"), "text": .string(" second")]))
        XCTAssertEqual(model.items[0]["text"]?.stringValue, "Hello 🌍")
        XCTAssertEqual(model.items[1]["progress"]?["output"]?.stringValue, "first second")
        model.receive(
            .object([
                "type": .string("item"),
                "item": .object(["id": .string("reply"), "kind": .string("assistant"), "text": .string("Final")]),
            ]))
        XCTAssertEqual(model.items.count, 2)
        XCTAssertEqual(model.items[0]["text"]?.stringValue, "Final")
    }

    @MainActor func testResetRemovesOldDeltaTargetsAndPendingApproval() {
        let model = ChatModel(client: SessionClientFake(), chatID: UUID().uuidString)
        model.replace(
            .object([
                "items": .array([
                    .object(["id": .string("old"), "kind": .string("approval"), "decision": .string("pending")])
                ])
            ]))
        XCTAssertEqual(model.pending.count, 1)
        model.receive(
            .object(["type": .string("reset"), "items": .array([]), "info": .object(["status": .string("idle")])]))
        model.receive(.object(["type": .string("delta"), "itemId": .string("old"), "text": .string("stale")]))
        XCTAssertTrue(model.items.isEmpty)
        XCTAssertTrue(model.pending.isEmpty)
    }

    @MainActor func testSendFailureKeepsDraftAndAttachments() async {
        let client = SessionClientFake()
        client.failure = true
        let id = UUID().uuidString
        let model = ChatModel(client: client, chatID: id)
        model.connected = true
        model.draft = "Keep this draft"
        model.addAttachment(data: Data("file".utf8), name: "note.txt", mime: "text/plain")
        await model.send()
        XCTAssertEqual(model.draft, "Keep this draft")
        XCTAssertEqual(model.attachments.count, 1)
        XCTAssertNotNil(model.error)
        XCTAssertEqual(UserDefaults.standard.string(forKey: "ruimte.chat.draft.\(id)"), "Keep this draft")
        UserDefaults.standard.removeObject(forKey: "ruimte.chat.draft.\(id)")
    }

    @MainActor func testInputIsSerializedAndNeverResizesRemoteTerminal() async {
        let client = SessionClientFake()
        client.holdWrites = true
        let model = TerminalModel(client: client, sessionID: "terminal")
        model.connected = true
        model.write("a")
        model.write("b")
        await client.waitForRequest("session.write", count: 1)
        XCTAssertEqual(client.requests.filter { $0.0 == "session.write" }.count, 1)
        client.finishWrite()
        await client.waitForRequest("session.write", count: 2)
        XCTAssertEqual(
            client.requests.filter { $0.0 == "session.write" }.map { $0.1["data"]?.stringValue }, ["a", "b"])
        XCTAssertFalse(client.requests.contains { $0.0 == "session.resize" })
        client.finishWrite()
    }

    @MainActor func testTerminalFollowAttachAndResyncReplaceBufferedOutput() async {
        let client = SessionClientFake()
        client.responses["session.attach"] = .object([
            "screen": .string("snapshot"), "cols": .number(132), "rows": .number(48), "exited": .bool(false),
        ])
        client.responses["session.list"] = .object(["sessions": .array([])])
        let model = TerminalModel(client: client, sessionID: "terminal")
        var displayed: [(String, Bool)] = []
        model.render = { text, reset in
            displayed.append((text, reset))
        }
        model.start()
        await client.waitForRequest("session.list", count: 1)
        let attach = client.requests.first { $0.0 == "session.attach" }!.1
        XCTAssertEqual(attach["follow"], .bool(true))
        XCTAssertNil(attach["cols"])
        XCTAssertEqual(model.cols, 132)
        client.emit("session.output", .object(["sessionId": .string("terminal"), "data": .string("live")]))
        client.emit("session.resync", .object(["sessionId": .string("terminal"), "screen": .string("replacement")]))
        XCTAssertEqual(displayed.map(\.0), ["snapshot", "live", "replacement"])
        XCTAssertEqual(displayed.map(\.1), [true, false, true])
        model.stop()
        XCTAssertTrue(client.handlers.values.allSatisfy(\.isEmpty))
    }

    @MainActor func testAttentionMarksOnlyUnseenCompletionsAndClearsOnFocus() {
        let store = AttentionStore(client: SessionClientFake())
        store.update("terminal", status: .idle)
        XCTAssertFalse(store.unseen.contains("terminal"))
        store.update("terminal", status: .running)
        store.update("terminal", status: .needsYou)
        XCTAssertTrue(store.needsYou("terminal"))
        XCTAssertTrue(store.unseen.contains("terminal"))
        store.focus("terminal")
        XCTAssertFalse(store.unseen.contains("terminal"))
        store.update("terminal", status: .running)
        store.update("terminal", status: .idle)
        XCTAssertFalse(store.unseen.contains("terminal"))
        store.blur("terminal")
    }

    func testMarkdownPreservesFencesTablesAndStreamingUnclosedCode() {
        let blocks = MarkdownBlock.parse(
            "# Title\n\n| File | State |\n| --- | --- |\n| App.swift | Done |\n\n```swift\nlet value = 42")
        XCTAssertEqual(blocks.count, 3)
        XCTAssertEqual(blocks[0].kind, .heading(1))
        XCTAssertEqual(blocks[1].rows, [["File", "State"], ["App.swift", "Done"]])
        XCTAssertEqual(blocks[2].kind, .code("swift"))
        XCTAssertEqual(blocks[2].text, "let value = 42")
    }
}

@MainActor private final class SessionClientFake: MachineRequesting {
    var requests: [(String, JSONValue)] = []
    var responses: [String: JSONValue] = [:]
    var handlers: [String: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]
    var failure = false
    var holdWrites = false
    private var writeContinuation: CheckedContinuation<JSONValue, any Error>?
    private var waiters: [(String, Int, CheckedContinuation<Void, Never>)] = []

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        let ready = waiters.filter { target, count, _ in requests.filter { $0.0 == target }.count >= count }
        waiters.removeAll { target, count, _ in requests.filter { $0.0 == target }.count >= count }
        ready.forEach { $0.2.resume() }
        if failure { throw MachineClientError.disconnected }
        if holdWrites && type == "session.write" {
            return try await withCheckedThrowingContinuation { writeContinuation = $0 }
        }
        return responses[type] ?? .object([:])
    }
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        let id = UUID()
        handlers[event, default: [:]][id] = handler
        return { [weak self] in self?.handlers[event]?[id] = nil }
    }
    func emit(_ event: String, _ value: JSONValue) {
        for handler in handlers[event, default: [:]].values { handler(value) }
    }
    func finishWrite() {
        let continuation = writeContinuation
        writeContinuation = nil
        continuation?.resume(returning: .object([:]))
    }
    func waitForRequest(_ type: String, count: Int) async {
        if requests.filter({ $0.0 == type }).count >= count { return }
        await withCheckedContinuation { waiters.append((type, count, $0)) }
    }
}
