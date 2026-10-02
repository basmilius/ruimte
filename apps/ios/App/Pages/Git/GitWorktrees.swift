import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// One worktree of a repository as `git.worktree-list` answers it, with the work it holds when the list
/// was asked to count it.
struct GitWorktree: Identifiable, Equatable {
    struct Work: Equatable {
        var changed = 0
        var untracked = 0
        /// Commits the branch it was made from lacks.
        var ahead = 0
        /// A rebase, merge, cherry-pick or revert that stopped halfway in it.
        var operation: String?
        var behind = 0
    }

    let path: String
    let branch: String
    let fromBranch: String?
    let fromCommit: String?
    let missing: Bool
    let locked: Bool
    let work: Work?

    var id: String { path }

    init(json: JSONValue) {
        path = json.text("path")
        branch = json.text("branch")
        fromBranch = json["from"]?["branch"]?.stringValue
        fromCommit = json["from"]?["commit"]?.stringValue
        missing = json["missing"] == .bool(true)
        locked = json["locked"] == .bool(true)
        work = json["work"].map { work in
            Work(
                changed: Int(work.number("changed")), untracked: Int(work.number("untracked")),
                ahead: Int(work.number("ahead")), operation: work["operation"]?.stringValue,
                behind: Int(work.number("behind")))
        }
    }

    init(
        path: String, branch: String, fromBranch: String? = nil, fromCommit: String? = nil, missing: Bool = false,
        locked: Bool = false, work: Work? = nil
    ) {
        self.path = path
        self.branch = branch
        self.fromBranch = fromBranch
        self.fromCommit = fromCommit
        self.missing = missing
        self.locked = locked
        self.work = work
    }

    /// The branch its commits are counted against, in words; one the register does not know was measured against the base.
    var target: String { fromBranch ?? "the base branch" }
    var hasWork: Bool {
        guard let work else { return false }
        return work.changed + work.untracked + work.ahead > 0 || work.operation != nil
    }
    var hasLooseWork: Bool { (work?.changed ?? 0) + (work?.untracked ?? 0) > 0 }
    /// What its diff measures from: the branch it was made from, or the commit when that was a detached HEAD.
    var base: String? { fromBranch ?? fromCommit }
}

/// How a worktree's branch lands on the branch it was made from, in the order the sheet offers them.
enum GitMergeStrategy: String, CaseIterable, Identifiable {
    case squash, merge, rebase

    var id: String { rawValue }

    var label: String {
        switch self {
        case .squash: "Squash"
        case .merge: "Merge"
        case .rebase: "Rebase"
        }
    }

    var line: String {
        switch self {
        case .squash: "One commit on the target with the message below."
        case .merge: "A merge commit; every commit of the worktree stays in the history."
        case .rebase: "The commits on top of the target, in a straight line."
        }
    }
}

/// What a person set up for one merge, kept so a refusal can be tried again with one thing changed.
struct GitWorktreeMergeRequest: Equatable {
    var worktree: GitWorktree
    var strategy: GitMergeStrategy
    var commitFirst = false
    var subject = ""
    var remove = false
    var stopAgent = false
    var into: String?

    func payload(repo: String, actionId: String) -> JSONValue {
        var fields: [String: JSONValue] = [
            "repo": .string(repo), "path": .string(worktree.path), "actionId": .string(actionId),
            "strategy": .string(strategy.rawValue),
        ]
        let message = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        if !message.isEmpty { fields["subject"] = .string(message) }
        if commitFirst { fields["commitFirst"] = .bool(true) }
        if remove { fields["remove"] = .bool(true) }
        if stopAgent { fields["stopAgent"] = .bool(true) }
        if let into { fields["into"] = .string(into) }
        return .object(fields)
    }
}

/// How a merge ended when it did not simply go through.
enum GitWorktreeMergeOutcome: Equatable {
    /// The merge waits in `cwd`, the checkout that has the target branch out, for a person to resolve or abort it.
    case conflict(cwd: String, files: [String], summary: String)
    case refused(code: String, message: String, request: GitWorktreeMergeRequest)
}

/// The question before a worktree goes. With work in it the numbers are the question, since they are
/// exactly what is lost, and the answer then has to go out with `force`.
struct GitWorktreeRemoval: Identifiable, Equatable {
    let worktree: GitWorktree
    let title: String
    let detail: String
    let confirmLabel: String
    let force: Bool

