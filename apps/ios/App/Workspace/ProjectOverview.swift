import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// How a machine is reached, as the heading over its projects says it.
enum MachineLinkState: Equatable {
    case connected(relayed: Bool)
    /// Not answered yet, and no try to reach it failed.
    case connecting
    case offline

    init(connected: Bool, route: LinkRoute?, failedAttempts: Int, problem: String?) {
        if connected {
            self = .connected(relayed: route == .relayed)
        } else if failedAttempts > 0 || problem != nil {
            self = .offline
        } else {
            self = .connecting
        }
    }
}

/// What the desktop counts beside a project's heading, read from its `project.sidebar` entry and the attention of
/// its machine.
struct ProjectActivity: Equatable {
    /// The views that stand in the list, dividers left out.
    var views = 0
    /// Of those, the chats, which is what the Chats project counts.
    var chats = 0
    /// Nodes waiting on a person that nobody snoozed.
    var needsYou = 0
    /// Nodes that run, or wait on work they started.
    var working = 0

    /// The state in words, as in "2 waiting · 1 working"; nil while nothing waits or works.
    var words: String? {
        let parts = [
            needsYou > 0
                ? String(localized: "\(needsYou) waiting", comment: "Views of a project that wait on you") : nil,
            working > 0 ? String(localized: "\(working) working", comment: "Views of a project that work") : nil,
        ]
        let line = parts.compactMap { $0 }.joined(separator: " · ")
        return line.isEmpty ? nil : line
    }
}

/// The branch a project's folder is on and what changed in it, from `git.status`.
struct ProjectGitLine: Equatable {
    /// Nil on a detached head.
    let branch: String?
    let changed: Int
    var added = 0
    var deleted = 0

    var branchName: String { branch ?? String(localized: "Detached", comment: "Git, a checkout that is on no branch") }

    /// The lines added and removed, as in "+126 −4"; nil while no line changed.
    var diff: String? {
        guard added + deleted > 0 else { return nil }
        return "+\(Format.number(Double(added))) \u{2212}\(Format.number(Double(deleted)))"
    }

    /// Nil while nothing changed.
    var changedText: String? {
        changed == 0 ? nil : String(localized: "\(changed) changed", comment: "Files changed in a git checkout")
    }
}

extension ProjectGitLine {
    /// Nil for a folder outside any repository, which has nothing to say about a branch.
    init?(status: GitStatus) {
        guard status.repo else { return nil }
        self.init(
            branch: status.branch, changed: status.files.count, added: Int(status.files.reduce(0) { $0 + $1.added }),
            deleted: Int(status.files.reduce(0) { $0 + $1.deleted }))
    }
}

struct ProjectOverviewRow: Identifiable {
    let row: UnifiedProjectRow
    var activity: ProjectActivity?
    var git: ProjectGitLine?
    var id: UnifiedProjectRow.ID { row.id }
    var isChats: Bool { NewChat.isChats(row.summary) }

    var title: String {
        isChats ? String(localized: "Chats") : row.summary.text("name", fallback: String(localized: "Untitled project"))
    }

    var accessibilityID: String {
        isChats ? "projects.chats.\(row.machine.id)" : "projects.project.\(id.projectID)"
    }

    /// The second line: the branch, then what waits and works, or what changed while nothing does. Without either it
    /// counts the views; for Chats it says how many chats it holds.
    var detail: String? {
        if isChats {
            guard let activity else { return String(localized: "Earlier chats") }
            return activity.chats == 0
                ? String(localized: "No chats yet") : String(localized: "\(activity.chats) chats")
        }
        let state = activity?.words ?? git?.diff
        if git?.branch == nil && state == nil {
            return activity.map { String(localized: "\($0.views) views") }
        }
        let line = [git?.branch, state].compactMap { $0 }.joined(separator: " · ")
        return line.isEmpty ? nil : line
    }
}

struct ProjectMachineGroup: Identifiable {
    let machine: Machine
    let reach: MachineLinkState
    var rows: [ProjectOverviewRow]
    var id: String { machine.id }
}

/// The open projects of every machine grouped under their machine, as the iPhone's Projects tab lists them.
enum ProjectOverview {
    static func activity(views: [JSONValue], attention: NowAttention, snoozed: Set<String>) -> ProjectActivity {
        var activity = ProjectActivity()
        for view in views where !WorkspaceViewSections.isDivider(view) {
            activity.views += 1
            if view.text("kind") == "chat" { activity.chats += 1 }
            for id in [view.text("id")] + view.list("nodes").map({ $0.text("id") }) where !id.isEmpty {
                let status = attention.statuses[id]
                if status == .needsYou && !snoozed.contains(id) { activity.needsYou += 1 }
                if status == .running || attention.delegating.contains(id) { activity.working += 1 }
            }
        }
        return activity
    }

    /// Per machine, the projects in the order they were opened and the machine's Chats after them. A machine goes
    /// first when one of its projects was opened last; a machine without any of these has no group.
    static func groups(
        open: [UnifiedProjectRow], chats: [UnifiedProjectRow], reach: (Machine) -> MachineLinkState,
        activity: (UnifiedProjectRow.ID) -> ProjectActivity?, git: (UnifiedProjectRow.ID) -> ProjectGitLine?
    ) -> [ProjectMachineGroup] {
        var order: [String] = []
        var groups: [String: ProjectMachineGroup] = [:]
        for row in open + chats {
            let overview = ProjectOverviewRow(row: row, activity: activity(row.id), git: git(row.id))
            if groups[row.machine.id] == nil {
                order.append(row.machine.id)
                groups[row.machine.id] = ProjectMachineGroup(machine: row.machine, reach: reach(row.machine), rows: [])
            }
            groups[row.machine.id]?.rows.append(overview)
        }
        return order.compactMap { groups[$0] }
    }
}

/// The branch line of each open project, asked with `git.status` of its folder. Nothing watches the folders: the list
/// asks again when it shows and on a pull, and a project's page when it opens.
@MainActor @Observable
final class ProjectGitLines {
    private(set) var lines: [UnifiedProjectRow.ID: ProjectGitLine] = [:]
    @ObservationIgnored private var asking = Set<UnifiedProjectRow.ID>()

    func line(_ id: UnifiedProjectRow.ID) -> ProjectGitLine? { lines[id] }

    func refresh(_ rows: [UnifiedProjectRow], session: (Machine) -> SharedMachineSession) async {
        let asked = rows.filter { $0.connected && !NewChat.isChats($0.summary) }
        let tasks = asked.map { row in
            let client = session(row.machine).rpc
            let folder = row.summary.text("folder")
            return Task { await refresh(row.id, folder: folder, client: client) }
        }
        for task in tasks { await task.value }
    }

    func refresh(_ id: UnifiedProjectRow.ID, folder: String, client: any MachineRequesting) async {
        guard !folder.isEmpty, !asking.contains(id) else { return }
        asking.insert(id)
        defer { asking.remove(id) }
        guard let answer = try? await client.request(.gitStatus, payload: .object(["cwd": .string(folder)])),
            let status = try? answer.decoded(as: GitStatus.self)
        else { return }
        lines[id] = ProjectGitLine(status: status)
    }
}

extension Color {
    /// A project's color as its file holds it, `#rrggbb`; nil for anything else.
    init?(projectHex hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255)
    }
}
