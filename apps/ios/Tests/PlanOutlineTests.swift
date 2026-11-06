import Observation
import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class PlanOutlineTests: XCTestCase {
    private func step(
        _ id: String, state: String? = nil, checks: String? = nil, unlocked: Bool = false, by: String? = nil,
        steps: [JSONValue] = []
    ) -> JSONValue {
        var value: [String: JSONValue] = ["type": .string("step"), "id": .string(id), "title": .string("Step \(id)")]
        if let state { value["state"] = .string(state) }
        if let checks { value["checks"] = .string(checks) }
        if let by { value["by"] = .string(by) }
        if unlocked { value["unlocked"] = .bool(true) }
        if !steps.isEmpty { value["steps"] = .array(steps) }
        return .object(value)
    }

    private func plan(
        _ id: String = "plan", rev: Double = 1, createdAt: String = "2026-09-16T10:00:00Z", kind: String = "steps",
        checks: String = "anyone", items: [JSONValue]
    ) -> JSONValue {
        .object([
            "id": .string(id), "rev": .number(rev), "createdAt": .string(createdAt),
            "meta": .object(["title": .string("Plan \(id)"), "kind": .string(kind), "checks": .string(checks)]),
            "items": .array(items),
        ])
    }

    private func document(_ value: JSONValue) throws -> PlanDocument {
        PlanDocument(try value.decoded(as: StoredPlan.self))
    }

    private func planStep(_ value: JSONValue) throws -> PlanStep {
        PlanStep(try value.decoded(as: StoredPlanStep.self))
    }

    private func parent(_ states: [PlanStepState]) throws -> PlanStep {
        let steps = states.enumerated().map { step("c\($0.offset)", state: $0.element.rawValue) }
        return try planStep(step("p", steps: steps))
    }

    func testFailedGoesBeforeBlockedInAnyMix() throws {
        XCTAssertEqual(try parent([.done, .skipped, .blocked, .failed, .active, .open]).state, .failed)
        XCTAssertEqual(try parent([.done, .skipped, .open]).state, .active)
        XCTAssertEqual(try parent([.warning, .info, .blocked]).state, .blocked)
    }

    func testAWarningBubblesUpThroughEveryLevelAndInfoStopsAtItsOwnStep() throws {
        let warned = step(
            "a",
            steps: [
                step("b", steps: [step("c", state: "done"), step("d", state: "warning")]), step("e", state: "info"),
            ])
        XCTAssertEqual(try planStep(warned).state, .warning)
        let informed = step(
            "a",
            steps: [
                step("b", steps: [step("c", state: "info"), step("d", state: "skipped")]), step("e", state: "done"),
            ])
        XCTAssertEqual(try planStep(informed).state, .done)
        let unfinished = step(
            "a", steps: [step("b", steps: [step("c", state: "warning"), step("d")]), step("e", state: "info")])
        XCTAssertEqual(try planStep(unfinished).state, .active)
    }

    func testProgressCountsLeavesOnlyAndNamesTheActiveStep() throws {
        let value = plan(
            kind: "test",
            items: [
                .object([
                    "type": .string("section"), "id": .string("split"), "title": .string("Split"),
                    "items": .array([
                        .object(["type": .string("text"), "id": .string("prep"), "title": .string("Before")]),
                        step("a", state: "done"),
                        step("b", steps: [step("b1", state: "done"), step("b2", state: "failed"), step("b3")]),
                    ]),
                ]),
                step("c", state: "active"),
                step("d", state: "skipped"),
            ])
        let document = try document(value)
        XCTAssertEqual(document.groups.map(\.id), ["split", "top-c"])
        XCTAssertNil(document.groups[1].title)
        XCTAssertEqual(document.progress.total, 6)
        XCTAssertEqual(document.progress.label, "4/6")
        XCTAssertEqual(document.groups[0].progress.label, "3/4")
        XCTAssertEqual(document.progressSummary, "4 of 6 run, 2 passed, 1 failed, 1 skipped")
        XCTAssertEqual(document.activeSteps.map(\.id), ["c"])
        let b = try XCTUnwrap(document.groups[0].steps.last)
        XCTAssertEqual(b.progress.label, "2/3")
        XCTAssertEqual(b.state, .failed)
        XCTAssertFalse(b.hasActiveLeaf)
    }

    func testStepsPlanSummaryCountsDone() throws {
        let document = try document(plan(items: [step("a", state: "done"), step("b", state: "skipped"), step("c")]))
        XCTAssertEqual(document.progressSummary, "1 of 3 done, 1 skipped")
        XCTAssertEqual(document.word(for: .done), "Done")
    }

    func testWarningAndInfoAreFinishedOutcomes() throws {
        XCTAssertEqual(try parent([.done, .warning, .info]).state, .warning)
        XCTAssertEqual(try parent([.done, .info, .skipped]).state, .done)
        let leaves = ["done", "warning", "warning", "info", "failed", "open"].enumerated().map {
            step("s\($0.offset)", state: $0.element)
        }
        XCTAssertEqual(
            try document(plan(kind: "test", items: leaves)).progressSummary,
            "5 of 6 run, 1 passed, 2 warnings, 1 info, 1 failed")
        XCTAssertEqual(
            try document(plan(items: leaves)).progressSummary, "4 of 6 done, 2 with warnings, 1 with info, 1 failed")
    }

    func testAgentStepsAreReadOnlyForAPersonUntilUnlocked() throws {
        let document = try document(
            plan(
                checks: "agent",
                items: [
                    step("inherits"), step("anyone", checks: "anyone"), step("person", checks: "person"),
                    step("unlocked", checks: "agent", unlocked: true), step("parent", steps: [step("child")]),
                ]))
        let steps = Dictionary(uniqueKeysWithValues: document.steps.map { ($0.id, $0) })
        XCTAssertFalse(document.personMaySet(try XCTUnwrap(steps["inherits"])))
        XCTAssertTrue(document.mayUnlock(try XCTUnwrap(steps["inherits"])))
        XCTAssertTrue(document.personMaySet(try XCTUnwrap(steps["anyone"])))
        XCTAssertTrue(document.personMaySet(try XCTUnwrap(steps["person"])))
        XCTAssertTrue(document.personMaySet(try XCTUnwrap(steps["unlocked"])))
        XCTAssertFalse(document.mayUnlock(try XCTUnwrap(steps["unlocked"])))
        XCTAssertFalse(document.personMaySet(try XCTUnwrap(steps["parent"])), "a parent's state follows its children")
    }

    func testTappingTheCircleTogglesBetweenOpenAndDone() throws {
        XCTAssertEqual(try planStep(step("a")).toggled, .done)
        XCTAssertEqual(try planStep(step("a", state: "active")).toggled, .done)
        XCTAssertEqual(try planStep(step("a", state: "done")).toggled, .open)
    }

    func testRowsFollowTheFilterAndTheFolds() throws {
        let document = try document(
            plan(
                kind: "test",
                items: [
                    .object(["type": .string("text"), "id": .string("intro"), "title": .string("Before")]),
                    step("a", state: "done"),
                    .object([
                        "type": .string("section"), "id": .string("done"), "title": .string("Done"),
                        "items": .array([step("b", state: "done"), step("c", state: "skipped")]),
                    ]),
                    .object([
                        "type": .string("section"), "id": .string("mixed"), "title": .string("Mixed"),
                        "items": .array([step("d", steps: [step("d1", state: "failed"), step("d2")])]),
                    ]),
                ]))
        XCTAssertEqual(
            document.rows(filter: .all, collapseDone: false, collapsed: []).map(\.id),
            ["intro", "a", "done", "b", "c", "mixed", "d", "d1", "d2"])
        XCTAssertEqual(
            document.rows(filter: .all, collapseDone: true, collapsed: ["d"]).map(\.id),
            ["intro", "a", "done", "mixed", "d"])
        XCTAssertEqual(
            document.rows(filter: .issues, collapseDone: false, collapsed: []).map(\.id), ["mixed", "d", "d1"])
        XCTAssertEqual(
            document.rows(filter: .open, collapseDone: false, collapsed: []).map(\.id), ["mixed", "d", "d2"])
        XCTAssertEqual(document.word(for: .open), "Not run")
    }

    func testCopyAsMarkdownWritesThePlanAsATaskList() throws {
        var failed = step("b", state: "failed")
        if case .object(var fields) = failed {
            fields["note"] = .string("Broke")
            failed = .object(fields)
        }
        let document = try document(
            plan(items: [
                step("a", state: "done"),
                .object([
                    "type": .string("section"), "id": .string("s"), "title": .string("Section"),
                    "items": .array([
                        .object([
                            "type": .string("text"), "id": .string("t"), "title": .string("Before"),
                            "description": .string("Read this"),
                        ]),
                        step("p", steps: [failed, step("c", state: "warning")]),
                    ]),
                ]),
                step("d"),
            ]))
        XCTAssertEqual(
            document.markdown,
            """
            # Plan plan

            - [x] Step a

            ## Section

            > **Before** Read this

            - [!] Step p
                - [!] Step b
                    > Broke
                - [w] Step c

            ---

            - [ ] Step d

            """)
    }

    func testCopyWritesAStepAsMarkdown() throws {
        let document = try document(plan(kind: "test", items: []))
        var value = step("a", state: "failed")
        if case .object(var fields) = value {
            fields["note"] = .string("Broke\ntwice")
            value = .object(fields)
        }
        XCTAssertEqual(
            document.markdown(for: try planStep(value)), "- [ ] Step a (failed)\n    > Broke\n    > twice")
    }

    func testNewestPlanComesFirst() throws {
        let plans = try [
            document(plan("old", createdAt: "2026-09-16T09:00:00Z", items: [])),
            document(plan("new", createdAt: "2026-09-16T11:00:00Z", items: [])),
            document(plan("tie", createdAt: "2026-09-16T11:00:00Z", items: [])),
        ]
        XCTAssertEqual(PlanDocument.newestFirst(plans).map(\.id), ["tie", "new", "old"])
    }

    func testOpsCarryOnlyWhatAPersonSends() {
        XCTAssertEqual(
            PlanOps.set(["a"], .failed, note: "Broke"),
            .object([
                "op": .string("set"), "ids": .array([.string("a")]), "state": .string("failed"),
                "note": .string("Broke"),
            ]))
        XCTAssertNil(PlanOps.set(["a"], .done, note: "")["note"])
        XCTAssertEqual(PlanOps.unlock(["a"])["ids"], .array([.string("a")]))
        XCTAssertEqual(PlanOps.note("a", "")["text"], .string(""))
    }

    @MainActor func testStoreKeepsTheLatestRevAndMarksCreatedPlans() async throws {
        let machine = PlanMachine()
        let store = PlanStore(client: machine)
        store.start()
        machine.emit(.planChanged, .object(["chatId": .string("chat"), "plan": plan("p", rev: 3, items: [])]))
        machine.emit(.planChanged, .object(["chatId": .string("chat"), "plan": plan("p", rev: 2, items: [])]))
        XCTAssertEqual(store.plans(for: "chat").map(\.rev), [3])

        store.setListed([
            try JSONValue.object(["chatId": .string("chat"), "plan": plan("p", rev: 1, items: [])])
                .decoded(as: PlanOfChat.self)
        ])
        XCTAssertEqual(store.plans(for: "chat").map(\.rev), [3], "a list answer older than an event does not win")

        machine.emit(.planCreated, .object(["chatId": .string("chat"), "planId": .string("q")]))
        XCTAssertTrue(store.unseen.contains("chat"))
        store.markSeen("chat")
        XCTAssertFalse(store.unseen.contains("chat"))

        machine.emit(.planRemoved, .object(["chatId": .string("chat"), "planId": .string("p")]))
        XCTAssertTrue(store.plans(for: "chat").isEmpty)
    }

    @MainActor func testStoreListsPlansOnConnect() async throws {
        let machine = PlanMachine()
        machine.listed = [.object(["chatId": .string("chat"), "plan": plan("p", rev: 6, items: [step("a")])])]
        let store = PlanStore(client: machine)
        let listed = expectation(description: "The listed plan reaches the store")
        withObservationTracking {
            _ = store.plans(for: "chat")
        } onChange: {
            listed.fulfill()
        }
        store.start()
        defer { store.stop() }
        await fulfillment(of: [listed], timeout: 1)
        XCTAssertEqual(machine.sent.filter { $0.0 == .planList }.map(\.1), [.object([:])])
        XCTAssertEqual(store.plans(for: "chat").map(\.rev), [6])
    }

    /// A chat is pushed as a navigation destination, which does not inherit the environment of the view that
    /// declared it, so the session has to reach the screen through its initializer.
    @MainActor func testChatScreenKeepsTheMachineSessionOfItsProjectOrCaller() {
        let runtime = AppRuntime(connections: MachineConnections(monitorPaths: false))
        defer { runtime.connections.shutdown() }
        let session = SharedMachineSession(
            machine: Machine(
                id: "machine", name: "Machine", icon: nil, publicKey: String(repeating: "A", count: 43),
                brokerUrl: "wss://broker.test", lastSeenAt: nil),
            runtime: runtime)
        let workspace = MobileWorkspace(session: session, projectID: "project")
        let opened = ChatScreen(client: session.rpc, chatID: "chat", title: "Chat", session: session)
        let inProject = ChatScreen(client: session.rpc, chatID: "chat", title: "Chat", workspace: workspace)
        XCTAssertTrue(opened.machineSession === session)
        XCTAssertTrue(inProject.machineSession === session)
    }

    @MainActor func testStoreSendsOperationsAndTakesTheAnsweredPlan() async throws {
        let machine = PlanMachine()
        machine.answer = .object(["plan": plan("p", rev: 5, items: [step("a", state: "done", by: "person")])])
        let store = PlanStore(client: machine)
        try await store.apply(chatID: "chat", planID: "p", ops: [PlanOps.set(["a"], .done)])
        XCTAssertEqual(machine.sent.last?.0, .planApply)
        XCTAssertEqual(machine.sent.last?.1["planId"], .string("p"))
        XCTAssertEqual(
            machine.sent.last?.1,
            .object([
                "chatId": .string("chat"), "planId": .string("p"),
                "ops": .array([
                    .object(["op": .string("set"), "ids": .array([.string("a")]), "state": .string("done")])
                ]),
            ]))
        XCTAssertEqual(store.plans(for: "chat").first?.steps.first?.state, .done)
        XCTAssertEqual(store.plans(for: "chat").first?.rev, 5)
    }
}

