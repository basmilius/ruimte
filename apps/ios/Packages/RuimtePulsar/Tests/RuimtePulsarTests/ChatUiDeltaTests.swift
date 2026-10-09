import XCTest
@testable import RuimtePulsar

final class ChatUiDeltaTests: XCTestCase {
    func testPreviewMatchesUTF16LengthWithoutAppendingItsTextTwice() {
        let item: JSONValue = .object(["kind": .string("assistant"), "text": .string("Hi 🐇")])
        let preview: JSONValue = .array([.object(["id": .string("block")])])
        let event: JSONValue = .object(["text": .string(""), "textLength": .number(5), "ui": preview])
        let updated = ChatUiDelta.apply(event, to: item)
        XCTAssertEqual(updated["text"], item["text"])
        XCTAssertEqual(updated["ui"], preview)
    }

    func testStalePreviewPreservesCurrentTreeButQueryMetadataStillArrives() {
        let blocks: JSONValue = .array([.object(["id": .string("new")])])
        let queries: JSONValue = .object(["authorChatId": .string("chat")])
        let item: JSONValue = .object(["kind": .string("assistant"), "text": .string("newer"), "ui": blocks])
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
}
