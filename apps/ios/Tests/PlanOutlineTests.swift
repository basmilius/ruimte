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

    private func document(_ value: JSONValue) throws -> PlanDocument { try XCTUnwrap(PlanDocument(value)) }

    private func parent(_ states: [String]) throws -> PlanStep {
        let steps = states.enumerated().map { step("c\($0.offset)", state: $0.element) }
        return try XCTUnwrap(PlanStep(step("p", steps: steps)))
    }

    func testParentDerivesItsStateLikeThePlanPackage() throws {
        XCTAssertEqual(try parent(["done", "skipped"]).state, .done)
        XCTAssertEqual(try parent(["done", "failed", "blocked"]).state, .failed)
        XCTAssertEqual(try parent(["open", "blocked", "active"]).state, .blocked)
        XCTAssertEqual(try parent(["open", "done"]).state, .active)
        XCTAssertEqual(try parent(["open", "active"]).state, .active)
        XCTAssertEqual(try parent(["open", "open"]).state, .open)
        XCTAssertEqual(try parent(["open", "skipped"]).state, .open)
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
        XCTAssertEqual(document.progressSummary, "1 of 3 done")
        XCTAssertEqual(document.word(for: .done), "Done")
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
        XCTAssertEqual(try XCTUnwrap(PlanStep(step("a"))).toggled, .done)
        XCTAssertEqual(try XCTUnwrap(PlanStep(step("a", state: "active"))).toggled, .done)
        XCTAssertEqual(try XCTUnwrap(PlanStep(step("a", state: "done"))).toggled, .open)
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
        machine.emit("plan.changed", .object(["chatId": .string("chat"), "plan": plan("p", rev: 3, items: [])]))
        machine.emit("plan.changed", .object(["chatId": .string("chat"), "plan": plan("p", rev: 2, items: [])]))
        XCTAssertEqual(store.plans(for: "chat").map(\.rev), [3])

        store.setListed([.object(["chatId": .string("chat"), "plan": plan("p", rev: 1, items: [])])])
        XCTAssertEqual(store.plans(for: "chat").map(\.rev), [3], "a list answer older than an event does not win")

        machine.emit("plan.created", .object(["chatId": .string("chat"), "planId": .string("q")]))
        XCTAssertTrue(store.unseen.contains("chat"))
        store.markSeen("chat")
        XCTAssertFalse(store.unseen.contains("chat"))

        machine.emit("plan.removed", .object(["chatId": .string("chat"), "planId": .string("p")]))
        XCTAssertTrue(store.plans(for: "chat").isEmpty)
    }

    @MainActor func testStoreListsPlansOnConnect() async throws {
        let machine = PlanMachine()
        machine.listed = [.object(["chatId": .string("chat"), "plan": plan("p", rev: 6, items: [step("a")])])]
        let store = PlanStore(client: machine)
        store.start()
        defer { store.stop() }
        for _ in 0..<20 where store.plans(for: "chat").isEmpty { await Task.yield() }
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
        XCTAssertEqual(machine.sent.last?.0, "plan.apply")
        XCTAssertEqual(machine.sent.last?.1["planId"], .string("p"))
        XCTAssertEqual(store.plans(for: "chat").first?.steps.first?.state, .done)
    }
}

@MainActor private final class PlanMachine: MachineRequesting {
    var handlers: [String: @MainActor @Sendable (JSONValue) -> Void] = [:]
    var sent: [(String, JSONValue)] = []
    var answer: JSONValue = .object(["plans": .array([])])
    var listed: [JSONValue] = []

    func emit(_ event: String, _ payload: JSONValue) { handlers[event]?(payload) }

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        return type == "plan.list" ? .object(["plans": .array(listed)]) : answer
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        handlers[event] = handler
        return {}
    }
}
