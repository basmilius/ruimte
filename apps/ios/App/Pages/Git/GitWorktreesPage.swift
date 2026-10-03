import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The worktrees of one repository, each with what it holds. It is the one place a worktree whose node is
/// gone still shows up, and where it is made, merged back and removed from the phone.
struct GitWorktreesPage: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let repo: String
    var workspace: MobileWorkspace?
    @State private var state: GitWorktreesState
    @State private var diff: GitDiffTarget?

    init(client: any MachineRequesting, repositories: GitRepositories, repo: String, workspace: MobileWorkspace? = nil) {
        self.client = client
        self.repositories = repositories
        self.repo = repo
        self.workspace = workspace
        _state = State(initialValue: GitWorktreesState(repo: repo))
    }

    var body: some View {
        MobileList {
            GitWorktreeStatusRows(client: client, state: state)
            if let outcome = state.outcome {
                GitWorktreeOutcomeSection(client: client, repositories: repositories, state: state, outcome: outcome)
            }
            if state.unsupported {
                ContentUnavailableView(
                    String(localized: "Needs an update"), lucideIcon: "circle-alert",
                    description: Text("Update Ruimte on this machine to manage worktrees on the phone."))
            } else if !state.loaded {
                MobileLoadingRow(String(localized: "Loading")).frame(maxWidth: .infinity).padding()
            } else if state.worktrees.isEmpty {
                ContentUnavailableView(
                    String(localized: "No worktrees"), lucideIcon: "git-branch",
                    description: Text("A worktree is a second checkout of this repository on a branch of its own."))
            } else {
                Section {
                    ForEach(state.worktrees) { worktree in
                        GitWorktreeRow(
                            client: client, state: state, worktree: worktree,
                            occupants: workspace.flatMap { GitWorktreeOccupants.line(in: $0.views, path: worktree.path) }
                        ) { diff = $0 }
                    }
                }
            }
        }
        .navigationTitle("Worktrees")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $diff) { target in
            GitDiffPage(client: client, target: target)
        }
        .toolbar {
            ToolbarItem {
                Button(String(localized: "New worktree"), lucideIcon: "plus") { state.creating = true }
                    .disabled(state.busy || state.unsupported)
            }
        }
        .task(id: repo) {
            await RemotePageLifecycle.run(client: client, events: ["git.worktrees"], load: { await state.load(client: client) })
        }
        .refreshable { await state.load(client: client) }
        .modifier(GitWorktreeDialogs(client: client, state: state))
    }
}

/// What the worktrees of a repository are doing right now: a merge at work, what went wrong, what went through.
struct GitWorktreeStatusRows: View {
    let client: any MachineRequesting
    let state: GitWorktreesState

    var body: some View {
        if state.busy {
            GitBusyRow(
                text: state.progress ?? String(localized: "Working"),
                cancel: state.mergeAction == nil ? nil : { Task { await state.cancelMerge(client: client) } })
        }
        if let problem = state.problem, !state.unsupported {
            Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
        }
        if let note = state.note {
            Text(note).font(.caption).foregroundStyle(MobileStyle.muted)
        }
    }
}

/// One worktree: its branch, where it came from and what it holds, who works in it, and merging it back or
/// removing it with the questions of `GitWorktreeText`.
struct GitWorktreeRow: View {
    let client: any MachineRequesting
    let state: GitWorktreesState
    let worktree: GitWorktree
    /// Who works there, as the project's nodes say; nil outside a project or when nobody does.
    var occupants: String?
    let onDiff: (GitDiffTarget) -> Void

    private var diffTarget: GitDiffTarget {
        GitDiffTarget(cwd: worktree.path, path: nil, staged: false, commit: nil, base: worktree.base)
    }

