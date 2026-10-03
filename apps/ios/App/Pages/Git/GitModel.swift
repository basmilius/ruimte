import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// One checkout the git page draws, with what was last read of it. A project folder is one or more of
/// these: the repository the folder is in, its initialized submodules, and the repositories sitting
/// beside it. A folder with exactly one reads as the page always did.
struct GitCheckout: Identifiable, Equatable {
    let path: String
    /// What a person reads: the path under the project folder, or the folder's own name for the
    /// repository the folder itself is in.
    let label: String
    /// `root`, `submodule` or `nested`, as `git.repos` reports it.
    let kind: String
    var status: JSONValue?
    var failure: String?

    var id: String { path }
    var branch: String? { status?["branch"]?.stringValue }
    var files: [JSONValue] { status?.list("files") ?? [] }
    var isRepository: Bool { status?["repo"] == .bool(true) }
    var ahead: Int { Int(status?.number("ahead") ?? 0) }
    var behind: Int { Int(status?.number("behind") ?? 0) }
    /// The merge, rebase, cherry-pick or revert that stopped halfway in this checkout.
    var operation: String? { status?["operation"]?.stringValue }
    var conflictCount: Int { files(state: "conflicted").count }
    /// Whether something waits on a person here; a machine from before `operation` only says so with conflicts.
    var halted: Bool { operation != nil || conflictCount > 0 }

    func files(state: String) -> [JSONValue] { files.filter { $0.text("state") == state } }
    var hasStaged: Bool { files.contains { $0.text("state") == "staged" } }
}

/// The groups a change falls in, in the order a person acts on them.
let gitFileGroups = ["conflicted", "staged", "unstaged", "untracked"]

enum GitPanel {
    /// The label a repository is listed under, for a page that only has its path.
    static func label(folder: String, path: String) -> String {
        guard path != folder, path.hasPrefix(folder + "/") else { return (path as NSString).lastPathComponent }
        return String(path.dropFirst(folder.count + 1))
    }

    /// One checkout's status without the repositories standing inside it. A repository git does not
    /// track shows up in the one above it as a single untracked folder (`inner/`), and the page already
    /// draws that repository as a section of its own. A submodule is tracked and stays: its gitlink is a
    /// change the repository above it has to commit.
    static func withoutNestedRepos(_ status: JSONValue?, root: String, others: [String]) -> JSONValue? {
        guard case .object(var fields)? = status else { return status }
        let inside = Set(others.filter { $0.hasPrefix(root + "/") }.map { String($0.dropFirst(root.count + 1)) + "/" })
        if inside.isEmpty { return status }
        let files = (fields["files"]?.arrayValue ?? []).filter {
            $0.text("state") != "untracked" || !inside.contains($0.text("path"))
        }
        guard files.count != fields["files"]?.arrayValue?.count else { return status }
        fields["files"] = .array(files)
        return .object(fields)
    }

    /// Where a commit would land. Every repository with something staged takes it, which is how a person
    /// says with the files themselves what belongs in one commit. Nothing staged anywhere and exactly one
    /// repository with changes is the commit that stages that repository first; with more than one,
    /// staging is what has to say which of them is meant, so there is nothing to commit yet.
    static func commitTargets(_ checkouts: [GitCheckout]) -> (targets: [GitCheckout], stageAll: Bool) {
        let staged = checkouts.filter(\.hasStaged)
        if !staged.isEmpty { return (staged, false) }
        let changed = checkouts.filter { !$0.files.isEmpty }
        return changed.count == 1 ? (changed, true) : ([], false)
    }

    /// The repositories a push would move, and what each one's push is called: a branch git has never
    /// seen is published with an upstream in the same push, which is another flag for git.
    static func pushable(_ checkouts: [GitCheckout]) -> [(checkout: GitCheckout, kind: String)] {
        checkouts.compactMap { checkout in
            guard checkout.isRepository, checkout.branch != nil else { return nil }
            if checkout.status?["upstream"]?.stringValue == nil { return (checkout, "publish") }
            return checkout.ahead > 0 ? (checkout, "push") : nil
        }
    }
}

/// A page of one checkout's log, as the merge below takes it.
struct GitLoadedLog {
    let cwd: String
    let repo: String
    var commits: [JSONValue]
    /// Nil when this checkout has no further page.
    var cursor: String?
}

/// One commit with the checkout it came out of.
struct GitLogRow: Identifiable {
    let cwd: String
    let repo: String
    let commit: JSONValue

