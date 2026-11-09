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

/// What a view's page draws while its project opens: its row for the title and the bar, and the project's name.
struct ProjectViewPreview {
    let item: JSONValue
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
    /// By parent id, a child agent of an open task that waits on a person or stopped on a limit.
    var waitingChildren: [String: String] = [:]
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
    /// A child agent it gave a task that waits on a person or on a limit; its own status stays as it is.
    var waitingChild: String?
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

    /// Whether it waits on a person through a child agent. A child that stands on Now itself already does, so the
    /// parent is not counted a second time; `waiting` holds `machineID:itemID` of what waits by its own status.
    func waitsOnChild(besides waiting: Set<String>) -> Bool {
        guard status != .needsYou, let child = waitingChild else { return false }
        return !waiting.contains("\(target.machineID):\(child)")
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
            item.entry.next.map { NowComingUp(subject: .routine(item), at: $0) }
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
        let all = entries(machines)
        let waiting = Set(all.filter { $0.status == .needsYou }.map { "\($0.target.machineID):\($0.target.itemID)" })
        for entry in all {
            if entry.status == .needsYou || entry.waitsOnChild(besides: waiting) {
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
            let projectName = Self.projectName(summary)
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
                            waitingChild: machine.attention.waitingChildren[itemID],
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

    /// The row a target opens and its project's name, as the machine's `project.sidebar` entries last told them.
    static func preview(_ target: ProjectViewTarget, in projects: [JSONValue]) -> ProjectViewPreview? {
        guard
            let project = projects.first(where: { $0["summary"]?.text("projectId") == target.projectID }),
            let summary = project["summary"],
            let view = project["views"]?.arrayValue?.first(where: { $0.text("id") == target.viewID }),
            let item = ([view] + view.list("nodes")).first(where: { $0.text("id") == target.itemID })
        else { return nil }
        return ProjectViewPreview(item: item, projectName: projectName(summary))
    }

    private static func projectName(_ summary: JSONValue) -> String {
        NewChat.isChats(summary)
            ? String(localized: "Chats", comment: "Name of the project that holds the chats outside any project")
            : summary.text("name", fallback: String(localized: "Untitled project"))
    }

    private static func isDivider(_ view: JSONValue) -> Bool {
        ["separator", "subheader"].contains(view.text("kind"))
    }

    private static func defaultTitle(_ kind: String) -> String {
        switch kind {
        case "chat": String(localized: "Chat")
        case "terminal": String(localized: "Terminal")
        case "browser": String(localized: "Browser")
        case "device": String(localized: "Device")
        default: kind.capitalized
        }
    }
}
