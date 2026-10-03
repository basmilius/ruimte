import Foundation
import RuimtePulsar

/// A view of a project, or a node on one of its canvases, named by where it stands. A page opened from Now, Search or
/// a notification keeps the project this way, so it never shows a view without one.
struct ProjectViewTarget: Hashable, Identifiable {
    let machineID: String
    let projectID: String
    /// The row in the project's list: the view itself, or the canvas a node stands on.
    let viewID: String
    /// What opens, which is the view or the node.
    let itemID: String
    var id: String { "\(machineID):\(projectID):\(itemID)" }
}

/// What one machine's attention store holds, keyed by node id.
struct NowAttention: Equatable {
    var statuses: [String: AgentStatus] = [:]
    var unseen: Set<String> = []
    /// What each chat waits on, oldest first.
    var requests: [String: [NowRequest]] = [:]
    /// The CLI each waiting chat runs.
    var providers: [String: String] = [:]
    /// Nodes between turns that still have work out: sub-agents or a workflow of their CLI, or a task they gave
    /// another agent that is still open.
    var delegating: Set<String> = []
}

/// One machine as Now reads it: the open projects `project.sidebar` lists, and what its sessions are doing.
struct NowMachineInput {
    let machineID: String
    let machineName: String
    /// The entries of `project.sidebar`, each a summary with its views, or with null views when the file could not
    /// be read.
    let projects: [JSONValue]
    var attention = NowAttention()
    /// The snoozes that stand, by node id.
    var snoozes: [String: Date] = [:]
    /// The CLIs whose denial carries a message to the agent (`denyReason` in `provider.list`).
    var denyReason: Set<String> = []
}

/// A view or node of an open project, with what Now and Search show of it.
struct ProjectViewEntry: Identifiable, Hashable {
    let target: ProjectViewTarget
    let machineName: String
    let projectName: String
    let title: String
    let kind: String
    let iconName: String
    var status: AgentStatus?
    var unseen = false
    var requests: [NowRequest] = []
    /// Its own turn ended, but work it started still runs; the desktop draws such a node working, in gray.
    var delegating = false
    var snoozedUntil: Date?
    /// Whether a denial of this chat's approval can tell the agent why.
    var repliesWithMessage = false
    var id: String { target.id }
}

/// The sections of Now, in the order the design fixes: what waits on a person, what works, what ended unseen, and what
/// waits but was put aside.
struct NowBoard: Equatable {
    var needsYou: [ProjectViewEntry] = []
    var working: [ProjectViewEntry] = []
    var finished: [ProjectViewEntry] = []
    /// Waiting nodes snoozed until a moment, the first to wake first.
    var snoozed: [ProjectViewEntry] = []
    /// Rows name their machine only once the work spans more than one.
    var namesMachines = false

    var isEmpty: Bool { needsYou.isEmpty && working.isEmpty && finished.isEmpty && snoozed.isEmpty }

    static func build(_ machines: [NowMachineInput]) -> NowBoard {
        var board = NowBoard()
        for entry in entries(machines) {
            if entry.status == .needsYou {
                if entry.snoozedUntil == nil {
                    board.needsYou.append(entry)
                } else {
                    board.snoozed.append(entry)
                }
            } else if entry.status == .running || entry.delegating {
                board.working.append(entry)
            } else if entry.unseen {
                board.finished.append(entry)
            }
        }
        board.snoozed.sort { ($0.snoozedUntil ?? .distantPast) < ($1.snoozedUntil ?? .distantPast) }
        let listed = board.needsYou + board.working + board.finished + board.snoozed
        board.namesMachines = Set(listed.map(\.target.machineID)).count > 1
        return board
    }

