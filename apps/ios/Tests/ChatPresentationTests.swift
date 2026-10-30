import RuimtePulsar
import XCTest

@testable import Ruimte

final class ChatPresentationTests: XCTestCase {
    @MainActor func testReplyTreesFollowBlocksReadingsAndAnswersAcrossTextUpdates() throws {
        func block(_ fallback: String) -> ChatUiBlock {
            ChatUiBlock(
                id: "block", catalogVersion: 1, start: 0, end: 0, complete: false, defaults: [:], queries: [:],
                nodes: [], diagnostics: [], fallback: fallback)
        }
        func reply(
            _ text: String, fallback: String? = "card", queries: ChatUiQueryState? = nil,
            answers: [String: ChatUiAnswer]? = nil
        ) -> ChatItem {
            .assistant(
                ChatAssistantItem(
                    id: "reply", createdAt: 0, turnId: nil, ui: fallback.map { [block($0)] }, uiAnswers: answers,
                    uiQueries: queries, text: text, streaming: true))
        }
        let record = ChatItemState(reply("before"))
        let initial = try XCTUnwrap(record.replyTrees)
        record.update(reply("after"))
        XCTAssertEqual(record.replyTrees?.blocks, initial.blocks)
        let queries = ChatUiQueryState(
            authorChatId: "chat",
            blocks: ["block": ChatUiQueryStateBlocksValue(revision: "r", readings: [:], fallback: "reading")])
        record.update(reply("after", queries: queries))
        XCTAssertEqual(record.replyTrees?.frozen["block"]?["fallback"]?.stringValue, "reading")
        let answers = [
            "block": ChatUiAnswer(
                itemId: "reply", blockId: "block", revision: "r", choiceId: "pick", label: "Answered", sourceAt: 0,
                older: false, at: 1, queued: false, turnId: "turn")
        ]
        record.update(reply("after", queries: queries, answers: answers))
        XCTAssertEqual(record.replyTrees?.answered["block"]?["label"]?.stringValue, "Answered")
        record.update(reply("after", fallback: "revised", queries: queries, answers: answers))
        XCTAssertEqual(record.replyTrees?.blocks.first?["fallback"]?.stringValue, "revised")
        record.update(reply("without UI", fallback: nil))
        XCTAssertNil(record.replyTrees)
        record.update(reply("restored"))
        XCTAssertEqual(record.replyTrees?.blocks.first?["fallback"]?.stringValue, "card")
        XCTAssertEqual(record.replyTrees?.frozen, [:])
        XCTAssertEqual(record.replyTrees?.answered, [:])
    }

    @MainActor func testInfoAloneStartsAndEndsWorking() {
        let presentation = ChatPresentation()
        presentation.setConnected(true)
        presentation.setInfo(ChatWire.info(["activeTurnId": .string("turn")]).chatInfo)
        XCTAssertEqual(presentation.entries.map(\.kind), [.activity])
        XCTAssertTrue(presentation.isAnimating)
        presentation.setInfo(ChatWire.info(["activeTurnId": .null, "running": .bool(true)]).chatInfo)
        XCTAssertTrue(presentation.entries.isEmpty)
        XCTAssertFalse(presentation.isAnimating)
    }

    @MainActor func testTextDeltaKeepsRowIdentityAndStructureRevision() {
        let presentation = ChatPresentation()
        presentation.replace([item("reply", "assistant").chatItem], info: nil)
        let record = presentation.entries[0].items[0]
        let revision = presentation.revision
        presentation.upsert(item("reply", "assistant").setting("text", .string("Hello 🌍")).chatItem, textOnly: true)
        XCTAssertEqual(presentation.revision, revision)
        XCTAssertTrue(presentation.entries[0].items[0] === record)
        XCTAssertEqual(record.item.assistantItem?.text, "Hello 🌍")
    }

