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

/// What the whole git page shows: every repository the project folder holds, the changes of each
/// grouped the way a person acts on them, and the history of all of them together. The staged files
/// say where a commit lands, so there is no repository to pick first. A folder with exactly one
/// repository reads as the page always did.
struct GitPage: View {
    let client: any MachineRequesting
    let folder: String
    @State private var repositories = GitRepositories()
    @State private var commitSheet = false
    @State private var confirmation: GitConfirmation?
    @State private var diff: GitDiffTarget?
    @State private var note: String?

    private var checkouts: [GitCheckout] { repositories.checkouts }

    var body: some View {
        MobileList {
            if let problem = repositories.problem {
                VStack(alignment: .leading, spacing: 12) {
                    Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
                    Button("Try again") { Task { await repositories.reload(client: client, folder: folder) } }
                }.padding(.vertical, 8)
            }
            if repositories.busy {
                HStack(spacing: 10) {
                    MobileLoadingRow("Working")
                    Text(repositories.step ?? repositories.progress ?? "Working")
                        .font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                }
            }
            if let note {
                Text(note).font(.caption).foregroundStyle(MobileStyle.muted)
            }
            if repositories.loading {
                MobileLoadingRow("Loading").frame(maxWidth: .infinity).padding()
            } else if checkouts.isEmpty {
                ContentUnavailableView("No Git repository", lucideIcon: "git-branch", description: Text(folder))
            } else {
                changes
                repositoriesSection
            }
        }
        .navigationTitle("Git")
        .navigationDestination(item: $diff) { target in
            GitDiffPage(client: client, target: target)
        }
        .toolbar {
            ToolbarItem {
                Menu {
                    menuItems
                } label: {
                    Label("More git actions", lucideIcon: "ellipsis")
                }.disabled(repositories.busy || checkouts.isEmpty)
            }
            ToolbarItem {
                Button("Commit", lucideIcon: "circle-check") { commitSheet = true }
                    .disabled(repositories.busy || GitPanel.commitTargets(checkouts).targets.isEmpty)
            }
        }
        .task(id: folder) { await repositories.run(client: client, folder: folder) }
        .refreshable { await repositories.reload(client: client, folder: folder) }
        .mobileSheet(isPresented: $commitSheet) {
            GitCommitSheet(client: client, repositories: repositories, isPresented: $commitSheet) { note = $0 }
        }
        .confirmationDialog(
            confirmation?.title ?? "", isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }),
            titleVisibility: .visible, presenting: confirmation
        ) { pending in
            Button(pending.confirmLabel, role: .destructive) { Task { await confirm(pending) } }
            Button("Cancel", role: .cancel) {}
        } message: { pending in
            Text(pending.detail)
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
                                Task {
                                    await repositories.stage(
                                        client: client, cwd: checkout.path, paths: files.map { $0.text("path") },
                                        staged: group != "staged")
                                }
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
                            for (checkout, files) in sections {
                                await repositories.stage(
                                    client: client, cwd: checkout.path, paths: files.map { $0.text("path") },
                                    staged: group != "staged")
                            }
                        }
                    }
                }
            }
        }
        if checkouts.contains(where: { $0.status?["truncated"] == .bool(true) }) || repositories.truncated {
            Text("Some of what changed was left out of this list.").font(.caption).foregroundStyle(MobileStyle.muted)
        }
    }

    private func fileRow(checkout: GitCheckout, file: JSONValue, group: String) -> some View {
        Button {
            diff = GitDiffTarget(cwd: checkout.path, path: file.text("path"), staged: group == "staged", commit: nil)
        } label: {
            HStack(spacing: 10) {
                Text(file.text("status")).font(.caption.monospaced())
                    .foregroundStyle(gitStatusColor(file.text("status"))).frame(width: 22, alignment: .leading)
                VStack(alignment: .leading, spacing: 3) {
                    Text((file.text("path") as NSString).lastPathComponent).lineLimit(1)
                    Text(file.text("path")).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                        .truncationMode(.head)
                }
                Spacer(minLength: 8)
                Text("+\(Int(file.number("added")))  −\(Int(file.number("deleted")))")
                    .font(.caption.monospacedDigit()).foregroundStyle(MobileStyle.muted)
            }
            .modifier(MobileSidebarLabel(disclosure: true))
        }
        .modifier(MobileSidebarRow())
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(group == "staged" ? "Unstage" : "Stage") {
                Task {
                    await repositories.stage(
                        client: client, cwd: checkout.path, paths: [file.text("path")], staged: group != "staged")
                }
            }.tint(MobileStyle.accent).disabled(repositories.busy)
            if group != "conflicted" {
                Button("Discard", role: .destructive) {
                    confirmation = .discard(cwd: checkout.path, path: file.text("path"))
                }.disabled(repositories.busy)
            }
        }
        .contextMenu {
            Button(group == "staged" ? "Unstage file" : "Stage file", lucideIcon: group == "staged" ? "minus" : "plus") {
                Task {
                    await repositories.stage(
                        client: client, cwd: checkout.path, paths: [file.text("path")], staged: group != "staged")
                }
            }
            if group != "conflicted" {
                Button("Discard changes", lucideIcon: "trash-2", role: .destructive) {
                    confirmation = .discard(cwd: checkout.path, path: file.text("path"))
                }
            }
        }
    }

    @ViewBuilder private var repositoriesSection: some View {
        Section("Repositories") {
            ForEach(checkouts) { checkout in
                NavigationLink {
                    GitRepositoryPage(client: client, repositories: repositories, path: checkout.path)
                } label: {
                    HStack(spacing: 10) {
                        Image(lucide: gitRepoIcon(checkout.kind), size: 16).foregroundStyle(MobileStyle.muted)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(checkout.label).lineLimit(1)
                            if let failure = checkout.failure {
                                Text(failure).font(.caption).foregroundStyle(.red).lineLimit(1)
                            } else if let branch = checkout.branch {
                                Text(branch).font(.caption.monospaced()).foregroundStyle(MobileStyle.muted).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 8)
                        GitAheadBehind(ahead: checkout.ahead, behind: checkout.behind)
                    }
                }
            }
            NavigationLink {
                GitLogPage(client: client, repositories: repositories)
            } label: {
                Label("History", lucideIcon: "git-commit-horizontal")
            }
        }
    }

    @ViewBuilder private var menuItems: some View {
        if repositories.named {
            Button("Pull all", lucideIcon: "arrow-down") { Task { await repositories.actAll(client: client, kind: "pull") } }
            Button("Push all", lucideIcon: "arrow-up") { Task { await pushAll() } }
            Button("Sync all", lucideIcon: "refresh-cw") { Task { await repositories.actAll(client: client, kind: "sync") } }
            Button("Fetch all", lucideIcon: "cloud-download") { Task { await repositories.actAll(client: client, kind: "fetch") } }
        } else if let only = checkouts.first {
            Button("Pull", lucideIcon: "arrow-down") { Task { await repositories.act(client: client, cwd: only.path, kind: "pull") } }
            Button("Push", lucideIcon: "arrow-up") { Task { await repositories.act(client: client, cwd: only.path, kind: "push") } }
            Button("Sync", lucideIcon: "refresh-cw") { Task { await repositories.act(client: client, cwd: only.path, kind: "sync") } }
            Button("Fetch", lucideIcon: "cloud-download") { Task { await repositories.act(client: client, cwd: only.path, kind: "fetch") } }
        }
    }

    /// Every repository that has something to push, one after another. A branch git has never seen is
    /// published with an upstream in the same push, which is a different flag for git.
    private func pushAll() async {
        for entry in GitPanel.pushable(checkouts) {
            await repositories.act(client: client, cwd: entry.checkout.path, kind: entry.kind)
        }
    }

    private func confirm(_ pending: GitConfirmation) async {
        switch pending {
        case .discard(let cwd, let path):
            let stash = await repositories.discard(client: client, cwd: cwd, path: path)
            note = stash == nil ? "Nothing to discard in \(path)." : "Discarded \(path). Restore it with git stash pop \(stash!)."
        case .forcePush(let cwd):
            await repositories.act(client: client, cwd: cwd, kind: "force-push")
        case .deleteBranch(let cwd, let ref, let force):
            await repositories.act(
                client: client, cwd: cwd, kind: "delete-branch",
                extra: force ? ["ref": .string(ref), "force": .bool(true)] : ["ref": .string(ref)])
        case .checkout(let cwd, let ref):
            await repositories.act(client: client, cwd: cwd, kind: "checkout", extra: ["ref": .string(ref), "stash": .bool(true)])
        }
        confirmation = nil
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
