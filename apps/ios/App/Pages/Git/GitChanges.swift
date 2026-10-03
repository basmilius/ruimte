import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The Changes segment: every change of every repository grouped the way a person acts on them, what waits on a
/// person in a checkout that stopped halfway, and the commit at the bottom. A checkout that waits puts Abort and
/// Continue where the commit was, since nothing else can be committed there until it is done.
struct GitChangesList: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let folder: String
    @Binding var note: String?
    let onDiff: (GitDiffTarget) -> Void
    let onConflict: (GitConflictTarget) -> Void
    let onCommit: () -> Void
    @State private var discard: (cwd: String, path: String)?
    @State private var confirmAbort = false

    private var checkouts: [GitCheckout] { repositories.checkouts }
    /// The one checkout that stopped halfway, which then owns the bar at the bottom.
    private var halted: GitCheckout? {
        let halted = checkouts.filter(\.halted)
        return halted.count == 1 ? halted[0] : nil
    }

    var body: some View {
        MobileList {
            if let problem = repositories.problem {
                VStack(alignment: .leading, spacing: 12) {
                    Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red).textSelection(.enabled)
                    Button("Try again") { Task { await repositories.reload(client: client, folder: folder) } }
                }.padding(.vertical, 8)
            }
            if repositories.busy {
                GitBusyRow(text: repositories.step ?? repositories.progress ?? "Working")
            }
            if let note {
                Text(note).font(.caption).foregroundStyle(MobileStyle.muted).textSelection(.enabled)
            }
            if repositories.loading {
                MobileLoadingRow("Loading").frame(maxWidth: .infinity).padding()
            } else if checkouts.isEmpty {
                ContentUnavailableView("No Git repository", lucideIcon: "git-branch", description: Text(folder))
            } else {
                waiting
                ForEach(checkouts.filter(GitPanel.diverged)) { checkout in
                    GitDivergedRow(
                        client: client, repositories: repositories, checkout: checkout, named: repositories.named)
                }
                changes
            }
        }
        .refreshable { await repositories.reload(client: client, folder: folder) }
        .safeAreaInset(edge: .bottom, spacing: 0) { bar }
        .alert(
            discard.map { "Discard changes in \(($0.path as NSString).lastPathComponent)?" } ?? "",
            isPresented: Binding(get: { discard != nil }, set: { if !$0 { discard = nil } })
        ) {
            Button("Discard", role: .destructive) {
                guard let pending = discard else { return }
                Task {
                    let stash = await repositories.discard(client: client, cwd: pending.cwd, path: pending.path)
                    note =
                        stash.map { "Discarded \(pending.path). Restore it with git stash pop \($0)." }
                        ?? "Nothing to discard in \(pending.path)."
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The file goes back to what it was, and git keeps a stash to undo it with.")
        }
    }

    @ViewBuilder private var bar: some View {
        if let halted, let operation = halted.operation {
            let session = repositories.conflicts.session(halted.path)
            GitBottomBar {
                GitBarButton(title: "Abort", prominent: false, role: .destructive) { confirmAbort = true }
                    .disabled(session.busy)
                GitBarButton(title: "Continue") { Task { await finish(halted, "continue") } }
                    .disabled(session.busy || halted.conflictCount > 0)
            }
            .modifier(
                GitAbortConfirmation(operation: operation, isPresented: $confirmAbort) {
                    Task { await finish(halted, "abort") }
                })
        } else if !checkouts.isEmpty {
            GitBottomBar {
                GitBarButton(title: GitPanel.commitTitle(checkouts), action: onCommit)
                    .disabled(repositories.busy || GitPanel.commitTargets(checkouts).targets.isEmpty)
            }
        }
    }

    /// Every checkout that stopped halfway says so until it is finished or taken back.
    @ViewBuilder private var waiting: some View {
        if let halted {
            GitHaltedCard(client: client, repositories: repositories, checkout: halted, named: repositories.named)
        } else {
            let all = checkouts.filter(\.halted)
            if !all.isEmpty {
                Section("Waiting on you") {
                    ForEach(all) { checkout in
                        GitHaltedRows(
                            client: client, repositories: repositories, checkout: checkout, named: repositories.named)
                    }
                }
            }
        }
    }

    @ViewBuilder private var changes: some View {
        if repositories.changeCount == 0 {
            ContentUnavailableView("Working tree clean", lucideIcon: "circle-check")
        }
        ForEach(gitFileGroups, id: \.self) { group in
            let sections = checkouts.map { ($0, $0.files(state: group)) }.filter { !$0.1.isEmpty }
            if !sections.isEmpty {
                Section {
                    ForEach(sections, id: \.0.id) { checkout, files in
                        if repositories.named {
                            GitRepoHeaderRow(
                                checkout: checkout, count: files.count, staged: group == "staged",
                                conflicted: group == "conflicted", busy: repositories.busy
                            ) {
                                Task { await stage(checkout, files, group) }
                            }
                        }
                        ForEach(files, id: \.stableID) { file in
                            fileRow(checkout: checkout, file: file, group: group)
                        }
                    }
                } header: {
                    GitGroupHeader(
                        group: group, count: sections.reduce(0) { $0 + $1.1.count }, busy: repositories.busy
                    ) {
                        Task {
                            for (checkout, files) in sections { await stage(checkout, files, group) }
                        }
                    }
                }
            }
        }
        if checkouts.contains(where: { $0.status?["truncated"] == .bool(true) }) || repositories.truncated {
            Text("Some of what changed was left out of this list.").font(.caption).foregroundStyle(MobileStyle.muted)
        }
    }

    private func stage(_ checkout: GitCheckout, _ files: [JSONValue], _ group: String) async {
        await repositories.stage(
            client: client, cwd: checkout.path, paths: files.map { $0.text("path") }, staged: group != "staged")
    }

    private func fileRow(checkout: GitCheckout, file: JSONValue, group: String) -> some View {
        let path = file.text("path")
        let folderName = (path as NSString).deletingLastPathComponent
        return Button {
            if group == "conflicted" {
                onConflict(GitConflictTarget(cwd: checkout.path, path: path))
            } else {
                onDiff(GitDiffTarget(cwd: checkout.path, path: path, staged: group == "staged", commit: nil))
            }
        } label: {
            HStack(spacing: 10) {
                Text(group == "conflicted" ? "!" : String(file.text("status").prefix(1)))
                    .font(.caption.monospaced().weight(.semibold))
                    .foregroundStyle(
                        group == "conflicted" ? MobileStyle.statusNeedsYou : gitStatusColor(file.text("status"))
                    )
                    .frame(width: 16, alignment: .leading)
                VStack(alignment: .leading, spacing: 3) {
                    Text((path as NSString).lastPathComponent).lineLimit(1)
                    Text(
                        group == "untracked"
                            ? [folderName, "new"].filter { !$0.isEmpty }.joined(separator: " · ") : folderName
                    )
                    .font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1).truncationMode(.head)
                }
                Spacer(minLength: 8)
                if group == "conflicted" {
                    Text("Resolve").font(.caption.weight(.medium)).foregroundStyle(MobileStyle.statusNeedsYou)
                } else {
                    GitLineCounts(file: file)
                }
            }
            .modifier(MobileSidebarLabel(disclosure: true))
        }
        .modifier(MobileSidebarRow())
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(group == "staged" ? "Unstage" : group == "conflicted" ? "Stage as resolved" : "Stage") {
                Task { await stage(checkout, [file], group) }
            }.tint(MobileStyle.accent).disabled(repositories.busy)
            if group != "conflicted" {
                Button("Discard", role: .destructive) { discard = (checkout.path, path) }.disabled(repositories.busy)
            }
        }
        .contextMenu {
            Button(
                group == "staged" ? "Unstage file" : group == "conflicted" ? "Stage as resolved" : "Stage file",
                lucideIcon: group == "staged" ? "minus" : "plus"
            ) {
                Task { await stage(checkout, [file], group) }
            }
            if group != "conflicted" {
                Button("Discard changes", lucideIcon: "trash", role: .destructive) { discard = (checkout.path, path) }
            }
        }
    }

    private func finish(_ checkout: GitCheckout, _ action: String) async {
        await repositories.conflicts.session(checkout.path).finish(client: client, action: action)
        await repositories.refresh(client: client, cwd: checkout.path)
    }
}

