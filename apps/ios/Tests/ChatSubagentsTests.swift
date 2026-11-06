import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit
import XCTest

@testable import Ruimte

final class ChatSubagentsTests: XCTestCase {
    private func agent(
        _ id: String, status: String = "running", started: Double = 0, finished: Double? = nil,
        extra: [String: JSONValue] = [:]
    ) -> ChatSubagentItem {
        agentValue(id, status: status, started: started, finished: finished, extra: extra).chatItem.subagentItem!
    }

    private func agentValue(
        _ id: String, status: String = "running", started: Double = 0, finished: Double? = nil,
        extra: [String: JSONValue] = [:]
    ) -> JSONValue {
        var value: [String: JSONValue] = [
            "id": .string(id), "kind": .string("subagent"), "toolUseId": .string("use-\(id)"),
            "description": .string("Agent \(id)"), "status": .string(status), "startedAt": .number(started),
            "finishedAt": finished.map(JSONValue.number) ?? .null, "itemsTruncated": .bool(false),
        ]
        value.merge(extra) { $1 }
        return ChatWire.item(value)
    }

    private func tool(_ id: String, parent: String, name: String = "Read", created: Double, input: JSONValue = .null)
        -> ChatItem
    {
        toolValue(id, parent: parent, name: name, created: created, input: input).chatItem
    }

