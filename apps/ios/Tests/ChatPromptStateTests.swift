import RuimtePulsar
import XCTest

#if canImport(Ruimte)
    @testable import Ruimte
#else
    @testable import PromptChecks
#endif

final class ChatPromptStateTests: XCTestCase {
    private func request(_ id: String, question: Bool = false, optional: Bool = false) -> JSONValue {
        .object([
            "requestId": .string(id), "id": .string(id), "kind": .string(question ? "question" : "approval"),
            "async": .bool(optional),
        ])
    }

    @MainActor func testBlockingRequestWinsWithoutReplacingAnActiveRequest() {
        let state = ChatPromptState()
        let optional = request("optional", question: true, optional: true)
        let approval = request("approval")
        state.update([optional, approval])
        XCTAssertEqual(state.activeID, "approval")
        state.update([request("new"), approval, optional])
        XCTAssertEqual(state.activeID, "approval")
    }

    @MainActor func testEveryPendingRequestBecomesActive() {
        let state = ChatPromptState()
        state.update([request("approval")])
        XCTAssertEqual(state.activeID, "approval")
        state.update([])
        XCTAssertNil(state.active)
        state.update([request("optional", question: true, optional: true)])
        XCTAssertEqual(state.activeID, "optional")
    }

    @MainActor func testAnswerAndReasonSurvivePendingUpdates() {
        let state = ChatPromptState()
        let active = request("a")
        state.update([active])
        state.draft.showingReason = true
        state.draft.denialReason = "Keep this reason"
        state.draft.answers["question"] = ChatPromptAnswer(
            choices: ["Chat, files", "Terminal"], text: "Custom answer", custom: false)
        state.update([active, request("next")])
        XCTAssertEqual(state.activeID, "a")
        XCTAssertTrue(state.draft.showingReason)
        XCTAssertEqual(state.draft.denialReason, "Keep this reason")
        XCTAssertEqual(state.draft.answers["question"]?.choices, ["Chat, files", "Terminal"])
        state.draft.answers["question"]?.custom = true
        XCTAssertEqual(state.draft.answers["question"]?.value, "Custom answer")
    }

    @MainActor func testDuplicateSubmissionAndDisconnectedSubmissionAreIgnored() async {
        let state = ChatPromptState()
        let item = request("a")
        var calls = 0
        state.update([item])
        await state.submit(item, connected: false) { calls += 1 }
        XCTAssertEqual(calls, 0)
        await state.submit(item, connected: true) {
            calls += 1
            await state.submit(item, connected: true) { calls += 1 }
        }
        XCTAssertEqual(calls, 1)
        XCTAssertNil(state.active)
    }

    @MainActor func testAnOldFailureCannotAppearOnTheNextRequest() async {
        let state = ChatPromptState()
        let first = request("first")
        let next = request("next")
        state.update([first])
        await state.submit(first, connected: true) {
            state.update([next])
            throw Failure.expected
        }
        XCTAssertEqual(state.activeID, "next")
        XCTAssertNil(state.error)
        XCTAssertNil(state.sendingID)
    }

    @MainActor func testFailureKeepsInputForRetry() async {
        let state = ChatPromptState()
        let item = request("a")
        state.update([item])
        state.draft.denialReason = "Keep this reason"
        await state.submit(item, connected: true) { throw Failure.expected }
        XCTAssertNotNil(state.error)
        XCTAssertEqual(state.draft.denialReason, "Keep this reason")
        var calls = 0
        await state.submit(item, connected: true) { calls += 1 }
        XCTAssertEqual(calls, 1)
        XCTAssertNil(state.active)
    }

    private enum Failure: Error { case expected }
}
