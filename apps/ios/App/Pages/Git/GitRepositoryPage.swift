import RuimtePulsar
import RuimteTransport
import SwiftUI

/// One repository of the project folder: where its branch stands, everything that acts on it alone, its stash,
/// and the way into its branches, its history, its worktrees and a pull request.
struct GitRepositoryPage: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let path: String
    var workspace: MobileWorkspace?
    @State private var actions: GitBranchActions
    @State private var pullRequest = false
    @State private var note: String?

    init(client: any MachineRequesting, repositories: GitRepositories, path: String, workspace: MobileWorkspace? = nil) {
        self.client = client
        self.repositories = repositories
        self.path = path
        self.workspace = workspace
        _actions = State(initialValue: GitBranchActions(repositories: repositories, path: path))
    }

    private var checkout: GitCheckout? { repositories.checkout(path) }
    private var refs: GitRefsState { actions.refs }

    var body: some View {
        MobileList {
            if repositories.busy {
                GitBusyRow(text: repositories.progress ?? String(localized: "Working"))
            }
            if let problem = repositories.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            if let note {
                Text(note).font(.caption).foregroundStyle(MobileStyle.muted).textSelection(.enabled)
            }
            if let checkout {
                Section {
                    LabeledContent(
                        "Branch",
                        value: checkout.branch
                            ?? (checkout.status?["detached"] == .bool(true)
                                ? String(localized: "Detached HEAD") : String(localized: "No commits")))
                    if let upstream = checkout.status?["upstream"]?.stringValue {
                        LabeledContent("Upstream", value: upstream)
                    }
                    LabeledContent(
                        "Ahead and behind",
                        value: String(localized: "\(checkout.ahead) ahead, \(checkout.behind) behind"))
                    if let base = checkout.status?["base"]?.stringValue {
                        LabeledContent("Base", value: base)
                    }
                    if checkout.status?["live"] == .bool(false) {
                        Label(String(localized: "Too large to watch. Pull to refresh it."), lucideIcon: "refresh-cw", iconSize: 14)
                            .font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                }
                if GitPanel.diverged(checkout) {
                    GitDivergedRow(client: client, repositories: repositories, checkout: checkout, named: false)
                }
                Section("Remote") {
                    action(String(localized: "Pull"), icon: "arrow-down", kind: "pull")
                    action(GitPanel.pushLabel(checkout), icon: "arrow-up", kind: GitPanel.pushKind(checkout))
                    action(String(localized: "Sync"), icon: "refresh-cw", kind: "sync")
                    action(String(localized: "Fetch"), icon: "cloud-download", kind: "fetch")
                    Button(String(localized: "Force push"), lucideIcon: "triangle-alert", role: .destructive) {
                        actions.confirmation = .forcePush(cwd: path)
                    }.disabled(repositories.busy)
                }
                Section("Working tree") {
                    Button(String(localized: "Stash changes"), lucideIcon: "archive") { actions.prompt = .stash(cwd: path) }
                        .disabled(repositories.busy || checkout.files.isEmpty)
                    Button(String(localized: "Pop stash"), lucideIcon: "archive-restore") {
                        if refs.stashes.count > 1 {
                            actions.popping = true
                        } else {
                            Task { await actions.pop(client: client, stash: nil) }
                        }
                    }.disabled(repositories.busy || refs.stashes.isEmpty)
                    if refs.capabilities {
                        Button(String(localized: "Create pull request"), lucideIcon: "git-pull-request") { pullRequest = true }
                            .disabled(repositories.busy || checkout.branch == nil)
                    }
                }
                Section {
                    NavigationLink {
                        GitBranchesPage(client: client, actions: actions)
                    } label: {
                        LabeledContent {
                            Text("\(refs.branches.count)").monospacedDigit().foregroundStyle(MobileStyle.muted)
                        } label: {
                            Label(String(localized: "Branches"), lucideIcon: "git-branch")
                        }
                    }
                    NavigationLink {
                        GitLogPage(client: client, repositories: repositories, only: path)
                    } label: {
                        Label(String(localized: "History"), lucideIcon: "git-commit-horizontal")
                    }
                    NavigationLink {
                        GitWorktreesPage(client: client, repositories: repositories, repo: path, workspace: workspace)
                    } label: {
                        Label(String(localized: "Worktrees"), lucideIcon: "folder-git-2")
                    }
                }
            }
        }
        .navigationTitle(checkout?.label ?? String(localized: "Repository"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $pullRequest) {
            GitPullRequestPage(client: client, repositories: repositories, path: path, subject: refs.lastSubject) {
                note = $0
            }
        }
        .task(id: path) { await actions.load(client: client) }
        .refreshable {
            await repositories.refresh(client: client, cwd: path)
            await actions.load(client: client)
        }
        .modifier(GitBranchDialogs(client: client, actions: actions))
    }

    private func action(_ title: String, icon: String, kind: String) -> some View {
        Button(title, lucideIcon: icon) {
            Task { await repositories.act(client: client, cwd: path, kind: kind) }
        }.disabled(repositories.busy)
    }
}

extension GitPanel {
    /// A branch git has never seen is published with an upstream in the same push, which is a different word for
    /// a person and a different flag for git.
    static func pushLabel(_ checkout: GitCheckout) -> String {
        checkout.status?["upstream"]?.stringValue == nil ? String(localized: "Publish branch") : String(localized: "Push")
    }

    static func pushKind(_ checkout: GitCheckout) -> String {
        checkout.status?["upstream"]?.stringValue == nil ? "publish" : "push"
    }
}

/// A branch that moved on both sides. A pull only fast-forwards, so the person says here how the two come
/// together; nothing merges or rebases on its own.
struct GitDivergedRow: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let checkout: GitCheckout
    let named: Bool

    var body: some View {
        let branch = checkout.branch ?? String(localized: "This branch")
        VStack(alignment: .leading, spacing: 8) {
            Text(named ? "How should \(branch) in \(checkout.label) come together?" : "How should \(branch) come together?")
                .font(.callout)
            Text(
                "It has \(checkout.ahead) commits of its own and \(checkout.behind) from \(checkout.status?["upstream"]?.stringValue ?? String(localized: "the remote")). A pull only fast-forwards until you choose."
            ).font(.caption).foregroundStyle(MobileStyle.muted)
            HStack(spacing: 8) {
                Button("Merge") { pull("merge") }
                Button("Rebase") { pull("rebase") }
            }
            .buttonStyle(.bordered).font(.callout).disabled(repositories.busy)
        }
        .padding(.vertical, 6)
    }

    private func pull(_ strategy: String) {
        Task {
            await repositories.act(
                client: client, cwd: checkout.path, kind: "pull", extra: ["strategy": .string(strategy)])
        }
    }
}