    var id: String { worktree.path }
}

enum GitWorktreeText {
    private static func plural(_ count: Int, _ one: String, _ other: String) -> String {
        count == 1 ? "1 \(one)" : "\(count) \(other)"
    }

    /// Clauses into one sentence, with "and" before the last one.
    static func join(_ parts: [String]) -> String {
        guard parts.count > 1 else { return parts.first ?? "" }
        return parts.dropLast().joined(separator: ", ") + " and " + parts[parts.count - 1]
    }

    /// "3 uncommitted files, 2 new files and 1 commit that main lacks", leaving out what is zero.
    static func workSentence(_ worktree: GitWorktree) -> String {
        guard let work = worktree.work else { return "" }
        var parts: [String] = []
        if work.changed > 0 { parts.append(plural(work.changed, "uncommitted file", "uncommitted files")) }
        if work.untracked > 0 { parts.append(plural(work.untracked, "new file", "new files")) }
        if work.ahead > 0 {
            parts.append(plural(work.ahead, "commit that \(worktree.target) lacks", "commits that \(worktree.target) lacks"))
        }
        if let operation = work.operation { parts.append("a \(operation) that stopped halfway") }
        return join(parts)
    }

    /// The line under a row: where it came from and what it holds, behind included, since that is not lost.
    static func rowDetail(_ worktree: GitWorktree) -> String {
        if worktree.missing { return "Folder missing" }
        var parts: [String] = []
        if let from = worktree.fromBranch { parts.append("from \(from)") }
        let held = workSentence(worktree)
        if !held.isEmpty { parts.append(held) }
        if let behind = worktree.work?.behind, behind > 0 {
            parts.append(plural(behind, "commit behind \(worktree.target)", "commits behind \(worktree.target)"))
        }
        return parts.joined(separator: ", ")
    }

    /// "2 commits and 3 uncommitted files" over a worktree, or "nothing yet".
    static func mergeContents(_ worktree: GitWorktree) -> String {
        var parts: [String] = []
        if let ahead = worktree.work?.ahead, ahead > 0 { parts.append(plural(ahead, "commit", "commits")) }
        let loose = (worktree.work?.changed ?? 0) + (worktree.work?.untracked ?? 0)
        if loose > 0 { parts.append(plural(loose, "uncommitted file", "uncommitted files")) }
        return parts.isEmpty ? "nothing yet" : join(parts)
    }

    /// Written into the repository rather than onto a screen, so it reads the same as the desktop's.
    static func defaultSubject(_ branch: String) -> String { "\(branch): work of the agent" }

    static func removal(_ worktree: GitWorktree) -> GitWorktreeRemoval {
        let title = "Remove worktree \(worktree.branch)?"
        let lock = worktree.locked ? " It is locked with git worktree lock." : ""
        guard worktree.hasWork else {
            let clean =
                "Nothing in it is lost: it holds no uncommitted files, no new files and no commits that \(worktree.target) lacks."
            return GitWorktreeRemoval(
                worktree: worktree, title: title,
                detail: (worktree.missing ? "Its folder is already gone. " : "") + clean + lock,
                confirmLabel: worktree.locked ? "Remove anyway" : "Remove", force: worktree.locked)
        }
        let detail =
            worktree.missing
            ? "Its folder is already gone, and the branch holds \(workSentence(worktree)). Those commits are lost with the branch."
            : "It holds \(workSentence(worktree)). They are lost, and so is the branch. Files git ignores in it, such as .env or a local database, go too."
        return GitWorktreeRemoval(worktree: worktree, title: title, detail: detail + lock, confirmLabel: "Remove anyway", force: true)
    }

    static func removed(branch: String, result: JSONValue) -> String {
        if result["branchDeleted"] == .bool(false) { return "Removed worktree \(branch). The branch \(branch) stays." }
        if let commit = result["branchCommit"]?.stringValue {
            return "Removed worktree \(branch) and its branch. \"git branch \(branch) \(commit.prefix(12))\" brings it back."
        }
        return "Removed worktree \(branch)."
    }

