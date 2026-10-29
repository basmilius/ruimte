import RuimtePulsar
import XCTest

@testable import Ruimte

final class ChatThoughtTests: XCTestCase {
    func testFlattenDropsTheMarksAndFoldsEveryLineIntoOne() {
        XCTAssertEqual(
            ChatThought.flatten("The test in `chat.test.ts` fails.\n\nIt **races** the [outbox](https://bas.dev)."),
            "The test in chat.test.ts fails. It races the outbox.")
        XCTAssertEqual(ChatThought.flatten("## Plan\n- read it\n* fix it\n1. test it"), "Plan read it fix it test it")
    }

    func testPreviewIsTheHeadingAThoughtOpensWith() {
        XCTAssertEqual(
            ChatThought.preview("**Checking the failing test**\n\nThe test fails because the entry is written first."),
            "Checking the failing test")
        XCTAssertEqual(
            ChatThought.preview("\n\n  **Reading the outbox**  \nIt holds two entries."), "Reading the outbox")
    }

    func testPreviewIsTheWholeThoughtFlattenedWithoutAHeading() {
        XCTAssertEqual(
            ChatThought.preview("The entry is written first.\n\n**Then** the task settles."),
            "The entry is written first. Then the task settles.")
        XCTAssertEqual(ChatThought.preview("**Note** that the outbox runs first."), "Note that the outbox runs first.")
        XCTAssertEqual(ChatThought.preview(""), "")
        XCTAssertEqual(ChatThought.preview("  \n "), "")
    }

    func testLineIsTheLastHeadingTheModelIsOn() {
        XCTAssertEqual(
            ChatThought.line("**Reading the test**\nIt fails.\n\n**Checking the outbox**\nThe entry comes first."),
            "Checking the outbox")
        XCTAssertEqual(ChatThought.line("Some words.\n\n**Running the suite**"), "Running the suite")
        XCTAssertEqual(
            ChatThought.line("The entry is written first. So it races.\n\n**Running the"), "The entry is written first."
        )
    }

    func testLineIsTheFirstSentenceOfAThoughtWithoutHeadings() {
        XCTAssertEqual(
            ChatThought.line(
                "The outbox entry is written before the task settles, so the wake races. I will check `a.ts` next."),
            "The outbox entry is written before the task settles, so the wake races.")
        XCTAssertEqual(
            ChatThought.line("Version 1.5 of a.ts breaks it? Then revert."), "Version 1.5 of a.ts breaks it?")
        XCTAssertEqual(ChatThought.line("Looking at the outbox"), "Looking at the outbox")
        XCTAssertEqual(ChatThought.line(""), "")
    }

    @MainActor func testARunningTurnKeepsItsThoughtAboveTheToolGroupWithoutRepeatingIt() {
        let presentation = ChatPresentation()
        let info = ChatWire.info(["activeTurnId": .string("turn")]).chatInfo
        presentation.replace(
            [
                item("turn", "turn").setting("state", .string("running")),
                item("thought", "thinking").setting("text", .string("**Reading the outbox**")),
                item("read", "tool").setting("state", .string("done")),
                item("live", "tool").setting("state", .string("running")),
            ].map { $0.setting("turnId", .string("turn")).chatItem }, info: info)
        XCTAssertEqual(
            presentation.entries.map(\.id), ["thought", "tools-read", "working-turn"])
    }

    @MainActor func testTheThoughtIsNotRepeatedRightUnderItself() {
        let presentation = ChatPresentation()
        let info = ChatWire.info(["activeTurnId": .string("turn")]).chatInfo
        presentation.replace(
            [
                item("turn", "turn").setting("state", .string("running")),
                item("thought", "thinking").setting("text", .string("Checking it.")),
                item("live", "tool").setting("state", .string("running")),
            ].map { $0.setting("turnId", .string("turn")).chatItem }, info: info)
        XCTAssertFalse(presentation.entries.contains { $0.kind == .liveThought })
    }

    @MainActor func testARunningWorkflowStaysInSightAfterItsTurnEnded() {
        let presentation = ChatPresentation()
        let workflow: JSONValue = .object(["name": .string("review"), "phases": .array([]), "agents": .array([])])
        presentation.replace(
            [
                item("turn", "turn").setting("state", .string("done")),
                item("read", "tool"),
                item("flow", "tool").setting("name", .string("Workflow")).setting("state", .string("running"))
                    .setting("workflow", workflow),
                item("answer", "assistant").setting("text", .string("Started.")),
            ].map { $0.setting("turnId", .string("turn")).chatItem }, info: nil)
        XCTAssertEqual(presentation.entries.map(\.id), ["fold-turn", "flow", "answer"])
    }