    var body: some View {
        Button {
            guard !worktree.missing else { return }
            onDiff(diffTarget)
        } label: {
            HStack(spacing: 10) {
                Image(lucide: worktree.missing ? "folder-x" : "folder-git-2", size: 15)
                    .foregroundStyle(MobileStyle.muted)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text((worktree.path as NSString).lastPathComponent).lineLimit(1).truncationMode(.middle)
                        if worktree.locked {
                            Image(lucide: "lock", size: 12).foregroundStyle(MobileStyle.muted)
                                .accessibilityLabel("Locked")
                        }
                    }
                    Text([worktree.branch, occupants].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption.monospaced()).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    let detail = GitWorktreeText.rowDetail(worktree)
                    if !detail.isEmpty {
                        Text(detail).font(.caption)
                            .foregroundStyle(worktree.work?.operation != nil ? MobileStyle.statusNeedsYou : MobileStyle.muted)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
            }
            .modifier(MobileSidebarLabel(disclosure: !worktree.missing))
        }
        .modifier(MobileSidebarRow())
        .disabled(state.busy)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("Remove", role: .destructive) { Task { await state.ask(client: client, remove: worktree) } }
            if !worktree.missing {
                Button("Merge") { Task { await state.ask(client: client, merge: worktree) } }.tint(MobileStyle.accent)
            }
        }
        .contextMenu {
            if !worktree.missing {
                Button(String(localized: "View changes"), lucideIcon: "eye") { onDiff(diffTarget) }
                Button(
                    worktree.fromBranch.map { String(localized: "Merge into \($0)…") } ?? String(localized: "Merge…"),
                    lucideIcon: "git-merge"
                ) { Task { await state.ask(client: client, merge: worktree) } }
            }
            Button(String(localized: "Remove…"), lucideIcon: "trash", role: .destructive) {
                Task { await state.ask(client: client, remove: worktree) }
            }
        }
    }
}

/// How a worktree merge ended when it did not simply go through: conflicts to resolve or take back, or a
/// refusal with the one thing a person can do about it.
struct GitWorktreeOutcomeSection: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let state: GitWorktreesState
    let outcome: GitWorktreeMergeOutcome

    var body: some View {
        switch outcome {
        case .conflict(let cwd, let files, let summary):
            Section {
                Label(summary, lucideIcon: "git-merge").foregroundStyle(MobileStyle.statusNeedsYou)
                if !files.isEmpty {
                    Text(files.joined(separator: ", ")).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(4)
                }
                NavigationLink {
                    GitConflictsPage(client: client, session: repositories.conflicts.session(cwd))
                } label: {
                    Label(String(localized: "Resolve"), lucideIcon: "file-exclamation-point")
                }
                Button(String(localized: "Abort merge"), lucideIcon: "ban", role: .destructive) { state.confirmAbort = cwd }
                    .disabled(state.busy)
            } header: {
                Text("The merge waits for you")
            }
        case .refused(let code, let message, let request):
            Section {
                Label(message, lucideIcon: "triangle-alert").foregroundStyle(.red)
                if let hint = GitWorktreeText.refusalHint(code) {
                    Text(hint).font(.caption).foregroundStyle(MobileStyle.muted)
                }
                if code == "target-not-checked-out", let branch = GitWorktreeText.checkedOutBranch(message),
                    branch != request.worktree.branch
                {
                    Button(String(localized: "Merge into \(branch) instead"), lucideIcon: "git-merge") {
                        var retry = request
                        retry.into = branch
                        Task { await state.merge(client: client, request: retry) }
                    }.disabled(state.busy)
                }
                if GitWorktreeText.isOverwriteRefusal(code: code, message: message) {
                    Text(
                        "Stash and retry moves your own changes in the target checkout into a stash named \"\(GitWorktreeText.stashMessage(request.worktree.branch))\" and runs the merge again."
                    ).font(.caption).foregroundStyle(MobileStyle.muted)
                    Button(String(localized: "Stash and retry"), lucideIcon: "archive") {
                        Task { await state.stashAndRetry(client: client, request: request) }
                    }.disabled(state.busy)
                }
                if code == "agent-working" {
                    Button(String(localized: "Stop the agents and merge"), lucideIcon: "git-merge") {
                        var retry = request
                        retry.stopAgent = true
                        Task { await state.merge(client: client, request: retry) }
                    }.disabled(state.busy)
                }
                Button("Dismiss") { state.outcome = nil }
            } header: {
                Text("Merging \(request.worktree.branch) failed")
            }
        }
    }
}

/// The questions of the worktree actions, put on a page once.
struct GitWorktreeDialogs: ViewModifier {
    let client: any MachineRequesting
    @Bindable var state: GitWorktreesState

