import Foundation
import RuimtePulsar
import Testing

@testable import RuimteTransport

/// A machine that records what it is asked and lets a test say when the link goes and which events arrive.
@MainActor private final class LiveMachine: MachineRequesting, MachineFeatures {
    var requests: [WireRequest] = []
    var named: Set<WireRequest> = []
    var refused: Set<WireRequest> = []
    private(set) var isConnected: Bool
    private var observers: [UUID: @MainActor @Sendable (Bool) -> Void] = [:]
    private var subscribers: [WireEvent: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]
    private var rejecters: [WireEvent: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]

    init(connected: Bool = true) { isConnected = connected }

    func answers(_ type: WireRequest) -> Bool { named.contains(type) }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        requests.append(type)
        if refused.contains(type) { throw MachineClientError.server(code: "unknown-request", message: "No") }
        return .object([:])
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        let id = UUID()
        subscribers[event, default: [:]][id] = handler
        return { [weak self] in self?.subscribers[event]?[id] = nil }
    }

    func subscribeRejected(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void)
        -> () -> Void
    {
        let id = UUID()
        rejecters[event, default: [:]][id] = handler
        return { [weak self] in self?.rejecters[event]?[id] = nil }
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        let id = UUID()
        observers[id] = handler
        handler(isConnected)
        return { [weak self] in self?.observers[id] = nil }
    }

    func link(_ up: Bool) {
        isConnected = up
        for observer in Array(observers.values) { observer(up) }
    }

    func emit(_ event: WireEvent, _ payload: JSONValue = .object([:])) {
        for handler in Array(subscribers[event]?.values ?? [:].values) { handler(payload) }
    }

    func reject(_ event: WireEvent, _ payload: JSONValue = .object([:])) {
        for handler in Array(rejecters[event]?.values ?? [:].values) { handler(payload) }
    }

    var listeners: Int { subscribers.values.reduce(0) { $0 + $1.count } + rejecters.values.reduce(0) { $0 + $1.count } }
}

/// What a read did, and a read that waits until a test lets it finish.
@MainActor private final class Reads {
    private(set) var count = 0
    private(set) var cancelled = 0
    var log: [String] = []
    var holds = false
    private var held: [CheckedContinuation<Void, Never>] = []

    func read() async {
        count += 1
        log.append("read")
        guard holds else { return }
        await withCheckedContinuation { held.append($0) }
        if Task.isCancelled { cancelled += 1 }
    }

    func finish() {
        let waiting = held
        held = []
        for continuation in waiting { continuation.resume() }
    }
}

private struct Changed: Decodable, Equatable {
    let name: String
}

@MainActor struct LiveResourceTests {
    private func resource(
        _ machine: LiveMachine, _ reads: Reads, events: [LiveEvent] = [], watch: LiveWatch? = nil,
        scheduler: any TransportScheduling = FakeScheduler(), settle: Double = 0,
        poll: (@MainActor () -> Double)? = nil, connection: (@MainActor (Bool) -> Void)? = nil
    ) -> LiveResource {
        LiveResource(
            client: machine, events: events, watch: watch, scheduler: scheduler, settleMilliseconds: settle,
            poll: poll, connection: connection, read: { await reads.read() })
    }

    @Test func aLinkThatOpensRenewsTheWatchAndThenReads() async {
        let machine = LiveMachine()
        let reads = Reads()
        let live = resource(machine, reads, watch: .area(.deviceWatch))
        live.start()
        await live.refresh()
        #expect(machine.requests == [.deviceWatch])
        #expect(reads.count == 1)
        #expect(live.isWatching)
    }

    @Test func everyNewLinkRenewsTheWatchAndReadsAgain() async {
        let machine = LiveMachine()
        let reads = Reads()
        let live = resource(machine, reads, watch: .area(.deviceWatch))
        live.start()
        await live.refresh()
        machine.link(false)
        #expect(!live.isWatching)
        machine.link(true)
        await live.refresh()
        #expect(machine.requests == [.deviceWatch, .deviceWatch])
        #expect(reads.count == 2)
        #expect(live.isWatching)
    }

    @Test func aLinkThatDropsCancelsTheReadInFlightAndReadsNothingUntilItIsBack() async {
        let machine = LiveMachine()
        let reads = Reads()
        reads.holds = true
        let live = resource(machine, reads)
        live.start()
        await Task.yield()
        #expect(reads.count == 1)
        machine.link(false)
        reads.finish()
        await Task.yield()
        await Task.yield()
        #expect(reads.cancelled == 1)
        machine.emit(.taskChanged)
        #expect(reads.count == 1)
        #expect(!live.isConnected)
    }

