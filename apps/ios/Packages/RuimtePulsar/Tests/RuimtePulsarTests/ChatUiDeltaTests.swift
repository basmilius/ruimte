import XCTest
@testable import RuimtePulsar

final class ChatUiDeltaTests: XCTestCase {
    func testPreviewMatchesUTF16LengthWithoutAppendingItsTextTwice() {
        let item: JSONValue = .object([
            "kind": .string("assistant"), "text": .string("Hi 🐇"), "streaming": .bool(true),
        ])
        let preview: JSONValue = .array([.object(["id": .string("block")])])
        let event: JSONValue = .object(["text": .string(""), "textLength": .number(5), "ui": preview])
        let updated = ChatUiDelta.apply(event, to: item)
        XCTAssertEqual(updated["text"], item["text"])
        XCTAssertEqual(updated["ui"], preview)
    }

    func testStalePreviewPreservesCurrentTreeButQueryMetadataStillArrives() {
        let blocks: JSONValue = .array([.object(["id": .string("new")])])
        let queries: JSONValue = .object(["authorChatId": .string("chat")])
        let item: JSONValue = .object([
            "kind": .string("assistant"), "text": .string("newer"), "ui": blocks, "streaming": .bool(true),
        ])
        let event: JSONValue = .object(["textLength": .number(2), "ui": .array([]), "uiQueries": queries])
        let updated = ChatUiDelta.apply(event, to: item)
        XCTAssertEqual(updated["ui"], blocks)
        XCTAssertEqual(updated["uiQueries"], queries)
    }

    func testTextAndToolDeltasKeepExistingMetadata() {
        let item: JSONValue = .object(["kind": .string("assistant"), "text": .string("a"), "ui": .array([])])
        let updated = ChatUiDelta.apply(.object(["text": .string("b")]), to: item)
        XCTAssertEqual(updated["text"], .string("ab"))
        XCTAssertEqual(updated["ui"], .array([]))
        let tool: JSONValue = .object(["kind": .string("tool"), "progress": .object(["output": .string("a")])])
        let progress = ChatUiDelta.apply(.object(["text": .string("b")]), to: tool)
        XCTAssertEqual(progress["progress"]?["output"], .string("ab"))
        XCTAssertNil(progress["text"])
    }

    func testTreesReachOnlyAStreamingReplyAndQueryMetadataOnlyAReply() {
        let blocks: JSONValue = .array([.object(["id": .string("block")])])
        let queries: JSONValue = .object(["authorChatId": .string("chat")])
        let event: JSONValue = .object([
            "text": .string(""), "textLength": .number(2), "ui": blocks, "uiQueries": queries,
        ])
        let settled: JSONValue = .object(["kind": .string("assistant"), "text": .string("hi")])
        let reply = ChatUiDelta.apply(event, to: settled)
        XCTAssertNil(reply["ui"])
        XCTAssertEqual(reply["uiQueries"], queries)
        let thinking: JSONValue = .object([
            "kind": .string("thinking"), "text": .string("hi"), "streaming": .bool(true),
        ])
        let thought = ChatUiDelta.apply(event, to: thinking)
        XCTAssertNil(thought["ui"])
        XCTAssertNil(thought["uiQueries"])
    }
}