    func body(content: Content) -> some View {
        content
            .mobileSheet(isPresented: $state.creating) {
                GitPromptSheet(pending: .createWorktree(repo: state.repo)) { branch in
                    state.creating = false
                    Task { await state.add(client: client, branch: branch) }
                } onCancel: {
                    state.creating = false
                }
            }
            .mobileSheet(item: $state.merging) { worktree in
                GitWorktreeMergeSheet(worktree: worktree) { request in
                    state.merging = nil
                    Task { await state.merge(client: client, request: request) }
                } onCancel: {
                    state.merging = nil
                }
            }
            .alert(
                state.removal?.title ?? "",
                isPresented: Binding(get: { state.removal != nil }, set: { if !$0 { state.removal = nil } }),
                presenting: state.removal
            ) { pending in
                Button(pending.confirmLabel, role: .destructive) {
                    Task { state.removal = await state.remove(client: client, removal: pending) }
                }
                if pending.force && !pending.worktree.missing {
                    Button("Merge first") { state.merging = pending.worktree }
                }
                Button("Cancel", role: .cancel) {}
            } message: { pending in
                Text(pending.detail)
            }
            .alert(
                "Abort the merge?",
                isPresented: Binding(get: { state.confirmAbort != nil }, set: { if !$0 { state.confirmAbort = nil } }),
                presenting: state.confirmAbort
            ) { cwd in
                Button("Abort merge", role: .destructive) { Task { await state.abortMerge(client: client, cwd: cwd) } }
                Button("Cancel", role: .cancel) {}
            } message: { cwd in
                Text("\((cwd as NSString).lastPathComponent) goes back to how it was before the merge.")
            }
    }
}

/// The one question before a worktree is merged: whether its loose work is committed first and under what
/// message, how its branch lands, and whether the worktree goes afterwards.
struct GitWorktreeMergeSheet: View {
    let worktree: GitWorktree
    let onMerge: (GitWorktreeMergeRequest) -> Void
    let onCancel: () -> Void
    @AppStorage("ruimte.ios.worktreeMergeStrategy") private var strategy = GitMergeStrategy.squash.rawValue
    @State private var commitFirst = true
    @State private var subject = ""
    @State private var remove = true

    private var chosen: GitMergeStrategy { GitMergeStrategy(rawValue: strategy) ?? .squash }
    private var needsMessage: Bool { (worktree.hasLooseWork && commitFirst) || chosen == .squash }
    private var blocked: Bool {
        (worktree.hasLooseWork && !commitFirst) || (needsMessage && subject.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    Text("It holds \(GitWorktreeText.mergeContents(worktree)).")
                } footer: {
                    Text(
                        "It is merged in the checkout that has \(worktree.fromBranch ?? String(localized: "its target branch")) out. Nothing is stashed and no branch is moved behind a working tree."
                    )
                }
                if worktree.hasLooseWork {
                    Section {
                        Toggle("Commit the uncommitted files first", isOn: $commitFirst)
                    } footer: {
                        if !commitFirst {
                            Text("Without that commit the merge would leave half of the work behind.")
                        }
                    }
                }
                if needsMessage {
                    Section("Commit message") {
                        TextField("Commit message", text: $subject)
                            .font(.body.monospaced()).autocorrectionDisabled().textInputAutocapitalization(.never)
                    }
                }
                Section {
                    Picker("Strategy", selection: $strategy) {
                        ForEach(GitMergeStrategy.allCases) { option in
                            Text(option.label).tag(option.rawValue)
                        }
                    }.pickerStyle(.segmented)
                } header: {
                    Text("Strategy")
                } footer: {
                    Text(chosen.line)
                }
                Section {
                    Toggle("Remove the worktree and its branch afterwards", isOn: $remove)
                }
            }
            .navigationTitle(
                worktree.fromBranch.map { String(localized: "Merge \(worktree.branch) into \($0)") }
                    ?? String(localized: "Merge \(worktree.branch)"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Merge") {
                        onMerge(
                            GitWorktreeMergeRequest(
                                worktree: worktree, strategy: chosen, commitFirst: worktree.hasLooseWork && commitFirst,
                                subject: needsMessage ? subject : "", remove: remove))
                    }.disabled(blocked)
                }
            }
        }
        .task { subject = GitWorktreeText.defaultSubject(worktree.branch) }
    }
}