    @Test func theConnectionIsToldBeforeAnythingIsRead() async {
        let machine = LiveMachine(connected: false)
        let reads = Reads()
        let live = resource(machine, reads, connection: { reads.log.append($0 ? "up" : "down") })
        live.start()
        machine.link(true)
        await live.refresh()
        machine.link(false)
        #expect(reads.log == ["down", "up", "read", "down"])
    }

    @Test func anAppliedEventIsDecodedAndAMalformedOneIsDropped() async {
        let machine = LiveMachine()
        let reads = Reads()
        var seen: [Changed] = []
        let live = resource(
            machine, reads, events: [.apply(.taskChanged, as: Changed.self) { seen.append($0) }])
        live.start()
        await live.refresh()
        machine.emit(.taskChanged, .object(["name": .string("a")]))
        machine.emit(.taskChanged, .object(["other": .number(1)]))
        #expect(seen == [Changed(name: "a")])
        #expect(reads.count == 1)
    }

    @Test func anEventThatMeansChangedReadsOnce() async {
        let machine = LiveMachine()
        let reads = Reads()
        let live = resource(machine, reads, events: [.reread(.deviceChanged)])
        live.start()
        await live.refresh()
        machine.emit(.deviceChanged)
        await live.refresh()
        #expect(reads.count == 2)
    }

    @Test func aBurstDuringAReadMakesOneMoreRead() async {
        let machine = LiveMachine()
        let reads = Reads()
        let live = resource(machine, reads, events: [.reread(.deviceChanged)])
        reads.holds = true
        live.start()
        await Task.yield()
        for _ in 0..<5 { machine.emit(.deviceChanged) }
        reads.holds = false
        reads.finish()
        await live.refresh()
        #expect(reads.count == 2)
    }

    @Test func aMatchSaysWhichEventsCount() async {
        let machine = LiveMachine()
        let reads = Reads()
        let live = resource(
            machine, reads,
            events: [.reread(.fsChanged) { $0["root"]?.stringValue == "/here" }])
        live.start()
        await live.refresh()
        machine.emit(.fsChanged, .object(["root": .string("/elsewhere")]))
        #expect(reads.count == 1)
        machine.emit(.fsChanged, .object(["root": .string("/here")]))
        await live.refresh()
        #expect(reads.count == 2)
    }

    @Test func aRejectedEventReadsAgainUnlessTheEventAsksNot() async {
        let machine = LiveMachine()
        let reads = Reads()
        let live = resource(
            machine, reads, events: [.reread(.deviceChanged), .reread(.taskChanged, rejected: false)])
        live.start()
        await live.refresh()
        machine.reject(.taskChanged)
        #expect(reads.count == 1)
        machine.reject(.deviceChanged)
        await live.refresh()
        #expect(reads.count == 2)
    }

    @Test func aRejectedEventIsHandedOverRaw() async {
        let machine = LiveMachine()
        var raw: [JSONValue] = []
        let live = LiveResource(client: machine, events: [.rejected(.chatEvent) { raw.append($0) }])
        live.start()
        machine.reject(.chatEvent, .object(["chatId": .string("c")]))
        #expect(raw == [.object(["chatId": .string("c")])])
    }

    @Test func aBurstOfEventsIsGatheredIntoOneReadAfterTheSettle() async {
        let machine = LiveMachine()
        let reads = Reads()
        let scheduler = FakeScheduler()
        let live = resource(
            machine, reads, events: [.reread(.deviceChanged)], scheduler: scheduler, settle: 150)
        live.start()
        await live.refresh()
        for _ in 0..<4 { machine.emit(.deviceChanged) }
        #expect(reads.count == 1)
        #expect(scheduler.delays == [150])
        scheduler.advance()
        await live.refresh()
        #expect(reads.count == 2)
    }

    @Test func aWatchTheMachineDoesNotNameIsNotAsked() async {
        let machine = LiveMachine()
        let reads = Reads()
        let live = resource(machine, reads, watch: .area(.deviceWatch, gated: true))
        live.start()
        await live.refresh()
        #expect(machine.requests.isEmpty)
        #expect(!live.isWatching)
        machine.named = [.deviceWatch]
        machine.link(false)
        machine.link(true)
        await live.refresh()
        #expect(machine.requests == [.deviceWatch])
        #expect(live.isWatching)
    }