    private func toolValue(
        _ id: String, parent: String, name: String = "Read", created: Double, input: JSONValue = .null
    ) -> JSONValue {
        ChatWire.item([
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
        XCTAssertEqual(sections.active.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(sections.done.map(\.id), ["e", "d", "f"])
    }

    @MainActor func testThePageDerivesItsListsAgainOnlyWhenASubagentMoved() {
        let model = ChatModel(client: SubagentMachine(), chatID: "chat")
        let reply = ChatWire.item(["id": .string("reply"), "kind": .string("assistant"), "text": .string("Hi")])
        model.attached(
            .object(["info": ChatWire.info(), "items": .array([agentValue("a", started: 10), reply])]), since: nil)
        let derived = SubagentListDerivation()
        var reads = 0
        let lists = {
            derived.lists(revision: model.subagentRevision) {
                reads += 1
                return model.items
            }
        }
        XCTAssertEqual(lists().active.map(\.id), ["a"])
        model.receive(.object(["type": .string("delta"), "itemId": .string("reply"), "text": .string(" there")]))
        _ = lists()
        XCTAssertEqual(reads, 1)
        model.receive(.object(["type": .string("item"), "item": toolValue("t", parent: "use-a", created: 30)]))
        XCTAssertEqual(lists().work["use-a"]?.count, 1)
        XCTAssertEqual(reads, 2)
    }

    @MainActor func testTheBarNamesTheModelTheKindWhereItRunsAndWhatItSpent() {
        let item = agent(
            "a",
            extra: [
                "model": .string("claude-haiku-4-5"), "subagentType": .string("Explore"), "background": .bool(true),
                "usage": .object(["totalTokens": .number(12_300), "toolUses": .number(8), "durationMs": .number(5_000)]
                ),
            ])
        let locale = FormatLocale(region: Locale(identifier: "en_US"), language: Locale(identifier: "en"))
        XCTAssertEqual(
            ChatSubagents.facts(item, locale: locale),
            ["Claude Haiku 4.5", "Explore", "background", "12K tokens", "8 tool calls"])
        XCTAssertEqual(ChatSubagents.facts(agent("b", extra: ["usage": .null]), locale: locale), [])
        let one = agent(
            "c",
            extra: [
                "usage": .object(["totalTokens": .number(0), "toolUses": .number(1), "durationMs": .number(0)])
            ])
        XCTAssertEqual(ChatSubagents.facts(one, locale: locale), ["1 tool call"])
    }

    @MainActor func testOnlyARowWithAToolUseIDOpens() {
        XCTAssertTrue(ChatSubagents.canOpen(agent("a")))
        XCTAssertFalse(ChatSubagents.canOpen(agent("a", extra: ["toolUseId": .string("")])))
    }

    @MainActor func testACancelledTaskReadsAsCancelledRatherThanFailed() {
        let row = agent("task-7", status: "failed", extra: ["origin": .string("ruimte")])
        XCTAssertEqual(ChatSubagents.taskID(row), "7")
        XCTAssertEqual(ChatSubagents.statusWord(row, task: nil), .failed)
        XCTAssertEqual(ChatSubagents.statusWord(row, task: TaskWire.task(status: "cancelled")), .cancelled)
        XCTAssertNil(ChatSubagents.taskID(agent("task-7")))
    }

    @MainActor func testAHandedBackReportReplacesTheNoticeInThePreview() {
        let notice = "This agent's report was delivered to you as a message from \"agent-1\". Read it there."
        let row = agent("a", status: "done", finished: 5, extra: ["result": .string(notice)])
        let handback = tool(
            "h", parent: "use-a", name: "SubagentHandback", created: 4,
            input: .object(["message": .string("## Done\n**All** tests [pass](https://x)")]))
        XCTAssertEqual(ChatSubagents.preview(row, work: [handback], tail: nil), .text("Done All tests pass"))
        XCTAssertTrue(ChatSubagents.needsTail(row, work: []))
        XCTAssertFalse(ChatSubagents.needsTail(row, work: [handback]))
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
        let locale = FormatLocale(
            region: Locale(identifier: "en_US"), language: Locale(identifier: "en"),
            timeZone: TimeZone(identifier: "UTC")!)
        let now = Date(timeIntervalSince1970: 2 * 86_400 + 12 * 3600)
        let nowMs = now.timeIntervalSince1970 * 1000
        XCTAssertEqual(
            ChatSubagents.entryTime(agent("a", started: nowMs - 65_000), task: nil, now: now, locale: locale), "1m 5s")
        XCTAssertEqual(
            ChatSubagents.entryTime(agent("a", started: nowMs - 7_500_000), task: nil, now: now, locale: locale),
            "2h 5m")
        let today = ChatSubagents.entryTime(
            agent("d", status: "done", finished: nowMs - 3_600_000), task: nil, now: now, locale: locale)
        XCTAssertEqual(today, "11:00 AM")
        let earlier = ChatSubagents.entryTime(
            agent("d", status: "done", finished: nowMs - 86_400_000), task: nil, now: now, locale: locale)
        XCTAssertEqual(earlier, "Jan 2 at 12:00 PM")
        XCTAssertNil(ChatSubagents.entryTime(agent("d", status: "done"), task: nil, now: now, locale: locale))
    }

    @MainActor func testANewestPageWithoutOverlapReplacesWhatIsHeld() {
        let reply: (String, String) -> ChatItem = { id, text in
            ChatWire.item(["id": .string(id), "kind": .string("assistant"), "text": .string(text)]).chatItem
        }
        let held = [reply("1", ""), reply("2", "")]
        let grown = ChatSubagents.mergeNewest(
            current: held, cursor: "c1", page: [reply("2", "x"), reply("3", "")], pageCursor: "c2")
        XCTAssertEqual(grown.items.map(\.id), ["1", "2", "3"])
        XCTAssertEqual(grown.items[1].assistantItem?.text, "x")
        XCTAssertEqual(grown.cursor, "c1")
        XCTAssertFalse(grown.replaced)
        let jumped = ChatSubagents.mergeNewest(
            current: held, cursor: "c1", page: [reply("9", "")], pageCursor: "c9")
        XCTAssertEqual(jumped.items.map(\.id), ["9"])
        XCTAssertEqual(jumped.cursor, "c9")
        XCTAssertTrue(jumped.replaced)
    }

    @MainActor func testAHandbackCallIsAMessageRowInTheTimeline() {
        let presentation = ChatPresentation()
        presentation.replace(
            [
                ChatWire.item([
                    "id": .string("r"), "kind": .string("tool"), "name": .string("Read"), "state": .string("done"),
                ]),
                ChatWire.item([
                    "id": .string("h"), "kind": .string("tool"), "name": .string("SubagentHandback"),
                    "state": .string("done"), "input": .object(["message": .string("Report")]),
                ]),
            ].map(\.chatItem), info: nil)
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
        XCTAssertEqual(first.items.map(\.id), ["1"])
        for handler in machine.handlers { handler(.object(["chatId": .string("chat"), "toolUseId": .string("use")])) }
        await machine.wait(for: 4)
        XCTAssertNil(machine.payloads[2]["watch"])
        first.stop()
        second.stop()
        await machine.wait(for: 5)
        XCTAssertEqual(machine.payloads.last?["watch"], .bool(false))
        XCTAssertEqual(machine.payloads.filter { $0["watch"] == .bool(false) }.count, 1)
    }

    @MainActor func testTheChipCountsWhatRunsAndWhatSettledSinceThePersonLastWrote() {
        let user: (String, Double) -> ChatItem = { id, created in
            ChatWire.item(["id": .string(id), "kind": .string("user"), "createdAt": .number(created)]).chatItem
        }
        let items: [ChatItem] = [
            .subagent(agent("old", status: "done", finished: 5, extra: ["turnId": .string("t1")])),
            .subagent(agent("running-turn", status: "done", finished: 6, extra: ["turnId": .string("t2")])),
            .subagent(agent("still", extra: ["turnId": .string("t2")])),
            user("u", 10),
            .subagent(agent("late", status: "failed", finished: 12)),
            .subagent(agent("new", status: "done", finished: 20)),
        ]
        XCTAssertEqual(ChatSubagents.activity(items).map(\.id), ["running-turn", "still", "late", "new"])
    }

    func testTheChipShowsWorkFirstAndCountsWhatStillRuns() {
        XCTAssertEqual(ChatSubagents.summaryWord([.done, .failed, .running]), .running)
        XCTAssertEqual(ChatSubagents.summaryWord([.done, .cancelled, .failed]), .failed)
        XCTAssertEqual(ChatSubagents.summaryWord([.done, .done]), .done)
        XCTAssertEqual(ChatSubagents.badgeCount([.running, .done, .running]), 2)
        XCTAssertEqual(ChatSubagents.badgeCount([.done, .failed, .done]), 3)
    }

    func testTheChipCountsProgressWhileMoreThanOneWorks() {
        XCTAssertEqual(
            ChatSubagents.chipLabel(
                [.done, .running, .waiting, .paused], words: [.done, .running, .running, .running]),
            "1 of 4 sub-agents done, 1 needs you")
        XCTAssertEqual(
            ChatSubagents.chipLabel([.done, .done, .running], words: [.done, .done, .running]),
            "2 of 3 sub-agents done")
        XCTAssertEqual(ChatSubagents.chipLabel([.running], words: [.running]), "1 sub-agent")
        XCTAssertEqual(ChatSubagents.chipLabel([.done, .failed], words: [.done, .failed]), "2 sub-agents")
    }

    func testTheBackgroundChipNamesOnlyTheKindsThatRun() {
        let task: (ChatInfoBackgroundItemKind) -> ChatInfoBackgroundItem = {
            ChatInfoBackgroundItem(id: UUID().uuidString, kind: $0, description: "", command: nil, startedAt: 0)
        }
        XCTAssertEqual(ChatBackground.label([task(.shell), task(.monitor)]), "1 shell · 1 monitor")
        XCTAssertEqual(ChatBackground.label([task(.monitor), task(.monitor)]), "2 monitors")
        XCTAssertEqual(ChatBackground.label([task(.shell)]), "1 shell")
    }

    /// A pushed page makes its chat screen disappear, and a chat nobody holds stops: without the page holding it, the
    /// questions and approvals of the parent chat never reached the composer under a sub-agent.
    @MainActor func testASubagentPageHoldsItsChatOnceItsScreenLetsGo() async throws {
        let runtime = AppRuntime(connections: MachineConnections(monitorPaths: false))
        defer { runtime.connections.shutdown() }
        let session = SharedMachineSession(
            machine: Machine(
                id: "machine", name: "Machine", icon: nil, publicKey: String(repeating: "A", count: 43),
                brokerUrl: "wss://broker.test", lastSeenAt: nil),
            runtime: runtime)
        let machine = HeldChatMachine()
        let model = session.retainChat(ChatModel(client: machine, chatID: "chat", machineID: "machine"))
        let crumb = SubagentCrumb(agent("one"))
        let host = UIHostingController(
            rootView: NavigationStack { SubagentConversationPage(model: model, crumb: crumb, session: session) })
        let window = UIWindow.showing(host)
        await displayFrames(10)

        session.releaseChat(model)
        await displayFrames(10)
        XCTAssertFalse(machine.requests.contains(.chatDetach))

        window.close()
        await displayFrames(10)
        XCTAssertTrue(machine.requests.contains(.chatDetach))
    }
}

@MainActor private final class HeldChatMachine: MachineRequesting {
    var requests: [WireRequest] = []

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        requests.append(type)
        throw MachineClientError.disconnected
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}

@MainActor private final class SubagentMachine: MachineRequesting {
    var payloads: [JSONValue] = []
    var handlers: [@MainActor @Sendable (JSONValue) -> Void] = []
    private var waiters: [(Int, CheckedContinuation<Void, Never>)] = []

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        XCTAssertEqual(type, .chatSubagent)
        payloads.append(payload)
        let reached = waiters.filter { payloads.count >= $0.0 }
        waiters.removeAll { payloads.count >= $0.0 }
        reached.forEach { $0.1.resume() }
        return .object([
            "items": .array([ChatWire.item(["id": .string("1"), "kind": .string("assistant"), "text": .string("Hi")])]),
            "history": .object(["cursor": .null]), "source": .string("claude-transcript"), "live": .bool(true),
        ])
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        if event == .chatSubagentChanged { handlers.append(handler) }
        return {}
    }

    func wait(for count: Int) async {
        if payloads.count < count { await withCheckedContinuation { waiters.append((count, $0)) } }
        for _ in 0..<10 { await Task.yield() }
    }
}
