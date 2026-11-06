import Foundation
import RuimtePulsar

/// Every name the app counts in its anonymous daily usage, and nothing else: a fixed word for a screen it showed or a
/// thing a person did from the phone, never an id, a name, a path or text. Only what a machine cannot see itself, since
/// every machine counts its chats, turns, projects and clients already. `apps/ios/README.md` ("Usage statistics") has
/// the list in words.
enum UsageCounter: String, CaseIterable, Sendable {
    case screenNow = "screens.now"
    case screenProjects = "screens.projects"
    case screenRoutines = "screens.routines"
    case screenMachines = "screens.machines"
    case screenSearch = "screens.search"
    case screenProject = "screens.project"
    case screenCanvas = "screens.canvas"
    case screenChat = "screens.chat"
    case screenTerminal = "screens.terminal"
    case screenMachine = "screens.machine"
    case screenVoice = "screens.voice"
    case screenSettings = "screens.settings"
    case messageSent = "actions.messageSent"
    case approvalAnswered = "actions.approvalAnswered"
    case questionAnswered = "actions.questionAnswered"
    case chatStarted = "actions.chatStarted"
    case attachmentAdded = "actions.attachmentAdded"

    /// The counter of a request that answers a card, wherever on the phone it was answered.
    static func answering(_ request: WireRequest) -> UsageCounter? {
        switch request {
        case .chatApprove: .approvalAnswered
        case .chatAnswer: .questionAnswered
        default: nil
        }
    }
}

/// One UTC day as the phone keeps it until it is sent.
struct UsageDayRecord: Codable, Equatable {
    let date: String
    let version: String
    var signedIn: Bool
    let firstThisWeek: Bool
    let firstThisMonth: Bool
    var counts: [String: Int]
}

struct UsageState: Codable, Equatable {
    var version = 1
    /// The first day the phone counted, for the cohort.
    var firstDate: String?
    var lastWeek: String?
    var lastMonth: String?
    var days: [UsageDayRecord] = []
    /// `usageStats` of every machine of the account the phone heard from, by machine id.
    var machines: [String: Bool] = [:]
}

protocol UsageStore {
    func read() -> Data?
    func write(_ data: Data) throws
}

/// In the app's own container, where no extension reads.
struct FileUsageStore: UsageStore {
    let url: URL

    init(url: URL = URL.applicationSupportDirectory.appending(path: "usage/stats.json")) {
        self.url = url
    }

    func read() -> Data? { try? Data(contentsOf: url) }

    func write(_ data: Data) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

/// UTC days and ISO weeks, as `usageDateOf` and `isoWeekOf` in `packages/pulsar` write them.
enum UsageCalendar {
    private static let utc = TimeZone(identifier: "UTC")!

    private static let gregorian: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        return calendar
    }()

    private static let iso: Calendar = {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = utc
        return calendar
    }()

    static func date(of moment: Date) -> String {
        let parts = gregorian.dateComponents([.year, .month, .day], from: moment)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func moment(of date: String) -> Date? {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return gregorian.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func isoWeek(of date: String) -> String? {
        guard let moment = moment(of: date) else { return nil }
        let parts = iso.dateComponents([.yearForWeekOfYear, .weekOfYear], from: moment)
        guard let year = parts.yearForWeekOfYear, let week = parts.weekOfYear else { return nil }
        return String(format: "%04d-W%02d", year, week)
    }

    static func date(_ date: String, minusDays days: Int) -> String? {
        moment(of: date).flatMap { gregorian.date(byAdding: .day, value: -days, to: $0) }.map(self.date(of:))
    }
}

/// The phone's anonymous usage, counted per UTC day and written at most once a minute and when the app leaves the
/// screen. It keeps today and the days a batch may still carry, the first day it counted and the last week and month
/// it counted in, the way the desktop's counter does (`apps/desktop/src/usage.ts`).
@MainActor final class UsageDays {
    /// Today and every finished day a batch may still carry.
    static let keptDays = UsageIngest.maxDaysPerBatch + 1

    private let store: any UsageStore
    private let version: String
    private let release: Bool
    private let signedIn: @MainActor () -> Bool
    private let now: @MainActor () -> Date
    private let later: @MainActor (@escaping @MainActor () -> Void) -> Void
    private(set) var state = UsageState()
    private var pending = false
    private var lastScreen: UsageCounter?

    /// `release` is whether this build may count at all; `later` runs a write a minute on.
    init(
        store: any UsageStore, version: String, release: Bool, signedIn: @escaping @MainActor () -> Bool,
        now: @escaping @MainActor () -> Date = { Date() },
        later: @escaping @MainActor (@escaping @MainActor () -> Void) -> Void = UsageDays.inAMinute
    ) {
        self.store = store
        self.version = version
        self.release = release
        self.signedIn = signedIn
        self.now = now
        self.later = later
    }

    static func inAMinute(_ run: @escaping @MainActor () -> Void) {
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(60))
            run()
        }
    }

