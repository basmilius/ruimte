import Foundation
import Observation
import RuimtePulsar
import RuimteShared
import RuimteTransport

/// The ways to put a node aside, in the order the desktop's snooze menu offers them.
enum SnoozeChoice: CaseIterable, Identifiable {
    case tenMinutes, hour, tomorrow

    var id: Self { self }

    var title: String {
        switch self {
        case .tenMinutes: String(localized: "10 minutes")
        case .hour: String(localized: "1 hour")
        case .tomorrow: String(localized: "Tomorrow")
        }
    }

    /// Tomorrow is the next 09:00 still ahead, so a snooze set at two in the night wakes the same morning. The phone
    /// works it out because the morning is where the person is.
    func until(from now: Date, calendar: Calendar = .current) -> Date {
        switch self {
        case .tenMinutes:
            return now.addingTimeInterval(10 * 60)
        case .hour:
            return now.addingTimeInterval(60 * 60)
        case .tomorrow:
            return calendar.nextDate(
                after: now, matching: DateComponents(hour: 9, minute: 0, second: 0), matchingPolicy: .nextTime)
                ?? now.addingTimeInterval(24 * 60 * 60)
        }
    }

    /// When a snooze ends, as a menu and a row say it: the time today, the day and time after.
    static func moment(_ date: Date, from now: Date) -> String {
        Format.isSameDay(date, now) ? Format.clock(date) : Format.weekdayClock(date)
    }
}

/// One machine's snoozes as this phone knows them: what the machine listed last, and what this phone changed that
/// the machine has not taken yet. Times are epoch milliseconds, as on the wire.
struct SnoozeBook: Codable, Equatable {
    enum Change: Codable, Equatable {
        case set(until: Double)
        case clear
    }

    var listed: [String: Double] = [:]
    var outbox: [String: Change] = [:]

    private enum CodingKeys: String, CodingKey {
        case listed, outbox
        /// Written by a book from before the machine kept every snooze; only read.
        case kept
    }

    init() {}

    /// The snoozes an earlier book kept for the phone alone go to the machine once, as changes it has not taken yet.
    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        listed = try container.decode([String: Double].self, forKey: .listed)
        outbox = try container.decode([String: Change].self, forKey: .outbox)
        let kept = try container.decodeIfPresent([String: Double].self, forKey: .kept) ?? [:]
        for (node, until) in kept where outbox[node] == nil {
            outbox[node] = .set(until: until)
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(listed, forKey: .listed)
        try container.encode(outbox, forKey: .outbox)
    }

    func standing(at now: Double) -> [String: Double] {
        var result = listed
        for (node, change) in outbox {
            switch change {
            case .set(let until): result[node] = until
            case .clear: result[node] = nil
            }
        }
        return result.filter { $0.value > now }
    }

    func nextWake(after now: Double) -> Double? { standing(at: now).values.min() }

    mutating func snooze(_ node: String, until: Double) {
        outbox[node] = .set(until: until)
    }

    mutating func clear(_ node: String) {
        outbox[node] = .clear
    }

    /// What goes to the machine now, oldest node first. A snooze that ran out while it waited for a connection is not
    /// sent at all.
    mutating func due(at now: Double) -> [(node: String, change: Change)] {
        dropLapsed(at: now)
        return outbox.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
    }

    /// The machine took a change. A newer change made meanwhile stays queued.
    mutating func delivered(_ node: String, _ change: Change) {
        guard outbox[node] == change else { return }
        outbox[node] = nil
        switch change {
        case .set(let until): listed[node] = until
        case .clear: listed[node] = nil
        }
    }

    /// The machine refused a change it will refuse again, such as a node that is gone.
    mutating func dropped(_ node: String, _ change: Change) {
        if outbox[node] == change { outbox[node] = nil }
    }

    mutating func receive(_ snoozes: [String: Double]) {
        listed = snoozes
    }

    mutating func prune(at now: Double) {
        listed = listed.filter { $0.value > now }
        dropLapsed(at: now)
    }

    /// A snooze that ended before it went out has nothing left to tell the machine.
    private mutating func dropLapsed(at now: Double) {
        outbox = outbox.filter { _, change in
            if case .set(let until) = change { return until > now }
            return true
        }
    }
}