@MainActor private final class PlanMachine: MachineRequesting {
    var handlers: [WireEvent: @MainActor @Sendable (JSONValue) -> Void] = [:]
    var sent: [(WireRequest, JSONValue)] = []
    var answer: JSONValue = .object(["plans": .array([])])
    var listed: [JSONValue] = []

    func emit(_ event: WireEvent, _ payload: JSONValue) { handlers[event]?(payload) }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        return type == .planList ? .object(["plans": .array(listed)]) : answer
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        handlers[event] = handler
        return {}
    }
}

@MainActor
final class PlanActivityHoldTests: XCTestCase {
    /// Runs nothing on its own; a test fires what is due.
    @MainActor private final class ManualScheduler {
        var pending: [(id: Int, delay: Duration, action: @MainActor () -> Void)] = []
        private var next = 0

        var schedule: PlanActivityHold.Schedule {
            { [unowned self] delay, action in
                next += 1
                let id = next
                pending.append((id, delay, action))
                return { [unowned self] in pending.removeAll { $0.id == id } }
            }
        }

        func fire() {
            let due = pending
            pending = []
            for entry in due { entry.action() }
        }
    }

    private let first = PlanActivityHold.Step(id: "a", title: "First")
    private let second = PlanActivityHold.Step(id: "b", title: "Second")

