import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The mark a repository row carries: a module git tracks for the project reads apart from one that
/// only happens to sit beside it.
func gitRepoIcon(_ kind: String) -> String {
    switch kind {
    case "submodule": "boxes"
    default: "folder-git-2"
    }
}

/// The git sheet: Changes, History and Branches as segments under a pill that says where the project stands and
/// switches between the project folder and its worktrees. Every repository the folder holds is in it at once;
/// the staged files say where a commit lands, so there is no repository to pick first. A folder with exactly one
/// repository reads as one repository.
struct GitPage: View {
    let client: any MachineRequesting
    let folder: String
    /// The project, which a worktree's occupants and binding a group need; nil leaves those out.
    var workspace: MobileWorkspace?
    /// A worktree of the project the sheet looks at instead of the project folder.
    @State private var root: String?
    @State private var repositories = GitRepositories()
    @State private var projectWorktrees: GitWorktreesState
    @State private var segment = GitSegment.changes
    @State private var history = GitHistoryModel()
    @State private var commitModel: GitCommitModel?
    @State private var committing = false
    @State private var showRepositories = false
    @State private var pullRequest: String?
    @State private var repositoryPage: String?
    @State private var canPullRequest = false
    @State private var diff: GitDiffTarget?
    @State private var conflictFile: GitConflictTarget?
    @State private var note: String?
    @State private var detent = PresentationDetent.large

    init(client: any MachineRequesting, folder: String, workspace: MobileWorkspace? = nil) {
        self.client = client
        self.folder = folder
        self.workspace = workspace
        _projectWorktrees = State(initialValue: GitWorktreesState(repo: folder))
    }

    private var current: String { root ?? folder }
    private var checkouts: [GitCheckout] { repositories.checkouts }