    @MainActor func testWorkLinesSitTightAndProseKeepsABlockGap() {
        let presentation = ChatPresentation()
        presentation.replace(
            [
                item("ask", "user"),
                item("turn", "turn").setting("state", .string("done")),
                item("read", "tool"),
                item("answer", "assistant").setting("text", .string("Done.")),
            ].map { $0.setting("turnId", .string("turn")).chatItem }, info: nil)
        presentation.toggleTurn("turn")
        XCTAssertEqual(presentation.entries.map(\.kind), [.message, .turnFold, .tools, .message])
        XCTAssertEqual(presentation.entries.map(\.isWorkLine), [false, true, true, false])
    }

    func testAWorkLineGetsABlockGapOnlyWhereItMeetsProse() {
        let rows = ChatRowPadding.rows([.block, .work, .work, .block, .work])
        XCTAssertEqual(rows.map(\.top), [10, 10, 2, 10, 10])
        XCTAssertEqual(rows.map(\.bottom), [10, 2, 10, 10, 2])
        XCTAssertEqual(zip(rows, rows.dropFirst()).map { $0.bottom + $1.top }, [20, 4, 20, 20])
    }

    func testAQuestionMakesRoomForItsAnswerAndOpensATurnWithTheTurnGap() {
        let rows = ChatRowPadding.rows([.question, .work, .block, .question, .block])
        let gaps = zip(rows, rows.dropFirst()).map { $0.bottom + $1.top }
        // Under a question its answer gap, whatever answers; over one after the first the turn gap.
        XCTAssertEqual(gaps, [26, 20, 40, 26])
        XCTAssertEqual(rows[0].top, ChatRowPadding.prose)
        XCTAssertGreaterThan(gaps[0], gaps[1])
        XCTAssertGreaterThan(gaps[2], gaps[0])
    }

    @MainActor func testAQuestionIsTheRowAReplyAnswers() {
        let presentation = ChatPresentation()
        presentation.replace(
            [
                item("ask", "user"),
                item("turn", "turn").setting("state", .string("done")),
                item("answer", "assistant").setting("text", .string("Done.")),
            ].map { $0.setting("turnId", .string("turn")).chatItem }, info: nil)
        XCTAssertEqual(presentation.entries.map(\.rhythm), [.question, .block])
    }

    private func item(_ id: String, _ kind: String) -> JSONValue {
        ChatWire.item(["id": .string(id), "kind": .string(kind)])
    }
}

final class ChatWorkflowLayoutTests: XCTestCase {
    private func agent(
        _ index: Int64, phase: Int64? = 1, status: ChatSubagentStatus = .running,
        startedAt: Double? = 1000, duration: Int64? = nil, lastTool: String? = nil, lastToolSummary: String? = nil,
        promptPreview: String? = nil, resultPreview: String? = nil, error: String? = nil
    ) -> ChatToolItemWorkflowAgentsItem {
        ChatToolItemWorkflowAgentsItem(
            index: index, label: "agent-\(index)", phaseIndex: phase, agentId: "a\(index)", status: status,
            startedAt: startedAt, durationMs: duration, lastTool: lastTool, lastToolSummary: lastToolSummary,
            promptPreview: promptPreview, resultPreview: resultPreview, error: error)
    }

    private func workflow(_ agents: [ChatToolItemWorkflowAgentsItem]) -> ChatToolItemWorkflow {
        ChatToolItemWorkflow(
            name: "write-and-read",
            phases: [.init(index: 1, title: "Write"), .init(index: 2, title: "Read")], agents: agents)
    }

    func testEveryPhaseIsThereInOrderAndAgentsOfNoKnownPhaseComeFirst() {
        let phases = ChatWorkflowLayout.phases(
            workflow([agent(1), agent(2, phase: nil), agent(3, phase: 9)]), running: true)
        XCTAssertEqual(phases.map(\.title), [nil, "Write", "Read"])
        XCTAssertEqual(phases.map { $0.agents.map(\.agent.index) }, [[2, 3], [1], []])
    }

