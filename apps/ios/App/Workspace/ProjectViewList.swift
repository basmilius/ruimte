import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

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
    /// Between turns, only commands or monitors it left running, which wake it once they end.
    var background: ProjectBackground?

    var needsYou: Bool { status == .needsYou && snoozedUntil == nil }
    var working: Bool { !needsYou && (status == .running || delegating) }
}

/// What a row between turns still runs, named by its oldest command or monitor.
struct ProjectBackground: Equatable {
    var shell: Bool
    var description: String
}

struct ProjectMarkSources {
    var statuses: [String: AgentStatus] = [:]
    var unseen: Set<String> = []
    var delegating: Set<String> = []
    /// What each chat runs in the background (`ChatInfo.background`).
    var background: [String: [ChatActivity.Background]] = [:]
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
    static func nodes(of view: ProjectItem) -> [ProjectItem] {
        guard view.kind == "canvas" else { return [] }
        return view.nodes.filter { ProjectKinds.runs($0.kind) }
    }

    static func heaviest(_ statuses: [AgentStatus?]) -> AgentStatus? {
        statuses.compactMap { $0 }.max { weight[$0, default: 0] < weight[$1, default: 0] }
    }

    static func marks(view: ProjectItem, sources: ProjectMarkSources) -> ProjectRowMarks {
        let id = view.id
        let nodes = nodes(of: view)
        guard !nodes.isEmpty else {
            var marks = marks(node: view, sources: sources)
            marks.shared = sources.shared.contains(id)
            return marks
        }
        let ids = nodes.map(\.id)
        // A canvas keeps the draft dot and the snooze on the row of the node itself.
        let waking = ids.filter { sources.snoozes[$0] == nil }
        return ProjectRowMarks(
            status: heaviest(waking.map { sources.statuses[$0] }),
            delegating: ids.contains { sources.delegating.contains($0) },
            unseen: ids.contains { sources.unseen.contains($0) },
            warning: sources.warnings.contains(id) || ids.contains { sources.warnings.contains($0) },
            shared: sources.shared.contains(id),
            background: waking.lazy.compactMap { background(of: $0, sources: sources) }.first)
    }

    static func marks(node: ProjectItem, sources: ProjectMarkSources) -> ProjectRowMarks {
        let id = node.id
        return ProjectRowMarks(
            status: sources.statuses[id], delegating: sources.delegating.contains(id),
            unseen: sources.unseen.contains(id),
            draft: node.kind == "chat" && sources.drafts.contains(id),
            warning: sources.warnings.contains(id), snoozedUntil: sources.snoozes[id],
            background: background(of: id, sources: sources))
    }

    static func backgroundLine(_ background: ProjectBackground) -> String {
        background.description.isEmpty
            ? String(localized: "A command it started still runs.")
            : String(localized: "\(background.description) still runs.", comment: "%@ is a command or monitor, such as Run the tests")
    }

    /// Only a chat between turns: a turn, sub-agents and a wait on a person each say more than a command left running.
    static func background(of id: String, sources: ProjectMarkSources) -> ProjectBackground? {
        guard sources.statuses[id] == .idle, !sources.delegating.contains(id),
            let tasks = sources.background[id], let oldest = tasks.min(by: { $0.startedAt < $1.startedAt })
        else { return nil }
        return ProjectBackground(shell: tasks.contains(where: \.shell), description: oldest.description)
    }

    /// The actions a view offers; a node of a canvas only offers what acts on its session.
    static func actions(for item: ProjectItem, isView: Bool, status: AgentStatus?, canFork: Bool) -> [ProjectRowAction] {
        let kind = item.kind
        var actions: [ProjectRowAction] = []
        if isView && kind != "unknown" { actions += [.rename, .icon, .settings] }
        if kind == "chat" && canFork { actions.append(.fork) }
        if kind == "chat" || kind == "terminal" { actions.append(.snooze) }
        if kind == "chat" && status == .running { actions.append(.stopTurn) }
        if isView { actions.append(.delete) }
        return actions
    }

    /// A view the list leaves out, as `isUnlistedView` in `packages/contracts` has it: a chat an extension draws or
    /// nobody wrote in yet, and a hidden chat or canvas (an inline edit, or the canvas another machine draws its nodes
    /// on). `emptyChatStays` keeps the empty chat that is open.
    static func isUnlisted(_ view: ProjectItem, emptyChatStays: Bool = false) -> Bool {
        let kind = view.kind
        guard kind == "chat" || kind == "canvas" else { return false }
        if view.hidden { return true }
        guard kind == "chat" else { return false }
        return view.drawnBy != nil || (view.empty && !emptyChatStays)
    }

    /// The CLI a chat runs: on a view it sits in its node, on a canvas node on the node itself.
    static func provider(of item: ProjectItem) -> String { item.provider ?? "" }

    static func chatIDs(_ views: [ProjectItem]) -> [String] {
        views.flatMap { [$0] + nodes(of: $0) }.filter { $0.kind == "chat" }.map(\.id)
    }
}

/// The part of a project's list that lives on this phone: which canvases are unfolded while the page shows, which
/// chats hold a draft, and which nodes the machine warns about.
@MainActor @Observable
final class ProjectListState {
    private(set) var expanded: Set<String> = []
    private(set) var drafts: Set<String> = []
    private(set) var warnings: Set<String> = []
    @ObservationIgnored private var live: LiveResource?

    func isExpanded(_ id: String) -> Bool { expanded.contains(id) }

    func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    func readDrafts(machineID: String, chatIDs: [String]) {
        drafts = Set(
            chatIDs.filter { id in
                guard let record = try? ChatDraftFiles(machineID: machineID, chatID: id).read() else { return false }
                return !record.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !record.uploads.isEmpty
            })
    }

    /// Follows the machine's process warnings, which it pushes to every client whether or not it watches processes.
    func watchWarnings(_ client: any MachineRequesting) {
        guard live == nil else { return }
        let live = LiveResource(
            client: client, events: [.apply(.processesAlerts, as: ProcessesAlerts.self) { [weak self] in self?.receive($0) }],
            read: { [weak self] in
                guard let list = try? await client.request(.processesListAlerts).decoded(as: ProcessesAlerts.self)
                else { return }
                self?.receive(list)
            })
        self.live = live
        live.start()
    }

    func stopWatching() {
        live?.stop()
        live = nil
    }

    private func receive(_ list: ProcessesAlerts) {
        warnings = Set(list.alerts.compactMap(\.nodeId))
    }
}