    static func merged(_ result: JSONValue) -> String {
        let summary = result.text("summary", fallback: "Merged.")
        if let kept = result["kept"]?.stringValue { return "\(summary) The worktree stays: \(kept)" }
        if result["removed"] == .bool(true) {
            return result["branchDeleted"] == .bool(false)
                ? "\(summary) Removed the worktree; its branch stays." : "\(summary) Removed the worktree and its branch."
        }
        return summary
    }

    /// The branch a `target-not-checked-out` refusal says the project folder is on, to offer merging into that one.
    static func checkedOutBranch(_ message: String) -> String? {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasSuffix("."), let range = trimmed.range(of: " is on ", options: .backwards) else { return nil }
        let branch = String(trimmed[range.upperBound..<trimmed.index(before: trimmed.endIndex)])
        guard !branch.isEmpty, !branch.contains(" ") else { return nil }
        return branch
    }

    /// Git refusing a merge over a changed file of the person's, which a stash would move out of the way.
    static func isOverwriteRefusal(code: String, message: String) -> Bool {
        code == "git-failed"
            && (message.range(of: "would be overwritten by merge", options: .caseInsensitive) != nil
                || message.range(of: "commit your changes or stash them", options: .caseInsensitive) != nil)
    }

    /// What the stash before a retried merge is called, so it is found again.
    static func stashMessage(_ branch: String) -> String { "Before merging \(branch)" }

    /// The checkout a worktree's branch is merged into: the folder when that is on the target, or the
    /// worktree that has it out. Nil when nothing has it out, which the daemon refuses too.
    static func targetCheckout(folder: String, folderBranch: String?, worktrees: [GitWorktree], into: String?) -> String? {
        guard let into else { return nil }
        if folderBranch == into { return folder }
        return worktrees.first { $0.branch == into && !$0.missing }?.path
    }

    /// The one thing a person can do about a refusal, in words, for the codes that have one.
    static func refusalHint(_ code: String) -> String? {
        switch code {
        case "target-not-checked-out":
            "A worktree is merged in the checkout that has the target branch out, and never by moving a branch behind a working tree. Check that branch out in the project folder or in a worktree first."
        case "target-busy": "Finish or abort what waits in the target checkout first."
        case "target-dirty": "Commit or stash the changes in the target checkout first."
        case "worktree-busy": "Finish or abort what waits in the worktree first."
        case "agent-working": "An agent is still working in the worktree."
        default: nil
        }
    }
}

/// The worktrees of one repository and everything done to them from the phone.
@MainActor @Observable final class GitWorktreesState {
    let repo: String
    private(set) var worktrees: [GitWorktree] = []
    private(set) var loaded = false
    private(set) var unsupported = false
    var problem: String?
    var note: String?
    var busy = false
    var progress: String?
    var outcome: GitWorktreeMergeOutcome?
    private(set) var mergeAction: String?

    init(repo: String) {
        self.repo = repo
    }

    func load(client: any MachineRequesting) async {
        do {
            let answer = try await client.request(
                "git.worktree-list", payload: .object(["repo": .string(repo), "inspect": .bool(true)]))
            worktrees = answer.list("worktrees").map(GitWorktree.init(json:))
            unsupported = false
        } catch is CancellationError {
            return
        } catch {
            if gitRefusalCode(error) == "unknown-request" { unsupported = true }
            problem = gitMessage(error, action: "manage worktrees on the phone")
        }
        loaded = true
    }

    /// The worktree counted again, for a question that has to show what is in it now and not a minute ago.
    func fresh(client: any MachineRequesting, path: String) async -> GitWorktree? {
        await load(client: client)
        return worktrees.first { $0.path == path }
    }

