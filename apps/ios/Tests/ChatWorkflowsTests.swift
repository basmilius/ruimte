import RuimtePulsar
import XCTest

@testable import Ruimte

final class ChatWorkflowsTests: XCTestCase {
    private func agent(_ index: Int64, _ status: ChatSubagentStatus, startedAt: Double? = 1, durationMs: Int64? = 5)
        -> ChatToolItemWorkflowAgentsItem
    {
        ChatToolItemWorkflowAgentsItem(
            index: index, label: "a\(index)", phaseIndex: nil, agentId: "a\(index)", status: status,
            startedAt: startedAt, durationMs: status == .running ? nil : durationMs, lastTool: nil)
    }

    private func tool(
        _ id: String, _ state: ChatToolState, name: String? = nil, agents: [ChatToolItemWorkflowAgentsItem] = [],
        stalledAt: Double? = nil, finishedAt: Double? = nil
    ) -> ChatToolItem {
        ChatToolItem(
            id: id, createdAt: 0, turnId: nil, toolUseId: id, name: "Workflow", input: .null, output: nil, state: state,
            parentToolUseId: nil,
            workflow: ChatToolItemWorkflow(
                name: name ?? "Flow \(id)", phases: [], agents: agents, stalledAt: stalledAt, finishedAt: finishedAt))
    }

    private func call(_ tool: ChatToolItem) -> WorkflowCall {
        WorkflowCall(item: tool, workflow: tool.workflow!)
    }

    private func user(_ id: String, at createdAt: Double) -> ChatItem {
        .user(ChatUserItem(id: id, createdAt: createdAt, turnId: nil, text: "Go"))
    }

    func testActivityKeepsWhatRunsAndWhatEndedSinceTheLastMessage() {
        let items: [ChatItem] = [
            .tool(tool("old", .done, finishedAt: 50)),
            .tool(tool("long", .running)),
            .tool(tool("ended", .done, finishedAt: 150)),
            user("u", at: 100),
            .tool(tool("after", .done)),
        ]
        XCTAssertEqual(ChatWorkflows.activity(items).map(\.id), ["long", "ended", "after"])
    }

    func testActivityLeavesOutACallThatNeverReported() {
        let quiet = ChatToolItem(
            id: "quiet", createdAt: 0, turnId: nil, toolUseId: "quiet", name: "Workflow", input: .null, output: nil,
            state: .running, parentToolUseId: nil)
        XCTAssertTrue(ChatWorkflows.activity([.tool(quiet)]).isEmpty)
    }

    func testPillNamesOneWorkflowWithItsProgress() {
        let running = tool("w", .running, agents: [agent(0, .done), agent(1, .running), agent(2, .running)])
        XCTAssertEqual(ChatWorkflows.pill([call(running)]).word, .running)
        XCTAssertEqual(ChatWorkflows.pill([call(running)]).label, "Flow w · 1/3")
        XCTAssertEqual(ChatWorkflows.pill([call(tool("w", .running))]).label, "Flow w")
        XCTAssertEqual(ChatWorkflows.pill([call(tool("w", .running, stalledAt: 9))]).word, .stalled)
        XCTAssertEqual(ChatWorkflows.pill([call(tool("w", .running, stalledAt: 9))]).label, "Flow w · no progress")
        XCTAssertEqual(ChatWorkflows.pill([call(tool("w", .error, agents: [agent(0, .failed)]))]).word, .failed)
    }

    func testPillCountsSeveralByTheOnesStillAtWork() {
        let busy = ChatWorkflows.pill([
            call(tool("a", .done)), call(tool("b", .running)), call(tool("c", .running, stalledAt: 9)),
        ])
        XCTAssertEqual(busy.word, .stalled)
        XCTAssertEqual(busy.label, "2 workflows")
        let settled = ChatWorkflows.pill([call(tool("a", .done)), call(tool("b", .error)), call(tool("c", .done))])
        XCTAssertEqual(settled.word, .failed)
        XCTAssertEqual(settled.label, "3 workflows")
    }
}
