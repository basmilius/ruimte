import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// Who works in a worktree, as the project's nodes say: a chat or terminal whose folder is in it, or a group
/// bound to it.
enum GitWorktreeOccupants {
    static func line(in views: [StoredView], path: String) -> String? {
        var chats = 0
        var terminals = 0
        var groups: [String] = []
        let count = { (kind: String, cwd: String?) in
            guard let cwd, cwd == path || cwd.hasPrefix(path + "/") else { return }
            if kind == "chat" { chats += 1 }
            if kind == "terminal" { terminals += 1 }
        }
        for view in views {
            switch view {
            case .chat(let chat): count("chat", chat.node.cwd)
            case .terminal(let terminal): count("terminal", terminal.node.cwd)
            default: break
            }
            for node in view.nodes {
                count(node.kind.rawValue, node.cwd)
                if node.kind == .group, node.worktree?.path == path { groups.append(node.title) }
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

struct GitBindableGroup: Identifiable, Equatable {
    let viewID: String
    let id: String
    let title: String
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
    static func groups(in views: [StoredView]) -> [GitBindableGroup] {
        views.flatMap { view in
            view.nodes.filter { $0.kind == .group }.map { node in
                GitBindableGroup(
                    viewID: view.id, id: node.id, title: node.title,
                    worktree: node.worktree.map { ($0.path, $0.branch) })
            }
        }
    }

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
        name = name.split(separator: "/").compactMap { part -> String? in
            var component = String(part)
            while component.contains("..") { component = component.replacingOccurrences(of: "..", with: "-") }
            while component.hasPrefix(".") { component.removeFirst() }
            while component.hasSuffix(".") { component.removeLast() }
            if component.hasSuffix(".lock") { component = String(component.dropLast(5)) + "-lock" }
            return component.isEmpty ? nil : component
        }.joined(separator: "/")
        while name.hasPrefix("-") || name.hasPrefix("/") || name.hasPrefix(".") { name.removeFirst() }
        return name.isEmpty ? "work" : name
    }

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

    var groups: [GitBindableGroup] { GitWorktreeBinding.groups(in: workspace.storedViews) }
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
                .gitWorktreeAdd,
                payload: .object([
                    "repo": .string(workspace.folder), "branch": .string(name),
                    "projectId": .string(workspace.projectID),
                ])
            ).decoded(as: WorktreeAddResult.self)
            let bound = (path: result.worktree.path, branch: result.worktree.branch)
            await workspace.edit {
                GitWorktreeBinding.bind($0, viewID: group.viewID, groupID: group.id, worktree: bound)
            }
            problem = workspace.problem
            return workspace.problem == nil
        } catch {
            problem = error.localizedDescription
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
                            "Unbinding leaves the worktree as it is. New nodes in the group start in the project folder again."
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
                    Section { Label(problem, lucideIcon: "triangle-alert").foregroundStyle(MobileStyle.statusError) }
                }
            }
            .navigationTitle("Bind to worktree")
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
