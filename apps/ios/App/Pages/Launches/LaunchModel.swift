import Foundation
import RuimtePulsar

/// One launch of a project as the machine hands it over, kept whole so a field a newer release writes survives a save.
struct LaunchEntry: Equatable, Identifiable {
    var raw: JSONValue

    var id: String { raw.text("id") }
    var name: String { raw.text("name") }
    /// `service`, `task` or `group`.
    var kind: String { raw.text("kind", fallback: "service") }
    var cwd: String? { raw["cwd"]?.stringValue }
    var command: String? { raw["command"]?.stringValue }
    var url: String? { raw["url"]?.stringValue }
    var env: [String: String] { (raw["env"]?.objectValue ?? [:]).compactMapValues(\.stringValue) }
    /// The launch ids a group starts, in order.
    var members: [String] { raw.list("launches").compactMap(\.stringValue) }
    var autostart: Bool { raw["autostart"]?.boolValue == true }
    var shared: Bool { raw["shared"]?.boolValue == true }
    var overlay: JSONValue? { raw["overlay"] }
    /// A shared launch this machine lays a folder or variables of its own over.
    var hasOverlay: Bool {
        guard let overlay else { return false }
        return overlay["cwd"]?.stringValue != nil || !(overlay["env"]?.objectValue ?? [:]).isEmpty
    }
    var isGroup: Bool { kind == "group" }
}

/// A launch that ran on the machine since the daemon started; one that never ran has none.
struct LaunchStatus: Equatable {
    var projectID: String
    var launchID: String
    /// The terminal its output is in, which the phone attaches to like any session.
    var sessionID: String
    var kind: String
    /// `starting`, `running`, `stopping` or `exited`.
    var state: String
    var exitCode: Int?
    /// Milliseconds since the epoch.
    var startedAt: Double
    var endedAt: Double?
    var port: Int?
    var url: String?
    /// Stopped by a person or an agent rather than on its own.
    var stopped: Bool

    init(json: JSONValue) {
        projectID = json.text("projectId")
        launchID = json.text("launchId")
        sessionID = json.text("sessionId")
        kind = json.text("kind", fallback: "service")
        state = json.text("state", fallback: "exited")
        exitCode = json["exitCode"]?.numberValue.map { Int($0) }
        startedAt = json.number("startedAt")
        endedAt = json["endedAt"]?.numberValue
        port = json["port"]?.numberValue.map { Int($0) }
        url = json["url"]?.stringValue
        stopped = json["stopped"]?.boolValue ?? false
    }

    var live: Bool { state != "exited" }
}

struct LaunchesDocument: Equatable {
    var rev: Int
    /// In the order of the menu.
    var launches: [LaunchEntry]
    /// The launches a person on this machine approved as they stand now; a group is approved when all it starts is.
    var approved: Set<String>

    init(rev: Int = 0, launches: [LaunchEntry] = [], approved: Set<String> = []) {
        self.rev = rev
        self.launches = launches
        self.approved = approved
    }

    init(json: JSONValue) {
        rev = Int(json.number("rev"))
        launches = json.list("launches").map(LaunchEntry.init(raw:))
        approved = Set(json.list("approved").compactMap(\.stringValue))
    }

    func launch(_ id: String) -> LaunchEntry? { launches.first { $0.id == id } }
}

/// What a launch looks like from here. A launch a person stopped, or a service that ended cleanly on its own, is at
/// rest again; only an exit that went wrong stays red until the next start.
enum LaunchPhase: String, Equatable {
    case idle, held, starting, running, stopping, passed, failed

    var label: String {
        switch self {
        case .idle: "At rest"
        case .held: "needs approval"
        case .starting: "starting"
        case .running: "Running"
        case .stopping: "stopping"
        case .passed: "passed"
        case .failed: "failed"
        }
    }
}

struct LaunchView: Equatable {
    var launch: LaunchEntry
    var phase: LaunchPhase
    /// A process of it runs, or is being stopped.
    var live: Bool
    /// Its own status; a group has none and reads its members'.
    var status: LaunchStatus?
    var exitCode: Int?
    var port: Int?
}

/// A checkout of the project folder, as `git.repos` names it, which the launches list groups by.
struct LaunchRepo: Equatable {
    var path: String
    var label: String
    var name: String?
    var kind: String

    init(path: String, label: String, name: String? = nil, kind: String = "nested") {
        self.path = path
        self.label = label
        self.name = name
        self.kind = kind
    }

