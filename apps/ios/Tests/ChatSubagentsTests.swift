import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class ChatSubagentsTests: XCTestCase {
    private func agent(
        _ id: String, status: String = "running", started: Double = 0, finished: Double? = nil,
        extra: [String: JSONValue] = [:]
    ) -> JSONValue {
        var value: [String: JSONValue] = [
            "id": .string(id), "kind": .string("subagent"), "toolUseId": .string("use-\(id)"),
            "description": .string("Agent \(id)"), "status": .string(status), "startedAt": .number(started),
            "finishedAt": finished.map(JSONValue.number) ?? .null, "itemsTruncated": .bool(false),
        ]
        value.merge(extra) { $1 }
        return .object(value)
    }

    private func tool(_ id: String, parent: String, name: String = "Read", created: Double, input: JSONValue = .null)
        -> JSONValue
    {
        .object([
            "id": .string(id), "kind": .string("tool"), "name": .string(name), "parentToolUseId": .string(parent),
            "createdAt": .number(created), "state": .string("done"), "input": input,
        ])
    }

    @MainActor func testSectionsPutWhatMovedLastFirstAndUntimedEntriesLast() {
        let items = [
            agent("a", started: 10), agent("b", started: 20), agent("c", started: 0),
            agent("d", status: "done", finished: 5), agent("e", status: "failed", finished: 9),
            agent("f", status: "done"),
        ]
        let work = ChatSubagents.threadWork([tool("t", parent: "use-a", created: 30)])
        let sections = ChatSubagents.sections(items, work: work)
        XCTAssertEqual(sections.active.map { $0.text("id") }, ["a", "b", "c"])
        XCTAssertEqual(sections.done.map { $0.text("id") }, ["e", "d", "f"])
    }

    @MainActor func testOnlyARowWithAPointerOpensOnAMachineThatRefused() {
        let native = agent("n", extra: ["native": .object(["agentId": .string("x")])])
        XCTAssertTrue(ChatSubagents.canOpen(agent("a"), machineRefused: false))
        XCTAssertFalse(ChatSubagents.canOpen(agent("a"), machineRefused: true))
        XCTAssertTrue(ChatSubagents.canOpen(native, machineRefused: true))
    }

    @MainActor func testACancelledTaskReadsAsCancelledRatherThanFailed() {
        let row = agent("task-7", status: "failed", extra: ["origin": .string("ruimte")])
        XCTAssertEqual(ChatSubagents.taskID(row), "7")
        XCTAssertEqual(ChatSubagents.statusWord(row, task: nil), .failed)
        XCTAssertEqual(ChatSubagents.statusWord(row, task: .object(["status": .string("cancelled")])), .cancelled)
        XCTAssertNil(ChatSubagents.taskID(agent("task-7")))
    }

    @MainActor func testAHandedBackReportReplacesTheNoticeInThePreview() {
        let notice = "This agent's report was delivered to you as a message from \"agent-1\". Read it there."
        let row = agent("a", status: "done", finished: 5, extra: ["result": .string(notice)])
        let handback = tool(
            "h", parent: "use-a", name: "SubagentHandback", created: 4,
            input: .object(["message": .string("## Done\n**All** tests [pass](https://x)")]))
        XCTAssertEqual(ChatSubagents.preview(row, work: [handback], tail: nil), .text("Done All tests pass"))
        XCTAssertTrue(ChatSubagents.needsTail(row, work: [], machineRefused: false))
        XCTAssertFalse(ChatSubagents.needsTail(row, work: [handback], machineRefused: false))
        XCTAssertEqual(
            ChatSubagents.preview(
                agent("b", status: "done", extra: ["result": .string("Fixed it")]), work: [], tail: nil),
            .text("Fixed it"))
    }

    @MainActor func testARunningEntryShowsItsLatestToolCall() {
        let work = [
            tool("1", parent: "use-a", created: 1, input: .object(["file_path": .string("a.swift")])),
            tool("2", parent: "use-a", name: "Bash", created: 2, input: .object(["command": .string("swift test")])),
        ]
        XCTAssertEqual(
            ChatSubagents.preview(agent("a"), work: work, tail: nil), .tool(name: "Bash", detail: "swift test"))
        XCTAssertEqual(
            ChatSubagents.preview(agent("b", extra: ["lastTool": .string("Grep")]), work: [], tail: nil),
            .tool(name: "Grep", detail: ""))
    }

    @MainActor func testStopIsOfferedByTheSameRulesAsTheDesktop() {
        let task = agent("task-1", extra: ["origin": .string("ruimte"), "childId": .string("node")])
        XCTAssertEqual(ChatSubagents.stop(task, turnRunning: true), .task)
        XCTAssertNil(ChatSubagents.stop(agent("t", extra: ["origin": .string("ruimte")]), turnRunning: false))
        XCTAssertEqual(ChatSubagents.stop(agent("n"), turnRunning: false), .mark)
        XCTAssertNil(ChatSubagents.stop(agent("n"), turnRunning: true))
        XCTAssertNil(ChatSubagents.stop(agent("d", status: "done"), turnRunning: false))
    }

    @MainActor func testTheTimeIsHowLongItRunsOrWhenItEnded() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let locale = Locale(identifier: "en_US_POSIX")
        let now = Date(timeIntervalSince1970: 2 * 86_400 + 12 * 3600)
        let nowMs = now.timeIntervalSince1970 * 1000
        XCTAssertEqual(
            ChatSubagents.entryTime(agent("a", started: nowMs - 65_000), task: nil, now: now, calendar: calendar),
            "1m 5s")
        XCTAssertEqual(
            ChatSubagents.entryTime(agent("a", started: nowMs - 7_500_000), task: nil, now: now, calendar: calendar),
            "2h 5m")
        let today = ChatSubagents.entryTime(
            agent("d", status: "done", finished: nowMs - 3_600_000), task: nil, now: now, calendar: calendar,
            locale: locale)
        XCTAssertEqual(today?.replacingOccurrences(of: "\u{202F}", with: " "), "11:00 AM")
        let earlier = ChatSubagents.entryTime(
            agent("d", status: "done", finished: nowMs - 86_400_000), task: nil, now: now, calendar: calendar,
            locale: locale)
        XCTAssertEqual(earlier?.replacingOccurrences(of: "\u{202F}", with: " "), "Jan 2, 1970 12:00 PM")
        XCTAssertNil(ChatSubagents.entryTime(agent("d", status: "done"), task: nil, now: now, calendar: calendar))
    }

    @MainActor func testANewestPageWithoutOverlapReplacesWhatIsHeld() {
        let held: [JSONValue] = [.object(["id": .string("1")]), .object(["id": .string("2")])]
        let grown = ChatSubagents.mergeNewest(
            current: held, cursor: "c1",
            page: [.object(["id": .string("2"), "text": .string("x")]), .object(["id": .string("3")])],
            pageCursor: "c2")
        XCTAssertEqual(grown.items.map { $0.text("id") }, ["1", "2", "3"])
        XCTAssertEqual(grown.cursor, "c1")
        XCTAssertFalse(grown.replaced)
        let jumped = ChatSubagents.mergeNewest(
            current: held, cursor: "c1", page: [.object(["id": .string("9")])], pageCursor: "c9")
        XCTAssertEqual(jumped.items.map { $0.text("id") }, ["9"])
        XCTAssertTrue(jumped.replaced)
    }

    @MainActor func testAHandbackCallIsAMessageRowInTheTimeline() {
        let presentation = ChatPresentation()
        presentation.replace(
            [
                .object([
                    "id": .string("r"), "kind": .string("tool"), "name": .string("Read"), "state": .string("done"),
                ]),
                .object([
                    "id": .string("h"), "kind": .string("tool"), "name": .string("SubagentHandback"),
                    "state": .string("done"), "input": .object(["message": .string("Report")]),
                ]),
            ], info: .null)
        XCTAssertEqual(presentation.entries.map(\.kind), [.tools, .message])
    }

    @MainActor func testOnlyTheLastPageOnAConversationLetsTheMachineGo() async {
        let machine = SubagentMachine()
        let first = SubagentConversation(client: machine, chatID: "chat", toolUseID: "use")
        let second = SubagentConversation(client: machine, chatID: "chat", toolUseID: "use", limit: 10)
        first.start()
        second.start()
        await machine.wait(for: 2)
        XCTAssertEqual(machine.payloads.map { $0["watch"] }, [.bool(true), .bool(true)])
        XCTAssertEqual(first.items.map { $0.text("id") }, ["1"])
        for handler in machine.handlers { handler(.object(["chatId": .string("chat"), "toolUseId": .string("use")])) }
        await machine.wait(for: 4)
        XCTAssertNil(machine.payloads[2]["watch"])
        first.stop()
        second.stop()
        await machine.wait(for: 5)
        XCTAssertEqual(machine.payloads.last?["watch"], .bool(false))
        XCTAssertEqual(machine.payloads.filter { $0["watch"] == .bool(false) }.count, 1)
    }
}

@MainActor private final class SubagentMachine: MachineRequesting {
    var payloads: [JSONValue] = []
    var handlers: [@MainActor @Sendable (JSONValue) -> Void] = []
    private var waiters: [(Int, CheckedContinuation<Void, Never>)] = []

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        XCTAssertEqual(type, "chat.subagent")
        payloads.append(payload)
        let reached = waiters.filter { payloads.count >= $0.0 }
        waiters.removeAll { payloads.count >= $0.0 }
        reached.forEach { $0.1.resume() }
        return .object([
            "items": .array([.object(["id": .string("1"), "kind": .string("assistant"), "text": .string("Hi")])]),
            "history": .object(["cursor": .null]), "source": .string("claude-transcript"), "live": .bool(true),
        ])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        if event == "chat.subagentChanged" { handlers.append(handler) }
        return {}
    }

    func wait(for count: Int) async {
        if payloads.count < count { await withCheckedContinuation { waiters.append((count, $0)) } }
        for _ in 0..<10 { await Task.yield() }
    }
}
