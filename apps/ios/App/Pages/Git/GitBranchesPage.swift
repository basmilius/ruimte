import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What a person does to the branches and stashes of one repository, and the questions in between. The Branches
/// segment and the page of all branches share it, so a switch asks the same thing in both places.
@MainActor @Observable final class GitBranchActions {
    let repositories: GitRepositories
    let refs = GitRefsState()
    private(set) var path: String
    var prompt: GitPrompt?
    var confirmation: GitConfirmation?
    var popping = false

    init(repositories: GitRepositories, path: String) {
        self.repositories = repositories
        self.path = path
    }

    var checkout: GitCheckout? { repositories.checkout(path) }

    /// Points the actions at another repository of the folder.
    func point(at path: String) {
        guard path != self.path else { return }
        self.path = path
        refs.clear()
    }

    func load(client: any MachineRequesting) async {
        await refs.load(client: client, cwd: path)
    }

    /// A switch that would lose the working tree asks to stash it first; a clean tree switches straight away.
    func switchTo(client: any MachineRequesting, branch: String) async {
        if (checkout?.files.count ?? 0) > 0 {
            confirmation = .checkout(cwd: path, ref: branch)
            return
        }
        await repositories.act(client: client, cwd: path, kind: "checkout", extra: ["ref": .string(branch)])
        await load(client: client)
    }

    func merge(client: any MachineRequesting, branch: String) async {
        await repositories.act(client: client, cwd: path, kind: "merge", extra: ["ref": .string(branch)])
        await load(client: client)
    }

    func rebase(client: any MachineRequesting, onto branch: String) async {
        await repositories.act(client: client, cwd: path, kind: "rebase", extra: ["ref": .string(branch)])
        await load(client: client)
    }

    /// One stash back into the working tree; nil pops the newest.
    func pop(client: any MachineRequesting, stash: String?) async {
        await repositories.act(
            client: client, cwd: path, kind: "stash-pop", extra: stash.map { ["ref": .string($0)] } ?? [:])
        await load(client: client)
    }

    func confirm(client: any MachineRequesting, _ pending: GitConfirmation) async {
        confirmation = nil
        switch pending {
        case .checkout(let cwd, let ref):
            await repositories.act(
                client: client, cwd: cwd, kind: "checkout", extra: ["ref": .string(ref), "stash": .bool(true)])
        case .deleteBranch(let cwd, let ref, let force):
            let extra: [String: JSONValue] = force ? ["ref": .string(ref), "force": .bool(true)] : ["ref": .string(ref)]
            await repositories.act(client: client, cwd: cwd, kind: "delete-branch", extra: extra)
            if !force, let problem = repositories.problem, gitIsUnmergedRefusal(problem) {
                confirmation = .deleteBranch(cwd: cwd, ref: ref, force: true)
                return
            }
        case .forcePush(let cwd):
            await repositories.act(client: client, cwd: cwd, kind: "force-push")
        case .discard:
            break
        }
        await load(client: client)
    }

    func run(client: any MachineRequesting, _ pending: GitPrompt, first: String) async {
        prompt = nil
        switch pending {
        case .stash(let cwd):
            await repositories.act(client: client, cwd: cwd, kind: "stash", extra: ["subject": .string(first)])
        case .createBranch(let cwd):
            await repositories.act(client: client, cwd: cwd, kind: "create-branch", extra: ["name": .string(first)])
        case .renameBranch(let cwd, _):
            await repositories.act(client: client, cwd: cwd, kind: "rename-branch", extra: ["name": .string(first)])
        case .createWorktree:
            return
        }
        await load(client: client)
    }
}

/// One branch: which one is out, where else it is checked out, and what a long press does with it. A branch
/// another worktree has out cannot be switched to here, which is git's own rule and not this row's.
struct GitBranchRow: View {
    let client: any MachineRequesting
    let actions: GitBranchActions
    let ref: JSONValue