    init(json: JSONValue) {
        self.init(
            path: json.text("path"), label: json.text("label"), name: json["name"]?.stringValue,
            kind: json.text("kind", fallback: "nested"))
    }
}

struct LaunchSection: Equatable, Identifiable {
    /// The checkout the launches run in; nil for the ones in the project folder itself, which go first.
    var label: String?
    var launches: [LaunchEntry]

    var id: String { label ?? "" }
}

/// One launch waiting on a person's approval before it may run here.
struct LaunchHeld: Equatable, Identifiable {
    var launchID: String
    var command: String
    /// Absolute, where it would run.
    var cwd: String
    /// Every variable the approval covers, since a change to those alone asks again.
    var env: [String: String]

    var id: String { launchID }

    init(json: JSONValue) {
        launchID = json.text("launchId")
        command = json.text("command")
        cwd = json.text("cwd")
        env = (json["env"]?.objectValue ?? [:]).compactMapValues(\.stringValue)
    }
}

/// A start that came back with a question for the person who asked.
enum LaunchAsk: Equatable, Identifiable {
    case held(launchID: String, restart: Bool, held: [LaunchHeld], replace: Bool)
    case busy(launchID: String, restart: Bool, holder: String, port: Int, approve: Bool)

    var id: String {
        switch self {
        case .held(let launchID, _, _, _): "held:\(launchID)"
        case .busy(let launchID, _, _, _, _): "busy:\(launchID)"
        }
    }
}

enum LaunchLogic {
    static func views(document: LaunchesDocument, statuses: [String: LaunchStatus]) -> [String: LaunchView] {
        var views: [String: LaunchView] = [:]
        for launch in document.launches where !launch.isGroup {
            views[launch.id] = single(launch, status: statuses[launch.id], approved: document.approved.contains(launch.id))
        }
        for launch in document.launches where launch.isGroup {
            let members = launch.members.compactMap { views[$0] }
            views[launch.id] = group(launch, members: members, approved: document.approved.contains(launch.id))
        }
        return views
    }

    private static func ended(_ status: LaunchStatus) -> LaunchPhase {
        if status.stopped { return .idle }
        if status.kind == "task" { return status.exitCode == 0 ? .passed : .failed }
        return status.exitCode == 0 ? .idle : .failed
    }

    private static func single(_ launch: LaunchEntry, status: LaunchStatus?, approved: Bool) -> LaunchView {
        if let status, status.live {
            return LaunchView(
                launch: launch, phase: LaunchPhase(rawValue: status.state) ?? .running, live: true, status: status,
                port: status.port)
        }
        if !approved {
            return LaunchView(launch: launch, phase: .held, live: false, status: status, exitCode: status?.exitCode)
        }
        guard let status else { return LaunchView(launch: launch, phase: .idle, live: false) }
        return LaunchView(launch: launch, phase: ended(status), live: false, status: status, exitCode: status.exitCode)
    }

    /// A group runs while one of its members does; a failed member makes it red once none runs.
    private static func group(_ launch: LaunchEntry, members: [LaunchView], approved: Bool) -> LaunchView {
        let live = members.filter(\.live)
        if !live.isEmpty {
            let phase: LaunchPhase =
                live.contains { $0.phase == .starting }
                ? .starting : live.contains { $0.phase == .stopping } ? .stopping : .running
            return LaunchView(launch: launch, phase: phase, live: true)
        }
        if !approved { return LaunchView(launch: launch, phase: .held, live: false) }
        if let failed = members.first(where: { $0.phase == .failed }) {
            return LaunchView(launch: launch, phase: .failed, live: false, exitCode: failed.exitCode)
        }
        return LaunchView(launch: launch, phase: .idle, live: false)
    }

    /// The launch whose terminal shows for the one chosen. A group has no session of its own, so it shows a member:
    /// one that runs, else one that failed, else the first that ran at all.
    static func output(views: [String: LaunchView], launch: LaunchEntry) -> LaunchView? {
        guard launch.isGroup else { return views[launch.id] }
        let members = launch.members.compactMap { views[$0] }
        return members.first(where: \.live) ?? members.first { $0.phase == .failed }
            ?? members.first { $0.status != nil } ?? members.first
    }

    /// Whether a press on the launch starts it again rather than starting it: one of what it runs still runs.
    static func runs(_ launch: LaunchEntry, statuses: [String: LaunchStatus]) -> Bool {
        let ids = launch.isGroup ? launch.members : [launch.id]
        return ids.contains { statuses[$0]?.live == true }
    }

