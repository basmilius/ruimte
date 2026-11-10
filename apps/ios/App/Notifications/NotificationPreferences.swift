import Foundation
import RuimtePulsar

/// A kind of push a machine sends (`PushNotifyKindSchema`). A test holds the cases against
/// `WireVocabulary.pushNotifyKinds`.
enum PushNotifyKind: String, CaseIterable, Codable, Sendable {
    case needsYou = "needs-you"
    case turn
    case process
}

/// What one project hears of. `all` follows the kinds chosen for every project and is no entry on the wire.
enum ProjectNotifyChoice: String, CaseIterable, Codable, Sendable {
    case all, needsYou, off

    var label: String {
        switch self {
        case .all: String(localized: "All", comment: "Notifications of a project: everything chosen above")
        case .needsYou: String(localized: "Needs you only")
        case .off: String(localized: "Off", comment: "Notifications of a project: none")
        }
    }

    /// The kinds that replace the subscription's own for the project; nil leaves it on them.
    var kinds: [PushNotifyKind]? {
        switch self {
        case .all: nil
        case .needsYou: [.needsYou]
        case .off: []
        }
    }

    /// How a machine's entry for a project reads here. Kinds another client chose that are neither list read as
    /// all, since they reach the person on more than needs you.
    init(kinds: [String]) {
        let known = Set(kinds.compactMap(PushNotifyKind.init(rawValue:)))
        if known.isEmpty {
            self = kinds.isEmpty ? .off : .all
        } else {
            self = known == [.needsYou] ? .needsYou : .all
        }
    }
}

/// The hours in which this phone wants no alert (`QuietHoursSchema`). Every machine holds its alerts back in them and
/// announces what still waits when they end. Off to start with, and the days and times stay chosen while it is off.
struct QuietHours: Equatable, Codable, Sendable {
    var on = false
    /// ISO weekdays, 1 is Monday. A night belongs to the day it starts on.
    var days: Set<Int> = Set(1...7)
    /// Minutes past midnight. An end at or before the start runs into the next day.
    var start = 22 * 60
    var end = 7 * 60

    init(on: Bool = false, days: Set<Int> = Set(1...7), start: Int = 22 * 60, end: Int = 7 * 60) {
        self.on = on
        self.days = days
        self.start = start
        self.end = end
    }

    /// What a machine holds for this phone (`push.preferences`), as hours that are on; nil for anything that is no hours.
    init?(wire: JSONValue?) {
        guard let wire, let start = Self.minutes(wire["start"]?.stringValue), let end = Self.minutes(wire["end"]?.stringValue)
        else { return nil }
        let days = Set(
            (wire["days"]?.arrayValue ?? []).compactMap { entry -> Int? in
                guard case .number(let number) = entry, let day = Int(exactly: number), (1...7).contains(day) else { return nil }
                return day
            })
        guard !days.isEmpty else { return nil }
        self.init(on: true, days: days, start: start, end: end)
    }

    static func clock(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }

    private static func minutes(_ clock: String?) -> Int? {
        guard let clock else { return nil }
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, (0..<24).contains(parts[0]), (0..<60).contains(parts[1]) else { return nil }
        return parts[0] * 60 + parts[1]
    }

    func wire(timeZone: String) -> JSONValue {
        .object([
            "days": .array(days.sorted().map { .number(Double($0)) }),
            "start": .string(Self.clock(start)), "end": .string(Self.clock(end)),
            "timeZone": .string(timeZone),
        ])
    }
}

/// The kinds this phone wants to hear of and its choice per project, sent to every machine with `push.subscribe`.
/// A project is one machine's, so its choice is kept under that machine.
struct NotificationPreferences: Equatable, Codable, Sendable {
    var notify: Set<PushNotifyKind> = [.needsYou]
    /// Per machine and project id; a project left out is `all`.
    var projects: [String: [String: ProjectNotifyChoice]] = [:]
    /// Nil until a person looks at it, which reads as off.
    var quietHours: QuietHours?

    var quiet: QuietHours {
        get { quietHours ?? QuietHours() }
        set { quietHours = newValue }
    }

    static let storageKey = "ruimte.push.preferences"

    func choice(machineID: String, projectID: String) -> ProjectNotifyChoice {
        projects[machineID]?[projectID] ?? .all
    }

    mutating func set(_ choice: ProjectNotifyChoice, machineID: String, projectID: String) {
        var machine = projects[machineID] ?? [:]
        machine[projectID] = choice == .all ? nil : choice
        projects[machineID] = machine.isEmpty ? nil : machine
    }

    /// `notify`, `projects` and, while they are on, the `quietHours` of a `push.subscribe` to this machine, in a stable
    /// order. A machine from before quiet hours drops what it does not know and keeps pushing.
    func subscription(machineID: String, timeZone: String = TimeZone.current.identifier) -> [String: JSONValue] {
        let kinds = PushNotifyKind.allCases.filter(notify.contains).map { JSONValue.string($0.rawValue) }
        let entries = (projects[machineID] ?? [:]).sorted { $0.key < $1.key }.compactMap { projectID, choice in
            choice.kinds.map { kinds in
                JSONValue.object([
                    "projectId": .string(projectID), "notify": .array(kinds.map { .string($0.rawValue) }),
                ])
            }
        }
        var payload: [String: JSONValue] = ["notify": .array(kinds), "projects": .array(entries)]
        if let hours = quietHours, hours.on, !hours.days.isEmpty {
            payload["quietHours"] = hours.wire(timeZone: timeZone)
        }
        return payload
    }

    /// Takes what a machine applies (`push.preferences`) for its own projects and, when `kinds` is set, its kinds.
    mutating func adopt(_ result: JSONValue, machineID: String, kinds: Bool) {
        guard result["subscribed"] == .bool(true) else { return }
        if kinds, let words = result["notify"]?.arrayValue {
            notify = Set(words.compactMap { $0.stringValue.flatMap(PushNotifyKind.init(rawValue:)) })
            if let hours = QuietHours(wire: result["quietHours"]) { quietHours = hours }
        }
        var machine: [String: ProjectNotifyChoice] = [:]
        for entry in result.list("projects") {
            let projectID = entry.text("projectId")
            guard !projectID.isEmpty else { continue }
            let choice = ProjectNotifyChoice(kinds: entry.list("notify").compactMap(\.stringValue))
            if choice != .all { machine[projectID] = choice }
        }
        projects[machineID] = machine.isEmpty ? nil : machine
    }

    static func load(_ defaults: UserDefaults = .standard) -> NotificationPreferences? {
        defaults.data(forKey: storageKey).flatMap { try? JSONDecoder().decode(NotificationPreferences.self, from: $0) }
    }

    func save(_ defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.storageKey) }
    }
}