    var body: some View {
        Group {
            switch segment {
            case .changes:
                GitChangesList(
                    client: client, repositories: repositories, folder: current, note: $note,
                    onDiff: { diff = $0 }, onConflict: { conflictFile = $0 }, onCommit: openCommit)
            case .history:
                MobileList {
                    GitHistoryRows(
                        client: client, history: history, named: repositories.named,
                        reload: { Task { await history.load(client: client, sources: checkouts) } },
                        onOpen: { diff = $0 })
                }
                .task(id: checkouts.map(\.path)) { await history.load(client: client, sources: checkouts) }
                .refreshable { await history.load(client: client, sources: checkouts) }
            case .branches:
                if let first = checkouts.first {
                    GitBranchesSegment(
                        client: client, repositories: repositories, path: first.path,
                        workspace: root == nil ? workspace : nil, onDiff: { diff = $0 }
                    )
                    .id(current)
                } else {
                    MobileLoadingRow("Loading").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            Picker("Show", selection: $segment) {
                ForEach(GitSegment.allCases) { segment in
                    Text(segment.title).tag(segment)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 20).padding(.vertical, 8)
        }
        .navigationTitle("Git")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $diff) { target in
            GitDiffPage(client: client, target: target)
        }
        .navigationDestination(item: $conflictFile) { target in
            GitConflictFilePage(client: client, session: repositories.conflicts.session(target.cwd), path: target.path)
        }
        .navigationDestination(isPresented: $committing) {
            if let commitModel {
                GitCommitPage(client: client, model: commitModel) { note = $0 }
            }
        }
        .navigationDestination(isPresented: $showRepositories) {
            GitRepositoriesPage(
                client: client, repositories: repositories, workspace: workspace,
                title: workspace?.title ?? (current as NSString).lastPathComponent)
        }
        .navigationDestination(item: $repositoryPage) { path in
            GitRepositoryPage(client: client, repositories: repositories, path: path, workspace: workspace)
        }
        .navigationDestination(item: $pullRequest) { path in
            GitPullRequestPage(client: client, repositories: repositories, path: path, subject: "") { note = $0 }
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { pill }
            ToolbarItem(placement: .topBarTrailing) { moreMenu }
        }
        .task(id: current) {
            await repositories.run(client: client, folder: current)
        }
        .task(id: folder) {
            await RemotePageLifecycle.run(
                client: client, events: ["git.worktrees"], load: { await projectWorktrees.load(client: client) })
        }
        .task(id: checkouts.first?.path) {
            guard let probe = checkouts.first?.path else { return }
            let answer = try? await client.request("git.capabilities", payload: .object(["cwd": .string(probe)]))
            canPullRequest = answer?["gh"] == .bool(true)
        }
        .presentationDetents([.medium, .large], selection: $detent)
    }

    /// Where the project stands, and the way to its worktrees and its repositories.
    private var pill: some View {
        Menu {
            let worktrees = projectWorktrees.worktrees.filter { !$0.missing }
            if !worktrees.isEmpty {
                Section("Checkout") {
                    Button {
                        switchRoot(to: nil)
                    } label: {
                        Label(
                            "Project folder",
                            lucideIcon: root == nil ? "check" : "folder")
                    }
                    ForEach(worktrees) { worktree in
                        Button {
                            switchRoot(to: worktree.path)
                        } label: {
                            Label(
                                "\(worktree.branch) (worktree)",
                                lucideIcon: root == worktree.path ? "check" : "folder-git-2")
                        }
                    }
                }
            }
            if repositories.named {
                Button("Repositories", lucideIcon: "folder-git-2") { showRepositories = true }
            } else if !checkouts.isEmpty {
                Button("Switch branch", lucideIcon: "git-branch") { segment = .branches }
            }
        } label: {
            HStack(spacing: 6) {
                Image(lucide: root == nil ? "git-branch" : "folder-git-2", size: 14)
                Text(GitPanel.pillTitle(checkouts)).font(.subheadline.weight(.medium)).lineLimit(1)
                    .truncationMode(.middle)
                if repositories.ahead > 0 {
                    Text("↑\(repositories.ahead)").font(.caption.monospacedDigit()).foregroundStyle(MobileStyle.muted)
                }
                if repositories.behind > 0 {
                    Text("↓\(repositories.behind)").font(.caption.monospacedDigit()).foregroundStyle(MobileStyle.muted)
                }
            }
            .frame(maxWidth: 200)
        }
        .accessibilityLabel(root == nil ? "Branch" : "Worktree")
        .accessibilityValue(GitPanel.pillTitle(checkouts))
        .disabled(checkouts.isEmpty)
    }

    private var moreMenu: some View {
        Menu {
            if repositories.named {
                Button("Pull all", lucideIcon: "arrow-down") {
                    Task { await repositories.actAll(client: client, kind: "pull") }
                }
                Button("Push all", lucideIcon: "arrow-up") { Task { await repositories.pushAll(client: client) } }
                Button("Sync all", lucideIcon: "refresh-cw") {
                    Task { await repositories.actAll(client: client, kind: "sync") }
                }
                Button("Fetch all", lucideIcon: "cloud-download") {
                    Task { await repositories.actAll(client: client, kind: "fetch") }
                }
            } else if let only = checkouts.first {
                Button("Pull", lucideIcon: "arrow-down") { act(only, "pull") }
                Button(GitPanel.pushLabel(only), lucideIcon: "arrow-up") { act(only, GitPanel.pushKind(only)) }
                Button("Sync", lucideIcon: "refresh-cw") { act(only, "sync") }
                Button("Fetch", lucideIcon: "cloud-download") { act(only, "fetch") }
                if canPullRequest && only.branch != nil {
                    Divider()
                    Button("Create pull request", lucideIcon: "git-pull-request") { pullRequest = only.path }
                }
                Divider()
                Button("Repository", lucideIcon: "folder-git-2") { repositoryPage = only.path }
            }
        } label: {
            Label("More git actions", lucideIcon: "ellipsis")
        }
        .disabled(repositories.busy || checkouts.isEmpty)
    }

    private func act(_ checkout: GitCheckout, _ kind: String) {
        Task { await repositories.act(client: client, cwd: checkout.path, kind: kind) }
    }

    /// The commit opens inside the sheet; what was typed stays while the sheet looks at the same checkout.
    private func openCommit() {
        if commitModel?.repositories !== repositories { commitModel = GitCommitModel(repositories: repositories) }
        committing = true
    }

    private func switchRoot(to path: String?) {
        guard path != root else { return }
        root = path
        repositories = GitRepositories()
        history = GitHistoryModel()
        commitModel = nil
        note = nil
    }
}

/// The colors the whole app gives the same news, which a row here carries on the porcelain letter alone.
func gitStatusColor(_ status: String) -> Color {
    switch status.first {
    case "A", "?": MobileStyle.accent
    case "D": .red
    case "R", "C": .orange
    default: MobileStyle.muted
    }
}

struct GitAheadBehind: View {
    let ahead: Int
    let behind: Int

    var body: some View {
        HStack(spacing: 8) {
            if ahead > 0 {
                Label("\(ahead)", lucideIcon: "arrow-up", iconSize: 12)
            }
            if behind > 0 {
                Label("\(behind)", lucideIcon: "arrow-down", iconSize: 12)
            }
        }
        .font(.caption.monospacedDigit()).foregroundStyle(MobileStyle.muted)
        .accessibilityLabel(ahead > 0 || behind > 0 ? "\(ahead) ahead, \(behind) behind" : "")
    }
}

/// One group of changes, with what stages or unstages the whole of it.
struct GitGroupHeader: View {
    let group: String
    let count: Int
    let busy: Bool
    let onStage: () -> Void

    var body: some View {
        HStack {
            Text(group.capitalized)
            Text("\(count)").monospacedDigit().foregroundStyle(MobileStyle.faint)
            Spacer()
            if group != "conflicted" {
                Button(group == "staged" ? "Unstage all" : "Stage all", action: onStage)
                    .font(.caption).buttonStyle(.plain).foregroundStyle(MobileStyle.accent).disabled(busy)
            }
        }
    }
}

/// The repository a stretch of a group belongs to, drawn only while the folder holds more than one.
struct GitRepoHeaderRow: View {
    let checkout: GitCheckout
    let count: Int
    let staged: Bool
    let conflicted: Bool
    let busy: Bool
    let onStage: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(lucide: gitRepoIcon(checkout.kind), size: 13).foregroundStyle(MobileStyle.faint)
            Text(checkout.label).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
            Text("\(count)").font(.caption.monospacedDigit()).foregroundStyle(MobileStyle.faint)
            Spacer()
            if !conflicted {
                Button(staged ? "Unstage" : "Stage", action: onStage)
                    .font(.caption).buttonStyle(.plain).foregroundStyle(MobileStyle.accent).disabled(busy)
            }
        }
        .listRowInsets(EdgeInsets(top: 6, leading: 28, bottom: 2, trailing: 28))
    }
}

