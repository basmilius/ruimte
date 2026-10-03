import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor final class SnoozeTests: XCTestCase {
    private var domain = ""
    private var defaults: UserDefaults!
    private var now = Date(timeIntervalSince1970: 1_000_000)

    override func setUp() async throws {
        domain = "SnoozeTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: domain)
    }

    override func tearDown() async throws {
        UserDefaults().removePersistentDomain(forName: domain)
    }

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Amsterdam")!
        return calendar
    }

    private func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    private func milliseconds(_ date: Date) -> Double { MachineSnoozes.milliseconds(date) }

    /// Lets the work a change or a fresh link starts run to its end; the fake machine never waits.
    private func settle() async {
        for _ in 0..<20 { await Task.yield() }
    }

    func testTheChoicesEndAfterTenMinutesAnHourAndAtTheNextNineOClock() {
        let evening = date(3, 21, 30)
        XCTAssertEqual(SnoozeChoice.tenMinutes.until(from: evening, calendar: calendar), date(3, 21, 40))
        XCTAssertEqual(SnoozeChoice.hour.until(from: evening, calendar: calendar), date(3, 22, 30))
        XCTAssertEqual(SnoozeChoice.tomorrow.until(from: evening, calendar: calendar), date(4, 9))
        XCTAssertEqual(SnoozeChoice.tomorrow.until(from: date(4, 2), calendar: calendar), date(4, 9))
        XCTAssertEqual(SnoozeChoice.tomorrow.until(from: date(4, 9), calendar: calendar), date(5, 9))
        // The night the clocks go back still wakes at nine on the wall.
        XCTAssertEqual(SnoozeChoice.tomorrow.until(from: date(24, 23), calendar: calendar), date(25, 9))
    }

    func testWhatStandsIsTheMachinesListWithThisPhonesChangesOverItUntilTheyRunOut() {
        var book = SnoozeBook()
        book.receive(["a": 2000, "b": 3000])
        book.snooze("c", until: 4000)
        book.clear("a")
        XCTAssertEqual(book.standing(at: 1000), ["b": 3000, "c": 4000])
        XCTAssertEqual(book.nextWake(after: 1000), 3000)
        XCTAssertEqual(book.standing(at: 3000), ["c": 4000])
        book.prune(at: 3500)
        XCTAssertEqual(book.listed, [:])
        XCTAssertEqual(book.outbox, ["c": .set(until: 4000), "a": .clear])
    }

    func testASnoozeThatRanOutWhileOfflineIsNeverSent() {
        var book = SnoozeBook()
        book.snooze("a", until: 2000)
        book.snooze("b", until: 5000)
        book.clear("c")
        let due = book.due(at: 3000)
        XCTAssertEqual(due.map(\.node), ["b", "c"])
        XCTAssertNil(book.outbox["a"])
    }

    func testANewerChangeStaysQueuedWhenAnOlderOneIsDelivered() {
        var book = SnoozeBook()
        book.snooze("a", until: 2000)
        book.snooze("a", until: 9000)
        book.delivered("a", .set(until: 2000))
        XCTAssertEqual(book.outbox["a"], .set(until: 9000))
        book.delivered("a", .set(until: 9000))
        XCTAssertTrue(book.outbox.isEmpty)
        XCTAssertEqual(book.listed["a"], 9000)
    }

    func testAMachineWithoutSnoozesHasThemKeptHereAndAnUpdatedOneGetsThemOnce() {
        var book = SnoozeBook()
        book.snooze("a", until: 5000)
        book.machineKeepsNone()
        XCTAssertTrue(book.keepsNone)
        XCTAssertEqual(book.kept, ["a": 5000])
        book.snooze("b", until: 6000)
        XCTAssertEqual(book.standing(at: 1000), ["a": 5000, "b": 6000])
        XCTAssertTrue(book.outbox.isEmpty)

        book.receive(["b": 7000])
        XCTAssertFalse(book.keepsNone)
        XCTAssertEqual(book.outbox, ["a": .set(until: 5000)])
        XCTAssertEqual(book.standing(at: 1000), ["a": 5000, "b": 7000])
    }

    func testAKeptSnoozeEndsOnlyOnceItsNodeWasSeenWaitingAndStopped() {
        var book = SnoozeBook()
        book.machineKeepsNone()
        book.snooze("a", until: 5000)
        book.observe("a", needsYou: false)
        XCTAssertEqual(book.kept["a"], 5000)
        book.observe("a", needsYou: true)
        book.observe("a", needsYou: false)
        XCTAssertNil(book.kept["a"])
    }

    func testASnoozeSetOfflineGoesOutOnceTheLinkIsBack() async {
        let machine = SnoozeMachine()
        let snoozes = MachineSnoozes(machineID: "mac", client: machine, defaults: defaults) { [unowned self] in now }
        snoozes.start()
        let until = now.addingTimeInterval(600)
        snoozes.snooze("chat-a", until: until)
        await settle()
        XCTAssertTrue(machine.sent.isEmpty)
        XCTAssertEqual(snoozes.until("chat-a"), until)

        let restored = MachineSnoozes(machineID: "mac", client: SnoozeMachine(), defaults: defaults) { [unowned self] in
            now
        }
        XCTAssertEqual(restored.book.outbox, ["chat-a": .set(until: milliseconds(until))])

        machine.connect()
        await settle()
        XCTAssertEqual(machine.sent.map(\.0), ["snooze.list", "snooze.set"])
        XCTAssertEqual(machine.sent.last?.1["until"], .number(milliseconds(until)))
        XCTAssertTrue(snoozes.book.outbox.isEmpty)
        XCTAssertEqual(snoozes.until("chat-a"), until)
        snoozes.stop()
    }

    func testAnOfflineSnoozeThatRanOutStaysHome() async {
        let machine = SnoozeMachine()
        let snoozes = MachineSnoozes(machineID: "mac", client: machine, defaults: defaults) { [unowned self] in now }
        snoozes.start()
        snoozes.snooze("chat-a", until: now.addingTimeInterval(600))
        now = now.addingTimeInterval(601)
        XCTAssertNil(snoozes.until("chat-a"))
        machine.connect()
        await settle()
        XCTAssertEqual(machine.sent.map(\.0), ["snooze.list"])
        snoozes.stop()
    }

    func testAnOlderMachineLeavesTheSnoozeOnThisPhoneForThatMachineAlone() async {
        let machine = SnoozeMachine()
        machine.knowsSnoozes = false
        machine.connect()
        let snoozes = MachineSnoozes(machineID: "old", client: machine, defaults: defaults) { [unowned self] in now }
        snoozes.start()
        await settle()
        XCTAssertTrue(snoozes.book.keepsNone)
        let until = now.addingTimeInterval(3600)
        snoozes.snooze("term", until: until)
        await settle()
        XCTAssertEqual(machine.sent.map(\.0), ["snooze.list"])
        XCTAssertEqual(snoozes.until("term"), until)

        let other = MachineSnoozes(machineID: "new", client: SnoozeMachine(), defaults: defaults) { [unowned self] in now }
        XCTAssertNil(other.until("term"))
        snoozes.stop()
    }

    func testTheMachinesListAndItsChangesReplaceWhatItHolds() async {
        let machine = SnoozeMachine()
        machine.listed = [("a", milliseconds(now) + 5000)]
        machine.connect()
        let snoozes = MachineSnoozes(machineID: "mac", client: machine, defaults: defaults) { [unowned self] in now }
        snoozes.start()
        await settle()
        XCTAssertEqual(snoozes.standing.keys.sorted(), ["a"])
        machine.emit([("b", milliseconds(now) + 5000)])
        XCTAssertEqual(snoozes.standing.keys.sorted(), ["b"])
        snoozes.clear("b")
        await settle()
        XCTAssertEqual(machine.sent.last?.0, "snooze.clear")
        XCTAssertTrue(snoozes.standing.isEmpty)
        snoozes.stop()
    }
}

@MainActor private final class SnoozeMachine: MachineRequesting {
    var sent: [(String, JSONValue)] = []
    var listed: [(String, Double)] = []
    var knowsSnoozes = true
    private var connected = false
    private var observers: [@MainActor @Sendable (Bool) -> Void] = []
    private var changed: (@MainActor @Sendable (JSONValue) -> Void)?

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        guard connected else { throw MachineClientError.disconnected }
        sent.append((type, payload))
        guard knowsSnoozes else { throw MachineClientError.server(code: "unknown-request", message: type) }
        if type == "snooze.list" { return Self.list(listed) }
        return .object([:])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        if event == "snooze.changed" { changed = handler }
        return {}
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        observers.append(handler)
        handler(connected)
        return {}
    }

    func connect() {
        connected = true
        observers.forEach { $0(true) }
    }

    func emit(_ snoozes: [(String, Double)]) { changed?(Self.list(snoozes)) }

    private static func list(_ snoozes: [(String, Double)]) -> JSONValue {
        .object([
            "snoozes": .array(
                snoozes.map {
                    .object(["projectId": .string("p"), "nodeId": .string($0.0), "until": .number($0.1)])
                })
        ])
    }
}
