import RuimtePulsar
import RuimteShared
import RuimteTransport
import XCTest

@testable import Ruimte

/// What the chat's sheets work out: the context a chat holds and the results a plan sends back.
final class ChatSheetTests: XCTestCase {
    func testTheContextSplitsIntoItsPartsOfTheWindow() {
        let usage = ChatContextUsage(
            ChatInfoUsage(
                contextTokens: 150_000, contextWindow: 200_000, costUsd: 0, turns: 1,
                breakdown: ChatInfoUsageBreakdown(
                    toolOutput: 60_000, filesRead: 40_000, conversation: 30_000, system: 20_000)))
        XCTAssertEqual(usage.fraction, 0.75)
        XCTAssertEqual(usage.segments?.map(\.part), [.toolOutput, .filesRead, .conversation, .system])
        XCTAssertEqual(usage.segments?.map(\.fraction), [0.3, 0.2, 0.15, 0.1])
    }

    func testAMachineThatDoesNotEstimateDrawsThePlainBar() {
        let usage = ChatContextUsage(ChatInfoUsage(contextTokens: 10, contextWindow: nil, costUsd: 0, turns: 1))
        XCTAssertNil(usage.segments)
        XCTAssertNil(usage.window)
        XCTAssertEqual(usage.fraction, 0)
    }

    func testAFoldWithoutASizeIsPendingUntilTheNextCount() {
        let pending = ChatContextUsage(
            ChatInfoUsage(contextTokens: 0, contextWindow: 200_000, costUsd: 0, turns: 2, contextPending: true))
        XCTAssertTrue(pending.pending)
        XCTAssertEqual(pending.fraction, 0)
        XCTAssertNil(pending.segments)
        XCTAssertFalse(ChatContextUsage(ChatInfoUsage(contextTokens: 9000, contextWindow: 200_000, costUsd: 0, turns: 3)).pending)
    }

    func testACompactionNamesTheSizesItKnows() {
        let pre = Format.tokens(123_323)
        let post = Format.tokens(86_425)
        XCTAssertEqual(
            ChatCompactionRule.text(preTokens: 123_323, postTokens: 86_425), "Context compacted from \(pre) to \(post) tokens")
        XCTAssertEqual(ChatCompactionRule.text(preTokens: 123_323, postTokens: nil), "Context compacted from \(pre) tokens")
        XCTAssertEqual(ChatCompactionRule.text(preTokens: nil, postTokens: 86_425), "Context compacted to \(post) tokens")
        XCTAssertEqual(ChatCompactionRule.text(preTokens: nil, postTokens: nil), "Context compacted")
        // A CLI that does not know the size before says zero.
        XCTAssertEqual(ChatCompactionRule.text(preTokens: 0, postTokens: nil), "Context compacted")
        XCTAssertEqual(ChatCompactionRule.text(preTokens: 0, postTokens: 86_425), "Context compacted to \(post) tokens")
    }

    func testTokensReadAsTheDesktopWritesThem() {
        XCTAssertEqual(ChatContextUsage.tokens(950), "950")
        XCTAssertEqual(ChatContextUsage.tokens(172_400), "172K")
        XCTAssertEqual(ChatContextUsage.tokens(1_000_000), "1M")
        XCTAssertEqual(ChatContextUsage.tokens(1_240_000), "1.2M")
    }

    private func step(_ id: String, state: String, note: String? = nil) -> JSONValue {
        var value: [String: JSONValue] = [
            "type": .string("step"), "id": .string(id), "title": .string("Step \(id)"), "state": .string(state),
        ]
        if let note { value["note"] = .string(note) }
        return .object(value)
    }

    private func plan(_ items: [JSONValue]) throws -> PlanDocument {
        PlanDocument(
            try JSONValue.object([
                "id": .string("plan"), "rev": .number(1), "createdAt": .string("2026-10-03T10:00:00Z"),
                "meta": .object(["title": .string("Split"), "kind": .string("test"), "checks": .string("anyone")]),
                "items": .array(items),
            ]).decoded(as: StoredPlan.self))
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