    func testAnActiveStepShowsAtOnce() {
        let scheduler = ManualScheduler()
        let hold = PlanActivityHold(schedule: scheduler.schedule)
        hold.update(active: [first], working: true)
        XCTAssertEqual(hold.shown, .init(steps: [first], working: true))
        XCTAssertTrue(scheduler.pending.isEmpty)
    }

    func testNoActiveStepKeepsTheLastForTheHold() {
        let scheduler = ManualScheduler()
        let hold = PlanActivityHold(schedule: scheduler.schedule)
        hold.update(active: [first], working: true)
        hold.update(active: [], working: true)
        XCTAssertEqual(hold.shown, .init(steps: [first], working: true))
        XCTAssertEqual(scheduler.pending.map(\.delay), [PlanActivityHold.hold])
        scheduler.fire()
        XCTAssertNil(hold.shown)
    }

    func testANewActiveStepDuringTheHoldReplacesTheLast() {
        let scheduler = ManualScheduler()
        let hold = PlanActivityHold(schedule: scheduler.schedule)
        hold.update(active: [first], working: true)
        hold.update(active: [], working: true)
        hold.update(active: [second], working: true)
        XCTAssertEqual(hold.shown, .init(steps: [second], working: true))
        XCTAssertTrue(scheduler.pending.isEmpty)
    }