    @MainActor func testToolGroupKeepsItsIdentityAndOrderAsCallsStartAndFinish() {
        let presentation = ChatPresentation()
        let first = item("first", "tool").setting("state", .string("running"))
        let second = item("second", "tool").setting("state", .string("running"))
        presentation.replace([first.chatItem], info: nil)
        XCTAssertEqual(presentation.entries.map(\.id), ["tools-first"])
        presentation.upsert(second.chatItem)
        presentation.upsert(second.setting("state", .string("done")).chatItem)
        XCTAssertEqual(presentation.entries.map(\.id), ["tools-first"])
        XCTAssertEqual(presentation.entries[0].items.map(\.id), ["first", "second"])
        presentation.upsert(first.setting("state", .string("error")).chatItem)
        XCTAssertEqual(presentation.entries.map(\.id), ["tools-first"])
        XCTAssertEqual(presentation.entries[0].items.map(\.item.toolItem?.state), [.error, .done])
    }

    @MainActor func testBlockingRequestAndDisconnectStopActiveAnimation() {
        let presentation = ChatPresentation()
        presentation.setConnected(true)
        presentation.replace(
            [
                item("question", "question").setting("state", .string("pending")).setting("async", .bool(true))
            ].map(\.chatItem), info: ChatWire.info(["activeTurnId": .string("turn")]).chatInfo)
        XCTAssertTrue(presentation.isAnimating)
        presentation.upsert(item("permission", "approval").setting("decision", .string("pending")).chatItem)
        XCTAssertEqual(presentation.activityLabel, "Waiting for you")
        XCTAssertFalse(presentation.isAnimating)
        XCTAssertEqual(presentation.entries.count, 1)
        presentation.setConnected(false)
        XCTAssertEqual(presentation.activityLabel, "Connection lost")
    }

    @MainActor func testSnapshotReplacesOldRecordsAndUsesTurnStart() {
        let presentation = ChatPresentation()
        presentation.replace([item("old", "assistant").chatItem], info: nil)
        presentation.replace(
            [
                item("turn", "turn").setting("createdAt", .number(42)).setting("state", .string("running"))
            ].map(\.chatItem), info: ChatWire.info(["activeTurnId": .string("turn")]).chatInfo)
        XCTAssertEqual(presentation.startedAt, 42)
        XCTAssertEqual(presentation.entries.map(\.id), ["working-turn"])
    }

    func testRevealWaitsForWordsAndFinishesWithoutSplittingEmoji() {
        XCTAssertEqual(ChatReveal.boundary("Hello world", position: 8, finished: false), "Hello ")
        XCTAssertEqual(ChatReveal.boundary("Hello world", position: 11, finished: false), "Hello ")
        XCTAssertEqual(ChatReveal.boundary("Hello 🌍", position: 7, finished: true), "Hello 🌍")
        XCTAssertEqual(ChatReveal.boundary("👩🏽‍💻 done", position: 1, finished: false), "👩🏽‍💻")
    }

    @MainActor func testSettledTurnKeepsAnswerAndWarningVisible() {
        let presentation = ChatPresentation()
        let turn = item("turn", "turn").setting("turnId", .string("turn")).setting("state", .string("done"))
        let tool = item("tool", "tool").setting("turnId", .string("turn")).setting("state", .string("done"))
        let reply = item("reply", "assistant").setting("turnId", .string("turn"))
        let note = item("warning", "note").setting("turnId", .string("turn")).setting("level", .string("warning"))
        presentation.replace([turn, tool, reply, note].map(\.chatItem), info: nil)
        XCTAssertEqual(presentation.entries.map(\.id), ["fold-turn", "reply", "warning"])
        presentation.toggleTurn("turn")
        XCTAssertEqual(presentation.entries.map(\.id), ["fold-turn", "tools-tool", "reply", "warning"])
    }

    @MainActor func testASteeringMessageKeepsItsPlaceInTheTurn() {
        let presentation = ChatPresentation()
        let turn = item("turn", "turn").setting("turnId", .string("turn")).setting("state", .string("running"))
        let first = item("first", "user").setting("turnId", .string("turn"))
        let early = item("early", "assistant").setting("turnId", .string("turn"))
        let steer = item("steer", "user").setting("turnId", .string("turn"))
        let tool = item("tool", "tool").setting("turnId", .string("turn")).setting("state", .string("done"))
        let reply = item("reply", "assistant").setting("turnId", .string("turn"))
        presentation.replace(
            [turn, first, early, steer, tool, reply].map(\.chatItem),
            info: ChatWire.info(["activeTurnId": .string("turn")]).chatInfo)
        XCTAssertEqual(
            presentation.entries.map(\.id), ["first", "early", "steer", "tools-tool", "reply", "working-turn"])
        presentation.replace(
            [turn.setting("state", .string("done")), first, early, steer, tool, reply].map(\.chatItem), info: nil)
        XCTAssertEqual(presentation.entries.map(\.id), ["first", "early", "steer", "fold-turn", "reply"])
    }