    private static func trimmingSlashes(_ path: String) -> String {
        var path = path
        while path.hasSuffix("/") { path.removeLast() }
        return path
    }

    /// Where a launch runs, absolute. A private overlay may name a folder of its own.
    static func folder(of launch: LaunchEntry, in folder: String) -> String {
        let cwd = (launch.overlay?["cwd"]?.stringValue ?? launch.cwd ?? "").trimmingCharacters(in: .whitespaces)
        if cwd.hasPrefix("/") { return trimmingSlashes(cwd) }
        var relative = cwd
        if relative.hasPrefix("./") {
            relative.removeFirst(2)
        } else if relative == "." {
            relative = ""
        }
        return relative.isEmpty ? trimmingSlashes(folder) : "\(trimmingSlashes(folder))/\(trimmingSlashes(relative))"
    }

    /// The launches grouped by the checkout they run in, the way the git page groups a folder of repositories. A group
    /// and a launch in the project folder itself come first under no heading; one checkout has no headings at all.
    static func sections(_ launches: [LaunchEntry], folder: String, repos: [LaunchRepo]) -> [LaunchSection] {
        let root = trimmingSlashes(folder)
        let inner = repos.filter { trimmingSlashes($0.path) != root }.sorted { $0.path.count > $1.path.count }
        var loose: [LaunchEntry] = []
        var byRepo: [String: [LaunchEntry]] = [:]
        for launch in launches {
            let at = launch.isGroup ? root : self.folder(of: launch, in: root)
            let repo = inner.first { candidate in
                let path = trimmingSlashes(candidate.path)
                return at == path || at.hasPrefix(path + "/")
            }
            if let repo { byRepo[repo.path, default: []].append(launch) } else { loose.append(launch) }
        }
        var sections: [LaunchSection] = []
        if !loose.isEmpty { sections.append(LaunchSection(label: nil, launches: loose)) }
        for repo in repos {
            if let found = byRepo[repo.path] { sections.append(LaunchSection(label: repo.name ?? repo.label, launches: found)) }
        }
        if sections.count == 1 { return [LaunchSection(label: nil, launches: sections[0].launches)] }
        return sections
    }

    /// An address as a person reads it in a row: the host and port, without the scheme.
    static func shortAddress(_ url: String) -> String {
        var text = url
        if let range = text.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*://", options: .regularExpression) {
            text.removeSubrange(range)
        }
        if text.hasSuffix("/") { text.removeLast() }
        return text
    }

    /// What a row says after the name: how long it runs and where, or how it ended. `now` is in milliseconds.
    /// The line under a launch's command in the list: its state, and the port it holds or when it ended.
    static func stateLine(_ view: LaunchView, now: Double) -> String {
        let ago: (Double) -> String = { ended in
            let formatter = RelativeDateTimeFormatter()
            formatter.unitsStyle = .full
            return now - ended < 60_000
                ? "just now"
                : formatter.localizedString(
                    for: Date(timeIntervalSince1970: ended / 1000), relativeTo: Date(timeIntervalSince1970: now / 1000))
        }
        switch view.phase {
        case .held: return "Needs approval"
        case .starting: return "Starting…"
        case .stopping: return "Stopping…"
        case .running: return (["Running"] + (view.port.map { [":\($0)"] } ?? [])).joined(separator: " · ")
        case .passed: return view.status?.endedAt.map { "Passed \(ago($0))" } ?? "Passed"
        case .failed: return "Failed · exit \(view.status?.exitCode.map(String.init) ?? "?")"
        case .idle: return view.status?.endedAt.map { "Stopped \(ago($0))" } ?? "Not running"
        }
    }

    static func detail(_ view: LaunchView, now: Double) -> String {
        if view.phase == .held { return LaunchPhase.held.label }
        guard let status = view.status else { return "" }
        let ran = ProcessesText.duration((status.endedAt ?? now) - status.startedAt)
        switch view.phase {
        case .starting, .stopping:
            return "\(view.phase.label) · \(ran)"
        case .running:
            return ([ran] + (view.port.map { [":\($0)"] } ?? [])).joined(separator: " · ")
        case .passed:
            return "passed · \(ran)"
        case .failed:
            return "exit \(status.exitCode.map(String.init) ?? "?") · \(ran)"
        default:
            guard let ended = status.endedAt else { return "" }
            return "stopped \(ProcessesText.duration(now - ended)) ago"
        }
    }
}