    func testAnAgentAtWorkStopsWithItsWorkflowAndOneWithoutAStartWaits() {
        XCTAssertEqual(ChatWorkflowLayout.state(agent(1), workflowRunning: true), .running)
        XCTAssertEqual(ChatWorkflowLayout.state(agent(1, startedAt: nil), workflowRunning: true), .waiting)
        XCTAssertEqual(ChatWorkflowLayout.state(agent(1), workflowRunning: false), .stopped)
        XCTAssertEqual(ChatWorkflowLayout.state(agent(1, status: .done), workflowRunning: false), .done)
        XCTAssertEqual(ChatWorkflowLayout.phases(workflow([agent(1)]), running: false)[0].agents[0].state, .stopped)
    }

    func testASettledAgentSaysHowLongItTookAndTheOthersWhatTheyAreDoing() {
        func time(_ agent: ChatToolItemWorkflowAgentsItem, _ state: WorkflowAgentState) -> String? {
            ChatWorkflowLayout.time(WorkflowAgentView(agent: agent, state: state))
        }
        XCTAssertEqual(time(agent(1, status: .done, duration: 5421), .done), "5s")
        let elapsed: [(Int64, String)] = [(-5, "0s"), (12_400, "12s"), (120_000, "2m"), (125_000, "2m 5s")]
        for (duration, expected) in elapsed {
            XCTAssertEqual(time(agent(1, status: .done, duration: duration), .done), expected)
        }
        XCTAssertEqual(time(agent(1, status: .failed, duration: 2000), .failed), "2s")
        XCTAssertNil(time(agent(1, status: .failed), .failed))
        XCTAssertEqual(time(agent(1, startedAt: nil), .waiting), "waiting")
        XCTAssertEqual(time(agent(1), .stopped), "stopped")
        XCTAssertNil(time(agent(1), .running))
    }

    func testAnAgentAtWorkShowsItsLastToolASettledOneItsAnswerAndAFailedOneItsError() {
        func preview(_ agent: ChatToolItemWorkflowAgentsItem, _ state: WorkflowAgentState) -> WorkflowAgentPreview {
            ChatWorkflowLayout.preview(WorkflowAgentView(agent: agent, state: state))
        }
        XCTAssertEqual(
            preview(agent(1, lastTool: "Bash", lastToolSummary: "bun test"), .running),
            WorkflowAgentPreview(tool: "Bash", text: "bun test"))
        XCTAssertEqual(
            preview(agent(1, promptPreview: "Map the device"), .running), WorkflowAgentPreview(text: "Map the device"))
        XCTAssertEqual(
            preview(agent(1, promptPreview: "Map", resultPreview: "\n# Catalog\nmore"), .done),
            WorkflowAgentPreview(text: "Catalog"))
        XCTAssertEqual(preview(agent(1, promptPreview: "Map"), .done), WorkflowAgentPreview(text: "Map"))
        XCTAssertEqual(preview(agent(1, error: "blocked"), .failed), WorkflowAgentPreview(text: "blocked"))
        XCTAssertEqual(preview(agent(1), .waiting), WorkflowAgentPreview())
    }

    func testTheCountsHoldEveryAgentOnceByItsState() {
        let phases = ChatWorkflowLayout.phases(
            workflow([agent(1), agent(2, status: .done), agent(3, startedAt: nil), agent(4, status: .done)]),
            running: true)
        XCTAssertEqual(
            ChatWorkflowLayout.counts(phases), WorkflowCounts(total: 4, running: 1, waiting: 1, done: 2))
        XCTAssertEqual(phases[0].settled, 2)
        XCTAssertEqual(
            String(ChatWorkflowRow.countsText(ChatWorkflowLayout.counts(phases)).characters),
            "4 agents · 1 working · 2 done")
    }

    func testTheDescriptionReadsOutOfTheMetaLiteralQuotesAndEscapesIncluded() {
        let script =
            "export const meta = {\n    name: 'build',\n    description: 'Build the \\'home\\' layer',\n"
            + "    phases: [{ title: 'Map' }]\n}\nconst description = 'not this'"
        XCTAssertEqual(ChatWorkflowLayout.description(.object(["script": .string(script)])), "Build the 'home' layer")
        let outside =
            "export const meta = { name: \"x\", phases: [{ title: \"}\" }] }\nagent(\"a\", { description: \"not this\" })"
        XCTAssertNil(ChatWorkflowLayout.description(.object(["script": .string(outside)])))
        XCTAssertNil(ChatWorkflowLayout.description(.object(["name": .string("review")])))
        XCTAssertNil(ChatWorkflowLayout.description(.null))
    }

    func testAWorkflowAgentIsOpenedByItsAgentIDUnderThePrefix() {
        XCTAssertEqual(ChatWorkflowRow.agentRef("abc"), "workflow-agent:abc")
    }
}

