import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The worktrees of one repository, each with what it holds. It is the one place a worktree whose node is
/// gone still shows up, and where it is made, merged back and removed from the phone.
struct GitWorktreesPage: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let repo: String
    @State private var state: GitWorktreesState
    @State private var creating = false
    @State private var merging: GitWorktree?
    @State private var removal: GitWorktreeRemoval?
    @State private var confirmAbort: String?
    @State private var diff: GitDiffTarget?

    init(client: any MachineRequesting, repositories: GitRepositories, repo: String) {
        self.client = client
        self.repositories = repositories
        self.repo = repo
        _state = State(initialValue: GitWorktreesState(repo: repo))
    }

    var body: some View {
        MobileList {
            if state.busy {
                HStack(spacing: 10) {
                    MobileLoadingRow("Working")
                    Text(state.progress ?? "Working").font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    if state.mergeAction != nil {
                        Spacer(minLength: 8)
                        Button("Cancel") { Task { await state.cancelMerge(client: client) } }.font(.caption)
                    }
                }
            }
            if let problem = state.problem, !state.unsupported {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            if let note = state.note {
                Text(note).font(.caption).foregroundStyle(MobileStyle.muted)
            }
            if let outcome = state.outcome {
                outcomeSection(outcome)
            }
            if state.unsupported {
                ContentUnavailableView(
                    "Needs an update", lucideIcon: "circle-alert",
                    description: Text("Update Ruimte on this machine to manage worktrees on the phone."))
            } else if !state.loaded {
                MobileLoadingRow("Loading").frame(maxWidth: .infinity).padding()
            } else if state.worktrees.isEmpty {
                ContentUnavailableView(
                    "No worktrees", lucideIcon: "git-branch",
                    description: Text("A worktree is a second checkout of this repository on a branch of its own."))
            } else {
                Section {
                    ForEach(state.worktrees) { worktree in
                        row(worktree)
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
                Button("New worktree", lucideIcon: "plus") { creating = true }.disabled(state.busy || state.unsupported)
            }
        }
        .task(id: repo) {
            await RemotePageLifecycle.run(client: client, events: ["git.worktrees"], load: { await state.load(client: client) })
        }
        .refreshable { await state.load(client: client) }
        .mobileSheet(isPresented: $creating) {
            GitPromptSheet(pending: .createWorktree(repo: repo)) { branch, _ in
                creating = false
                Task { await state.add(client: client, branch: branch) }
            } onCancel: {
                creating = false
            }
        }
        .mobileSheet(item: $merging) { worktree in
            GitWorktreeMergeSheet(worktree: worktree) { request in
                merging = nil
                Task { await state.merge(client: client, request: request) }
            } onCancel: {
                merging = nil
            }
        }
        .confirmationDialog(
            removal?.title ?? "", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }),
            titleVisibility: .visible, presenting: removal
        ) { pending in
            Button(pending.confirmLabel, role: .destructive) {
                Task { removal = await state.remove(client: client, removal: pending) }
            }
            if pending.force && !pending.worktree.missing {
                Button("Merge first") { merging = pending.worktree }
            }
            Button("Cancel", role: .cancel) {}
        } message: { pending in
            Text(pending.detail)
        }
        .confirmationDialog(
            "Abort the merge?", isPresented: Binding(get: { confirmAbort != nil }, set: { if !$0 { confirmAbort = nil } }),
            titleVisibility: .visible, presenting: confirmAbort
        ) { cwd in
            Button("Abort merge", role: .destructive) { Task { await state.abortMerge(client: client, cwd: cwd) } }
            Button("Cancel", role: .cancel) {}
        } message: { cwd in
            Text("\((cwd as NSString).lastPathComponent) goes back to how it was before the merge.")
        }
    }

    private func row(_ worktree: GitWorktree) -> some View {
        Button {
            guard !worktree.missing else { return }
            diff = GitDiffTarget(cwd: worktree.path, path: nil, staged: false, commit: nil, base: worktree.base)
        } label: {
            HStack(spacing: 10) {
                Image(lucide: worktree.missing ? "folder-x" : "git-branch", size: 15).foregroundStyle(MobileStyle.muted)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(worktree.branch).font(.callout.monospaced()).lineLimit(1).truncationMode(.middle)
                        if worktree.locked {
                            Image(lucide: "lock", size: 12).foregroundStyle(MobileStyle.muted)
                                .accessibilityLabel("Locked")
                        }
                    }
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
            Button("Remove", role: .destructive) { Task { await ask(remove: worktree) } }
            if !worktree.missing {
                Button("Merge") { Task { await ask(merge: worktree) } }.tint(MobileStyle.accent)
            }
        }
        .contextMenu {
            if !worktree.missing {
                Button("View changes", lucideIcon: "eye") {
                    diff = GitDiffTarget(cwd: worktree.path, path: nil, staged: false, commit: nil, base: worktree.base)
                }
                Button("Merge…", lucideIcon: "git-merge") { Task { await ask(merge: worktree) } }
            }
            Button("Remove…", lucideIcon: "trash-2", role: .destructive) { Task { await ask(remove: worktree) } }
        }
    }

    /// The questions are asked with the work counted now, not with the numbers on the row.
    private func ask(merge worktree: GitWorktree) async {
        guard let fresh = await state.fresh(client: client, path: worktree.path), !fresh.missing else {
            state.note = "There is no worktree left to merge."
            return
        }
        merging = fresh
    }

    private func ask(remove worktree: GitWorktree) async {
        let fresh = await state.fresh(client: client, path: worktree.path)
        guard let fresh else {
            state.note = "This worktree is already gone."
            return
        }
        removal = GitWorktreeText.removal(fresh)
    }

    @ViewBuilder private func outcomeSection(_ outcome: GitWorktreeMergeOutcome) -> some View {
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
                    Label("Resolve", lucideIcon: "file-exclamation-point")
                }
                Button("Abort merge", lucideIcon: "ban", role: .destructive) { confirmAbort = cwd }
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
                    Button("Merge into \(branch) instead", lucideIcon: "git-merge") {
                        var retry = request
                        retry.into = branch
                        Task { await state.merge(client: client, request: retry) }
                    }.disabled(state.busy)
                }
                if GitWorktreeText.isOverwriteRefusal(code: code, message: message) {
                    Text(
                        "Stash and retry moves your own changes in the target checkout into a stash named \"\(GitWorktreeText.stashMessage(request.worktree.branch))\" and runs the merge again."
                    ).font(.caption).foregroundStyle(MobileStyle.muted)
                    Button("Stash and retry", lucideIcon: "archive") {
                        Task { await state.stashAndRetry(client: client, request: request) }
                    }.disabled(state.busy)
                }
                if code == "agent-working" {
                    Button("Stop the agents and merge", lucideIcon: "git-merge") {
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
                        "It is merged in the checkout that has \(worktree.fromBranch ?? "its target branch") out. Nothing is stashed and no branch is moved behind a working tree."
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
            .navigationTitle(worktree.fromBranch.map { "Merge \(worktree.branch) into \($0)" } ?? "Merge \(worktree.branch)")
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
