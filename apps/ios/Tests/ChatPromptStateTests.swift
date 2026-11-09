import RuimtePulsar
import XCTest

#if canImport(Ruimte)
    @testable import Ruimte
#else
    @testable import PromptChecks
#endif

final class ChatPromptStateTests: XCTestCase {
    private func request(_ id: String, question: Bool = false, optional: Bool = false) -> ChatItem {
        var fields: [String: JSONValue] = [
            "requestId": .string(id), "id": .string(id), "kind": .string(question ? "question" : "approval"),
        ]
        if question { fields["async"] = .bool(optional) }
        return ChatWire.item(fields).chatItem
    }

    func testAnApprovalLeavesOutADescriptionThatOnlyRepeatsItsCommand() {
        let shown = { (description: JSONValue) -> String? in
            let item = ChatWire.item([
                "kind": .string("approval"), "description": description,
                "input": .object(["command": .string("ruimte-context list")]),
            ]).chatItem
            guard case .approval(let approval) = item else { return "not an approval" }
            return approval.shownDescription
        }
        XCTAssertNil(shown(.string("ruimte-context list ")))
        XCTAssertNil(shown(.string("")))
        XCTAssertNil(shown(.null))
        XCTAssertEqual(shown(.string("List the linked context")), "List the linked context")
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

    func testTheDraftGetsItsKeyboardBackOnlyAfterTheLastRequest() {
        var handoff = ChatDraftFocusHandoff()
        XCTAssertEqual(handoff.focus(from: nil, to: "a", focused: true, visible: true), false)
        XCTAssertNil(handoff.focus(from: "a", to: "b", focused: false, visible: true))
        XCTAssertEqual(handoff.focus(from: "b", to: nil, focused: false, visible: true), true)
        XCTAssertNil(handoff.focus(from: nil, to: nil, focused: true, visible: true))
    }

    func testAnUnfocusedOrHiddenDraftStaysWithoutTheKeyboard() {
        var handoff = ChatDraftFocusHandoff()
        XCTAssertEqual(handoff.focus(from: nil, to: "a", focused: false, visible: true), false)
        XCTAssertNil(handoff.focus(from: "a", to: nil, focused: false, visible: true))
        XCTAssertEqual(handoff.focus(from: nil, to: "b", focused: true, visible: true), false)
        XCTAssertNil(handoff.focus(from: "b", to: nil, focused: false, visible: false))
    }

    @MainActor func testARequestOfAChildChatKeepsItsRecipientApartFromTheChatsOwnOfTheSameID() async {
        let state = ChatPromptState()
        let own = request("acp-1-3")
        let source = ChatPromptSource(label: "Fix the outbox", provider: "grok")
        let child = ChatPromptSubject(chatID: "child", item: request("acp-1-3"), source: source)
        state.update([own], others: [child])
        XCTAssertEqual(state.subjects.map(\.key), ["acp-1-3", "child/acp-1-3"])
        XCTAssertEqual(state.activeID, "acp-1-3")
        await state.submit(own, connected: true) {}
        XCTAssertEqual(state.activeSubject?.chatID, "child")
        XCTAssertEqual(state.activeSubject?.source?.label, "Fix the outbox")
        state.update([], others: [])
        XCTAssertNil(state.active)
    }

    @MainActor func testANoteOfAWaitingChildBringsItsRequestToTheFront() {
        let state = ChatPromptState()
        let own = request("own")
        let child = ChatPromptSubject(chatID: "child", item: request("r1"), source: nil)
        state.update([own], others: [child])
        XCTAssertEqual(state.activeID, "own")
        state.show(chatID: "elsewhere")
        XCTAssertEqual(state.activeID, "own")
        state.show(chatID: "child")
        XCTAssertEqual(state.activeID, "child/r1")
    }

    @MainActor func testARequestOfAnotherChatStandsOnlyWhileThatChatStillWaitsOnIt() {
        let item = request("r1")
        func info(_ status: String, requests: [String]?) -> ChatInfo {
            var fields: [String: JSONValue] = ["status": .string(status)]
            if let requests {
                fields["requests"] = .array(
                    requests.map {
                        .object([
                            "requestId": .string($0), "itemId": .string($0), "kind": .string("approval"),
                            "createdAt": .number(0),
                        ])
                    })
            }
            return ChatWire.info(fields).chatInfo
        }
        XCTAssertTrue(ChatPromptFeed.stillWaiting(item, info: info("needs-you", requests: nil)))
        XCTAssertTrue(ChatPromptFeed.stillWaiting(item, info: info("needs-you", requests: ["r1"])))
        XCTAssertFalse(ChatPromptFeed.stillWaiting(item, info: info("needs-you", requests: ["r2"])))
        XCTAssertTrue(
            ChatPromptFeed.stillWaiting(item, info: info("needs-you", requests: (0..<8).map { "other-\($0)" })))
        XCTAssertFalse(ChatPromptFeed.stillWaiting(item, info: info("running", requests: ["r1"])))
    }

    private enum Failure: Error { case expected }
}
