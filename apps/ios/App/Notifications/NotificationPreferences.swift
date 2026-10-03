import Foundation
import RuimtePulsar

/// A kind of push a machine sends (`PushNotifyKindSchema`).
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
        case .all: "All"
        case .needsYou: "Needs you only"
        case .off: "Off"
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

/// The kinds this phone wants to hear of and its choice per project, sent to every machine with `push.subscribe`.
/// A project is one machine's, so its choice is kept under that machine.
struct NotificationPreferences: Equatable, Codable, Sendable {
    var notify: Set<PushNotifyKind> = [.needsYou]
    /// Per machine and project id; a project left out is `all`.
    var projects: [String: [String: ProjectNotifyChoice]] = [:]

    static let storageKey = "ruimte.push.preferences"

    func choice(machineID: String, projectID: String) -> ProjectNotifyChoice {
        projects[machineID]?[projectID] ?? .all
    }

    mutating func set(_ choice: ProjectNotifyChoice, machineID: String, projectID: String) {
        var machine = projects[machineID] ?? [:]
        machine[projectID] = choice == .all ? nil : choice
        projects[machineID] = machine.isEmpty ? nil : machine
    }

    /// `notify` and `projects` of a `push.subscribe` to this machine, in a stable order.
    func subscription(machineID: String) -> [String: JSONValue] {
        let kinds = PushNotifyKind.allCases.filter(notify.contains).map { JSONValue.string($0.rawValue) }
        let entries = (projects[machineID] ?? [:]).sorted { $0.key < $1.key }.compactMap { projectID, choice in
            choice.kinds.map { kinds in
                JSONValue.object([
                    "projectId": .string(projectID), "notify": .array(kinds.map { .string($0.rawValue) }),
                ])
            }
        }
        return ["notify": .array(kinds), "projects": .array(entries)]
    }

    /// Takes what a machine applies (`push.preferences`) for its own projects and, when `kinds` is set, its kinds.
    mutating func adopt(_ result: JSONValue, machineID: String, kinds: Bool) {
        guard result["subscribed"] == .bool(true) else { return }
        if kinds, let words = result["notify"]?.arrayValue {
            notify = Set(words.compactMap { $0.stringValue.flatMap(PushNotifyKind.init(rawValue:)) })
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
