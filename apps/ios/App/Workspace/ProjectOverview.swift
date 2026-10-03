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

    init(connected: Bool, relayed: Bool?, failedAttempts: Int, problem: String?) {
        if connected {
            self = .connected(relayed: relayed == true)
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
    var working = false
}

/// The branch a project's folder is on and how many files changed in it, from `git.status`.
struct ProjectGitLine: Equatable {
    /// Nil on a detached head.
    let branch: String?
    let changed: Int

    /// Nil for a folder outside any repository, which has nothing to say about a branch.
    init?(status: JSONValue) {
        guard status["repo"]?.boolValue == true else { return nil }
        branch = status["branch"]?.stringValue
        changed = status.list("files").count
    }

    init(branch: String?, changed: Int) {
        self.branch = branch
        self.changed = changed
    }

    var text: String {
        let name = branch ?? "Detached"
        return changed == 0 ? name : "\(name) · \(changed) changed"
    }
}

struct ProjectOverviewRow: Identifiable {
    let row: UnifiedProjectRow
    var activity: ProjectActivity?
    var git: ProjectGitLine?
    var id: UnifiedProjectRow.ID { row.id }
    var isChats: Bool { NewChat.isChats(row.summary) }
    var unavailable: Bool { row.summary["available"] == .bool(false) }

    /// The second line: the branch and the number of views, or for Chats how many chats it holds.
    var detail: String? {
        if unavailable { return "Folder unavailable" }
        if isChats {
            guard let activity else { return "Your earlier chats" }
            return activity.chats == 1 ? "1 chat" : activity.chats == 0 ? "No chats yet" : "\(activity.chats) chats"
        }
        let parts = [git?.branch, activity.map { $0.views == 1 ? "1 view" : "\($0.views) views" }]
        let line = parts.compactMap { $0 }.joined(separator: " · ")
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
                if status == .running || attention.delegating.contains(id) { activity.working = true }
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
        let asked = rows.filter {
            $0.connected && $0.summary["available"] != .bool(false) && !NewChat.isChats($0.summary)
        }
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
        guard let status = try? await client.request("git.status", payload: .object(["cwd": .string(folder)])) else {
            return
        }
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
