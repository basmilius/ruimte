import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// What a row of a project's list wears beside its name, the marks the desktop's sidebar rows carry.
struct ProjectRowMarks: Equatable {
    /// The heaviest status of what the row holds: a canvas speaks for its nodes.
    var status: AgentStatus?
    /// Its own turn ended while work it started still runs.
    var delegating = false
    var unseen = false
    /// A chat with something typed on this phone and never sent.
    var draft = false
    /// The machine warns about the processes of this row.
    var warning = false
    /// It lives in the file a team commits.
    var shared = false
    var snoozedUntil: Date?

    var needsYou: Bool { status == .needsYou && snoozedUntil == nil }
    var working: Bool { !needsYou && (status == .running || delegating) }
}

/// Everything the marks of one project's rows are read from.
struct ProjectMarkSources {
    var statuses: [String: AgentStatus] = [:]
    var unseen: Set<String> = []
    var delegating: Set<String> = []
    var drafts: Set<String> = []
    var warnings: Set<String> = []
    var shared: Set<String> = []
    var snoozes: [String: Date] = [:]
}

/// What a long press on a row offers, in the order the menu holds it.
enum ProjectRowAction: Hashable {
    case rename, icon, settings, fork, snooze, stopTurn, delete
}

enum ProjectListLogic {
    private static let weight: [AgentStatus: Int] = [.needsYou: 3, .error: 2, .exited: 2, .running: 1, .idle: 0]

    /// The nodes a canvas lists under it. Groups, notes and drawings are frames and paper; the list is about what runs.
    static func nodes(of view: JSONValue) -> [JSONValue] {
        guard view.text("kind") == "canvas" else { return [] }
        return view.list("nodes").filter { ["terminal", "chat", "browser", "device"].contains($0.text("kind")) }
    }

    static func heaviest(_ statuses: [AgentStatus?]) -> AgentStatus? {
        statuses.compactMap { $0 }.max { weight[$0, default: 0] < weight[$1, default: 0] }
    }

    static func marks(view: JSONValue, sources: ProjectMarkSources) -> ProjectRowMarks {
        let id = view.stableID
        let nodes = nodes(of: view)
        guard !nodes.isEmpty else {
            var marks = marks(node: view, sources: sources)
            marks.shared = sources.shared.contains(id)
            return marks
        }
        let ids = nodes.map(\.stableID)
        // A canvas keeps the draft dot and the snooze on the row of the node itself.
        let waking = ids.filter { sources.snoozes[$0] == nil }
        return ProjectRowMarks(
            status: heaviest(waking.map { sources.statuses[$0] }),
            delegating: ids.contains { sources.delegating.contains($0) },
            unseen: ids.contains { sources.unseen.contains($0) },
            warning: sources.warnings.contains(id) || ids.contains { sources.warnings.contains($0) },
            shared: sources.shared.contains(id))
    }

    static func marks(node: JSONValue, sources: ProjectMarkSources) -> ProjectRowMarks {
        let id = node.stableID
        return ProjectRowMarks(
            status: sources.statuses[id], delegating: sources.delegating.contains(id),
            unseen: sources.unseen.contains(id),
            draft: node.text("kind") == "chat" && sources.drafts.contains(id),
            warning: sources.warnings.contains(id), snoozedUntil: sources.snoozes[id])
    }

    /// The actions a view offers; a node of a canvas only offers what acts on its session.
    static func actions(for item: JSONValue, isView: Bool, status: AgentStatus?) -> [ProjectRowAction] {
        let kind = item.text("kind")
        var actions: [ProjectRowAction] = []
        if isView && kind != "unknown" { actions += [.rename, .icon, .settings] }
        if kind == "chat" && ChatForking.forkable(provider: provider(of: item)) { actions.append(.fork) }
        if kind == "chat" || kind == "terminal" { actions.append(.snooze) }
        if kind == "chat" && status == .running { actions.append(.stopTurn) }
        if isView { actions.append(.delete) }
        return actions
    }

    /// The CLI a chat runs: on a view it sits in its node, on a canvas node on the node itself.
    static func provider(of item: JSONValue) -> String {
        item["node"]?["provider"]?.stringValue ?? item["provider"]?.stringValue ?? ""
    }

    /// The chats of the project, views and nodes, which are the rows that can carry a draft.
    static func chatIDs(_ views: [JSONValue]) -> [String] {
        views.flatMap { [$0] + nodes(of: $0) }.filter { $0.text("kind") == "chat" }.map(\.stableID)
    }
}

/// The part of a project's list that lives on this phone: which canvases are folded, which chats hold a draft, and
/// which nodes the machine warns about.
@MainActor @Observable
final class ProjectListState {
    private(set) var collapsed: Set<String>
    private(set) var drafts: Set<String> = []
    private(set) var warnings: Set<String> = []
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let key: String
    @ObservationIgnored private var stops: [() -> Void] = []
    @ObservationIgnored private var client: (any MachineRequesting)?

    init(machineID: String, projectID: String, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        key = "ruimte.ios.collapsed.\(machineID).\(projectID)"
        collapsed = Set(defaults.stringArray(forKey: key) ?? [])
    }

    func isExpanded(_ id: String) -> Bool { !collapsed.contains(id) }

    func toggle(_ id: String) {
        if collapsed.contains(id) { collapsed.remove(id) } else { collapsed.insert(id) }
        defaults.set(collapsed.sorted(), forKey: key)
    }

    /// Reads which chats hold a draft on this phone; the composer writes one as it is typed.
    func readDrafts(machineID: String, chatIDs: [String]) {
        drafts = Set(
            chatIDs.filter { id in
                guard let record = try? ChatDraftFiles(machineID: machineID, chatID: id).read() else { return false }
                return !record.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !record.uploads.isEmpty
            })
    }

    /// Follows the machine's process warnings, which it pushes to every client whether or not it watches processes.
    func watchWarnings(_ client: any MachineRequesting) {
        guard stops.isEmpty else { return }
        self.client = client
        stops.append(
            client.subscribe("processes.alerts") { [weak self] payload in self?.receive(payload) })
        stops.append(
            client.observeConnection { [weak self] connected in
                guard connected else { return }
                Task { await self?.readWarnings() }
            })
    }

    func stopWatching() {
        stops.forEach { $0() }
        stops.removeAll()
        client = nil
    }

    private func readWarnings() async {
        // A machine from before the warnings simply has none.
        guard let client, let result = try? await client.request("processes.listAlerts", payload: .object([:])) else {
            return
        }
        receive(result)
    }

    private func receive(_ payload: JSONValue) {
        warnings = Set(payload.list("alerts").compactMap { $0["nodeId"]?.stringValue })
    }
}