/// A checkout that stopped halfway, as the head of the Changes segment: what waits, how many files still
/// conflict, and the way to all of them. Abort and Continue sit in the bar below it.
struct GitHaltedCard: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let checkout: GitCheckout
    let named: Bool

    private var session: GitConflictSession { repositories.conflicts.session(checkout.path) }

    var body: some View {
        NavigationLink {
            GitConflictsPage(client: client, session: session)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(lucide: "git-merge", size: 16)
                    Text(GitHaltedText.title(checkout, named: named)).font(.callout.weight(.semibold))
                }
                .foregroundStyle(MobileStyle.statusNeedsYou)
                Text(
                    GitHaltedText.detail(
                        checkout, ours: session.loaded ? session.ours : nil,
                        theirs: session.loaded ? session.theirs : nil)
                )
                .font(.caption).foregroundStyle(MobileStyle.muted)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(MobileStyle.statusNeedsYou.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
        }
        .task(id: checkout.conflictCount) { await session.load(client: client) }
        if session.busy {
            GitBusyRow(text: session.progress ?? "Working")
        }
        if let problem = session.problem {
            Label(problem, lucideIcon: "triangle-alert").font(.caption).foregroundStyle(.red)
        }
        if let note = session.note {
            Text(note).font(.caption).foregroundStyle(MobileStyle.muted)
        }
    }
}

/// The words for a checkout that waits on a person.
enum GitHaltedText {
    static func title(_ checkout: GitCheckout, named: Bool) -> String {
        let what =
            switch checkout.operation {
            case "merge": "A merge waits on you"
            case "rebase": "A rebase waits on you"
            case "cherry-pick": "A cherry-pick waits on you"
            case "revert": "A revert waits on you"
            default: "Files conflict"
            }
        return named ? "\(what) (\(checkout.label))" : what
    }

    static func detail(_ checkout: GitCheckout, ours: String?, theirs: String?) -> String {
        let count = checkout.conflictCount
        let files =
            count == 0
            ? "Every file is resolved; Continue finishes it."
            : count == 1 ? "1 file conflicts." : "\(count) files conflict."
        guard let ours, let theirs else { return files }
        return "\(ours) against \(theirs). \(files)"
    }
}