    @MainActor func testGeneratedImageStaysOutsideTheTurnFoldAndNeverDuplicatesOnExpand() {
        let presentation = ChatPresentation()
        let turn = item("turn", "turn").setting("turnId", .string("turn")).setting("state", .string("done"))
        let tool = item("tool", "tool").setting("turnId", .string("turn")).setting("state", .string("done"))
        let image = item("image", "tool").setting("turnId", .string("turn")).setting("state", .string("done")).setting(
            "name", .string("ImageGeneration"))
        let reply = item("reply", "assistant").setting("turnId", .string("turn"))
        presentation.replace([turn, tool, image, reply].map(\.chatItem), info: nil)
        XCTAssertEqual(presentation.entries.map(\.id), ["fold-turn", "image", "reply"])
        XCTAssertEqual(presentation.entries[1].kind, .message)
        presentation.toggleTurn("turn")
        XCTAssertEqual(presentation.entries.map(\.id), ["fold-turn", "tools-tool", "image", "reply"])
        XCTAssertEqual(presentation.entries.filter { $0.id == "image" }.count, 1)
    }

    @MainActor func testSubagentTextBelongsToItsAgentAndDeltaRetainsStructure() {
        let presentation = ChatPresentation()
        let agent = item("agent", "subagent").setting("toolUseId", .string("spawn"))
        let child = item("child", "assistant").setting("parentToolUseId", .string("spawn"))
        presentation.replace([agent, child, item("main", "assistant")].map(\.chatItem), info: nil)
        XCTAssertEqual(presentation.entries.map(\.id), ["agent", "main"])
        XCTAssertEqual(presentation.entries[0].items.map(\.id), ["agent", "child"])
        let revision = presentation.revision
        presentation.upsert(child.setting("text", .string("Only the child changes")).chatItem, textOnly: true)
        XCTAssertEqual(presentation.revision, revision)
        XCTAssertEqual(presentation.entries[0].items[1].item.assistantItem?.text, "Only the child changes")
    }

    @MainActor func testAnAgentAnAgentOpenedIsARowOfItsOwnUnderTheOneThatOpenedIt() {
        let presentation = ChatPresentation()
        let parent = item("parent", "subagent").setting("toolUseId", .string("spawn-parent"))
        let step = item("step", "tool").setting("parentToolUseId", .string("spawn-parent"))
        let nested = item("nested", "subagent").setting("toolUseId", .string("spawn-nested"))
            .setting("parentToolUseId", .string("spawn-parent"))
        let deep = item("deep", "subagent").setting("toolUseId", .string("spawn-deep"))
            .setting("parentToolUseId", .string("spawn-nested"))
        let deepStep = item("deep-step", "assistant").setting("parentToolUseId", .string("spawn-deep"))
        presentation.replace([parent, step, nested, deep, deepStep].map(\.chatItem), info: nil)
        XCTAssertEqual(presentation.entries.map(\.id), ["parent"])
        let branch = presentation.entries[0].branch
        XCTAssertEqual(branch?.children.map(\.id), ["step"])
        XCTAssertEqual(branch?.nested.map(\.record.id), ["nested"])
        XCTAssertEqual(branch?.nested.first?.children.map(\.id), [])
        XCTAssertEqual(branch?.nested.first?.nested.first?.record.id, "deep")
        XCTAssertEqual(branch?.nested.first?.nested.first?.children.map(\.id), ["deep-step"])
        presentation.openSubagent(toolUseID: "spawn-deep")
        XCTAssertTrue(presentation.expandedSubagents.contains("deep"))
        XCTAssertEqual(presentation.requestedItemID, "parent")
    }