    /// Only a build that ships counts, only once the phone heard from a machine, and only while every machine it heard
    /// from has its switch on.
    nonisolated static func counts(release: Bool, machines: [String: Bool]) -> Bool {
        release && !machines.isEmpty && machines.values.allSatisfy { $0 }
    }

    var counting: Bool { Self.counts(release: release, machines: state.machines) }

    var firstDate: String? { state.firstDate }

    /// A file that does not read starts the counts over.
    func load() {
        guard let data = store.read(), let read = try? JSONDecoder().decode(UsageState.self, from: data),
            read.version == 1
        else { return }
        state = read
    }

    func count(_ counter: UsageCounter) {
        guard counting else { return }
        let date = today()
        guard let index = state.days.firstIndex(where: { $0.date == date }) else { return }
        state.days[index].counts[counter.rawValue, default: 0] += 1
        if signedIn() { state.days[index].signedIn = true }
        dirty()
    }

    /// A screen that shows again without another in between, as SwiftUI may tell twice, counts once.
    func screen(_ counter: UsageCounter) {
        guard counting, lastScreen != counter else { return }
        lastScreen = counter
        count(counter)
    }

    /// What a machine said of its switch, at every `endpoint.info` and `endpoint.changed`. Off drops every day not
    /// sent yet, as the machine's own counts do.
    func heard(machineID: String, usageStats: Bool) {
        guard state.machines[machineID] != usageStats else { return }
        state.machines[machineID] = usageStats
        if !usageStats { discardDays() }
        persist()
    }

    /// The machines still on the account; one that left no longer has a say.
    func keep(machineIDs: Set<String>) {
        let kept = state.machines.filter { machineIDs.contains($0.key) }
        guard kept != state.machines else { return }
        state.machines = kept
        persist()
    }

    /// The finished days still young enough to send, newest first; never today, which is still counting.
    func finished() -> [UsageDayRecord] {
        let today = UsageCalendar.date(of: now())
        let oldest = UsageCalendar.date(today, minusDays: UsageIngest.maxAgeDays) ?? today
        return state.days.filter { $0.date < today && $0.date >= oldest }.sorted { $0.date > $1.date }
    }

    func forget(_ dates: some Sequence<String>) {
        let gone = Set(dates)
        state.days.removeAll { gone.contains($0.date) }
        dirty()
    }

    /// The last week and month go with the days, so the day the switch is back on is a first of both again.
    private func discardDays() {
        state.days = []
        state.lastWeek = nil
        state.lastMonth = nil
    }

    func persist() {
        pending = false
        guard let data = try? JSONEncoder().encode(state) else { return }
        try? store.write(data)
    }

    private func dirty() {
        guard !pending else { return }
        pending = true
        later { [weak self] in
            guard let self, pending else { return }
            persist()
        }
    }

    /// Today's date, with its day made when it is the first count of it.
    private func today() -> String {
        let date = UsageCalendar.date(of: now())
        guard !state.days.contains(where: { $0.date == date }) else { return date }
        let week = UsageCalendar.isoWeek(of: date)
        let month = String(date.prefix(7))
        let day = UsageDayRecord(
            date: date, version: version, signedIn: false, firstThisWeek: week != state.lastWeek,
            firstThisMonth: month != state.lastMonth, counts: [:])
        if state.firstDate == nil { state.firstDate = date }
        state.lastWeek = week
        state.lastMonth = month
        let oldest = UsageCalendar.date(date, minusDays: Self.keptDays - 1) ?? date
        state.days = Array((state.days.filter { $0.date >= oldest && $0.date < date } + [day]).suffix(Self.keptDays))
        return date
    }
}
