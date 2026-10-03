import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The Branches segment of the git sheet, for one repository: its branches, its worktrees with who works in them,
/// its stashes, and binding a group of the project to a worktree. A folder of several repositories picks the one
/// at the top, since a branch only means something inside its own repository.
struct GitBranchesSegment: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    var workspace: MobileWorkspace?
    let onDiff: (GitDiffTarget) -> Void
    @State private var actions: GitBranchActions
    @State private var binding = false

    init(
        client: any MachineRequesting, repositories: GitRepositories, path: String, workspace: MobileWorkspace?,
        onDiff: @escaping (GitDiffTarget) -> Void
    ) {
        self.client = client
        self.repositories = repositories
        self.workspace = workspace
        self.onDiff = onDiff
        _actions = State(initialValue: GitBranchActions(repositories: repositories, path: path))
    }

    private var worktrees: GitWorktreesState { repositories.worktrees.state(actions.path) }
    private var branches: [JSONValue] { actions.refs.branches }

    var body: some View {
        MobileList {
            if repositories.named {
                Picker(
                    "Repository",
                    selection: Binding(get: { actions.path }, set: { actions.point(at: $0) })
                ) {
                    ForEach(repositories.checkouts) { checkout in
                        Text(checkout.label).tag(checkout.path)
                    }
                }
                .pickerStyle(.menu)
            }
            if repositories.busy {
                GitBusyRow(text: repositories.progress ?? String(localized: "Working"))
            }
            if let problem = repositories.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red).textSelection(.enabled)
            }
            Section {
                if actions.refs.loading && branches.isEmpty {
                    MobileLoadingRow(String(localized: "Loading")).frame(maxWidth: .infinity).padding()
                }
                ForEach(branches, id: \.stableID) { ref in
                    GitBranchRow(client: client, actions: actions, ref: ref)
                }
                NavigationLink {
                    GitBranchesPage(client: client, actions: actions)
                } label: {
                    Text("All branches").foregroundStyle(MobileStyle.muted)
                }
            } header: {
                header(String(localized: "Branches"))
            }
            Section {
                GitWorktreeStatusRows(client: client, state: worktrees)
                if let outcome = worktrees.outcome {
                    GitWorktreeOutcomeSection(
                        client: client, repositories: repositories, state: worktrees, outcome: outcome)
                }
                if worktrees.unsupported {
                    Text("Update Ruimte on this machine to manage worktrees on the phone.")
                        .font(.caption).foregroundStyle(MobileStyle.muted)
                } else if worktrees.loaded && worktrees.worktrees.isEmpty {
                    Text("A worktree is a second checkout of this repository on a branch of its own.")
                        .font(.caption).foregroundStyle(MobileStyle.muted)
                }
                ForEach(worktrees.worktrees) { worktree in
                    GitWorktreeRow(
                        client: client, state: worktrees, worktree: worktree,
                        occupants: workspace.flatMap { GitWorktreeOccupants.line(in: $0.views, path: worktree.path) },
                        onDiff: onDiff)
                }
                if let workspace, actions.path == workspace.folder,
                    !GitWorktreeBinding.groups(in: workspace.views).isEmpty
                {
                    Button(String(localized: "Bind a group to a worktree"), lucideIcon: "group") { binding = true }
                        .disabled(worktrees.busy)
                }
            } header: {
                header(String(localized: "Worktrees"))
            }
            Section {
                ForEach(actions.refs.stashes, id: \.stableID) { stash in
                    stashRow(stash)
                }
                Button(String(localized: "Stash changes"), lucideIcon: "archive") {
                    actions.prompt = .stash(cwd: actions.path)
                }
                .disabled(repositories.busy || (actions.checkout?.files.isEmpty ?? true))
            } header: {
                header(String(localized: "Stash", comment: "Section of git stashes"))
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            GitBottomBar {
                GitBarButton(title: String(localized: "New branch"), prominent: false) {
                    actions.prompt = .createBranch(cwd: actions.path)
                }.disabled(repositories.busy)
                GitBarButton(title: String(localized: "New worktree"), prominent: false) { worktrees.creating = true }
                    .disabled(worktrees.busy || worktrees.unsupported)
            }
        }
        .task(id: actions.path) {
            let path = actions.path
            await RemotePageLifecycle.run(
                client: client, events: ["git.worktrees"],
                load: {
                    await actions.load(client: client)
                    await repositories.worktrees.state(path).load(client: client)
                })
        }
        .refreshable {
            await actions.load(client: client)
            await worktrees.load(client: client)
        }
        .modifier(GitBranchDialogs(client: client, actions: actions))
        .modifier(GitWorktreeDialogs(client: client, state: worktrees))
        .mobileSheet(isPresented: $binding) {
            if let workspace {
                GitWorktreeBindSheet(client: client, model: GitWorktreeBindModel(workspace: workspace))
                    .onDisappear { Task { await worktrees.load(client: client) } }
            }
        }
    }

    private func header(_ title: String) -> some View {
        Text(title).font(.footnote).foregroundStyle(MobileStyle.muted).textCase(nil)
    }

    private func stashRow(_ stash: JSONValue) -> some View {
        let ref = stash.text("ref")
        return HStack(spacing: 10) {
            Image(lucide: "archive", size: 15).foregroundStyle(MobileStyle.faint)
            VStack(alignment: .leading, spacing: 3) {
                Text(stash.text("message", fallback: ref)).lineLimit(2)
                Text(ref).font(.caption.monospaced()).foregroundStyle(MobileStyle.muted)
            }
            Spacer(minLength: 8)
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("Pop") { Task { await actions.pop(client: client, stash: ref) } }
                .tint(MobileStyle.accent).disabled(repositories.busy)
        }
        .contextMenu {
            Button(String(localized: "Pop this stash"), lucideIcon: "archive-restore") {
                Task { await actions.pop(client: client, stash: ref) }
            }.disabled(repositories.busy)
            Button(String(localized: "Copy name"), lucideIcon: "copy") { UIPasteboard.general.string = ref }
        }
    }
}
