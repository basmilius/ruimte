import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The branches of one repository: which one is out, what switching to another costs, and the two
/// things a branch is the argument of. A branch another worktree has checked out cannot be switched
/// to here, which is git's own rule and not this page's.
struct GitBranchesPage: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let refs: GitRefsState
    let path: String
    @State private var query = ""
    @State private var prompt: GitPrompt?
    @State private var confirmation: GitConfirmation?
    @State private var remotes = false

    private var checkout: GitCheckout? { repositories.checkout(path) }
    private var shown: [JSONValue] {
        let source = remotes ? refs.refs : refs.branches
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return needle.isEmpty ? source : source.filter { $0.text("name").lowercased().contains(needle) }
    }

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
            Picker("Show", selection: $remotes) {
                Text("Local").tag(false)
                Text("All").tag(true)
            }.pickerStyle(.segmented)
            if refs.loading && refs.refs.isEmpty {
                MobileLoadingRow("Loading").frame(maxWidth: .infinity).padding()
            } else if shown.isEmpty {
                ContentUnavailableView("No branches", lucideIcon: "git-branch")
            }
            ForEach(shown, id: \.stableID) { ref in
                branchRow(ref)
            }
        }
        .searchable(text: $query, prompt: "Search branches")
        .navigationTitle("Branches")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem {
                Button("New branch", lucideIcon: "plus") { prompt = .createBranch(cwd: path) }
                    .disabled(repositories.busy)
            }
        }
        .refreshable { await refs.load(client: client, cwd: path) }
        .mobileSheet(item: $prompt) { pending in
            GitPromptSheet(pending: pending) { first, _ in
                prompt = nil
                Task {
                    switch pending {
                    case .createBranch(let cwd):
                        await repositories.act(client: client, cwd: cwd, kind: "create-branch", extra: ["name": .string(first)])
                    case .renameBranch(let cwd, _):
                        await repositories.act(client: client, cwd: cwd, kind: "rename-branch", extra: ["name": .string(first)])
                    default:
                        break
                    }
                    await refs.load(client: client, cwd: path)
                }
            } onCancel: {
                prompt = nil
            }
        }
        .confirmationDialog(
            confirmation?.title ?? "",
            isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }),
            titleVisibility: .visible, presenting: confirmation
        ) { pending in
            Button(pending.confirmLabel, role: .destructive) { Task { await confirm(pending) } }
            Button("Cancel", role: .cancel) {}
        } message: { pending in
            Text(pending.detail)
        }
    }

    private func branchRow(_ ref: JSONValue) -> some View {
        let name = ref.text("name")
        let isCurrent = ref["current"] == .bool(true)
        let elsewhere = ref["worktree"]?.stringValue
        return Button {
            Task { await switchTo(name) }
        } label: {
            HStack(spacing: 10) {
                Image(lucide: isCurrent ? "check" : "git-branch", size: 15)
                    .foregroundStyle(isCurrent ? MobileStyle.accent : MobileStyle.faint)
                VStack(alignment: .leading, spacing: 3) {
                    Text(name).font(.callout.monospaced()).lineLimit(1).truncationMode(.middle)
                    if let elsewhere {
                        Text("Checked out in \((elsewhere as NSString).lastPathComponent)")
                            .font(.caption).foregroundStyle(MobileStyle.muted)
                    } else if ref["isDefault"] == .bool(true) {
                        Text("Default branch").font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                }
                Spacer(minLength: 8)
            }.modifier(MobileSidebarLabel())
        }
        .modifier(MobileSidebarRow(selected: isCurrent))
        .disabled(repositories.busy || isCurrent || elsewhere != nil)
        .contextMenu {
            if !isCurrent && elsewhere == nil {
                Button("Switch to this branch", lucideIcon: "git-branch") { Task { await switchTo(name) } }
                Button("Merge into \(checkout?.branch ?? "HEAD")", lucideIcon: "git-merge") {
                    Task { await repositories.act(client: client, cwd: path, kind: "merge", extra: ["ref": .string(name)]) }
                }
                Button("Rebase onto this branch", lucideIcon: "git-pull-request-arrow") {
                    Task { await repositories.act(client: client, cwd: path, kind: "rebase", extra: ["ref": .string(name)]) }
                }
            }
            if isCurrent {
                Button("Rename branch", lucideIcon: "pencil") { prompt = .renameBranch(cwd: path, branch: name) }
            }
            if !isCurrent && ref.text("kind") == "local" {
                Button("Delete branch", lucideIcon: "trash-2", role: .destructive) {
                    confirmation = .deleteBranch(cwd: path, ref: name, force: false)
                }
            }
        }
    }

    /// A switch that would lose the working tree stashes it first; a clean tree switches straight away.
    private func switchTo(_ name: String) async {
        if (checkout?.files.count ?? 0) > 0 {
            confirmation = .checkout(cwd: path, ref: name)
            return
        }
        await repositories.act(client: client, cwd: path, kind: "checkout", extra: ["ref": .string(name)])
        await refs.load(client: client, cwd: path)
    }

    private func confirm(_ pending: GitConfirmation) async {
        confirmation = nil
        switch pending {
        case .checkout(let cwd, let ref):
            await repositories.act(client: client, cwd: cwd, kind: "checkout", extra: ["ref": .string(ref), "stash": .bool(true)])
        case .deleteBranch(let cwd, let ref, let force):
            let extra: [String: JSONValue] = force ? ["ref": .string(ref), "force": .bool(true)] : ["ref": .string(ref)]
            await repositories.act(client: client, cwd: cwd, kind: "delete-branch", extra: extra)
            // Git refuses to delete a branch it has not merged anywhere; that refusal earns a second ask.
            if !force, let problem = repositories.problem, gitIsUnmergedRefusal(problem) {
                confirmation = .deleteBranch(cwd: cwd, ref: ref, force: true)
                return
            }
        default:
            break
        }
        await refs.load(client: client, cwd: path)
    }
}
