import Observation
import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor
final class ChatProposalTests: XCTestCase {
    private func tunnel(
        _ id: String, chat: String = "chat", action: String = "add", kind: String = "dev", stale: Bool = false,
        createdAt: Double = 2
    ) -> JSONValue {
        .object([
            "proposalId": .string(id), "chatId": .string(chat), "action": .string(action), "kind": .string(kind),
            "hostname": .string("app.example.com"), "port": kind == "mcp" ? .null : .number(5173),
            "origin": .object(["https": .bool(true), "hostHeader": .string("localhost")]),
            "reason": .string("To try it on a phone"), "stale": .bool(stale), "createdAt": .number(createdAt),
            "expiresAt": .number(createdAt + 600),
        ])
    }

    private func project(_ id: String, chat: String = "chat", createdAt: Double = 1) -> JSONValue {
        .object([
            "proposalId": .string(id), "chatId": .string(chat), "name": .string("Garden planner"),
            "folder": .string("/Users/person/Garden"), "reason": .string("It has grown into an app"),
            "createdAt": .number(createdAt), "expiresAt": .number(createdAt + 600),
        ])
    }

    private func card(_ value: JSONValue) throws -> ChatProposal {
        try XCTUnwrap(ChatProposal(tunnel: value.decoded(as: TunnelProposal.self)))
    }

    func testTheStoreReadsBothListsAndKeepsOnlyTheCardsItCanName() async throws {
        let machine = ProposalMachine(answering: [.chatProposals, .tunnelProposals])
        machine.lists[.chatProposals] = .object(["proposals": .array([project("p1"), project("p2", chat: "other")])])
        machine.lists[.tunnelProposals] = .object([
            "proposals": .array([
                tunnel("t1"), tunnel("t2", action: "rename"), .object(["proposalId": .string("broken")]),
            ])
        ])
        let store = ProposalStore(client: machine)
        let read = expectation(description: "The tunnel list reaches the store")
        withObservationTracking {
            _ = store.tunnels
        } onChange: {
            read.fulfill()
        }
        store.start()
        defer { store.stop() }
        await fulfillment(of: [read], timeout: 1)

        XCTAssertEqual(Set(machine.sent.map(\.0)), [.chatProposals, .tunnelProposals])
        XCTAssertEqual(store.tunnels.map(\.proposalId), ["t1", "t2"], "a card that does not decode stays out alone")
        XCTAssertEqual(
            store.cards(for: "chat").map(\.id), ["project:p1", "tunnel:t1"],
            "a change this app has no words for stays out, and the oldest card leads")
        guard case .project(let proposal) = store.cards(for: "chat").first else {
            return XCTFail("The project card is missing")
        }
        XCTAssertEqual(proposal.folder, "/Users/person/Garden")
    }

    func testAFailedFirstReadIsReadAgainWhenAChatShowsItsCards() async throws {
        let machine = ProposalMachine(answering: [.chatProposals, .tunnelProposals])
        machine.lists[.chatProposals] = .object(["proposals": .array([project("p1")])])
        machine.lists[.tunnelProposals] = .object(["proposals": .array([tunnel("t1")])])
        machine.failing = [.chatProposals, .tunnelProposals]
        let store = ProposalStore(client: machine)
        let failed = expectation(description: "The failed reads reach the store")
        withObservationTracking {
            _ = store.unread
        } onChange: {
            failed.fulfill()
        }
        store.start()
        defer { store.stop() }
        await fulfillment(of: [failed], timeout: 1)
        await store.readAgainIfFailed()
        XCTAssertTrue(store.cards(for: "chat").isEmpty)

        machine.failing = []
        await store.readAgainIfFailed()
        XCTAssertEqual(store.cards(for: "chat").map(\.id), ["project:p1", "tunnel:t1"])
        XCTAssertTrue(store.unread.isEmpty)
        let reads = machine.sent.count
        await store.readAgainIfFailed()
        XCTAssertEqual(machine.sent.count, reads, "a store that read everything asks nothing again")
    }

    func testAListAnEventBringsIsNoLongerUnread() async {
        let machine = ProposalMachine(answering: [.chatProposals])
        machine.failing = [.chatProposals]
        let store = ProposalStore(client: machine)
        let failed = expectation(description: "The failed read reaches the store")
        withObservationTracking {
            _ = store.unread
        } onChange: {
            failed.fulfill()
        }
        store.start()
        defer { store.stop() }
        await fulfillment(of: [failed], timeout: 1)
        machine.emit(.chatProposals, .object(["proposals": .array([project("p1")])]))
        XCTAssertEqual(store.cards(for: "chat").map(\.id), ["project:p1"])
        XCTAssertTrue(store.unread.isEmpty)
    }

    func testEventsReplaceTheWholeList() throws {
        let machine = ProposalMachine(answering: [])
        let store = ProposalStore(client: machine)
        store.start()
        defer { store.stop() }
        machine.emit(.tunnelProposals, .object(["proposals": .array([tunnel("t1")])]))
        machine.emit(.chatProposals, .object(["proposals": .array([project("p1")])]))
        XCTAssertEqual(store.cards(for: "chat").map(\.id), ["project:p1", "tunnel:t1"])
        machine.emit(.tunnelProposals, .object(["proposals": .array([])]))
        XCTAssertEqual(store.cards(for: "chat").map(\.id), ["project:p1"])
    }

