import RuimtePulsar
import XCTest

@testable import RuimteTransport

final class ChatHistoryTests: XCTestCase {
    private func item(_ id: String, _ text: String = "") -> ChatItem {
        .assistant(ChatAssistantItem(id: id, createdAt: 0, turnId: nil, text: text, streaming: false))
    }

    private func approval(_ id: String, _ decision: ChatApprovalDecision) -> ChatItem {
        .approval(
            ChatApprovalItem(
                id: id, createdAt: 0, turnId: nil, requestId: "request-\(id)", toolUseId: nil, toolName: "Bash",
                input: .null, description: nil, canAllowAlways: false, decision: decision))
    }

    private func subagent(_ id: String, _ status: ChatSubagentStatus) -> ChatSubagentItem {
        ChatSubagentItem(
            id: id, createdAt: 0, turnId: nil, toolUseId: "tool-\(id)", description: id, subagentType: nil, prompt: nil,
            background: false, status: status, startedAt: 0, finishedAt: nil, summary: nil, result: nil, usage: nil,
            lastTool: nil, itemsTruncated: false)
    }

    func testSubagentsBeforePageFollowTheirUpdatesUntilAPageReachesThem() {
        var history = ChatHistory()
        history.replace(
            history: ChatHistoryPage(start: 80, cursor: "epoch:80"), pending: [], subagents: [subagent("s0", .running)])
        XCTAssertFalse(history.includes(.subagent(subagent("s0", .done)), index: 3))
        XCTAssertFalse(history.includes(.subagent(subagent("s1", .running)), index: 5))
        XCTAssertEqual(history.subagents, [.subagent(subagent("s0", .done)), .subagent(subagent("s1", .running))])
        _ = history.prepend(
            ChatHistoryResult(items: [.subagent(subagent("s1", .running))], history: ChatHistoryPage(start: 4, cursor: "epoch:4")),
            to: [])
        XCTAssertEqual(history.subagents, [.subagent(subagent("s0", .done))])
        history.replace(history: nil, pending: [], subagents: [subagent("s0", .running)])
        XCTAssertTrue(history.subagents.isEmpty)
    }

    private func workflow(_ id: String, _ state: ChatToolState) -> ChatToolItem {
        ChatToolItem(
            id: id, createdAt: 0, turnId: nil, toolUseId: id, name: "Workflow", input: .null, output: nil, state: state,
            parentToolUseId: nil, workflow: ChatToolItemWorkflow(name: id, phases: [], agents: []))
    }

    func testWorkflowsBeforePageFollowTheirUpdatesUntilAPageReachesThem() {
        var history = ChatHistory()
        history.replace(
            history: ChatHistoryPage(start: 80, cursor: "epoch:80"), pending: [], workflows: [workflow("w0", .running)])
        XCTAssertFalse(history.includes(.tool(workflow("w0", .done)), index: 3))
        XCTAssertFalse(history.includes(.tool(workflow("w1", .running)), index: 5))
        XCTAssertEqual(history.workflows, [.tool(workflow("w0", .done)), .tool(workflow("w1", .running))])
        _ = history.prepend(
            ChatHistoryResult(items: [.tool(workflow("w1", .running))], history: ChatHistoryPage(start: 4, cursor: "epoch:4")),
            to: [])
        XCTAssertEqual(history.workflows, [.tool(workflow("w0", .done))])
        history.replace(history: nil, pending: [], workflows: [workflow("w0", .running)])
        XCTAssertTrue(history.workflows.isEmpty)
    }

    func testOlderDaemonKeepsFullHistoryAndNeedsNoPagingRequest() {
        var history = ChatHistory()
        history.replace(history: nil, pending: [])
        XCTAssertNil(history.cursor)
        XCTAssertTrue(history.includes(item("two"), index: nil))
    }

    func testPendingOutsidePageRemainsActionableAndSettlesWithoutAppending() {
        var history = ChatHistory()
        let pending = approval("a", .pending)
        history.replace(history: ChatHistoryPage(start: 80, cursor: "epoch:80"), pending: [pending])
        XCTAssertEqual(history.pending["a"], pending)
        XCTAssertFalse(history.includes(approval("a", .allow), index: 0))
        XCTAssertTrue(history.pending.isEmpty)
        XCTAssertTrue(history.includes(item("tail"), index: 81))
    }

    func testPrependPreservesNewerLiveItemsAndResetDropsCursorAndPending() {
        var history = ChatHistory()
        history.replace(history: ChatHistoryPage(start: 2, cursor: "epoch:2"), pending: [])
        let merged = history.prepend(
            ChatHistoryResult(
                items: [item("old"), item("tail", "stale")], history: ChatHistoryPage(start: 0, cursor: nil)),
            to: [item("tail", "live")])
        XCTAssertEqual(merged, [item("old"), item("tail", "live")])
        XCTAssertNil(history.cursor)
        history.replace(history: nil, pending: [])
        XCTAssertEqual(history.start, 0)
        XCTAssertTrue(history.pending.isEmpty)
    }
}
