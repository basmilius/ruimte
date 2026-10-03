import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// Who works in a worktree, as the project's nodes say: a chat or terminal whose folder is in it, or a group
/// bound to it.
enum GitWorktreeOccupants {
    static func line(in views: [JSONValue], path: String) -> String? {
        var chats = 0
        var terminals = 0
        var groups: [String] = []
        let count = { (kind: String, cwd: String?) in
            guard let cwd, cwd == path || cwd.hasPrefix(path + "/") else { return }
            if kind == "chat" { chats += 1 }
            if kind == "terminal" { terminals += 1 }
        }
        for view in views {
            count(view.text("kind"), view["node"]?["cwd"]?.stringValue ?? view["cwd"]?.stringValue)
            for node in view.list("nodes") {
                count(node.text("kind"), node["cwd"]?.stringValue)
                if node.text("kind") == "group", node["worktree"]?["path"]?.stringValue == path {
                    groups.append(node.text("title", fallback: String(localized: "A group")))
                }
            }
        }
        switch (chats, terminals) {
        case (0, 0): break
        case (_, 0): return String(localized: "\(chats) chats work here")
        case (0, _): return String(localized: "\(terminals) terminals work here")
        default: return String(localized: "\(chats) chats and \(terminals) terminals work here")
        }
        return groups.first.map { String(localized: "bound to \($0)", comment: "%@ is the title of a group") }
    }
}

/// A group of a canvas, which is what a worktree is bound to.
struct GitBindableGroup: Identifiable, Equatable {
    let viewID: String
    let id: String
    let title: String
    /// The worktree it is bound to now.
    let worktree: (path: String, branch: String)?

    static func == (lhs: GitBindableGroup, rhs: GitBindableGroup) -> Bool {
        lhs.viewID == rhs.viewID && lhs.id == rhs.id && lhs.title == rhs.title
            && lhs.worktree?.path == rhs.worktree?.path && lhs.worktree?.branch == rhs.worktree?.branch
    }
}

/// Binding a group to a git worktree, as the desktop's worktree dialog does: every terminal and chat added to the
/// group starts in that checkout. The worktree of a node is one person's, so the machine keeps it in the private
/// project file.
enum GitWorktreeBinding {
    static func groups(in views: [JSONValue]) -> [GitBindableGroup] {
        views.flatMap { view in
            view.list("nodes").filter { $0.text("kind") == "group" }.map { node in
                let bound = node["worktree"].flatMap { worktree -> (String, String)? in
                    guard let path = worktree["path"]?.stringValue else { return nil }
                    return (path, worktree.text("branch"))
                }
                return GitBindableGroup(
                    viewID: view.stableID, id: node.stableID,
                    title: node.text("title", fallback: String(localized: "Group")),
                    worktree: bound)
            }
        }
    }

    /// A group's title as a branch name git accepts, the way the desktop proposes one.
    static func branchName(fromTitle title: String) -> String {
        var name = ""
        var gap = false
        for character in title.lowercased() {
            if character.isASCII && (character.isLetter || character.isNumber || "._/-".contains(character)) {
                if gap && !name.isEmpty { name.append("-") }
                gap = false
                name.append(character)
            } else {
                gap = true
            }
        }
        while name.hasPrefix("-") { name.removeFirst() }
        while name.hasSuffix("-") { name.removeLast() }
        return name.isEmpty ? "work" : name
    }

    /// The document with the group bound to the worktree, or unbound with nil.
    static func bind(_ document: JSONValue, viewID: String, groupID: String, worktree: (path: String, branch: String)?)
        -> JSONValue
    {
        let views = document.list("views").map { view -> JSONValue in
            guard view.stableID == viewID else { return view }
            let nodes = view.list("nodes").map { node -> JSONValue in
                guard node.stableID == groupID, node.text("kind") == "group" else { return node }
                return node.setting(
                    "worktree",
                    worktree.map { .object(["path": .string($0.path), "branch": .string($0.branch)]) })
            }
            return view.setting("nodes", .array(nodes))
        }
        return document.setting("views", .array(views))
    }
}