    @Test func aMachineWithoutTheWatchIsReadOnTheClock() async {
        let machine = LiveMachine()
        let reads = Reads()
        let scheduler = FakeScheduler()
        let live = resource(
            machine, reads, watch: .area(.deviceWatch, gated: true), scheduler: scheduler, poll: { 3_000 })
        live.start()
        await live.refresh()
        #expect(reads.count == 1)
        #expect(scheduler.delays == [3_000])
        scheduler.advance()
        await live.refresh()
        #expect(reads.count == 2)
        #expect(scheduler.delays == [3_000, 3_000])
    }

    @Test func aMachineThatRefusesTheWatchIsReadOnTheClockToo() async {
        let machine = LiveMachine()
        machine.refused = [.deviceWatch]
        let reads = Reads()
        let scheduler = FakeScheduler()
        let live = resource(machine, reads, watch: .area(.deviceWatch), scheduler: scheduler, poll: { 2_000 })
        live.start()
        await live.refresh()
        #expect(!live.isWatching)
        #expect(scheduler.delays == [2_000])
    }

    @Test func aWatchedMachineHasNoClock() async {
        let machine = LiveMachine()
        let reads = Reads()
        let scheduler = FakeScheduler()
        let live = resource(machine, reads, watch: .area(.projectWatch), scheduler: scheduler, poll: { 15_000 })
        live.start()
        await live.refresh()
        #expect(live.isWatching)
        #expect(scheduler.delays.isEmpty)
    }

    @Test func aLinkThatDropsStopsTheClock() async {
        let machine = LiveMachine()
        let reads = Reads()
        let scheduler = FakeScheduler()
        let live = resource(
            machine, reads, watch: .area(.deviceWatch, gated: true), scheduler: scheduler, poll: { 3_000 })
        live.start()
        await live.refresh()
        machine.link(false)
        scheduler.advance()
        await live.refresh()
        #expect(reads.count == 1)
    }

    @Test func stoppingLetsTheWatchGoAndHearsNothingMore() async {
        let machine = LiveMachine()
        let reads = Reads()
        let live = resource(machine, reads, events: [.reread(.deviceChanged)], watch: .area(.deviceWatch))
        live.start()
        await live.refresh()
        #expect(machine.listeners == 2)
        await live.stopAndRelease()
        #expect(machine.requests == [.deviceWatch, .deviceUnwatch])
        #expect(machine.listeners == 0)
        machine.emit(.deviceChanged)
        machine.link(false)
        machine.link(true)
        await live.refresh()
        #expect(reads.count == 1)
        #expect(!live.isStarted)
    }

    @Test func aResourceCanStartAgainAfterItStopped() async {
        let machine = LiveMachine()
        let reads = Reads()
        let live = resource(machine, reads, watch: .area(.deviceWatch))
        live.start()
        await live.refresh()
        await live.stopAndRelease()
        live.start()
        await live.refresh()
        #expect(machine.requests == [.deviceWatch, .deviceUnwatch, .deviceWatch])
        #expect(reads.count == 2)
    }

    @Test func theUnwatchIsDerivedFromTheWatch() {
        let watch = LiveWatch.area(.projectWatch)
        #expect(watch.start == .projectWatch)
        #expect(watch.stop == .projectUnwatch)
        #expect(watch.needs == nil)
        #expect(LiveWatch.area(.projectWatch, gated: true).needs == .projectWatch)
    }

    @Test func holdsStartOnTheFirstAndEndOnlyAfterTheGraceOfTheLast() {
        let scheduler = FakeScheduler()
        var log: [String] = []
        let holds = LiveHolds(
            graceMilliseconds: 2_000, scheduler: scheduler, began: { log.append("began") },
            ended: { log.append("ended") })
        holds.retain()
        holds.retain()
        holds.release()
        #expect(log == ["began"])
        holds.release()
        #expect(scheduler.delays == [2_000])
        #expect(log == ["began"])
        scheduler.advance()
        #expect(log == ["began", "ended"])
        #expect(!holds.isHeld)
    }

    @Test func aHoldThatComesBackWithinTheGraceKeepsEverythingRunning() {
        let scheduler = FakeScheduler()
        var log: [String] = []
        let holds = LiveHolds(
            graceMilliseconds: 2_000, scheduler: scheduler, began: { log.append("began") },
            ended: { log.append("ended") })
        holds.retain()
        holds.release()
        holds.retain()
        scheduler.advance()
        #expect(log == ["began"])
        #expect(holds.isHeld)
        holds.release()
        scheduler.advance()
        #expect(log == ["began", "ended"])
    }
}
