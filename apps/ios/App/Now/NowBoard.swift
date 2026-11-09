import Foundation
import RuimtePulsar

/// A view of a project, or a node on one of its canvases, named by where it stands. A page opened from Now, Search or
/// a notification keeps the project this way, so it never shows a view without one.
struct ProjectViewTarget: Hashable, Identifiable {
    let machineID: String
    let projectID: String
    /// The row in the project's list: the view itself, or the canvas a node stands on.
    let viewID: String
    let itemID: String
    var id: String { "\(machineID):\(projectID):\(itemID)" }
}

/// What a view's page draws while its project opens: its row for the title and the bar, and the project's name.
struct ProjectViewPreview {
    let item: ProjectItem
    let projectName: String
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
    /// What chats have going beside their turn.
    var activity: [String: ChatActivity] = [:]
    /// When a session last stopped running, in epoch milliseconds.
    var finishedAt: [String: Double] = [:]
}

/// One machine as Now reads it: the open projects `project.sidebar` lists, and what its sessions are doing.
struct NowMachineInput {
    let machineID: String
    let machineName: String
    /// The entries of `project.sidebar`, each a summary with its views, or with null views when the file could not
    /// be read.
    let projects: [ProjectSidebarEntry]
    var attention = NowAttention()
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
    var activity = ChatActivity()
    /// When it last stopped running, in epoch milliseconds.
    var finishedAt: Double?
    var id: String { target.id }

    /// Where it stands: its project, and its machine once the work spans several.
    func place(namesMachine: Bool) -> String {
        namesMachine ? "\(projectName) · \(machineName)" : projectName
    }

    /// Since when its oldest request waits, in epoch milliseconds; nil without a request that says.
    var waitingSince: Double? { requests.map(\.createdAt).filter { $0 > 0 }.min() }

    /// The second line of a working row: what runs beside its turn where the machine says, then where it stands.
    /// The machine names no step of a turn itself, so a turn with nothing beside it reads as its place alone.
    func workingLine(namesMachine: Bool) -> String {
        var parts: [String] = []
        if activity.background.count == 1, let description = activity.background.first?.description,
            !description.isEmpty
        {
            parts.append(description)
        } else if !activity.background.isEmpty {
            parts.append(String(localized: "\(activity.background.count) in the background"))
        } else if delegating && status != .running {
            parts.append(String(localized: "Waiting on delegated work"))
        }
        if activity.queued > 0 {
            parts.append(
                String(localized: "\(activity.queued) queued", comment: "Messages queued for a chat's next turn"))
        }
        parts.append(place(namesMachine: namesMachine))
        return parts.joined(separator: " · ")
    }

    /// Since when the background work its working row names runs, in epoch milliseconds. Only that work carries its
    /// start; a turn does not, so a row without it shows no duration.
    var workingSince: Double? { activity.background.map(\.startedAt).filter { $0 > 0 }.min() }
}

/// One row of Coming up on Now: a snoozed node by when it wakes, or a routine by when it runs next.
struct NowComingUp: Identifiable, Equatable {
    enum Subject: Equatable {
        case snoozed(ProjectViewEntry)
        case routine(ScheduledItem)
    }

    let subject: Subject
    let at: Date

    var id: String {
        switch subject {
        case .snoozed(let entry): "snoozed:\(entry.id)"
        case .routine(let item): "routine:\(item.id)"
        }
    }

