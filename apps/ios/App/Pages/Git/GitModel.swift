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
