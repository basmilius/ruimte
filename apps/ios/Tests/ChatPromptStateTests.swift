import RuimtePulsar
import RuimteTransport
import SwiftUI
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

    /// The answer's reply can come after the machine already settled the request; when the same item waits again (a
    /// reattach that replays it, a CLI that asks again), its card has to come back.
    @MainActor func testAnAnswerSettledBeforeItsReplyLeavesTheRequestToComeBack() async {
        let state = ChatPromptState()
        let item = request("r1", question: true)
        state.update([item])
        await state.submit(item, connected: true) { state.update([]) }
        XCTAssertNil(state.active)
        state.update([item])
        XCTAssertEqual(state.active, item)
    }

    @MainActor func testAnAnswerHidesOnlyTheItemItWentTo() async {
        let state = ChatPromptState()
        let first = request("r1")
        state.update([first])
        await state.submit(first, connected: true) {}
        XCTAssertNil(state.active)
        let again = ChatWire.item([
            "id": .string("other-item"), "kind": .string("approval"), "requestId": .string("r1"),
        ]).chatItem
        state.update([first, again])
        XCTAssertEqual(state.active, again)
    }

    /// Whatever shows the thread as waiting on a person reaches the composer as a request it can answer, through
    /// every way the thread changes.
    @MainActor func testEveryItemThatHoldsTheTurnBecomesARequestOfTheComposer() async {
        let machine = HistoryMachine()
        let model = ChatModel(client: machine, chatID: "chat")
        model.connected = true
        let state = ChatPromptState()
        func assertCovered(_ step: String, line: UInt = #line) {
            state.update(model.pending)
            let answerable = Set(state.subjects.map(\.item.id))
            XCTAssertTrue(
                model.presentation.holdingTurn.isSubset(of: answerable),
                "\(step): \(model.presentation.holdingTurn) waits without a card", line: line)
        }
        func question(_ id: String, index: Int, state: String = "pending", async: Bool = false) -> JSONValue {
            ChatWire.item([
                "id": .string(id), "kind": .string("question"), "requestId": .string("request-\(id)"),
                "state": .string(state), "async": .bool(async), "createdAt": .number(Double(index)),
            ])
        }
        func approval(_ id: String, decision: String = "pending") -> JSONValue {
            ChatWire.item([
                "id": .string(id), "kind": .string("approval"), "requestId": .string("request-\(id)"),
                "decision": .string(decision),
            ])
        }
        func item(_ value: JSONValue, index: Int) -> JSONValue {
            .object(["type": .string("item"), "item": value, "historyIndex": .number(Double(index))])
        }

        model.attached(
            .object([
                "info": ChatWire.info(["status": .string("needs-you")]),
                "items": .array([approval("a"), question("optional", index: 11, async: true)]),
                "history": .object(["start": .number(10), "cursor": .string("older")]),
                "pending": .array([question("old", index: 3)]),
            ]), since: nil)
        XCTAssertFalse(model.presentation.holdingTurn.isEmpty)
        assertCovered("snapshot")
        model.receive(item(question("q", index: 12), index: 12))
        assertCovered("a question arrives")
        model.receive(item(approval("a", decision: "allow"), index: 10))
        assertCovered("an approval settles")
        model.receive(item(question("old", index: 3), index: 3))
        assertCovered("a request before the page changes")
        machine.page = .object([
            "items": .array([question("old", index: 3)]), "history": .object(["start": .number(0), "cursor": .null]),
        ])
        _ = await model.loadOlderNow()
        assertCovered("the earlier page")
        model.receive(
            .object([
                "type": .string("reset"), "info": ChatWire.info(["status": .string("needs-you")]),
                "items": .array([approval("b")]),
            ]))
        XCTAssertEqual(model.presentation.holdingTurn, ["b"])
        assertCovered("a reset")
    }

    @MainActor func testAWaitingRequestWithoutItsCardIsReportedOncePerChatAfterTheDelay() {
        var sent: [ChatPromptGap] = []
        let reporter = ChatPromptGapReporter { sent.append($0) }
        let gap = ChatPromptGap(
            pending: 1, subjects: 0, answered: 0, activeSet: false, approval: false, sharedModel: true,
            rejectedEvent: false)
        let start = Date(timeIntervalSince1970: 1_000)
        reporter.observe(chatID: "a", gap: gap, now: start)
        reporter.observe(chatID: "a", gap: gap, now: start + 4)
        reporter.observe(chatID: "a", gap: nil, now: start + 4.5)
        reporter.observe(chatID: "a", gap: gap, now: start + 6)
        reporter.observe(chatID: "a", gap: gap, now: start + 10)
        XCTAssertTrue(sent.isEmpty, "a card that came in time starts the wait over")
        reporter.observe(chatID: "a", gap: gap, now: start + 11)
        XCTAssertEqual(sent, [gap])
        reporter.observe(chatID: "a", gap: nil, now: start + 12)
        reporter.observe(chatID: "a", gap: gap, now: start + 13)
        reporter.observe(chatID: "a", gap: gap, now: start + 30)
        XCTAssertEqual(sent.count, 1)
        reporter.observe(chatID: "b", gap: gap, now: start + 30)
        reporter.observe(chatID: "b", gap: gap, now: start + 35)
        XCTAssertEqual(sent.count, 2)
    }

    /// A chat a task opened asks a person; its parent's composer answers it, as the desktop's does.
    @MainActor func testAQuestionOfAChatATaskOpenedReachesItsParentsComposer() async {
        let machine = ChatsMachine()
        let question = ChatWire.item([
            "id": .string("question-r1"), "kind": .string("question"), "requestId": .string("r1"),
            "createdAt": .number(20), "turnId": .string("turn-child"),
            "questions": .array(
                (0..<3).map { index in
                    .object([
                        "id": .string("\(index)"), "header": .string("H\(index)"), "question": .string("Q\(index)?"),
                        "choices": .array([.object(["label": .string("A"), "description": .string("a")])]),
                        "multiSelect": .bool(false),
                    ])
                }),
        ])
        machine.snapshots["child"] = .object([
            "info": ChatWire.info([
                "chatId": .string("child"), "status": .string("needs-you"), "activeTurnId": .string("turn-child"),
                "requests": .array([
                    .object([
                        "requestId": .string("r1"), "itemId": .string("question-r1"), "kind": .string("question"),
                        "createdAt": .number(20),
                    ])
                ]),
            ]),
            "items": .array([question]),
        ])
        machine.snapshots["parent"] = .object([
            "info": ChatWire.info([
                "chatId": .string("parent"), "status": .string("idle"), "activeTurnId": .null,
            ]),
            "items": .array([
                ChatWire.item([
                    "id": .string("task-task-1"), "kind": .string("subagent"), "toolUseId": .string("task-task-1"),
                    "description": .string("Ask the person"), "background": .bool(true), "status": .string("running"),
                    "startedAt": .number(10), "createdAt": .number(10), "origin": .string("ruimte"),
                    "childId": .string("child"),
                ])
            ]),
        ])
        let model = ChatModel(client: machine, chatID: "parent")
        let prompts = ChatPromptState()
        let feed = ChatPromptFeed(session: nil)
        // Run first in a fresh host, this test can come before the host app's scene connects.
        for _ in 0..<60 where UIApplication.shared.connectedScenes.isEmpty { await displayFrames() }
        let host = UIHostingController(
            rootView: Color.clear.modifier(
                ChatPromptFeedTracking(feed: feed, prompts: prompts, model: model, attention: nil, visible: true)))
        let window = UIWindow.showing(host, size: CGSize(width: 390, height: 400))
        defer { window.close() }
        model.start()
        await displayFrames(20)
        XCTAssertEqual(prompts.activeSubject?.chatID, "child")
        XCTAssertEqual(prompts.activeSubject?.item.requestId, "r1")
        XCTAssertEqual(prompts.activeSubject?.source?.label, "Ask the person")
    }

    private func childQuestion(_ requestID: String, at time: Double) -> JSONValue {
        ChatWire.item([
            "id": .string("question-\(requestID)"), "kind": .string("question"), "requestId": .string(requestID),
            "createdAt": .number(time), "turnId": .string("turn-child"),
        ])
    }

    private func childInfo(_ status: String, requests: [String] = []) -> JSONValue {
        ChatWire.info([
            "chatId": .string("child"), "status": .string(status),
            "activeTurnId": status == "idle" ? .null : .string("turn-child"),
            "requests": .array(
                requests.map {
                    .object([
                        "requestId": .string($0), "itemId": .string("question-\($0)"), "kind": .string("question"),
                        "createdAt": .number(20),
                    ])
                }),
        ])
    }

    private func taskRow(status: String = "running", child: String? = "child") -> JSONValue {
        var fields: [String: JSONValue] = [
            "id": .string("task-task-1"), "kind": .string("subagent"), "toolUseId": .string("task-task-1"),
            "description": .string("Ask the person"), "background": .bool(true), "status": .string(status),
            "startedAt": .number(10), "createdAt": .number(10), "origin": .string("ruimte"),
        ]
        if let child { fields["childId"] = .string(child) }
        return ChatWire.item(fields)
    }

    private func itemEvent(_ item: JSONValue) -> JSONValue { .object(["type": .string("item"), "item": item]) }
    private func infoEvent(_ info: JSONValue) -> JSONValue { .object(["type": .string("info"), "info": info]) }

    @MainActor private func liveParent(
        _ machine: ChatsMachine, parentItems: [JSONValue], child: JSONValue
    ) async -> (ChatPromptState, ChatModel, UIWindow) {
        machine.snapshots["parent"] = .object([
            "info": ChatWire.info([
                "chatId": .string("parent"), "status": .string("running"), "activeTurnId": .string("t"),
            ]),
            "items": .array(parentItems), "seq": .number(10),
        ])
        machine.snapshots["child"] = child
        let model = ChatModel(client: machine, chatID: "parent")
        let prompts = ChatPromptState()
        for _ in 0..<60 where UIApplication.shared.connectedScenes.isEmpty { await displayFrames() }
        let host = UIHostingController(
            rootView: Color.clear.modifier(
                ChatPromptFeedTracking(
                    feed: ChatPromptFeed(session: nil), prompts: prompts, model: model, attention: nil, visible: true)))
        let window = UIWindow.showing(host, size: CGSize(width: 390, height: 400))
        model.start()
        await displayFrames(10)
        return (prompts, model, window)
    }

    /// The events of a child reach the phone on their own channels in no fixed order: its row in the parent, its
    /// status and its own thread. In every order the parent's composer ends up with the child's question, as the
    /// desktop's feed does.
    @MainActor func testAChildsQuestionReachesTheParentInEveryOrderItsEventsCome() async {
        func note(_ name: String, _ prompts: ChatPromptState, _ expected: [String], line: UInt = #line) {
            XCTAssertEqual(prompts.subjects.map(\.key), expected, name, line: line)
        }
        let quiet = { [self] in childInfo("running") }
        let empty: (JSONValue) -> JSONValue = { info in
            .object(["info": info, "items": .array([]), "seq": .number(10)])
        }

        do {  // 1: item, then needs-you
            let machine = ChatsMachine()
            let (prompts, _, window) = await liveParent(machine, parentItems: [taskRow()], child: empty(quiet()))
            machine.send("child", itemEvent(childQuestion("r1", at: 20)))
            await displayFrames(5)
            machine.send("child", infoEvent(childInfo("needs-you", requests: ["r1"])))
            await displayFrames(10)
            note("item, then status", prompts, ["child/r1"])
            window.close()
        }
        do {  // 2: needs-you, then item
            let machine = ChatsMachine()
            let (prompts, _, window) = await liveParent(machine, parentItems: [taskRow()], child: empty(quiet()))
            machine.send("child", infoEvent(childInfo("needs-you", requests: ["r1"])))
            await displayFrames(5)
            machine.send("child", itemEvent(childQuestion("r1", at: 20)))
            await displayFrames(10)
            note("status, then item", prompts, ["child/r1"])
            window.close()
        }
        do {  // 3: attach in flight, answer carries the question
            let machine = ChatsMachine()
            machine.held = ["child"]
            let (prompts, _, window) = await liveParent(machine, parentItems: [taskRow()], child: empty(quiet()))
            machine.snapshots["child"] = .object([
                "info": childInfo("needs-you", requests: ["r1"]), "items": .array([childQuestion("r1", at: 20)]),
                "seq": .number(12),
            ])
            machine.release("child")
            await displayFrames(10)
            note("an attach still in flight", prompts, ["child/r1"])
            window.close()
        }
        do {  // 4: item while running, needs-you later with nothing else
            let machine = ChatsMachine()
            let (prompts, _, window) = await liveParent(machine, parentItems: [taskRow()], child: empty(quiet()))
            machine.send("child", itemEvent(childQuestion("r1", at: 20)))
            await displayFrames(10)
            machine.send("child", infoEvent(childInfo("needs-you", requests: ["r1"])))
            await displayFrames(10)
            note("only the status changes later", prompts, ["child/r1"])
            window.close()
        }
        do {  // 5: a second question after the first settled
            let machine = ChatsMachine()
            let (prompts, _, window) = await liveParent(machine, parentItems: [taskRow()], child: empty(quiet()))
            machine.send("child", itemEvent(childQuestion("r1", at: 20)))
            machine.send("child", infoEvent(childInfo("needs-you", requests: ["r1"])))
            await displayFrames(10)
            var answered = childQuestion("r1", at: 20)
            if case .object(var fields) = answered {
                fields["state"] = .string("answered")
                answered = .object(fields)
            }
            machine.send("child", itemEvent(answered))
            machine.send("child", infoEvent(childInfo("running")))
            await displayFrames(10)
            machine.send("child", itemEvent(childQuestion("r2", at: 30)))
            machine.send("child", infoEvent(childInfo("needs-you", requests: ["r2"])))
            await displayFrames(10)
            note("a second question", prompts, ["child/r2"])
            window.close()
        }
        do {  // 6a: the row arrives later
            let machine = ChatsMachine()
            let (prompts, _, window) = await liveParent(
                machine, parentItems: [],
                child: .object([
                    "info": childInfo("needs-you", requests: ["r1"]), "items": .array([childQuestion("r1", at: 20)]),
                ]))
            machine.send("parent", itemEvent(taskRow()))
            await displayFrames(10)
            note("the row comes later", prompts, ["child/r1"])
            window.close()
        }
        do {  // 6b: the row's childId arrives in a later update of the row
            let machine = ChatsMachine()
            let (prompts, _, window) = await liveParent(
                machine, parentItems: [taskRow(child: nil)],
                child: .object([
                    "info": childInfo("needs-you", requests: ["r1"]), "items": .array([childQuestion("r1", at: 20)]),
                ]))
            machine.send("parent", itemEvent(taskRow()))
            await displayFrames(10)
            note("the row names its child later", prompts, ["child/r1"])
            window.close()
        }
        do {  // 7: a CLI sub-agent's background question in the parent's thread, live
            let machine = ChatsMachine()
            let agent = ChatWire.item([
                "id": .string("agent-1"), "kind": .string("subagent"), "toolUseId": .string("use-agent"),
                "description": .string("Explore"), "background": .bool(true), "status": .string("running"),
                "startedAt": .number(10), "createdAt": .number(10),
            ])
            let (prompts, _, window) = await liveParent(
                machine, parentItems: [agent, ChatWire.item(["id": .string("own"), "kind": .string("approval")])],
                child: empty(quiet()))
            machine.send(
                "parent",
                itemEvent(
                    ChatWire.item([
                        "id": .string("question-bg"), "kind": .string("question"), "requestId": .string("bg"),
                        "createdAt": .number(40), "turnId": .null,
                    ])))
            machine.send(
                "parent", infoEvent(ChatWire.info(["chatId": .string("parent"), "status": .string("needs-you")])))
            await displayFrames(10)
            note("a background question of the CLI's own sub-agent", prompts, ["request-own", "bg"])
            window.close()
        }
    }

    private enum Failure: Error { case expected }
}

