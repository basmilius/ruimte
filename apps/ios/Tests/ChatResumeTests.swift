import Foundation
import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor final class ChatResumeTests: XCTestCase {
    private func message(_ id: String, _ text: String) -> JSONValue {
        ChatWire.item(["id": .string(id), "kind": .string("assistant"), "text": .string(text)])
    }

    private func snapshot(_ items: [JSONValue], seq: Int) -> JSONValue {
        .object([
            "info": ChatWire.info(), "items": .array(items), "seq": .number(Double(seq)),
            "history": .object(["start": .number(0), "cursor": .null]),
        ])
    }

    private func started(_ machine: ResumeMachine) async -> ChatModel {
        let model = ChatModel(client: machine, chatID: "chat")
        model.start()
        await machine.settle()
        return model
    }

    func testAReconnectAsksOnlyForWhatCameAfterTheLastEvent() async {
        let machine = ResumeMachine()
        machine.attachResults = [snapshot([message("a", "Hello")], seq: 4)]
        let model = await started(machine)
        XCTAssertNil(machine.attaches.first?["since"])
        XCTAssertEqual(model.lastSeq, 4)

        machine.emit(.object(["type": .string("item"), "item": message("b", "Second")]), seq: 5)
        XCTAssertEqual(model.lastSeq, 5)
        let kept = model.presentation.entries.first { $0.id == "a" }?.items.first

        machine.attachResults = [
            .object([
                "info": ChatWire.info(), "items": .array([]), "seq": .number(7),
                "events": .array([
                    .object(["type": .string("item"), "item": message("c", "Third")]),
                    .object(["type": .string("delta"), "itemId": .string("c"), "text": .string(" part")]),
                ]),
            ])
        ]
        machine.setConnected(false)
        machine.setConnected(true)
        await machine.settle()

        XCTAssertEqual(machine.attaches.last?["since"], .number(5))
        XCTAssertEqual(model.items.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(model.items.last?.assistantItem?.text, "Third part")
        XCTAssertTrue(model.presentation.entries.first { $0.id == "a" }?.items.first === kept)
        XCTAssertEqual(model.lastSeq, 7)
    }

    func testAMachineThatNoLongerHoldsTheEventsSendsTheWholeSnapshot() async {
        let machine = ResumeMachine()
        machine.attachResults = [snapshot([message("a", "Hello")], seq: 4)]
        let model = await started(machine)

        machine.attachResults = [snapshot([message("z", "After a clear")], seq: 1)]
        machine.setConnected(false)
        machine.setConnected(true)
        await machine.settle()

        XCTAssertEqual(machine.attaches.last?["since"], .number(4))
        XCTAssertEqual(model.items.map(\.id), ["z"])
        XCTAssertEqual(model.lastSeq, 1)
    }

    func testAMachineWithoutSeqIsAttachedWithoutSinceAgain() async {
        let machine = ResumeMachine()
        machine.attachResults = [.object(["info": ChatWire.info(), "items": .array([message("a", "Hello")])])]
        let model = await started(machine)
        XCTAssertNil(model.lastSeq)

        machine.setConnected(false)
        machine.setConnected(true)
        await machine.settle()
        XCTAssertNil(machine.attaches.last?["since"])
    }

    func testAnUnreadableEventReadsTheWholeThreadAgain() async {
        let machine = ResumeMachine()
        machine.attachResults = [snapshot([message("a", "Hello")], seq: 4)]
        let model = await started(machine)

        machine.attachResults = [snapshot([message("a", "Hello"), message("b", "New")], seq: 5)]
        machine.reject(.object(["chatId": .string("chat"), "event": .object(["type": .string("item")])]))
        await machine.settle()
        XCTAssertEqual(machine.attaches.count, 2)
        XCTAssertNil(machine.attaches.last?["since"])
        XCTAssertEqual(model.items.map(\.id), ["a", "b"])
    }

    func testItemsOfANewerMachineKeepTheirPlaceAndNoneCanBeAnswered() async throws {
        let machine = ResumeMachine()
        let future = ChatWire.item(["id": .string("future"), "kind": .string("future-kind")])
        // An approval this app cannot read: `allowAlways` lost a field it requires.
        let approval = ChatWire.item([
            "id": .string("approval"), "kind": .string("approval"),
            "allowAlways": .object(["label": .string("Always")]),
        ])
        let newerTool = ChatWire.item(["id": .string("tool"), "kind": .string("tool"), "state": .string("paused")])
        machine.attachResults = [snapshot([message("a", "Hello"), future, approval, newerTool], seq: 4)]
        let model = await started(machine)

        XCTAssertEqual(model.items.map(\.id), ["a", "future", "approval", "tool"])
        XCTAssertTrue(model.pending.isEmpty)
        let words = model.items.dropFirst().map { item -> String? in
            if case .unknown(let unknown) = item { ChatUnknownItem.words(unknown) } else { nil }
        }
        XCTAssertEqual(
            words,
            [
                "Update Ruimte to see this.", "Answer this in Ruimte on the machine, or update Ruimte to answer here.",
                "Update Ruimte to see this.",
            ])
    }

    func testAnEventOfANewerMachineReadsTheWholeThreadAgain() async {
        let machine = ResumeMachine()
        machine.attachResults = [snapshot([message("a", "Hello")], seq: 4)]
        let model = await started(machine)

        machine.attachResults = [snapshot([message("a", "Hello"), message("b", "New")], seq: 6)]
        machine.emit(.object(["type": .string("future-event")]), seq: 5)
        await machine.settle()
        XCTAssertEqual(machine.attaches.count, 2)
        XCTAssertNil(machine.attaches.last?["since"])
        XCTAssertEqual(model.items.map(\.id), ["a", "b"])
    }
}

@MainActor private final class ResumeMachine: MachineRequesting {
    var attachResults: [JSONValue] = []
    private(set) var attaches: [JSONValue] = []
    private var handlers: [WireEvent: [@MainActor @Sendable (JSONValue) -> Void]] = [:]
    private var rejected: [@MainActor @Sendable (JSONValue) -> Void] = []
    private var connection: [@MainActor @Sendable (Bool) -> Void] = []
    private var running = 0

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        running += 1
        defer { running -= 1 }
        await Task.yield()
        if type == .chatAttach {
            attaches.append(payload)
            return attachResults.isEmpty
                ? .object(["info": ChatWire.info(), "items": .array([])]) : attachResults.removeFirst()
        }
        return .object([:])
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        handlers[event, default: []].append(handler)
        return {}
    }

    func subscribeRejected(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void)
        -> () -> Void
    {
        rejected.append(handler)
        return {}
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        connection.append(handler)
        handler(true)
        return {}
    }

    func emit(_ event: JSONValue, seq: Int) {
        let payload = JSONValue.object(["chatId": .string("chat"), "event": event, "seq": .number(Double(seq))])
        for handler in handlers[.chatEvent] ?? [] { handler(payload) }
    }

    func reject(_ payload: JSONValue) {
        for handler in rejected { handler(payload) }
    }

    func setConnected(_ connected: Bool) {
        for handler in connection { handler(connected) }
    }

    /// Lets every request the model started run to its end; no clock is involved.
    func settle() async {
        for _ in 0..<200 { await Task.yield() }
        while running > 0 { await Task.yield() }
    }
}