    func testRepeatedEmptyUpdatesDoNotExtendTheHold() {
        let scheduler = ManualScheduler()
        let hold = PlanActivityHold(schedule: scheduler.schedule)
        hold.update(active: [first], working: true)
        hold.update(active: [], working: true)
        hold.update(active: [], working: true)
        XCTAssertEqual(scheduler.pending.count, 1)
    }

    func testPausingWaitsForTheHoldAndWorkingAgainCancelsIt() {
        let scheduler = ManualScheduler()
        let hold = PlanActivityHold(schedule: scheduler.schedule)
        hold.update(active: [first], working: true)
        hold.update(active: [first], working: false)
        XCTAssertEqual(hold.shown?.working, true)
        hold.update(active: [first], working: true)
        XCTAssertTrue(scheduler.pending.isEmpty)
        hold.update(active: [first], working: false)
        scheduler.fire()
        XCTAssertEqual(hold.shown, .init(steps: [first], working: false))
    }

    func testAStepThatAppearsWhileStoppedShowsPausedAtOnce() {
        let scheduler = ManualScheduler()
        let hold = PlanActivityHold(schedule: scheduler.schedule)
        hold.update(active: [first, second], working: false)
        XCTAssertEqual(hold.shown, .init(steps: [first, second], working: false))
        hold.update(active: [first, second], working: true)
        XCTAssertEqual(hold.shown?.working, true)
    }