    /// Every snooze, and the first `routines` routines due before tomorrow noon, the soonest first. Later routines
    /// stay on Scheduled, so Now does not grow with every routine there is.
    static func build(snoozed: [ProjectViewEntry], scheduled: ScheduledBoard, routines: Int = 3) -> [NowComingUp] {
        let wakes = snoozed.compactMap { entry in
            entry.snoozedUntil.map { NowComingUp(subject: .snoozed(entry), at: $0) }
        }
        let runs = (scheduled.today + scheduled.overnight).prefix(routines).compactMap { item in
            item.entry.nextDate.map { NowComingUp(subject: .routine(item), at: $0) }
        }
        return (wakes + runs).sorted { $0.at < $1.at }
    }
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
                let left = lhs.1.summary.lastOpenedAt
                let right = rhs.1.summary.lastOpenedAt
                if left != right { return left > right }
                if lhs.0.machineName != rhs.0.machineName { return lhs.0.machineName < rhs.0.machineName }
                return lhs.1.summary.projectId < rhs.1.summary.projectId
            }
        var seen = Set<String>()
        var result: [ProjectViewEntry] = []
        for (machine, project) in projects {
            guard let views = project.views else { continue }
            let summary = project.summary
            let projectID = summary.projectId
            let projectName = Self.projectName(summary)
            for view in views where !view.isDivider {
                let viewID = view.id
                let rows = [view.row] + view.nodes.map(\.row)
                for row in rows {
                    let itemID = row.id
                    guard !itemID.isEmpty, seen.insert("\(machine.machineID):\(itemID)").inserted else { continue }
                    let kind = row.kind
                    let title = row.title
                    result.append(
                        ProjectViewEntry(
                            target: ProjectViewTarget(
                                machineID: machine.machineID, projectID: projectID, viewID: viewID, itemID: itemID),
                            machineName: machine.machineName, projectName: projectName,
                            title: title.isEmpty ? ProjectKinds.label(kind) : title, kind: kind,
                            iconName: WorkspaceViewIcon.name(kind: kind, chosen: row.icon),
                            status: machine.attention.statuses[itemID],
                            unseen: machine.attention.unseen.contains(itemID),
                            requests: machine.attention.requests[itemID] ?? [],
                            delegating: Self.delegates(machine.attention, itemID),
                            snoozedUntil: machine.snoozes[itemID],
                            repliesWithMessage: machine.attention.providers[itemID].map {
                                machine.denyReason.contains($0)
                            } ?? false,
                            activity: machine.attention.activity[itemID] ?? ChatActivity(),
                            finishedAt: machine.attention.finishedAt[itemID]))
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
    static func locate(_ itemID: String, machineID: String, in projects: [ProjectSidebarEntry]) -> ProjectViewTarget? {
        guard !itemID.isEmpty else { return nil }
        for project in projects {
            guard let views = project.views else { continue }
            for view in views where view.id == itemID || view.nodes.contains(where: { $0.id == itemID }) {
                return ProjectViewTarget(
                    machineID: machineID, projectID: project.summary.projectId, viewID: view.id, itemID: itemID)
            }
        }
        return nil
    }

    /// The row a target opens and its project's name, as the machine's `project.sidebar` entries last told them.
    static func preview(_ target: ProjectViewTarget, in projects: [ProjectSidebarEntry]) -> ProjectViewPreview? {
        guard
            let project = projects.first(where: { $0.summary.projectId == target.projectID }),
            let view = project.views?.first(where: { $0.id == target.viewID })
        else { return nil }
        let item =
            view.id == target.itemID
            ? ProjectItem(view) : view.nodes.first(where: { $0.id == target.itemID }).map(ProjectItem.init)
        guard let item else { return nil }
        return ProjectViewPreview(item: item, projectName: projectName(project.summary))
    }

    private static func projectName(_ summary: ProjectSummary) -> String {
        summary.isChats
            ? String(localized: "Chats", comment: "Name of the project that holds the chats outside any project")
            : summary.name
    }
}

/// What Now and Search show of a row in a project's list: a view, or a node on one of its canvases.
struct ProjectSidebarRow {
    let id: String
    let kind: String
    let title: String
    /// The symbol a person picked for a view; a node has none.
    let icon: String?
}

extension ProjectSidebarView {
    var isDivider: Bool { ProjectKinds.isDivider(kind.rawValue) }

    var row: ProjectSidebarRow {
        ProjectSidebarRow(id: id, kind: kind.rawValue, title: name, icon: icon?.value)
    }
}

extension ProjectSidebarNode {
    var row: ProjectSidebarRow {
        ProjectSidebarRow(id: id, kind: kind.rawValue, title: title, icon: nil)
    }
}
