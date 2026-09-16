import RuimtePulsar
import XCTest

@testable import RuimteTransport

final class ChatHistoryTests: XCTestCase {
    private func item(_ id: String, _ text: String = "") -> JSONValue {
        .object(["id": .string(id), "kind": .string("assistant"), "text": .string(text)])
    }
    func testSyntheticHistoryDecodeMeasurement() throws {
        let values = (0..<2871).map { item("m\($0)", String(repeating: "output ", count: 900)) }
        let full = try JSONValue.array(values).encoded()
        let page = try JSONValue.array(Array(values.suffix(60))).encoded()
        let fullStart = Date()
        XCTAssertEqual(try JSONValue.decode(full).arrayValue?.count, 2871)
        let fullTime = Date().timeIntervalSince(fullStart) * 1000
        let pageStart = Date()
        XCTAssertEqual(try JSONValue.decode(page).arrayValue?.count, 60)
        let pageTime = Date().timeIntervalSince(pageStart) * 1000
        print(
            "Synthetic JSON decode on Mac: full \(full.count) bytes / \(fullTime) ms; page \(page.count) bytes / \(pageTime) ms"
        )
    }

    func testOlderDaemonKeepsFullHistoryAndNeedsNoPagingRequest() {
        var history = ChatHistory()
        history.replace(.object(["items": .array([item("one")])]))
        XCTAssertNil(history.cursor)
        XCTAssertTrue(history.includes(item("two"), index: nil))
    }
    func testPendingOutsidePageRemainsActionableAndSettlesWithoutAppending() {
        var history = ChatHistory()
        let pending: JSONValue = .object([
            "id": .string("a"), "kind": .string("approval"), "decision": .string("pending"),
        ])
        history.replace(
            .object([
                "history": .object(["start": .number(80), "cursor": .string("epoch:80")]), "pending": .array([pending]),
            ]))
        XCTAssertEqual(history.pending["a"], pending)
        let answered: JSONValue = .object([
            "id": .string("a"), "kind": .string("approval"), "decision": .string("allow"),
        ])
        XCTAssertFalse(history.includes(answered, index: .number(0)))
        XCTAssertTrue(history.pending.isEmpty)
        XCTAssertTrue(history.includes(item("tail"), index: .number(81)))
    }
    func testPrependPreservesNewerLiveItemsAndResetDropsCursorAndPending() {
        var history = ChatHistory()
        history.replace(.object(["history": .object(["start": .number(2), "cursor": .string("epoch:2")])]))
        let merged = history.prepend(
            .object([
                "items": .array([item("old"), item("tail", "stale")]),
                "history": .object(["start": .number(0), "cursor": .null]),
            ]), to: [item("tail", "live")])
        XCTAssertEqual(merged, [item("old"), item("tail", "live")])
        XCTAssertNil(history.cursor)
        history.replace(.object(["items": .array([])]))
        XCTAssertEqual(history.start, 0)
        XCTAssertTrue(history.pending.isEmpty)
    }
}