    /// Every view and session node of every open project, the project opened last first and each in its list order.
    static func entries(_ machines: [NowMachineInput]) -> [ProjectViewEntry] {
        let projects = machines.flatMap { machine in machine.projects.map { (machine, $0) } }
            .sorted { lhs, rhs in
                let left = lhs.1["summary"]?.number("lastOpenedAt") ?? 0
                let right = rhs.1["summary"]?.number("lastOpenedAt") ?? 0
                if left != right { return left > right }
                if lhs.0.machineName != rhs.0.machineName { return lhs.0.machineName < rhs.0.machineName }
                return lhs.1["summary"]?.text("projectId") ?? "" < rhs.1["summary"]?.text("projectId") ?? ""
            }
        var seen = Set<String>()
        var result: [ProjectViewEntry] = []
        for (machine, project) in projects {
            guard let summary = project["summary"], let views = project["views"]?.arrayValue else { continue }
            let projectID = summary.text("projectId")
            let projectName = NewChat.isChats(summary) ? "Chats" : summary.text("name", fallback: "Untitled project")
            for view in views where !isDivider(view) {
                let viewID = view.text("id")
                let rows = [view] + view.list("nodes")
                for row in rows {
                    let itemID = row.text("id")
                    guard !itemID.isEmpty, seen.insert("\(machine.machineID):\(itemID)").inserted else { continue }
                    let kind = row.text("kind")
                    let title = row.text("name", fallback: row.text("title"))
                    result.append(
                        ProjectViewEntry(
                            target: ProjectViewTarget(
                                machineID: machine.machineID, projectID: projectID, viewID: viewID, itemID: itemID),
                            machineName: machine.machineName, projectName: projectName,
                            title: title.isEmpty ? defaultTitle(kind) : title, kind: kind,
                            iconName: WorkspaceViewIcon.name(for: row),
                            status: machine.attention.statuses[itemID],
                            unseen: machine.attention.unseen.contains(itemID),
                            requests: machine.attention.requests[itemID] ?? [],
                            delegating: Self.delegates(machine.attention, itemID),
                            snoozedUntil: machine.snoozes[itemID],
                            repliesWithMessage: machine.attention.providers[itemID].map {
                                machine.denyReason.contains($0)
                            } ?? false))
                }
            }
        }
        return result
    }

    /// Waiting on a person outranks the work a node left running, as on the desktop, and so does an error.
    private static func delegates(_ attention: NowAttention, _ id: String) -> Bool {
        let status = attention.statuses[id]
        return (status == nil || status == .idle) && attention.delegating.contains(id)
    }

    /// The project and list row that hold a node, from a machine's `project.sidebar` entries.
    static func locate(_ itemID: String, machineID: String, in projects: [JSONValue]) -> ProjectViewTarget? {
        guard !itemID.isEmpty else { return nil }
        for project in projects {
            guard let projectID = project["summary"]?.text("projectId"), let views = project["views"]?.arrayValue
            else { continue }
            for view in views where view.text("id") == itemID || view.list("nodes").contains(where: {
                $0.text("id") == itemID
            }) {
                return ProjectViewTarget(
                    machineID: machineID, projectID: projectID, viewID: view.text("id"), itemID: itemID)
            }
        }
        return nil
    }

    private static func isDivider(_ view: JSONValue) -> Bool {
        ["separator", "subheader"].contains(view.text("kind"))
    }

    private static func defaultTitle(_ kind: String) -> String {
        switch kind {
        case "chat": "Chat"
        case "terminal": "Terminal"
        case "browser": "Browser"
        case "device": "Device"
        default: kind.capitalized
        }
    }
}

/// The placeholder for the command palette: views and projects whose name holds the query.
enum ViewSearch {
    static func views(_ entries: [ProjectViewEntry], query: String) -> [ProjectViewEntry] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        return entries.filter {
            $0.title.localizedCaseInsensitiveContains(query) || $0.projectName.localizedCaseInsensitiveContains(query)
        }
    }

    static func projects(_ rows: [UnifiedProjectRow], query: String) -> [UnifiedProjectRow] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        return rows.filter { $0.matches(query) }
    }
}