/// The sheet that binds a group to a worktree: which group, and the branch its checkout is on.
@MainActor @Observable final class GitWorktreeBindModel {
    let workspace: MobileWorkspace
    var groupKey: String?
    var branch = ""
    private(set) var busy = false
    var problem: String?

    init(workspace: MobileWorkspace) {
        self.workspace = workspace
        groupKey = groups.first.map(Self.key)
        branch = groups.first.map { GitWorktreeBinding.branchName(fromTitle: $0.title) } ?? ""
    }

    var groups: [GitBindableGroup] { GitWorktreeBinding.groups(in: workspace.views) }
    var group: GitBindableGroup? { groups.first { Self.key($0) == groupKey } }
    var ready: Bool { group != nil && !branch.trimmingCharacters(in: .whitespaces).isEmpty && !busy }

    static func key(_ group: GitBindableGroup) -> String { group.viewID + "\u{0}" + group.id }

    func pick(_ key: String?) {
        groupKey = key
        if let group { branch = GitWorktreeBinding.branchName(fromTitle: group.title) }
    }

    /// Makes the worktree, or takes the one the branch already has, and binds the group to it.
    func bind(client: any MachineRequesting) async -> Bool {
        guard let group, ready else { return false }
        busy = true
        defer { busy = false }
        let name = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let result = try await client.request(
                "git.worktree-add",
                payload: .object([
                    "repo": .string(workspace.folder), "branch": .string(name),
                    "projectId": .string(workspace.projectID),
                ]))
            let worktree = result["worktree"]
            guard let path = worktree?["path"]?.stringValue else {
                problem = String(localized: "The machine did not say where the worktree is.")
                return false
            }
            let bound = (path: path, branch: worktree?.text("branch", fallback: name) ?? name)
            await workspace.edit {
                GitWorktreeBinding.bind($0, viewID: group.viewID, groupID: group.id, worktree: bound)
            }
            problem = workspace.problem
            return workspace.problem == nil
        } catch {
            problem = gitMessage(
                error, outdated: String(localized: "Update Ruimte on this machine to make worktrees on the phone."))
            return false
        }
    }

    func unbind() async {
        guard let group else { return }
        await workspace.edit { GitWorktreeBinding.bind($0, viewID: group.viewID, groupID: group.id, worktree: nil) }
        problem = workspace.problem
    }
}

struct GitWorktreeBindSheet: View {
    let client: any MachineRequesting
    @State var model: GitWorktreeBindModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    Picker(
                        "Group",
                        selection: Binding(get: { model.groupKey }, set: { model.pick($0) })
                    ) {
                        ForEach(model.groups) { group in
                            Text(group.title).tag(Optional(GitWorktreeBindModel.key(group)))
                        }
                    }
                } footer: {
                    Text(
                        "Creates a checkout of this branch. Every terminal and chat you add to the group starts in it.")
                }
                if let bound = model.group?.worktree {
                    Section {
                        LabeledContent("Bound to", value: bound.branch)
                        Button(String(localized: "Unbind"), lucideIcon: "unlink", role: .destructive) {
                            Task {
                                await model.unbind()
                                if model.problem == nil { dismiss() }
                            }
                        }.disabled(model.busy)
                    } footer: {
                        Text(
                            "Unbinding leaves the worktree as it is; new nodes in the group start in the project folder again."
                        )
                    }
                }
                Section("Branch") {
                    TextField("branch name", text: $model.branch)
                        .font(.body.monospaced()).autocorrectionDisabled().textInputAutocapitalization(.never)
                }
                if model.busy {
                    Section { GitBusyRow(text: String(localized: "Creating checkout")) }
                }
                if let problem = model.problem {
                    Section { Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red) }
                }
            }
            .navigationTitle("Bind to a worktree")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Bind") {
                        Task { if await model.bind(client: client) { dismiss() } }
                    }.disabled(!model.ready)
                }
            }
        }
        .interactiveDismissDisabled(model.busy)
    }
}