    func testAnOlderMachineIsNotAskedForCards() async {
        let machine = ProposalMachine(answering: [])
        let store = ProposalStore(client: machine)
        store.start()
        defer { store.stop() }
        await Task.yield()
        await Task.yield()
        XCTAssertTrue(machine.sent.isEmpty)
        XCTAssertTrue(store.cards(for: "chat").isEmpty)
    }

    func testThePhoneDeclinesATunnelCardAndLeavesTheConfirmToTheMachine() throws {
        let actions = try card(tunnel("t1")).actions { $0 == .tunnelProposalDecline }
        XCTAssertEqual(actions, ChatProposalActions(declines: true, note: "Confirm this in Ruimte on the machine."))

        let stale = try card(tunnel("t1", stale: true)).actions { $0 == .tunnelProposalDecline }
        XCTAssertEqual(stale, ChatProposalActions(declines: true, note: nil), "a stale card says so itself")

        let proposal = try ChatProposal.project(project("p1").decoded(as: ProjectProposal.self))
        XCTAssertEqual(
            proposal.actions { $0 == .chatProposalDecline },
            ChatProposalActions(declines: true, note: "Make it a project in Ruimte on the machine."))
    }

    func testACardOfAMachineWithoutDeclineHasNoActions() throws {
        let actions = try card(tunnel("t1")).actions { _ in false }
        XCTAssertEqual(
            actions,
            ChatProposalActions(
                declines: false, note: "Answer this in Ruimte on the machine, or update Ruimte to answer here."))
    }

    func testHeadingsFollowTheChange() throws {
        XCTAssertEqual(try card(tunnel("t", action: "add")).heading, "Add app.example.com → port 5173")
        XCTAssertEqual(try card(tunnel("t", action: "on", kind: "mcp")).heading, "Turn on app.example.com → Ruimte MCP")
        XCTAssertEqual(try card(tunnel("t", action: "off")).heading, "Turn off app.example.com")
        XCTAssertEqual(try card(tunnel("t", action: "remove")).heading, "Remove app.example.com")
    }

    func testDeclineSendsTheCardsIdAndHidesItWhileTheMachineListsIt() async throws {
        let machine = ProposalMachine(answering: [.tunnelProposalDecline, .chatProposalDecline])
        machine.replies[.tunnelProposalDecline] = .object(["accepted": .bool(true)])
        machine.replies[.chatProposalDecline] = .object(["accepted": .bool(true)])
        let tunnelCard = try card(tunnel("t1"))
        let projectCard = try ChatProposal.project(project("p1").decoded(as: ProjectProposal.self))
        let answers = ChatProposalAnswers()
        answers.update([projectCard, tunnelCard])

        await answers.decline(tunnelCard, client: machine)
        await answers.decline(projectCard, client: machine)

        XCTAssertEqual(machine.sent.map(\.0), [.tunnelProposalDecline, .chatProposalDecline])
        XCTAssertEqual(
            machine.sent.map(\.1), [.object(["proposalId": .string("t1")]), .object(["proposalId": .string("p1")])])
        XCTAssertTrue(answers.cards.isEmpty)
        XCTAssertTrue(answers.errors.isEmpty)
    }

    func testAFailedDeclineShowsOnItsCard() async throws {
        let machine = ProposalMachine(answering: [.tunnelProposalDecline])
        machine.replies[.tunnelProposalDecline] = .object(["accepted": .bool(false)])
        let tunnelCard = try card(tunnel("t1"))
        let answers = ChatProposalAnswers()
        answers.update([tunnelCard])

        await answers.decline(tunnelCard, client: machine)
        XCTAssertEqual(answers.errors[tunnelCard.id], "Already answered or expired")
        XCTAssertEqual(answers.cards, [tunnelCard])

        machine.failure = MachineClientError.server(code: "internal", message: "The machine could not answer")
        await answers.decline(tunnelCard, client: machine)
        XCTAssertEqual(answers.errors[tunnelCard.id], "The machine could not answer")
        XCTAssertNil(answers.sendingID)
    }

    func testACardAskedAgainReplacesTheOldOne() async throws {
        let machine = ProposalMachine(answering: [.tunnelProposalDecline])
        machine.replies[.tunnelProposalDecline] = .object(["accepted": .bool(false)])
        let first = try card(tunnel("t1"))
        let again = try card(tunnel("t2", createdAt: 3))
        let answers = ChatProposalAnswers()
        answers.update([first])
        await answers.decline(first, client: machine)
        XCTAssertNotNil(answers.errors[first.id])

        answers.update([again])
        XCTAssertEqual(answers.cards, [again])
        XCTAssertTrue(answers.errors.isEmpty, "what was kept for the old card goes with it")
    }
}

@MainActor private final class ProposalMachine: MachineRequesting, MachineFeatures {
    let answering: Set<WireRequest>
    var lists: [WireRequest: JSONValue] = [:]
    var replies: [WireRequest: JSONValue] = [:]
    var failure: Error?
    var failing: Set<WireRequest> = []
    private(set) var sent: [(WireRequest, JSONValue)] = []
    private var handlers: [WireEvent: @MainActor @Sendable (JSONValue) -> Void] = [:]

    init(answering: Set<WireRequest>) { self.answering = answering }

    func answers(_ type: WireRequest) -> Bool { answering.contains(type) }

    func emit(_ event: WireEvent, _ payload: JSONValue) { handlers[event]?(payload) }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        if let failure { throw failure }
        if failing.contains(type) { throw URLError(.timedOut) }
        return lists[type] ?? replies[type] ?? .object([:])
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        handlers[event] = handler
        return {}
    }
}
