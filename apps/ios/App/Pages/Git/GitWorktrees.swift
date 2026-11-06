import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// One worktree of a repository as `git.worktree-list` answers it, with the work it holds when the list
/// was asked to count it. Its `work.ahead` counts commits the branch it was made from lacks, and its `work.operation`
/// is a rebase, merge, cherry-pick or revert that stopped halfway in it.
typealias GitWorktree = Worktree

extension Worktree: Identifiable {
    public var id: String { path }

    var fromBranch: String? { from?.branch }
    var fromCommit: String? { from?.commit }
    var isMissing: Bool { missing ?? false }
    var isLocked: Bool { locked ?? false }

    /// The branch its commits are counted against, in words; one the register does not know was measured against the base.
    var target: String { fromBranch ?? String(localized: "the base branch") }
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
        case .squash: String(localized: "Squash", comment: "Git merge strategy")
        case .merge: String(localized: "Merge", comment: "Git merge strategy")
        case .rebase: String(localized: "Rebase", comment: "Git merge strategy")
        }
    }

    var line: String {
        switch self {
        case .squash: String(localized: "One commit on the target with the message below.")
        case .merge: String(localized: "A merge commit. Every worktree commit stays in history.")
        case .rebase: String(localized: "The commits on top of the target, in a straight line.")
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
    /// Clauses into one sentence, with "and" before the last one.
    static func join(_ parts: [String]) -> String {
        guard parts.count > 1 else { return parts.first ?? "" }
        let rest = parts.dropLast().joined(separator: ", ")
        return String(localized: "\(rest) and \(parts[parts.count - 1])", comment: "The last two parts of a list")
    }

    /// "3 uncommitted files, 2 new files and 1 commit that main lacks", leaving out what is zero.
    static func workSentence(_ worktree: GitWorktree) -> String {
        guard let work = worktree.work else { return "" }
        var parts: [String] = []
        if work.changed > 0 { parts.append(String(localized: "\(work.changed) uncommitted files")) }
        if work.untracked > 0 { parts.append(String(localized: "\(work.untracked) new files")) }
        if work.ahead > 0 {
            parts.append(
                String(localized: "\(work.ahead) commits that \(worktree.target) lacks", comment: "%@ is a git branch"))
        }
        if let operation = work.operation { parts.append(halted(operation)) }
        return join(parts)
    }

    private static func halted(_ operation: String) -> String {
        switch operation {
        case "merge": String(localized: "a merge that stopped halfway")
        case "rebase": String(localized: "a rebase that stopped halfway")
        case "cherry-pick": String(localized: "a cherry-pick that stopped halfway")
        case "revert": String(localized: "a revert that stopped halfway")
        default: String(localized: "an operation that stopped halfway")
        }
    }

    /// The line under a row: where it came from and what it holds, behind included, since that is not lost.
    static func rowDetail(_ worktree: GitWorktree) -> String {
        if worktree.isMissing { return String(localized: "Folder missing") }
        var parts: [String] = []
        if let from = worktree.fromBranch {
            parts.append(String(localized: "from \(from)", comment: "%@ is a git branch"))
        }
        let held = workSentence(worktree)
        if !held.isEmpty { parts.append(held) }
        if let behind = worktree.work?.behind, behind > 0 {
            parts.append(
                String(localized: "\(behind) commits behind \(worktree.target)", comment: "%@ is a git branch"))
        }
        return parts.joined(separator: ", ")
    }

    /// "2 commits and 3 uncommitted files" over a worktree, or "nothing yet".
    static func mergeContents(_ worktree: GitWorktree) -> String {
        var parts: [String] = []
        if let ahead = worktree.work?.ahead, ahead > 0 { parts.append(String(localized: "\(ahead) commits")) }
        let loose = (worktree.work?.changed ?? 0) + (worktree.work?.untracked ?? 0)
        if loose > 0 { parts.append(String(localized: "\(loose) uncommitted files")) }
        return parts.isEmpty ? String(localized: "nothing yet") : join(parts)
    }

    /// Written into the repository rather than onto a screen, so it reads the same as the desktop's.
    static func defaultSubject(_ branch: String) -> String { "\(branch): work of the agent" }

    static func removal(_ worktree: GitWorktree) -> GitWorktreeRemoval {
        let title = String(localized: "Remove worktree \(worktree.branch)?")
        let lock = worktree.isLocked ? String(localized: "It is locked with git worktree lock.") : nil
        guard worktree.hasWork else {
            let clean = String(
                localized:
                    "Nothing is lost. No uncommitted files, new files or commits that \(worktree.target) lacks."
            )
            let gone = worktree.isMissing ? String(localized: "Its folder is already gone.") : nil
            return GitWorktreeRemoval(
                worktree: worktree, title: title,
                detail: [gone, clean, lock].compactMap { $0 }.joined(separator: " "),
                confirmLabel: worktree.isLocked ? String(localized: "Remove anyway") : String(localized: "Remove"),
                force: worktree.isLocked)
        }
        let held = workSentence(worktree)
        let detail =
            worktree.isMissing
            ? String(
                localized:
                    "Its folder is already gone, and the branch holds \(held). Those commits are lost with the branch.")
            : String(
                localized:
                    "It holds \(held). They are lost, and so is the branch. Files git ignores in it, such as .env or a local database, go too."
            )
        return GitWorktreeRemoval(
            worktree: worktree, title: title, detail: [detail, lock].compactMap { $0 }.joined(separator: " "),
            confirmLabel: String(localized: "Remove anyway"), force: true)
    }

    static func removed(branch: String, result: WorktreeRemoveResult) -> String {
        if result.branchDeleted == false {
            return String(localized: "Removed worktree \(branch). The branch \(branch) stays.")
        }
        if let commit = result.branchCommit {
            let revive = "git branch \(branch) \(commit.prefix(12))"
            return String(
                localized: "Removed worktree \(branch) and its branch. \"\(revive)\" brings it back.",
                comment: "%2$@ is a git command")
        }
        return String(localized: "Removed worktree \(branch).")
    }

    static func merged(_ result: WorktreeMergeResult) -> String {
        let summary = result.summary
        if let kept = result.kept {
            return String(
                localized: "\(summary) The worktree stays: \(kept)",
                comment: "%1$@ is what the merge did, %2$@ why the worktree stays")
        }
        if result.removed == true {
            return result.branchDeleted == false
                ? String(
                    localized: "\(summary) Removed the worktree. Its branch stays.", comment: "%@ is what the merge did"
                )
                : String(
                    localized: "\(summary) Removed the worktree and its branch.", comment: "%@ is what the merge did")
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
    static func targetCheckout(folder: String, folderBranch: String?, worktrees: [GitWorktree], into: String?)
        -> String?
    {
        guard let into else { return nil }
        if folderBranch == into { return folder }
        return worktrees.first { $0.branch == into && !$0.isMissing }?.path
    }

    /// The one thing a person can do about a refusal, in words, for the codes that have one.
    static func refusalHint(_ code: String) -> String? {
        switch code {
        case "target-not-checked-out":
            String(localized: "Check out the target branch in the project folder or a worktree first.")
        case "target-busy": String(localized: "Finish or abort what waits in the target checkout first.")
        case "target-dirty": String(localized: "Commit or stash the changes in the target checkout first.")
        case "worktree-busy": String(localized: "Finish or abort what waits in the worktree first.")
        case "agent-working": String(localized: "An agent is still working in the worktree.")
        default: nil
        }
    }
}

/// The worktrees of one repository and everything done to them from the phone.
@MainActor @Observable final class GitWorktreesState {
    let repo: String
    private(set) var worktrees: [GitWorktree] = []
    private(set) var loaded = false
    var problem: String?
    var note: String?
    var busy = false
    var progress: String?
    var outcome: GitWorktreeMergeOutcome?
    private(set) var mergeAction: String?
    /// The questions on screen: a new worktree's branch, the merge sheet, the removal and taking a merge back.
    var creating = false
    var merging: GitWorktree?
    var removal: GitWorktreeRemoval?
    var confirmAbort: String?

    init(repo: String) {
        self.repo = repo
    }

    /// The merge sheet, asked with the work counted now and not with the numbers on the row.
    func ask(client: any MachineRequesting, merge worktree: GitWorktree) async {
        guard let fresh = await fresh(client: client, path: worktree.path), !fresh.isMissing else {
            note = String(localized: "No worktree left to merge.")
            return
        }
        merging = fresh
    }

    func ask(client: any MachineRequesting, remove worktree: GitWorktree) async {
        guard let fresh = await fresh(client: client, path: worktree.path) else {
            note = String(localized: "This worktree is already gone.")
            return
        }
        removal = GitWorktreeText.removal(fresh)
    }

    func load(client: any MachineRequesting) async {
        do {
            let answer = try await client.request(
                .gitWorktreeList, payload: .object(["repo": .string(repo), "inspect": .bool(true)])
            ).decoded(as: WorktreeListResult.self)
            worktrees = answer.worktrees
        } catch is CancellationError {
            return
        } catch {
            problem = error.localizedDescription
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
                .gitWorktreeAdd, payload: .object(["repo": .string(repo), "branch": .string(name)])
            ).decoded(as: WorktreeAddResult.self)
            problem = nil
            note =
                !result.created
                ? String(localized: "\(name) already had a worktree.")
                : String(localized: "Made a worktree for \(name).")
        } catch {
            problem = error.localizedDescription
        }
        await load(client: client)
    }

    func merge(client: any MachineRequesting, request: GitWorktreeMergeRequest) async {
        guard !busy else { return }
        busy = true
        outcome = nil
        let actionId = UUID().uuidString
        mergeAction = actionId
        let cancel = client.subscribe(.gitProgress) { [weak self] payload in
            guard let event = try? payload.decoded(as: GitProgressEvent.self), event.actionId == actionId else {
                return
            }
            self?.progress = event.line.isEmpty ? nil : event.line
        }
        defer {
            cancel()
            busy = false
            progress = nil
            mergeAction = nil
        }
        do {
            let result = try await client.request(
                .gitWorktreeMerge, payload: request.payload(repo: repo, actionId: actionId)
            ).decoded(as: WorktreeMergeResult.self)
            problem = nil
            if let conflicts = result.conflicts {
                outcome = .conflict(cwd: result.cwd ?? repo, files: conflicts, summary: result.summary)
                note = nil
            } else {
                note = GitWorktreeText.merged(result)
            }
        } catch is CancellationError {
        } catch {
            outcome = .refused(
                code: gitRefusalCode(error) ?? "failed", message: error.localizedDescription, request: request)
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
            let status = try await client.request(.gitStatus, payload: .object(["cwd": .string(repo)]))
                .decoded(as: GitStatus.self)
            let list = try await client.request(.gitWorktreeList, payload: .object(["repo": .string(repo)]))
                .decoded(as: WorktreeListResult.self)
            target = GitWorktreeText.targetCheckout(
                folder: repo, folderBranch: status.branch, worktrees: list.worktrees, into: into)
            if let target {
                _ = try await client.request(
                    .gitAction,
                    payload: .object([
                        "cwd": .string(target), "actionId": .string(UUID().uuidString), "kind": .string("stash"),
                        "subject": .string(message),
                    ]))
            }
        } catch {
            busy = false
            let reason = error.localizedDescription
            problem = String(localized: "Could not stash: \(reason)")
            return
        }
        busy = false
        guard let target else {
            problem =
                into.map { String(localized: "\($0) is not checked out anywhere.") }
                ?? String(localized: "The target branch is not checked out anywhere.")
            return
        }
        note = nil
        await merge(client: client, request: request)
        let stashed = String(
            localized: "Your changes in \((target as NSString).lastPathComponent) are in the stash \"\(message)\".",
            comment: "%1$@ is a folder, %2$@ the name of a git stash")
        note = [stashed, note].compactMap { $0 }.joined(separator: "\n")
    }

    func cancelMerge(client: any MachineRequesting) async {
        guard let mergeAction else { return }
        _ = try? await client.request(.gitCancel, payload: .object(["actionId": .string(mergeAction)]))
    }

    /// Takes back a merge that stopped on a conflict, in the checkout it waits in.
    func abortMerge(client: any MachineRequesting, cwd: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await client.request(.gitWorktreeAbort, payload: .object(["cwd": .string(cwd)]))
            outcome = nil
            problem = nil
            note = String(localized: "Merge aborted.")
        } catch {
            problem = error.localizedDescription
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
            let result = try await client.request(.gitWorktreeRemove, payload: .object(payload))
                .decoded(as: WorktreeRemoveResult.self)
            problem = nil
            note = GitWorktreeText.removed(branch: worktree.branch, result: result)
        } catch {
            let code = gitRefusalCode(error)
            if !removal.force, code == "worktree-has-work" || code == "worktree-locked",
                let again = await fresh(client: client, path: worktree.path), GitWorktreeText.removal(again).force
            {
                return GitWorktreeText.removal(again)
            }
            problem = error.localizedDescription
        }
        await load(client: client)
        return nil
    }
}