    func testRevealUnfoldsAncestorsAndDropsOnlyWhatStillHides() throws {
        let value: JSONValue = .object([
            "id": .string("plan"), "rev": .number(1), "createdAt": .string("2026-09-16T10:00:00Z"),
            "meta": .object(["title": .string("Plan"), "kind": .string("steps"), "checks": .string("anyone")]),
            "items": .array([
                .object([
                    "type": .string("section"), "id": .string("s"), "title": .string("Section"),
                    "items": .array([
                        .object([
                            "type": .string("step"), "id": .string("p"), "title": .string("Parent"),
                            "steps": .array([
                                .object([
                                    "type": .string("step"), "id": .string("c"), "title": .string("Child"),
                                    "state": .string("done"),
                                ])
                            ]),
                        ])
                    ]),
                ])
            ]),
        ])
        let plan = PlanDocument(try value.decoded(as: StoredPlan.self))
        XCTAssertEqual(
            plan.reveal("c", filter: .all, collapseDone: false, collapsed: ["s", "p", "other"]),
            PlanReveal(filter: .all, collapseDone: false, collapsed: ["other"]))
        XCTAssertEqual(
            plan.reveal("c", filter: .open, collapseDone: true, collapsed: []),
            PlanReveal(filter: .all, collapseDone: false, collapsed: []))
        XCTAssertNil(plan.reveal("missing", filter: .all, collapseDone: false, collapsed: []))
    }
}
