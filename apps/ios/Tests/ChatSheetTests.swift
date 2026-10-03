import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

/// What the chat's sheets work out: the context a chat holds and the results a plan sends back.
final class ChatSheetTests: XCTestCase {
    func testTheContextSplitsIntoItsPartsOfTheWindow() throws {
        let usage = try XCTUnwrap(
            ChatContextUsage(
                .object([
                    "contextTokens": .number(150_000), "contextWindow": .number(200_000),
                    "breakdown": .object([
                        "toolOutput": .number(60_000), "filesRead": .number(40_000),
                        "conversation": .number(30_000), "system": .number(20_000),
                    ]),
                ])))
        XCTAssertEqual(usage.fraction, 0.75)
        XCTAssertEqual(usage.segments?.map(\.part), [.toolOutput, .filesRead, .conversation, .system])
        XCTAssertEqual(usage.segments?.map(\.fraction), [0.3, 0.2, 0.15, 0.1])
    }

    func testAMachineThatDoesNotEstimateDrawsThePlainBar() throws {
        let usage = try XCTUnwrap(
            ChatContextUsage(.object(["contextTokens": .number(10), "contextWindow": .null])))
        XCTAssertNil(usage.segments)
        XCTAssertNil(usage.window)
        XCTAssertEqual(usage.fraction, 0)
        XCTAssertNil(ChatContextUsage(nil))
    }

    func testTokensReadAsTheDesktopWritesThem() {
        XCTAssertEqual(ChatContextUsage.tokens(950), "950")
        XCTAssertEqual(ChatContextUsage.tokens(172_400), "172K")
        XCTAssertEqual(ChatContextUsage.tokens(1_000_000), "1M")
        XCTAssertEqual(ChatContextUsage.tokens(1_250_000), "1.2M")
    }

    private func step(_ id: String, state: String, note: String? = nil) -> JSONValue {
        var value: [String: JSONValue] = [
            "type": .string("step"), "id": .string(id), "title": .string("Step \(id)"), "state": .string(state),
        ]
        if let note { value["note"] = .string(note) }
        return .object(value)
    }

    private func plan(_ items: [JSONValue]) throws -> PlanDocument {
        try XCTUnwrap(
            PlanDocument(
                .object([
                    "id": .string("plan"), "rev": .number(1), "createdAt": .string("2026-10-03T10:00:00Z"),
                    "meta": .object(["title": .string("Split"), "kind": .string("test"), "checks": .string("anyone")]),
                    "items": .array(items),
                ])))
    }

    func testResultsNameEveryStepThatDidNotSimplyPassWithItsNote() throws {
        let document = try plan([
            step("1", state: "done"),
            step("2", state: "info", note: "Slow on a cold start"),
            .object([
                "type": .string("section"), "id": .string("s"), "title": .string("More"),
                "items": .array([
                    step("3", state: "failed", note: "Focus jumped\n  to the first column."),
                    step("4", state: "blocked"),
                ]),
            ]),
        ])
        XCTAssertEqual(
            document.resultsText,
            "Results of the plan \"Split\":\n\nFailed:\n- Step 3: Focus jumped to the first column.\n\n"
                + "Blocked:\n- Step 4\n\nInfo:\n- Step 2: Slow on a cold start")
    }

    func testAPlanThatSimplyPassedHasNoResultsToSend() throws {
        XCTAssertNil(try plan([step("1", state: "done"), step("2", state: "open")]).resultsText)
    }
}
