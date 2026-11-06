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
        defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: domain)
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

    func testASnoozeAnEarlierBookKeptForTheMachineGoesOverOnceAsAChange() throws {
        let stored =
            #"{"listed":{"a":9000},"outbox":{"c":{"clear":{}}},"kept":{"b":5000,"c":6000},"keepsNone":true,"waiting":["b"]}"#
        let book = try JSONDecoder().decode(SnoozeBook.self, from: Data(stored.utf8))
        XCTAssertEqual(book.outbox, ["b": .set(until: 5000), "c": .clear])
        XCTAssertEqual(book.standing(at: 1000), ["a": 9000, "b": 5000])
        let saved = try JSONEncoder().encode(book)
        XCTAssertFalse(String(decoding: saved, as: UTF8.self).contains("kept"))
        XCTAssertEqual(try JSONDecoder().decode(SnoozeBook.self, from: saved), book)
    }

    func testASnoozeSetOfflineGoesOutOnceTheLinkIsBack() async {
        let machine = SnoozeMachine()
        let snoozes = MachineSnoozes(machineID: "mac", client: machine, defaults: defaults) { [unowned self] in now }
        snoozes.start()
        let until = now.addingTimeInterval(600)
        let offline = NativeTaskDrain { snoozes.snooze("chat-a", until: until) }
        snoozes.stop()
        await offline.finish()
        snoozes.start()
        XCTAssertTrue(machine.sent.isEmpty)
        XCTAssertEqual(snoozes.until("chat-a"), until)

        let restored = MachineSnoozes(machineID: "mac", client: SnoozeMachine(), defaults: defaults) { [unowned self] in
            now
        }
        XCTAssertEqual(restored.book.outbox, ["chat-a": .set(until: milliseconds(until))])

        machine.connect()
        await waitForNativeState { snoozes.book.outbox.isEmpty }
        XCTAssertEqual(machine.sent.map(\.0), [.snoozeList, .snoozeSet])
        XCTAssertEqual(machine.sent.last?.1["until"], .number(milliseconds(until)))
        XCTAssertTrue(snoozes.book.outbox.isEmpty)
        XCTAssertEqual(snoozes.until("chat-a"), until)
        snoozes.stop()
    }

    func testAnOfflineSnoozeThatRanOutStaysHome() async {
        let machine = SnoozeMachine()
        let snoozes = MachineSnoozes(machineID: "mac", client: machine, defaults: defaults) { [unowned self] in now }
        snoozes.start()
        let offline = NativeTaskDrain { snoozes.snooze("chat-a", until: now.addingTimeInterval(600)) }
        snoozes.stop()
        await offline.finish()
        snoozes.start()
        now = now.addingTimeInterval(601)
        XCTAssertNil(snoozes.until("chat-a"))
        machine.listed = [("expired-on-machine", milliseconds(now) - 1)]
        machine.connect()
        await waitForNativeState { snoozes.book.listed["expired-on-machine"] != nil }
        XCTAssertEqual(machine.sent.map(\.0), [.snoozeList])
        snoozes.stop()
    }

    func testTheMachinesListAndItsChangesReplaceWhatItHolds() async {
        let machine = SnoozeMachine()
        machine.listed = [("a", milliseconds(now) + 5000)]
        machine.connect()
        let snoozes = MachineSnoozes(machineID: "mac", client: machine, defaults: defaults) { [unowned self] in now }
        snoozes.start()
        await waitForNativeState { snoozes.book.listed["a"] != nil }
        XCTAssertEqual(snoozes.standing.keys.sorted(), ["a"])
        machine.emit([("b", milliseconds(now) + 5000)])
        XCTAssertEqual(snoozes.standing.keys.sorted(), ["b"])
        snoozes.clear("b")
        await waitForNativeState { snoozes.book.outbox.isEmpty }
        XCTAssertEqual(machine.sent.last?.0, .snoozeClear)
        XCTAssertTrue(snoozes.standing.isEmpty)
        snoozes.stop()
    }
}

@MainActor private final class SnoozeMachine: MachineRequesting {
    var sent: [(WireRequest, JSONValue)] = []
    var listed: [(String, Double)] = []
    private var connected = false
    private var observers: [UUID: @MainActor @Sendable (Bool) -> Void] = [:]
    private var changed: (@MainActor @Sendable (JSONValue) -> Void)?

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        guard connected else { throw MachineClientError.disconnected }
        if type == .snoozeList { return Self.list(listed) }
        return .object([:])
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        if event == .snoozeChanged { changed = handler }
        return { [weak self] in self?.changed = nil }
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        let id = UUID()
        observers[id] = handler
        handler(connected)
        return { [weak self] in self?.observers[id] = nil }
    }

    func connect() {
        connected = true
        for observer in Array(observers.values) { observer(true) }
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