    func add(client: any MachineRequesting, branch: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        let name = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let result = try await client.request(
                "git.worktree-add", payload: .object(["repo": .string(repo), "branch": .string(name)]))
            problem = nil
            note = result["created"] == .bool(false) ? "\(name) already had a worktree." : "Made a worktree for \(name)."
        } catch {
            problem = gitMessage(error, action: "make worktrees on the phone")
        }
        await load(client: client)
    }

    func merge(client: any MachineRequesting, request: GitWorktreeMergeRequest) async {
        guard !busy else { return }
        busy = true
        outcome = nil
        let actionId = UUID().uuidString
        mergeAction = actionId
        let cancel = client.subscribe("git.progress") { [weak self] payload in
            guard payload.text("actionId") == actionId else { return }
            let line = payload.text("line")
            self?.progress = line.isEmpty ? nil : line
        }
        defer {
            cancel()
            busy = false
            progress = nil
            mergeAction = nil
        }
        do {
            let result = try await client.request("git.worktree-merge", payload: request.payload(repo: repo, actionId: actionId))
            problem = nil
            if let conflicts = result["conflicts"]?.arrayValue {
                outcome = .conflict(
                    cwd: result.text("cwd", fallback: repo), files: conflicts.compactMap(\.stringValue),
                    summary: result.text("summary"))
                note = nil
            } else {
                note = GitWorktreeText.merged(result)
            }
        } catch is CancellationError {
        } catch {
            if gitRefusalCode(error) == "unknown-request" {
                problem = gitMessage(error, action: "merge worktrees on the phone")
            } else {
                outcome = .refused(code: gitRefusalCode(error) ?? "failed", message: error.localizedDescription, request: request)
            }
        }
        await load(client: client)
    }

    /// The person's own changes in the target checkout parked in a stash named after the merge, and the
    /// merge run again as it was set up. Only ever on their explicit word, after git refused to overwrite.
    func stashAndRetry(client: any MachineRequesting, request: GitWorktreeMergeRequest) async {
        guard !busy else { return }
        busy = true
        let into = request.into ?? request.worktree.fromBranch
        let message = GitWorktreeText.stashMessage(request.worktree.branch)
        var target: String?
        do {
            let status = try await client.request("git.status", payload: .object(["cwd": .string(repo)]))
            let list = try await client.request("git.worktree-list", payload: .object(["repo": .string(repo)]))
            target = GitWorktreeText.targetCheckout(
                folder: repo, folderBranch: status["branch"]?.stringValue,
                worktrees: list.list("worktrees").map(GitWorktree.init(json:)), into: into)
            if let target {
                _ = try await client.request(
                    "git.action",
                    payload: .object([
                        "cwd": .string(target), "actionId": .string(UUID().uuidString), "kind": .string("stash"),
                        "subject": .string(message),
                    ]))
            }
        } catch {
            busy = false
            problem = "Stashing failed: \(gitMessage(error, action: "stash on the phone"))"
            return
        }
        busy = false
        guard let target else {
            problem = "\(into ?? "The target branch") is not checked out anywhere."
            return
        }
        note = nil
        await merge(client: client, request: request)
        let stashed = "Your changes in \((target as NSString).lastPathComponent) are in the stash \"\(message)\"."
        note = [stashed, note].compactMap { $0 }.joined(separator: "\n")
    }

    func cancelMerge(client: any MachineRequesting) async {
        guard let mergeAction else { return }
        _ = try? await client.request("git.cancel", payload: .object(["actionId": .string(mergeAction)]))
    }

    /// Takes back a merge that stopped on a conflict, in the checkout it waits in.
    func abortMerge(client: any MachineRequesting, cwd: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await client.request("git.worktree-abort", payload: .object(["cwd": .string(cwd)]))
            outcome = nil
            problem = nil
            note = "Took the merge back."
        } catch {
            problem = gitMessage(error, action: "abort a worktree merge on the phone")
        }
        await load(client: client)
    }

    /// Removes the worktree as the question asked. A refusal over work that showed up in between comes
    /// back as a new question with the new numbers.
    func remove(client: any MachineRequesting, removal: GitWorktreeRemoval) async -> GitWorktreeRemoval? {
        guard !busy else { return nil }
        busy = true
        defer { busy = false }
        let worktree = removal.worktree
        var payload: [String: JSONValue] = ["repo": .string(repo), "path": .string(worktree.path)]
        if removal.force { payload["force"] = .bool(true) }
        do {
            let result = try await client.request("git.worktree-remove", payload: .object(payload))
            problem = nil
            note = GitWorktreeText.removed(branch: worktree.branch, result: result)
        } catch {
            let code = gitRefusalCode(error)
            if !removal.force, code == "worktree-has-work" || code == "worktree-locked",
                let again = await fresh(client: client, path: worktree.path), GitWorktreeText.removal(again).force
            {
                return GitWorktreeText.removal(again)
            }
            problem = gitMessage(error, action: "remove worktrees on the phone")
        }
        await load(client: client)
        return nil
    }
}