    @MainActor func testAChainOfAgentsThatNameEachOtherEndsAtTheNestingLimit() {
        let records = (0...10).map { depth in
            ChatItemState(
                item("agent-\(depth)", "subagent").setting("toolUseId", .string("spawn-\(depth)"))
                    .setting("parentToolUseId", depth == 0 ? .null : .string("spawn-\(depth - 1)")).chatItem)
        }
        let children = Dictionary(grouping: records.dropFirst()) { $0.item.parentToolUseID! }
        var branch: ChatSubagentBranch? = ChatSubagentBranch(records[0], children: children)
        var depth = 0
        while let next = branch?.nested.first {
            branch = next
            depth += 1
        }
        XCTAssertEqual(depth, ChatSubagentBranch.maxNesting)
    }

    @MainActor func testAgentTurnCanOpenTheSourceAgentInAnEarlierFold() {
        let presentation = ChatPresentation()
        let first = item("first", "turn").setting("turnId", .string("first")).setting("state", .string("done"))
        let agent = item("agent", "subagent").setting("turnId", .string("first")).setting("toolUseId", .string("spawn"))
            .setting("status", .string("done"))
        let second = item("second", "turn").setting("turnId", .string("second")).setting("state", .string("running"))
            .setting("origin", .string("agent"))
        presentation.replace([first, agent, second].map(\.chatItem), info: nil)
        XCTAssertEqual(presentation.entries.map(\.id), ["fold-first", "start-second"])
        presentation.openSubagent(toolUseID: "spawn")
        XCTAssertTrue(presentation.expandedSubagents.contains("agent"))
        XCTAssertEqual(presentation.requestedItemID, "agent")
        XCTAssertEqual(presentation.scrollRequest, 1)
        XCTAssertEqual(presentation.entries.map(\.id), ["fold-first", "agent", "start-second"])
    }

    func testProviderReplacementDiffsPreserveMultipleEditsToOneFile() {
        let tool = item("edit", "tool").setting("name", .string("MultiEdit")).setting(
            "input",
            .object([
                "file_path": .string("App.swift"),
                "edits": .array([
                    .object(["old_string": .string("old"), "new_string": .string("new")]),
                    .object(["old_string": .string("before"), "new_string": .string("after")]),
                ]),
            ]))
        let files = ChatFileChanges.grouped(ChatFileChanges.fromTool(tool.chatTool))
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(files[0].added, 2)
        XCTAssertEqual(files[0].deleted, 2)
        XCTAssertTrue(files[0].diff.contains("-old\n+new"))
        XCTAssertTrue(files[0].diff.contains("-before\n+after"))
        XCTAssertFalse(files[0].diff.contains("@@"))
    }

    func testRevealPaceDoesNotDependOnRefreshRate() {
        var slow = 0.0
        var fast = 0.0
        for _ in 0..<30 { slow = ChatReveal.advance(slow, target: 1000, elapsed: 1.0 / 30, finished: false) }
        for _ in 0..<120 { fast = ChatReveal.advance(fast, target: 1000, elapsed: 1.0 / 120, finished: false) }
        XCTAssertEqual(slow, fast, accuracy: 0.01)
        XCTAssertLessThanOrEqual(ChatReveal.advance(9, target: 10, elapsed: 3, finished: true), 10)
    }

    private func item(_ id: String, _ kind: String) -> JSONValue {
        ChatWire.item(["id": .string(id), "kind": .string(kind)])
    }
}

/// The cases of `deriveTimelineRows` in the desktop's `chat/logic/timeline.test.ts`, so both threads stay pinned to the
/// same rules.
@MainActor final class ChatTimelineRulesTests: XCTestCase {
    private func item(_ id: String, _ kind: String, turn: String = "t1") -> JSONValue {
        ChatWire.item(["id": .string(id), "kind": .string(kind), "turnId": .string(turn)])
    }

    private func tool(
        _ id: String, _ name: String = "Read", _ input: [String: JSONValue] = [:], state: String = "done",
        turn: String = "t1"
    ) -> JSONValue {
        item(id, "tool", turn: turn).setting("name", .string(name)).setting("input", .object(input))
            .setting("toolUseId", .string(id)).setting("state", .string(state))
    }

    private func reply(_ id: String, _ text: String = "Done.", turn: String = "t1") -> JSONValue {
        item(id, "assistant", turn: turn).setting("text", .string(text))
    }