    var id: String { cwd + "\u{0}" + commit.text("hash") }
    var at: Double { commit.number("at") }
}

extension GitPanel {
    /// The logs of several checkouts as one history, newest first. Every page covers a different stretch
    /// of time, so the merge reaches no further down than the newest of the pages that have more to give:
    /// under that line a repository could still hold a commit older than the rows around it, and putting
    /// those rows in now would mean moving them later. They come with the next page instead.
    static func mergeLogs(_ logs: [GitLoadedLog]) -> (rows: [GitLogRow], more: Bool) {
        let floors = logs.filter { $0.cursor != nil && !$0.commits.isEmpty }.map { $0.commits[$0.commits.count - 1].number("at") }
        let floor = floors.max()
        let rows =
            logs
            .flatMap { log in log.commits.map { GitLogRow(cwd: log.cwd, repo: log.repo, commit: $0) } }
            .filter { floor == nil || $0.at >= floor! }
            .sorted { $0.at > $1.at }
        return (rows, logs.contains { $0.cursor != nil })
    }
}

/// The three parts of the git sheet, in the order the design draws its segments.
enum GitSegment: String, CaseIterable, Identifiable {
    case changes, history, branches

    var id: String { rawValue }
    var title: String {
        switch self {
        case .changes: String(localized: "Changes")
        case .history: String(localized: "History")
        case .branches: String(localized: "Branches")
        }
    }
}

extension GitPanel {
    /// A branch that moved on both sides, which a pull does not bring together until a person says how.
    static func diverged(_ checkout: GitCheckout) -> Bool {
        checkout.isRepository && checkout.ahead > 0 && checkout.behind > 0
    }

    /// What the pill at the top of the sheet says: the branch of the one repository, or how many there are.
    static func pillTitle(_ checkouts: [GitCheckout]) -> String {
        if checkouts.count > 1 { return String(localized: "\(checkouts.count) repositories") }
        guard let only = checkouts.first else { return "Git" }
        if let branch = only.branch { return branch }
        return only.status?["detached"] == .bool(true) ? String(localized: "Detached HEAD") : String(localized: "No commits")
    }

    /// The words on the commit bar: how many files go in, which is everything when nothing is staged yet.
    static func commitTitle(_ checkouts: [GitCheckout]) -> String {
        let plan = commitTargets(checkouts)
        guard !plan.targets.isEmpty else { return String(localized: "Commit", comment: "Git commit button") }
        let count = plan.targets.reduce(0) { total, checkout in
            total + (plan.stageAll ? checkout.files.count : checkout.files(state: "staged").count)
        }
        return String(localized: "Commit \(count) files")
    }

    /// One line per repository on the repositories page: where it stands, in a word or two.
    static func repositoryState(_ checkout: GitCheckout) -> String {
        if let failure = checkout.failure { return failure }
        guard checkout.isRepository else { return String(localized: "Not a repository") }
        if diverged(checkout) { return String(localized: "diverged", comment: "State of a git branch") }
        let changed = checkout.files.count
        return changed == 0
            ? String(localized: "clean", comment: "State of a git repository")
            : String(localized: "\(changed) changed", comment: "Number of changed files in a git repository")
    }
}

/// Git at work, with the desktop's spinner and the last line git wrote.
struct GitBusyRow: View {
    let text: String
    var cancel: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            Spinner(size: 14, label: String(localized: "Working")).foregroundStyle(MobileStyle.statusRunning)
            Text(text).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
            if let cancel {
                Spacer(minLength: 8)
                Button("Cancel", action: cancel).font(.caption)
            }
        }
    }
}

/// A wide button that floats over the bottom of a git page, glass since it stands above the list.
struct GitBarButton: View {
    let title: String
    var prominent = true
    var role: ButtonRole?
    let action: () -> Void

    var body: some View {
        if prominent {
            label.buttonStyle(.glassProminent).tint(role == .destructive ? .red : MobileStyle.accent)
        } else {
            label.buttonStyle(.glass)
        }
    }

    private var label: some View {
        Button(role: role, action: action) {
            Text(title).font(.body.weight(.semibold)).lineLimit(1).frame(maxWidth: .infinity, minHeight: 36)
        }
    }
}

/// The bar the buttons of a git page stand in, over the bottom of its list.
struct GitBottomBar<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 10) { content }
            .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 12)
    }
}