@MainActor private final class ChatsMachine: MachineRequesting {
    var snapshots: [String: JSONValue] = [:]
    /// Chats whose attach waits until `release` answers it with what `snapshots` holds then.
    var held: Set<String> = []
    private var waiting: [String: CheckedContinuation<Void, Never>] = [:]
    private var handlers: [WireEvent: [@MainActor @Sendable (JSONValue) -> Void]] = [:]
    private var seq: [String: Int] = [:]

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        switch type {
        case .chatAttach:
            let chatID = payload["chatId"]?.stringValue ?? ""
            if held.contains(chatID) { await withCheckedContinuation { waiting[chatID] = $0 } }
            return snapshots[chatID] ?? .object([:])
        case .providerList: return .object(["providers": .array([])])
        default: return .object([:])
        }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        handlers[event, default: []].append(handler)
        return {}
    }

    func release(_ chatID: String) {
        held.remove(chatID)
        waiting.removeValue(forKey: chatID)?.resume()
    }

    /// One event of a chat's thread, as `chat.event` carries it to the clients attached to that chat.
    func send(_ chatID: String, _ event: JSONValue) {
        let next = (seq[chatID] ?? 10) + 1
        seq[chatID] = next
        let envelope: JSONValue = .object(["chatId": .string(chatID), "seq": .number(Double(next)), "event": event])
        for handler in handlers[.chatEvent] ?? [] { handler(envelope) }
    }
}

@MainActor private final class HistoryMachine: MachineRequesting {
    var page: JSONValue = .object([:])

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        type == .chatHistory ? page : .object([:])
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