    var body: some View {
        let name = ref.text("name")
        let isCurrent = ref["current"] == .bool(true)
        let elsewhere = ref["worktree"]?.stringValue
        Button {
            Task { await actions.switchTo(client: client, branch: name) }
        } label: {
            HStack(spacing: 10) {
                Image(lucide: isCurrent ? "check" : "git-branch", size: 15)
                    .foregroundStyle(isCurrent ? MobileStyle.accent : MobileStyle.faint)
                VStack(alignment: .leading, spacing: 3) {
                    Text(name).font(.callout.monospaced()).lineLimit(1).truncationMode(.middle)
                    if let detail = detail(isCurrent: isCurrent, elsewhere: elsewhere) {
                        Text(detail).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                if elsewhere != nil {
                    Text("worktree").font(.caption).foregroundStyle(MobileStyle.faint)
                }
            }.modifier(MobileSidebarLabel())
        }
        .modifier(MobileSidebarRow(selected: isCurrent))
        .disabled(actions.repositories.busy || isCurrent || elsewhere != nil)
        .contextMenu {
            if !isCurrent && elsewhere == nil {
                Button("Switch to this branch", lucideIcon: "git-branch") {
                    Task { await actions.switchTo(client: client, branch: name) }
                }
                Button("Merge into \(actions.checkout?.branch ?? "HEAD")", lucideIcon: "git-merge") {
                    Task { await actions.merge(client: client, branch: name) }
                }
                Button("Rebase onto this branch", lucideIcon: "git-pull-request-arrow") {
                    Task { await actions.rebase(client: client, onto: name) }
                }
            }
            if isCurrent {
                Button("Rename branch", lucideIcon: "pencil") {
                    actions.prompt = .renameBranch(cwd: actions.path, branch: name)
                }
            }
            if !isCurrent && ref.text("kind") == "local" {
                Button("Delete branch", lucideIcon: "trash", role: .destructive) {
                    actions.confirmation = .deleteBranch(cwd: actions.path, ref: name, force: false)
                }
            }
        }
    }

    private func detail(isCurrent: Bool, elsewhere: String?) -> String? {
        if let elsewhere { return "Checked out in \((elsewhere as NSString).lastPathComponent)" }
        if isCurrent, let checkout = actions.checkout {
            var parts: [String] = []
            if checkout.ahead > 0 { parts.append("↑\(checkout.ahead)") }
            if checkout.behind > 0 { parts.append("↓\(checkout.behind)") }
            if !checkout.files.isEmpty { parts.append("\(checkout.files.count) changed") }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        }
        return ref["isDefault"] == .bool(true) ? "Default branch" : nil
    }
}

/// The questions and the typed prompts of the branch actions, put on a page once.
struct GitBranchDialogs: ViewModifier {
    let client: any MachineRequesting
    @Bindable var actions: GitBranchActions

    func body(content: Content) -> some View {
        content
            .mobileSheet(item: $actions.prompt) { pending in
                GitPromptSheet(pending: pending) { first in
                    Task { await actions.run(client: client, pending, first: first) }
                } onCancel: {
                    actions.prompt = nil
                }
            }
            .mobileSheet(isPresented: $actions.popping) {
                GitStashSheet(stashes: actions.refs.stashes, isPresented: $actions.popping) { ref in
                    Task { await actions.pop(client: client, stash: ref) }
                }
            }
            .alert(
                actions.confirmation?.title ?? "",
                isPresented: Binding(
                    get: { actions.confirmation != nil }, set: { if !$0 { actions.confirmation = nil } }),
                presenting: actions.confirmation
            ) { pending in
                Button(pending.confirmLabel, role: .destructive) {
                    Task { await actions.confirm(client: client, pending) }
                }
                Button("Cancel", role: .cancel) {}
            } message: { pending in
                Text(pending.detail)
            }
    }
}

/// Every branch of one repository, the remote ones too, with a search over them.
struct GitBranchesPage: View {
    let client: any MachineRequesting
    let actions: GitBranchActions
    @State private var query = ""
    @State private var remotes = false

    private var shown: [JSONValue] {
        let source = remotes ? actions.refs.refs : actions.refs.branches
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return needle.isEmpty ? source : source.filter { $0.text("name").lowercased().contains(needle) }
    }

    var body: some View {
        MobileList {
            if actions.repositories.busy {
                GitBusyRow(text: actions.repositories.progress ?? "Working")
            }
            if let problem = actions.repositories.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            Picker("Show", selection: $remotes) {
                Text("Local").tag(false)
                Text("All").tag(true)
            }.pickerStyle(.segmented)
            if actions.refs.loading && actions.refs.refs.isEmpty {
                MobileLoadingRow("Loading").frame(maxWidth: .infinity).padding()
            } else if shown.isEmpty {
                ContentUnavailableView("No branches", lucideIcon: "git-branch")
            }
            ForEach(shown, id: \.stableID) { ref in
                GitBranchRow(client: client, actions: actions, ref: ref)
            }
        }
        .searchable(text: $query, prompt: "Search branches")
        .navigationTitle("Branches")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem {
                Button("New branch", lucideIcon: "plus") { actions.prompt = .createBranch(cwd: actions.path) }
                    .disabled(actions.repositories.busy)
            }
        }
        .refreshable { await actions.load(client: client) }
        .modifier(GitBranchDialogs(client: client, actions: actions))
    }
}