/// A checkout that stopped halfway: what waits in it, the way to its conflicts, and finishing or taking
/// the operation back without opening them.
struct GitHaltedRows: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let checkout: GitCheckout
    let named: Bool
    @State private var confirmAbort = false

    private var session: GitConflictSession { repositories.conflicts.session(checkout.path) }

    var body: some View {
        NavigationLink {
            GitConflictsPage(client: client, session: session)
        } label: {
            HStack(spacing: 10) {
                Image(lucide: "git-merge", size: 16).foregroundStyle(MobileStyle.statusNeedsYou)
                VStack(alignment: .leading, spacing: 3) {
                    Text(GitHaltedText.title(checkout, named: named)).lineLimit(1)
                    Text(
                        checkout.conflictCount == 0
                            ? "Every file is resolved."
                            : checkout.conflictCount == 1 ? "1 file conflicts" : "\(checkout.conflictCount) files conflict"
                    ).font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
        }
        if let operation = checkout.operation {
            HStack(spacing: 8) {
                Button(GitConflictModel.continueLabel(operation)) { Task { await finish("continue") } }
                    .disabled(session.busy || checkout.conflictCount > 0)
                Button(GitConflictModel.abortLabel(operation), role: .destructive) { confirmAbort = true }
                    .disabled(session.busy)
                Spacer(minLength: 0)
            }
            .font(.caption).buttonStyle(.bordered)
            .modifier(GitAbortConfirmation(operation: operation, isPresented: $confirmAbort) { Task { await finish("abort") } })
        }
        if session.busy {
            GitBusyRow(text: session.progress ?? "Working")
        }
        if let problem = session.problem {
            Label(problem, lucideIcon: "triangle-alert").font(.caption).foregroundStyle(.red)
        }
    }

    private func finish(_ action: String) async {
        await session.finish(client: client, action: action)
        await repositories.refresh(client: client, cwd: checkout.path)
    }
}