    private func entries(_ values: [JSONValue], active: String? = nil, expanded: String? = nil) -> [ChatTimelineEntry] {
        let presentation = ChatPresentation()
        presentation.replace(
            values.map(\.chatItem), info: active.map { ChatWire.info(["activeTurnId": .string($0)]).chatInfo })
        if let expanded { presentation.toggleTurn(expanded) }
        return presentation.entries
    }

    private var settled: JSONValue { item("t1", "turn").setting("state", .string("done")) }
    private var running: JSONValue { item("t1", "turn").setting("state", .string("running")) }

    func testATurnThatEndsOnARefusedCallKeepsTheAnswerBeforeItInSightWithTheCallAndItsDenial() {
        let refusal = { (decision: String) in
            [
                self.settled, self.item("u5", "user"), self.tool("r5"), self.reply("a5", "I will create probe.txt."),
                self.tool("c5", "Change", state: "error"),
                self.item("p5", "approval").setting("toolUseId", .string("c5")).setting("decision", .string(decision)),
            ]
        }
        XCTAssertEqual(entries(refusal("deny")).map(\.id), ["u5", "fold-t1", "a5", "tools-c5", "p5"])
        XCTAssertEqual(entries(refusal("allow")).map(\.id), ["u5", "fold-t1"])
    }

    func testAnImageThatSettlesAfterTheClosingAnswerKeepsBothVisible() {
        let rows = entries([settled, item("u1", "user"), tool("r1"), reply("a1"), tool("image", "ImageGeneration")])
        XCTAssertEqual(rows.map(\.id), ["u1", "fold-t1", "a1", "image"])
    }

    func testABackgroundSubagentStaysOutOfTheFoldOfItsSettledTurnUntilItEnds() {
        let agent = { (status: String) in
            self.item("sa1", "subagent").setting("background", .bool(true)).setting("status", .string(status))
        }
        let rows = { (status: String) in
            self.entries([self.settled, self.item("u1", "user"), self.tool("r1"), agent(status), self.reply("a1")])
        }
        XCTAssertEqual(rows("running").map(\.id), ["u1", "fold-t1", "sa1", "a1"])
        XCTAssertEqual(rows("done").map(\.id), ["u1", "fold-t1", "a1"])
    }

    func testAnUnfoldedTurnShowsItsWorkInPlaceThenTheChangedFilesThenTheAnswerAndWhatFollowsIt() {
        let edit = tool(
            "e1", "Edit", ["file_path": .string("a.ts"), "old_string": .string("x"), "new_string": .string("y")])
        let early = item("n1", "note")
        let late = item("n2", "note")
        let values = [settled, item("u1", "user"), tool("r1"), early, edit, reply("a1"), late]
        XCTAssertEqual(entries(values).map(\.id), ["u1", "fold-t1", "files-t1", "a1", "n2"])
        XCTAssertEqual(
            entries(values, expanded: "t1").map(\.id),
            ["u1", "fold-t1", "tools-r1", "n1", "tools-e1", "files-t1", "a1", "n2"])
    }

    func testTheActiveTurnCollectsARunOfCallsWithTheRunningOnesAfterTheSettled() {
        let values = [
            running, item("u2", "user"), tool("b1", "Bash"), tool("b2", "Bash", state: "running"), tool("b3", "Bash"),
            item("a2", "assistant").setting("streaming", .bool(true)),
        ]
        let rows = entries(values, active: "t1")
        XCTAssertEqual(rows.map(\.id), ["u2", "tools-b1", "b2", "a2", "working-t1"])
        XCTAssertEqual(rows[1].items.map(\.id), ["b1", "b3"])
    }

    func testAnEmptyReplyThatNoLongerStreamsHasNoRow() {
        let rows = entries([item("u", "user"), reply("a", ""), reply("live", "").setting("streaming", .bool(true))])
        XCTAssertEqual(rows.map(\.id), ["u", "live"])
    }