/// The snoozes of one machine, read with `snooze.list` on every fresh link and `snooze.changed` after. A snooze set
/// without a connection waits on this phone and goes out once the link is back.
@MainActor @Observable
final class MachineSnoozes {
    private(set) var book: SnoozeBook
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let storageKey: String
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private lazy var live = LiveResource(
        client: client,
        events: [
            .apply(.snoozeChanged, raw: { [weak self] payload in
                self?.update { $0.receive(Self.parse(payload)) }
            })
        ],
        connection: { [weak self] connected in
            self?.connected = connected
            self?.generation += 1
        }, read: { [weak self] in await self?.synchronize() })
    @ObservationIgnored private var timer: Task<Void, Never>?
    @ObservationIgnored private var connected = false
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var flushing = false
    @ObservationIgnored private var flushAgain = false

    init(
        machineID: String, client: any MachineRequesting, defaults: UserDefaults = .standard,
        clock: @escaping () -> Date = Date.init
    ) {
        self.client = client
        self.defaults = defaults
        self.clock = clock
        storageKey = "ruimte.ios.snoozes.\(machineID)"
        book =
            defaults.data(forKey: storageKey).flatMap { try? JSONDecoder().decode(SnoozeBook.self, from: $0) }
            ?? SnoozeBook()
    }

    isolated deinit { stop() }

    var standing: [String: Date] {
        book.standing(at: Self.milliseconds(clock())).mapValues { Date(timeIntervalSince1970: $0 / 1000) }
    }

    func until(_ nodeID: String) -> Date? { standing[nodeID] }

    func start() {
        guard !live.isStarted else { return }
        live.start()
        arm()
    }

    func stop() {
        live.stop()
        timer?.cancel()
        timer = nil
        connected = false
        generation += 1
    }

    func snooze(_ nodeID: String, until: Date) {
        update { $0.snooze(nodeID, until: Self.milliseconds(until)) }
        Task { await flush() }
    }

    func clear(_ nodeID: String) {
        update { $0.clear(nodeID) }
        Task { await flush() }
    }

    func synchronize() async {
        let generation = generation
        do {
            let result = try await client.request(.snoozeList)
            guard generation == self.generation else { return }
            update { $0.receive(Self.parse(result)) }
        } catch {
            return
        }
        await flush()
    }

    /// Sends what waits, one change at a time. A link that goes keeps the rest for the next one.
    func flush() async {
        guard connected else { return }
        guard !flushing else {
            flushAgain = true
            return
        }
        flushing = true
        defer { flushing = false }
        repeat {
            flushAgain = false
            var due: [(node: String, change: SnoozeBook.Change)] = []
            update { due = $0.due(at: Self.milliseconds(clock())) }
            for (node, change) in due {
                guard connected else { return }
                do {
                    switch change {
                    case .set(let until):
                        _ = try await client.request(
                            .snoozeSet,
                            payload: .object(["nodeId": .string(node), "until": .number(until.rounded())]))
                    case .clear:
                        _ = try await client.request(
                            .snoozeClear, payload: .object(["nodeId": .string(node)]))
                    }
                    update { $0.delivered(node, change) }
                } catch MachineClientError.server {
                    update { $0.dropped(node, change) }
                } catch {
                    return
                }
            }
        } while flushAgain
    }

    private func update(_ change: (inout SnoozeBook) -> Void) {
        var next = book
        change(&next)
        guard next != book else { return }
        book = next
        if let data = try? JSONEncoder().encode(next) { defaults.set(data, forKey: storageKey) }
        arm()
    }

    /// Nothing else moves when a snooze runs out, so this takes it out on time. A timer asleep with the phone runs late
    /// by as long as it slept, so it reads the clock again at least every minute.
    private func arm() {
        timer?.cancel()
        timer = nil
        guard live.isStarted else { return }
        let now = Self.milliseconds(clock())
        guard let wake = book.nextWake(after: now) else { return }
        let delay = min(max(wake - now, 0) + 50, 60_000)
        timer = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(Int(delay))) } catch { return }
            guard let self else { return }
            update { $0.prune(at: Self.milliseconds(self.clock())) }
            arm()
        }
    }

    static func milliseconds(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }

    static func parse(_ payload: JSONValue) -> [String: Double] {
        Dictionary(
            payload.list("snoozes").compactMap { snooze in
                snooze["nodeId"]?.stringValue.map { ($0, snooze.number("until")) }
            }, uniquingKeysWith: { first, _ in first })
    }
}
