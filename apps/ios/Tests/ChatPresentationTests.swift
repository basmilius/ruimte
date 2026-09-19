import RuimtePulsar
import XCTest

@testable import Ruimte

final class ChatPresentationTests: XCTestCase {
    @MainActor func testInfoAloneStartsAndEndsWorking() {
        let presentation = ChatPresentation()
        presentation.setConnected(true)
        presentation.setInfo(.object(["activeTurnId": .string("turn")]))
        XCTAssertEqual(presentation.entries.map(\.kind), [.activity])
        XCTAssertTrue(presentation.isAnimating)
        presentation.setInfo(.object(["activeTurnId": .null, "running": .bool(true)]))
        XCTAssertTrue(presentation.entries.isEmpty)
        XCTAssertFalse(presentation.isAnimating)
    }

    @MainActor func testTextDeltaKeepsRowIdentityAndStructureRevision() {
        let presentation = ChatPresentation()
        presentation.replace([item("reply", "assistant")], info: .null)
        let record = presentation.entries[0].items[0]
        let revision = presentation.revision
        presentation.upsert(item("reply", "assistant").setting("text", .string("Hello 🌍")), textOnly: true)
        XCTAssertEqual(presentation.revision, revision)
        XCTAssertTrue(presentation.entries[0].items[0] === record)
        XCTAssertEqual(record.value.text("text"), "Hello 🌍")
    }

    @MainActor func testActiveWorkDoesNotDisappearIntoSettledTools() {
        let presentation = ChatPresentation()
        presentation.replace(
            [
                item("done", "tool").setting("state", .string("done")),
                item("live", "tool").setting("state", .string("running")),
                item("thought", "thinking").setting("streaming", .bool(true)),
            ], info: .null)
        XCTAssertEqual(presentation.entries.map(\.kind), [.tools, .message, .message])
    }

    @MainActor func testBlockingRequestAndDisconnectStopActiveAnimation() {
        let presentation = ChatPresentation()
        presentation.setConnected(true)
        presentation.replace(
            [
                item("question", "question").setting("state", .string("pending")).setting("async", .bool(true))
            ], info: .object(["activeTurnId": .string("turn")]))
        XCTAssertTrue(presentation.isAnimating)
        presentation.upsert(item("permission", "approval").setting("decision", .string("pending")))
        XCTAssertEqual(presentation.activityLabel, "Waiting for you")
        XCTAssertFalse(presentation.isAnimating)
        XCTAssertEqual(presentation.entries.count, 1)
        presentation.setConnected(false)
        XCTAssertEqual(presentation.activityLabel, "Connection lost")
    }

    @MainActor func testSnapshotReplacesOldRecordsAndUsesTurnStart() {
        let presentation = ChatPresentation()
        presentation.replace([item("old", "assistant")], info: .null)
        presentation.replace(
            [
                item("turn", "turn").setting("createdAt", .number(42)).setting("state", .string("running"))
            ], info: .object(["activeTurnId": .string("turn")]))
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
        presentation.replace([turn, tool, reply, note], info: .null)
        XCTAssertEqual(presentation.entries.map(\.id), ["fold-turn", "reply", "warning"])
        presentation.toggleTurn("turn")
        XCTAssertEqual(presentation.entries.map(\.id), ["fold-turn", "tools-tool", "reply", "warning"])
    }

    @MainActor func testSubagentTextBelongsToItsAgentAndDeltaRetainsStructure() {
        let presentation = ChatPresentation()
        let agent = item("agent", "subagent").setting("toolUseId", .string("spawn"))
        let child = item("child", "assistant").setting("parentToolUseId", .string("spawn"))
        presentation.replace([agent, child, item("main", "assistant")], info: .null)
        XCTAssertEqual(presentation.entries.map(\.id), ["agent", "main"])
        XCTAssertEqual(presentation.entries[0].items.map(\.id), ["agent", "child"])
        let revision = presentation.revision
        presentation.upsert(child.setting("text", .string("Only the child changes")), textOnly: true)
        XCTAssertEqual(presentation.revision, revision)
        XCTAssertEqual(presentation.entries[0].items[1].value.text("text"), "Only the child changes")
    }

    @MainActor func testAgentTurnCanOpenTheSourceAgentInAnEarlierFold() {
        let presentation = ChatPresentation()
        let first = item("first", "turn").setting("turnId", .string("first")).setting("state", .string("done"))
        let agent = item("agent", "subagent").setting("turnId", .string("first")).setting("toolUseId", .string("spawn"))
        let second = item("second", "turn").setting("turnId", .string("second")).setting("state", .string("running"))
            .setting("origin", .string("agent"))
        presentation.replace([first, agent, second], info: .null)
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
        let files = ChatFileChanges.grouped(ChatFileChanges.fromTool(tool))
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
        .object(["id": .string(id), "kind": .string(kind), "text": .string("")])
    }
}

final class ChatToolPresentationTests: XCTestCase {
    func testElapsedTimeReadsAsSecondsThenMinutes() {
        XCTAssertEqual(ChatToolPresentation.elapsed(-5), "0s")
        XCTAssertEqual(ChatToolPresentation.elapsed(12_400), "12s")
        XCTAssertEqual(ChatToolPresentation.elapsed(120_000), "2m")
        XCTAssertEqual(ChatToolPresentation.elapsed(125_000), "2m 5s")
    }

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
        let item = JSONValue.object([
            "kind": .string("tool"), "name": .string("Unknown"), "input": .object([:]),
            "progress": .object(["description": .string("Still going")]),
        ])
        XCTAssertEqual(ChatToolPresentation.summary(item), "")
        XCTAssertEqual(ChatSubagents.previewOfItem(item), .tool(name: "Unknown", detail: "Still going"))
    }

    private func summary(_ name: String, _ input: [String: JSONValue]) -> String {
        ChatToolPresentation.summary(.object(["name": .string(name), "input": .object(input)]))
    }
}