final class ChatTaskRowTests: XCTestCase {
    private func task(
        _ status: String = "running", started: Double = 1000, finished: Double? = nil,
        extra: [String: JSONValue] = [:]
    ) -> ChatSubagentItem {
        var fields: [String: JSONValue] = [
            "id": .string("task-t1"), "kind": .string("subagent"), "description": .string("Fix the outbox"),
            "status": .string(status), "startedAt": .number(started),
            "finishedAt": finished.map(JSONValue.number) ?? .null,
            "origin": .string("ruimte"), "childId": .string("child"),
        ]
        fields.merge(extra) { $1 }
        return ChatWire.item(fields).chatItem.subagentItem!
    }

    func testTheStateIsTheTasksOwnOrThatItsAgentWaitsOnAPerson() {
        XCTAssertEqual(ChatSubagents.taskRowState(task(), task: nil, childWaiting: false), .running)
        XCTAssertEqual(ChatSubagents.taskRowState(task(), task: nil, childWaiting: true), .waiting)
        let paused: JSONValue = .object(["status": .string("open"), "paused": .object(["kind": .string("usage")])])
        XCTAssertEqual(ChatSubagents.taskRowState(task(), task: paused, childWaiting: true), .paused)
        let cancelled: JSONValue = .object(["status": .string("cancelled")])
        XCTAssertEqual(ChatSubagents.taskRowState(task("failed"), task: cancelled, childWaiting: false), .cancelled)
        XCTAssertEqual(ChatSubagents.taskRowState(task("failed"), task: nil, childWaiting: true), .failed)
        XCTAssertEqual(ChatSubagents.taskRowState(task("done"), task: nil, childWaiting: false), .done)
    }

    func testTheStateLineSaysUntilWhenAPausedTaskWaits() {
        let locale = FormatLocale(
            region: Locale(identifier: "en_US"), language: Locale(identifier: "en"),
            timeZone: TimeZone(identifier: "UTC")!)
        let now = Date(timeIntervalSince1970: 2 * 86_400 + 12 * 3600)
        let until = (now.timeIntervalSince1970 + 3600) * 1000
        let paused: JSONValue = .object(["paused": .object(["kind": .string("usage"), "until": .number(until)])])
        XCTAssertEqual(
            ChatSubagents.taskStateText(.paused, task: paused, now: now, locale: locale), "Paused until 01:00 PM")
        XCTAssertEqual(ChatSubagents.taskStateText(.paused, task: nil, now: now, locale: locale), "Paused")
        XCTAssertEqual(ChatSubagents.taskStateText(.waiting, task: nil, now: now, locale: locale), "Waiting for you")
        XCTAssertEqual(ChatSubagents.taskStateText(.cancelled, task: nil, now: now, locale: locale), "Cancelled")
    }

    func testTheTitleNamesTheModelBeforeTheTask() {
        XCTAssertEqual(ChatSubagents.taskTitle(task(), model: "Opus 5.5"), "Opus 5.5: Fix the outbox")
        XCTAssertEqual(ChatSubagents.taskTitle(task(), model: nil), "Fix the outbox")
        XCTAssertEqual(ChatSubagents.taskTitle(task(extra: ["description": .string("")]), model: nil), "Task")
    }

    func testASettledTaskSaysHowLongItTookFromItsOwnRecord() {
        let done = task("done", started: 1000, finished: 4000)
        XCTAssertEqual(ChatSubagents.taskDuration(done, task: nil, state: .done), "3s")
        let record: JSONValue = .object(["createdAt": .number(1000), "settledAt": .number(66_000)])
        XCTAssertEqual(ChatSubagents.taskDuration(done, task: record, state: .done), "1m 5s")
        XCTAssertNil(ChatSubagents.taskDuration(task(), task: nil, state: .running))
        XCTAssertNil(ChatSubagents.taskDuration(task("done", started: 0, finished: 4000), task: nil, state: .done))
    }

    func testASettledSubAgentSaysHowItEndedAndHowLongItTook() {
        XCTAssertEqual(ChatSubagents.outcome(task("done", finished: 6000)), "done in 5s")
        XCTAssertEqual(ChatSubagents.outcome(task("failed", finished: 3000)), "failed in 2s")
        XCTAssertEqual(ChatSubagents.outcome(task("done")), "Done")
        XCTAssertNil(ChatSubagents.outcome(task()))
    }
}
