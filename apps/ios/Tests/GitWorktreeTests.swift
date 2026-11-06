import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class GitWorktreeTests: XCTestCase {
    private func worktree(
        changed: Int = 0, untracked: Int = 0, ahead: Int = 0, operation: String? = nil, missing: Bool = false,
        locked: Bool = false
    ) -> GitWorktree {
        GitWorktree(
            path: "/wt/lexer", branch: "lexer", from: WorktreeFrom(branch: "main", commit: "abc"), missing: missing,
            locked: locked,
            work: WorktreeWork(
                changed: Int64(changed), untracked: Int64(untracked), ahead: Int64(ahead), operation: operation))
    }

    func testAWorktreeIsReadFromTheList() {
        let entry = WorktreeWire.entry(
            "/wt/x", branch: "x", from: ("main", "c1"), locked: true,
            work: WorktreeWire.work(changed: 2, ahead: 1, behind: 3)
        ).worktree
        XCTAssertEqual(entry.fromBranch, "main")
        XCTAssertEqual(entry.base, "main")
        XCTAssertTrue(entry.isLocked)
        XCTAssertFalse(entry.isMissing)
        XCTAssertEqual(entry.work?.behind, 3)
        XCTAssertTrue(entry.hasWork)
        XCTAssertTrue(entry.hasLooseWork)
    }

    func testWhatAWorktreeHoldsReadsAsOneSentence() {
        XCTAssertEqual(
            GitWorktreeText.workSentence(worktree(changed: 3, untracked: 2, ahead: 1)),
            "3 uncommitted files, 2 new files and 1 commit that main lacks")
        XCTAssertEqual(GitWorktreeText.workSentence(worktree(operation: "rebase")), "a rebase that stopped halfway")
        XCTAssertEqual(
            GitWorktreeText.mergeContents(worktree(changed: 1, untracked: 2, ahead: 2)),
            "2 commits and 3 uncommitted files")
        XCTAssertEqual(GitWorktreeText.mergeContents(worktree()), "nothing yet")
    }

    func testRemovingAWorktreeWithWorkTakesForceAndSaysWhatGoes() {
        let clean = GitWorktreeText.removal(worktree())
        XCTAssertFalse(clean.force)
        XCTAssertEqual(clean.confirmLabel, "Remove")
        let holding = GitWorktreeText.removal(worktree(ahead: 2))
        XCTAssertTrue(holding.force)
        XCTAssertEqual(holding.confirmLabel, "Remove anyway")
        XCTAssertTrue(holding.detail.hasPrefix("It holds 2 commits that main lacks."))
        XCTAssertTrue(GitWorktreeText.removal(worktree(locked: true)).force)
    }

    func testAMergeAsksOnlyForWhatWasSetUp() {
        var request = GitWorktreeMergeRequest(worktree: worktree(), strategy: .squash, subject: "  Work  ")
        XCTAssertEqual(
            request.payload(repo: "/repo", actionId: "a1"),
            .object([
                "repo": .string("/repo"), "path": .string("/wt/lexer"), "actionId": .string("a1"),
                "strategy": .string("squash"), "subject": .string("Work"),
            ]))
        request.into = "develop"
        request.stopAgent = true
        request.commitFirst = true
        request.remove = true
        let payload = request.payload(repo: "/repo", actionId: "a2")
        XCTAssertEqual(payload["into"], .string("develop"))
        XCTAssertEqual(payload["stopAgent"], .bool(true))
        XCTAssertEqual(payload["commitFirst"], .bool(true))
        XCTAssertEqual(payload["remove"], .bool(true))
    }

    func testARefusalOverATargetCheckedOutNowhereNamesTheBranchToMergeInto() {
        XCTAssertEqual(
            GitWorktreeText.checkedOutBranch("main is not checked out anywhere; /work/app is on develop."), "develop")
        XCTAssertNil(
            GitWorktreeText.checkedOutBranch("main is not checked out anywhere; /work/app is on a detached HEAD."))
        XCTAssertNil(GitWorktreeText.checkedOutBranch("lexer cannot be merged into itself."))
        XCTAssertNotNil(GitWorktreeText.refusalHint("target-not-checked-out"))
    }

    func testWhatARemovalLeftBehindIsSaid() {
        XCTAssertEqual(
            GitWorktreeText.removed(
                branch: "lexer", result: WorktreeWire.removed(branchDeleted: false).worktreeRemoved),
            "Removed worktree lexer. The branch lexer stays.")
        XCTAssertEqual(
            GitWorktreeText.removed(
                branch: "lexer",
                result: WorktreeWire.removed(branchDeleted: true, branchCommit: "0123456789abcdef").worktreeRemoved),
            "Removed worktree lexer and its branch. \"git branch lexer 0123456789ab\" brings it back.")
    }

    func testOnlyGitRefusingToOverwriteOffersAStash() {
        let message = "error: Your local changes to the following files would be overwritten by merge:\n\ta.ts"
        XCTAssertTrue(GitWorktreeText.isOverwriteRefusal(code: "git-failed", message: message))
        XCTAssertTrue(
            GitWorktreeText.isOverwriteRefusal(
                code: "git-failed", message: "Please commit your changes or stash them before you merge."))
        XCTAssertFalse(GitWorktreeText.isOverwriteRefusal(code: "target-dirty", message: message))
        XCTAssertFalse(
            GitWorktreeText.isOverwriteRefusal(
                code: "git-failed", message: "fatal: refusing to merge unrelated histories"))
    }

    func testTheStashGoesToTheCheckoutThatHasTheTargetOut() {
        let others = [
            GitWorktree(path: "/wt/gone", branch: "develop", missing: true),
            GitWorktree(path: "/wt/develop", branch: "develop"),
        ]
        XCTAssertEqual(
            GitWorktreeText.targetCheckout(folder: "/repo", folderBranch: "main", worktrees: others, into: "main"),
            "/repo")
        XCTAssertEqual(
            GitWorktreeText.targetCheckout(folder: "/repo", folderBranch: "main", worktrees: others, into: "develop"),
            "/wt/develop")
        XCTAssertNil(
            GitWorktreeText.targetCheckout(folder: "/repo", folderBranch: "main", worktrees: others, into: "release"))
        XCTAssertNil(
            GitWorktreeText.targetCheckout(folder: "/repo", folderBranch: "main", worktrees: others, into: nil))
    }

    @MainActor func testStashAndRetryParksTheTargetsChangesUnderTheMergesNameAndMergesAgain() async {
        let machine = WorktreeMachine()
        machine.conflicts = false
        let state = GitWorktreesState(repo: "/repo")
        await state.stashAndRetry(
            client: machine, request: GitWorktreeMergeRequest(worktree: worktree(), strategy: .merge))
        let stash = machine.sent.first { $0.type == .gitAction }?.payload
        XCTAssertEqual(stash?["cwd"], .string("/repo"))
        XCTAssertEqual(stash?["kind"], .string("stash"))
        XCTAssertEqual(stash?["subject"], .string("Before merging lexer"))
        XCTAssertEqual(
            machine.sent.map(\.type).filter { $0 == .gitWorktreeMerge || $0 == .gitAction },
            [.gitAction, .gitWorktreeMerge])
        XCTAssertEqual(
            state.note, "Your changes in repo are in the stash \"Before merging lexer\".\nMerged lexer into main.")
    }

    @MainActor func testNoStashIsMadeWhenNothingHasTheTargetOut() async {
        let machine = WorktreeMachine()
        machine.branch = "develop"
        let state = GitWorktreesState(repo: "/repo")
        await state.stashAndRetry(
            client: machine, request: GitWorktreeMergeRequest(worktree: worktree(), strategy: .merge))
        XCTAssertFalse(machine.sent.contains { $0.type == .gitAction || $0.type == .gitWorktreeMerge })
        XCTAssertEqual(state.problem, "main is not checked out anywhere.")
    }

    @MainActor func testAMergeThatConflictsWaitsInTheCheckoutItRanIn() async {
        let machine = WorktreeMachine()
        let state = GitWorktreesState(repo: "/repo")
        await state.merge(client: machine, request: GitWorktreeMergeRequest(worktree: worktree(), strategy: .merge))
        XCTAssertEqual(state.outcome, .conflict(cwd: "/repo", files: ["a.ts"], summary: "1 file conflicts in /repo."))
    }

    @MainActor func testATargetCheckedOutNowhereIsRefusedAndKeptToTryAgain() async {
        let machine = WorktreeMachine()
        machine.refusal = ("target-not-checked-out", "main is not checked out anywhere; /repo is on develop.")
        let state = GitWorktreesState(repo: "/repo")
        let request = GitWorktreeMergeRequest(worktree: worktree(), strategy: .merge)
        await state.merge(client: machine, request: request)
        XCTAssertEqual(
            state.outcome,
            .refused(
                code: "target-not-checked-out", message: "main is not checked out anywhere; /repo is on develop.",
                request: request))
    }
}

@MainActor private final class WorktreeMachine: MachineRequesting {
    var refusal: (code: String, message: String)?
    var conflicts = true
    var branch = "main"
    var sent: [(type: WireRequest, payload: JSONValue)] = []

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        switch type {
        case .gitStatus:
            return GitWire.json(GitWire.status(["branch": .string(branch)]))
        case .gitWorktreeMerge:
            if let refusal { throw MachineClientError.server(code: refusal.code, message: refusal.message) }
            let actionId = payload["actionId"] ?? .null
            if !conflicts {
                return WorktreeWire.merged(actionId: actionId, summary: "Merged lexer into main.", cwd: "/repo")
            }
            return WorktreeWire.merged(
                actionId: actionId, summary: "1 file conflicts in /repo.", cwd: "/repo", conflicts: ["a.ts"])
        case .gitWorktreeList:
            return WorktreeWire.list()
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