    func testTheLiveThoughtStandsOverTheRunningCallTheLatestThoughtLedTo() {
        let thought = { (id: String) in
            self.item(id, "thinking").setting("text", .string("The entry is written first."))
        }
        let call = { (id: String, state: String) in
            self.tool(id, "Bash", ["command": .string("bun test")], state: state)
        }
        let ids = { (values: [JSONValue]) in
            self.entries([self.running, self.item("u2", "user")] + values, active: "t1").map(\.id)
        }
        XCTAssertEqual(
            ids([thought("k1"), call("r1", "done"), call("b1", "running")]),
            ["u2", "k1", "tools-r1", "live-thought-k1", "b1", "working-t1"])
        XCTAssertFalse(ids([thought("k1"), call("b1", "running")]).contains("live-thought-k1"))
        // Only the answer between the thought and the call it waits to run, as while it waits on an approval.
        XCTAssertFalse(ids([thought("k1"), reply("a1"), call("b1", "running")]).contains("live-thought-k1"))
        XCTAssertTrue(
            ids([thought("k1"), call("r1", "done"), thought("k2"), call("r2", "done"), call("b1", "running")])
                .contains("live-thought-k2"))
        XCTAssertFalse(
            ids([call("r1", "done"), call("b1", "running"), thought("k1")]).contains { $0.hasPrefix("live") })
        XCTAssertFalse(ids([thought("k1"), call("r1", "done"), call("r2", "done")]).contains { $0.hasPrefix("live") })
    }

    func testAnEditThatFailedOrWasRefusedCountsAsACallNeverAsAFileEdited() {
        let write = { (path: String, state: String) in
            self.tool(path, "Write", ["file_path": .string(path)], state: state).chatTool
        }
        let edit = { (path: String, state: String) in
            self.tool(path, "Edit", ["file_path": .string(path)], state: state).chatTool
        }
        XCTAssertEqual(ChatToolPresentation.turnSummary([write("a", "error")]).map(\.text), ["1 tool call"])
        XCTAssertEqual(
            ChatToolPresentation.turnSummary([edit("a", "done"), write("b", "error")]).map(\.text),
            ["Edited 1 file", "1 other tool call"])
        XCTAssertEqual(
            ChatToolPresentation.groupLabel([write("a", "done"), write("b", "error")]).text, "Edited 1 file")
        XCTAssertEqual(
            ChatToolPresentation.groupLabel([write("a", "error"), write("b", "error")]).text, "Write 2 calls")
        XCTAssertEqual(ChatToolPresentation.groupLabel([edit("a", "error"), edit("b", "error")]).text, "Edit 2 calls")
    }

    func testACallThatWaitsOnAnApprovalIsKnownByItsToolUse() {
        let presentation = ChatPresentation()
        let approval = item("p", "approval").setting("toolUseId", .string("call"))
        presentation.replace([running, tool("call", "Bash", state: "running"), approval].map(\.chatItem), info: nil)
        XCTAssertEqual(presentation.awaitingApproval, ["call"])
        presentation.upsert(approval.setting("decision", .string("allow")).chatItem)
        XCTAssertEqual(presentation.awaitingApproval, [])
    }

    func testAJumpThatSearchedLightsUpTheRowItLandedOn() {
        let presentation = ChatPresentation()
        presentation.replace([item("u1", "user")].map(\.chatItem), info: nil)
        XCTAssertTrue(presentation.revealItem("u1"))
        XCTAssertNil(presentation.flash)
        XCTAssertTrue(presentation.revealItem("u1", flashing: true))
        let first = presentation.flash
        XCTAssertEqual(first?.entryID, "u1")
        XCTAssertEqual(first?.fresh, true)
        presentation.reveal(entryID: "u1", flashing: true)
        XCTAssertNotEqual(presentation.flash?.nonce, first?.nonce)
    }

    func testAQuoteWhoseReplyIsGoneSaysSoUntilItIsTappedAgain() throws {
        let presentation = ChatPresentation()
        presentation.requestQuote(messageID: "u2", sourceID: "a1")
        let jump = try XCTUnwrap(presentation.quoteRequest)
        XCTAssertEqual(jump.sourceID, "a1")
        presentation.finishQuote(jump, gone: true)
        XCTAssertNil(presentation.quoteRequest)
        XCTAssertEqual(presentation.goneQuotes, ["u2"])
        presentation.requestQuote(messageID: "u2", sourceID: "a1")
        XCTAssertEqual(presentation.goneQuotes, [])
    }

