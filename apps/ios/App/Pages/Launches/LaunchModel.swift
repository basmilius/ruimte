import Foundation
import RuimtePulsar

/// One launch of a project as the machine hands it over. `raw` keeps the entry whole, so a field a newer release
/// writes survives a save; every read goes through `config`.
struct LaunchEntry: Equatable, Identifiable {
    let raw: JSONValue
    let config: LaunchConfigEntry

    init(raw: JSONValue, config: LaunchConfigEntry) {
        self.raw = raw
        self.config = config
    }

    init(raw: JSONValue) throws {
        self.init(raw: raw, config: try raw.decoded(as: LaunchConfigEntry.self))
    }

    var id: String { config.id }
    var name: String { config.name }
    var kind: LaunchConfigKind { config.kind }
    var cwd: String? { config.cwd }
    var command: String? { config.command }
    var url: String? { config.url }
    var env: [String: String] { config.env ?? [:] }
    /// The launch ids a group starts, in order.
    var members: [String] { config.launches ?? [] }
    var autostart: Bool { config.autostart ?? false }
    var shared: Bool { config.shared }
    var overlay: LaunchConfigOverlay? { config.overlay }
    /// A shared launch this machine lays a folder or variables of its own over.
    var hasOverlay: Bool {
        guard let overlay else { return false }
        return overlay.cwd != nil || !(overlay.env ?? [:]).isEmpty
    }
    var isGroup: Bool { kind == .group }
}

extension LaunchStatus {
    var live: Bool { state != .exited }
    var exit: Int? { exitCode.map { Int($0) } }
    /// The port it waits on, or listens on once running.
    var listening: Int? { port.map { Int($0) } }
}

extension LaunchState {
    var phase: LaunchPhase {
        switch self {
        case .starting: .starting
        case .running: .running
        case .stopping: .stopping
        case .exited: .idle
        }
    }
}

/// The launches file as `launches.read` answers it, each launch kept whole beside its typed reading.
struct LaunchBook: Equatable {
    var rev = 0
    /// In the order of the menu.
    var launches: [LaunchEntry] = []
    /// The launches a person on this machine approved as they stand now; a group is approved when all it starts is.
    var approved: Set<String> = []

    func launch(_ id: String) -> LaunchEntry? { launches.first { $0.id == id } }
}

extension LaunchBook: Decodable {
    private struct Kept: Decodable {
        let launches: [JSONValue]
    }

    init(from decoder: any Decoder) throws {
        let wire = try LaunchesDocument(from: decoder)
        let kept = try Kept(from: decoder)
        self.init(
            rev: Int(wire.rev),
            launches: zip(kept.launches, wire.launches).map { LaunchEntry(raw: $0, config: $1) },
            approved: Set(wire.approved))
    }
}

/// `launches.changed`: one project's launches file changed.
struct LaunchesChanged: Decodable {
    let projectId: String
    let document: LaunchBook
}

/// What a launch looks like from here. A launch a person stopped, or a service that ended cleanly on its own, is at
/// rest again; only an exit that went wrong stays red until the next start.
enum LaunchPhase: String, Equatable {
    case idle, held, starting, running, stopping, passed, failed

    var label: String {
        switch self {
        case .idle: String(localized: "launch.phase.idle", defaultValue: "Idle", comment: "A launch that is not running")
        case .held: String(localized: "needs approval")
        case .starting: String(localized: "starting")
        case .running: String(localized: "Running")
        case .stopping: String(localized: "stopping")
        case .passed: String(localized: "passed", comment: "A task that ended successfully")
        case .failed: String(localized: "failed")
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

struct LaunchSection: Equatable, Identifiable {
    /// The checkout the launches run in; nil for the ones in the project folder itself, which go first.
    var label: String?
    var launches: [LaunchEntry]

    var id: String { label ?? "" }
}

/// One launch waiting on a person's approval before it may run here. Its variables are everything the approval covers,
/// since a change to those alone asks again.
extension LaunchHeld: Identifiable {
    public var id: String { launchId }
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
    static func views(document: LaunchBook, statuses: [String: LaunchStatus]) -> [String: LaunchView] {
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
        if status.kind == .task { return status.exitCode == 0 ? .passed : .failed }
        return status.exitCode == 0 ? .idle : .failed
    }

    private static func single(_ launch: LaunchEntry, status: LaunchStatus?, approved: Bool) -> LaunchView {
        if let status, status.live {
            return LaunchView(
                launch: launch, phase: status.state.phase, live: true, status: status, port: status.listening)
        }
        if !approved {
            return LaunchView(launch: launch, phase: .held, live: false, status: status, exitCode: status?.exit)
        }
        guard let status else { return LaunchView(launch: launch, phase: .idle, live: false) }
        return LaunchView(launch: launch, phase: ended(status), live: false, status: status, exitCode: status.exit)
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
        LaunchPath.cwd(launch.overlay?.cwd ?? launch.cwd, in: folder)
    }

    /// The launches grouped by the checkout they run in, the way the git page groups a folder of repositories. A group
    /// and a launch in the project folder itself come first under no heading; one checkout has no headings at all.
    static func sections(_ launches: [LaunchEntry], folder: String, repos: [GitRepo]) -> [LaunchSection] {
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

    /// The line under a launch's command in the list: its state, and the port it holds or when it ended. `now` is in
    /// milliseconds.
    static func stateLine(_ view: LaunchView, now: Double) -> String {
        let ago = { (ended: Double) in Format.ago(milliseconds: now - ended) }
        switch view.phase {
        case .held: return String(localized: "Needs approval")
        case .starting: return String(localized: "Starting…")
        case .stopping: return String(localized: "Stopping…")
        case .running:
            return ([String(localized: "Running")] + (view.port.map { [":\($0)"] } ?? [])).joined(separator: " · ")
        case .passed:
            return view.status?.endedAt.map {
                String(localized: "Passed \(ago($0))", comment: "%@ is a relative time, like 5 minutes ago")
            } ?? String(localized: "Passed", comment: "A task that ended successfully")
        case .failed:
            let code = view.status?.exit.map(String.init) ?? "?"
            return String(localized: "Failed · exit \(code)", comment: "%@ is the exit code of a process")
        case .idle:
            return view.status?.endedAt.map {
                String(localized: "Stopped \(ago($0))", comment: "%@ is a relative time, like 5 minutes ago")
            } ?? String(localized: "Not running")
        }
    }
}
