import RuimtePulsar
import RuimteTransport
import SwiftUI

/// One repository of the project folder: where its branch stands, everything that acts on it alone,
/// and the way into its branches and its history.
struct GitRepositoryPage: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let path: String
    @State private var refs = GitRefsState()
    @State private var confirmation: GitConfirmation?
    @State private var stashSheet = false
    @State private var prompt: GitPrompt?
    @State private var note: String?

    private var checkout: GitCheckout? { repositories.checkout(path) }

    var body: some View {
        MobileList {
            if repositories.busy {
                HStack(spacing: 10) {
                    MobileLoadingRow("Working")
                    Text(repositories.progress ?? "Working").font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                }
            }
            if let problem = repositories.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            if let note {
                Text(note).font(.caption).foregroundStyle(MobileStyle.muted)
            }
            if let checkout {
                Section {
                    LabeledContent(
                        "Branch",
                        value: checkout.branch
                            ?? (checkout.status?["detached"] == .bool(true) ? "Detached HEAD" : "No commits"))
                    if let upstream = checkout.status?["upstream"]?.stringValue {
                        LabeledContent("Upstream", value: upstream)
                    }
                    LabeledContent("Ahead and behind", value: "\(checkout.ahead) ahead, \(checkout.behind) behind")
                    if let base = checkout.status?["base"]?.stringValue {
                        LabeledContent("Base", value: base)
                    }
                    if checkout.status?["live"] == .bool(false) {
                        Label("Too large to watch. Pull to refresh it.", lucideIcon: "refresh-cw", iconSize: 14)
                            .font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                }
                Section("Remote") {
                    action("Pull", icon: "arrow-down", kind: "pull")
                    action(pushLabel(checkout), icon: "arrow-up", kind: pushKind(checkout))
                    action("Sync", icon: "refresh-cw", kind: "sync")
                    action("Fetch", icon: "cloud-download", kind: "fetch")
                    Button("Force push", lucideIcon: "triangle-alert", role: .destructive) {
                        confirmation = .forcePush(cwd: path)
                    }.disabled(repositories.busy)
                }
                Section("Working tree") {
                    Button("Stash changes", lucideIcon: "archive") { prompt = .stash(cwd: path) }
                        .disabled(repositories.busy || checkout.files.isEmpty)
                    Button("Pop stash", lucideIcon: "archive-restore") {
                        if refs.stashes.count > 1 {
                            stashSheet = true
                        } else {
                            Task { await repositories.act(client: client, cwd: path, kind: "stash-pop") }
                        }
                    }.disabled(repositories.busy || refs.stashes.isEmpty)
                    if refs.capabilities {
                        Button("Create pull request", lucideIcon: "git-pull-request") {
                            prompt = .pullRequest(cwd: path, subject: refs.lastSubject)
                        }.disabled(repositories.busy)
                    }
                }
                Section {
                    NavigationLink {
                        GitBranchesPage(client: client, repositories: repositories, refs: refs, path: path)
                    } label: {
                        LabeledContent {
                            Text("\(refs.branches.count)").monospacedDigit().foregroundStyle(MobileStyle.muted)
                        } label: {
                            Label("Branches", lucideIcon: "git-branch")
                        }
                    }
                    NavigationLink {
                        GitLogPage(client: client, repositories: repositories, only: path)
                    } label: {
                        Label("History", lucideIcon: "git-commit-horizontal")
                    }
                }
            }
        }
        .navigationTitle(checkout?.label ?? "Repository")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: path) { await refs.load(client: client, cwd: path) }
        .refreshable {
            await repositories.refresh(client: client, cwd: path)
            await refs.load(client: client, cwd: path)
        }
        .mobileSheet(isPresented: $stashSheet) {
            GitStashSheet(stashes: refs.stashes, isPresented: $stashSheet) { ref in
                Task { await repositories.act(client: client, cwd: path, kind: "stash-pop", extra: ["ref": .string(ref)]) }
            }
        }
        .mobileSheet(item: $prompt) { pending in
            GitPromptSheet(pending: pending) { first, second in
                prompt = nil
                Task { await run(pending, first: first, second: second) }
            } onCancel: {
                prompt = nil
            }
        }
        .confirmationDialog(
            confirmation?.title ?? "",
            isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }),
            titleVisibility: .visible, presenting: confirmation
        ) { pending in
            Button(pending.confirmLabel, role: .destructive) {
                Task {
                    if case .forcePush(let cwd) = pending {
                        await repositories.act(client: client, cwd: cwd, kind: "force-push")
                    }
                    confirmation = nil
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { pending in
            Text(pending.detail)
        }
    }

    private func action(_ title: String, icon: String, kind: String) -> some View {
        Button(title, lucideIcon: icon) {
            Task { await repositories.act(client: client, cwd: path, kind: kind) }
        }.disabled(repositories.busy)
    }

    /// A branch git has never seen is published with an upstream in the same push, which is a different
    /// word for a person and a different flag for git.
    private func pushLabel(_ checkout: GitCheckout) -> String {
        checkout.status?["upstream"]?.stringValue == nil ? "Publish branch" : "Push"
    }

    private func pushKind(_ checkout: GitCheckout) -> String {
        checkout.status?["upstream"]?.stringValue == nil ? "publish" : "push"
    }

    private func run(_ pending: GitPrompt, first: String, second: String) async {
        switch pending {
        case .stash(let cwd):
            await repositories.act(client: client, cwd: cwd, kind: "stash", extra: ["subject": .string(first)])
            await refs.load(client: client, cwd: cwd)
        case .pullRequest(let cwd, _):
            let result = await repositories.act(
                client: client, cwd: cwd, kind: "create-pr",
                extra: ["subject": .string(first), "body": .string(second)])
            note = result?["url"]?.stringValue ?? result?.text("summary")
        case .createBranch(let cwd):
            await repositories.act(client: client, cwd: cwd, kind: "create-branch", extra: ["name": .string(first)])
            await refs.load(client: client, cwd: cwd)
        case .renameBranch(let cwd, _):
            await repositories.act(client: client, cwd: cwd, kind: "rename-branch", extra: ["name": .string(first)])
            await refs.load(client: client, cwd: cwd)
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