/// The branches and stashes of one repository, and whether this machine can open a pull request at all.
@MainActor @Observable final class GitRefsState {
    private(set) var refs: [JSONValue] = []
    private(set) var stashes: [JSONValue] = []
    private(set) var capabilities = false
    /// The subject of the last commit, which is what a pull request opens with.
    private(set) var lastSubject = ""
    private(set) var loading = false

    var branches: [JSONValue] { refs.filter { $0.text("kind") == "local" } }
    var current: String? { refs.first { $0["current"] == .bool(true) }?.text("name") }

    /// Forgets what was read, for a page that now points at another repository.
    func clear() {
        refs = []
        stashes = []
        capabilities = false
        lastSubject = ""
    }

    func load(client: any MachineRequesting, cwd: String) async {
        loading = refs.isEmpty
        defer { loading = false }
        if let answer = try? await client.request("git.refs", payload: .object(["cwd": .string(cwd)])) {
            refs = answer.list("refs")
            stashes = answer.list("stashes")
        }
        if let answer = try? await client.request("git.capabilities", payload: .object(["cwd": .string(cwd)])) {
            capabilities = answer["gh"] == .bool(true)
        }
        if let answer = try? await client.request(
            "git.log", payload: .object(["cwd": .string(cwd), "limit": .number(1)]))
        {
            lastSubject = answer.list("commits").first?.text("subject") ?? ""
        }
    }
}

/// One stash to pop, for a repository that holds more than one.
struct GitStashSheet: View {
    let stashes: [JSONValue]
    @Binding var isPresented: Bool
    let onPick: (String) -> Void

    var body: some View {
        NavigationStack {
            MobileList {
                ForEach(stashes, id: \.stableID) { stash in
                    Button {
                        onPick(stash.text("ref"))
                        isPresented = false
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(stash.text("ref")).font(.callout.monospaced())
                            Text(stash.text("message")).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(2)
                        }.modifier(MobileSidebarLabel())
                    }.modifier(MobileSidebarRow())
                }
            }
            .navigationTitle("Pop stash")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isPresented = false } }
            }
        }
    }
}