    func testAMessageSplitsIntoItsQuoteAndTheRest() {
        let split = { (text: String) in ChatQuote.split(text).map { [$0.quote, $0.rest] } }
        XCTAssertEqual(
            split("> One.\n>\n> Two.\n>     code\n\nWhy?\n\nAnd more."),
            ["One.\n\nTwo.\n    code", "Why?\n\nAnd more."])
        XCTAssertEqual(split("> One."), ["One.", ""])
        XCTAssertNil(split("Why?"))
        XCTAssertNil(split(">no space"))
        XCTAssertNil(split("> One.\nno blank line"))
    }
}

final class ChatToolPresentationTests: XCTestCase {
    func testANamedToolSaysWhatItWasCalledWith() {
        XCTAssertEqual(summary("Bash", ["command": .string("bun test")]), "bun test")
        XCTAssertEqual(
            summary("Bash", ["command": .string("bun test"), "description": .string("Run the tests")]), "Run the tests")
        XCTAssertEqual(summary("Read", ["file_path": .string("/a/b.ts")]), "/a/b.ts")
        XCTAssertEqual(summary("Grep", ["pattern": .string("todo")]), "todo")
    }

    func testAToolNobodyNamedShowsWhateverStringItWasCalledWith() {
        XCTAssertEqual(summary("Unknown", ["target": .string("src/app.ts")]), "src/app.ts")
        XCTAssertEqual(summary("Unknown", ["depth": .number(3), "reason": .string("why")]), "why")
        XCTAssertEqual(summary("Unknown", ["depth": .number(3)]), "")
    }

    func testTheToolRowLeavesTheProgressDescriptionToTheSubagentPreview() {
        let item = ChatWire.item([
            "kind": .string("tool"), "name": .string("Unknown"), "input": .object([:]),
            "progress": .object([
                "startedAt": .null, "description": .string("Still going"), "output": .null,
            ]),
        ]).chatItem
        XCTAssertEqual(item.toolItem.map(ChatToolPresentation.summary), "")
        XCTAssertEqual(ChatSubagents.previewOfItem(item), .tool(name: "Unknown", detail: "Still going"))
    }

    func testALiveCallThatNamesNothingSaysWhatItsProgressReports() {
        let progress: JSONValue = .object(["startedAt": .null, "description": .string("Still going"), "output": .null])
        let call = { (state: String, input: [String: JSONValue]) in
            ChatWire.item([
                "kind": .string("tool"), "name": .string("Unknown"), "input": .object(input), "state": .string(state),
                "progress": progress,
            ]).chatTool
        }
        XCTAssertEqual(ChatToolPresentation.lineDetail(call("running", [:])), "Still going")
        XCTAssertEqual(ChatToolPresentation.lineDetail(call("running", ["target": .string("a.ts")])), "a.ts")
        XCTAssertEqual(ChatToolPresentation.lineDetail(call("done", [:])), "")
    }

    func testAnApprovalSaysWhatItsCallIsAbout() {
        XCTAssertEqual(
            ChatToolPresentation.summary(name: "Edit", input: .object(["file_path": .string("/a/b.ts")])), "/a/b.ts")
        XCTAssertTrue(ChatToolPresentation.summaryIsPath(name: "Edit", input: .object(["file_path": .string("/a")])))
        XCTAssertFalse(ChatToolPresentation.summaryIsPath(name: "Bash", input: .object(["command": .string("ls")])))
    }

    func testRuimteSaysANoteWithoutTheNameEachParagraphLedWith() {
        let note = ChatWire.item([
            "kind": .string("note"), "level": .string("info"), "said": .bool(true),
            "text": .string("Ruimte: First line\nstill first.\n\nRuimte: Second.\n\nThird, Ruimte: kept."),
        ]).chatItem
        guard case .note(let decoded) = note else {
            return XCTFail("Expected a note")
        }
        XCTAssertEqual(decoded.said, true)
        XCTAssertEqual(ChatRuimteSaid.words(decoded.text), "First line\nstill first.\n\nSecond.\n\nThird, Ruimte: kept.")
        XCTAssertEqual(ChatRuimteSaid.words("Ruimte:no space"), "Ruimte:no space")
    }

    private func summary(_ name: String, _ input: [String: JSONValue]) -> String {
        ChatToolPresentation.summary(
            ChatWire.item(["kind": .string("tool"), "name": .string(name), "input": .object(input)]).chatTool)
    }
}
