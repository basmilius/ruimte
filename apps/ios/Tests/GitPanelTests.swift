import RuimtePulsar
import XCTest

@testable import Ruimte

final class GitPanelTests: XCTestCase {
    private func file(_ path: String, _ state: String) -> JSONValue {
        .object([
            "path": .string(path), "state": .string(state), "status": .string(state == "untracked" ? "?" : "M"),
            "added": .number(1), "deleted": .number(0), "binary": .bool(false),
        ])
    }

    private func status(_ files: [JSONValue], ahead: Int = 0, upstream: String? = "origin/main") -> JSONValue {
        var fields: [String: JSONValue] = [
            "repo": .bool(true), "root": .string("/work/app"), "branch": .string("main"), "detached": .bool(false),
            "ahead": .number(Double(ahead)), "behind": .number(0), "files": .array(files),
            "truncated": .bool(false), "live": .bool(true),
        ]
        fields["upstream"] = upstream.map { .string($0) } ?? .null
        return .object(fields)
    }

    private func checkout(_ label: String, _ states: [String], ahead: Int = 0, upstream: String? = "origin/main")
        -> GitCheckout
    {
        GitCheckout(
            path: "/work/\(label)", label: label, kind: "nested",
            status: status(states.enumerated().map { file("\($0.offset).ts", $0.element) }, ahead: ahead, upstream: upstream))
    }

    func testARepositoryIsListedUnderItsPathInTheFolder() {
        XCTAssertEqual(GitPanel.label(folder: "/work/app", path: "/work/app/packages/ui"), "packages/ui")
        XCTAssertEqual(GitPanel.label(folder: "/work/app", path: "/work/app"), "app")
        XCTAssertEqual(GitPanel.label(folder: "/work/app/apps/client", path: "/work/app"), "app")
    }

    func testTheUntrackedFolderARepositoryShowsUpAsInTheOneAboveItIsDropped() {
        let before = status([file("inner/", "untracked"), file("a.ts", "unstaged")])
        let after = GitPanel.withoutNestedRepos(before, root: "/work/app", others: ["/work/app", "/work/app/inner"])
        XCTAssertEqual(after?.list("files").map { $0.text("path") }, ["a.ts"])
    }

    func testATrackedChangeAtThatPathStaysBecauseThatIsWhatASubmoduleGitlinkIs() {
        let before = status([file("inner", "unstaged")])
        let after = GitPanel.withoutNestedRepos(before, root: "/work/app", others: ["/work/app", "/work/app/inner"])
        XCTAssertEqual(after?.list("files").map { $0.text("path") }, ["inner"])
    }

    func testACheckoutWithNothingInsideItKeepsTheStatusItWasGiven() {
        let before = status([file("a.ts", "untracked")])
        XCTAssertEqual(
            GitPanel.withoutNestedRepos(before, root: "/work/app/inner", others: ["/work/app", "/work/app/inner"]),
            before)
        XCTAssertNil(GitPanel.withoutNestedRepos(nil, root: "/work/app", others: []))
    }

    func testEveryRepositoryWithSomethingStagedTakesTheCommit() {
        let plan = GitPanel.commitTargets([
            checkout("one", ["staged"]), checkout("two", ["unstaged"]), checkout("three", ["staged", "unstaged"]),
        ])
        XCTAssertEqual(plan.targets.map(\.label), ["one", "three"])
        XCTAssertFalse(plan.stageAll)
    }

    func testASingleRepositoryWithNothingStagedIsTheCommitThatStagesFirst() {
        let plan = GitPanel.commitTargets([checkout("one", ["unstaged"])])
        XCTAssertEqual(plan.targets.map(\.label), ["one"])
        XCTAssertTrue(plan.stageAll)
    }

    func testTwoRepositoriesWithNothingStagedHaveNoCommitToMakeYet() {
        XCTAssertTrue(GitPanel.commitTargets([checkout("one", ["unstaged"]), checkout("two", ["untracked"])]).targets.isEmpty)
        XCTAssertTrue(GitPanel.commitTargets([checkout("one", [])]).targets.isEmpty)
    }

    func testAPushMovesOnlyWhatIsAheadAndPublishesABranchGitHasNeverSeen() {
        let entries = GitPanel.pushable([
            checkout("one", [], ahead: 2), checkout("two", []), checkout("three", [], upstream: nil),
        ])
        XCTAssertEqual(entries.map { ($0.checkout.label, $0.kind) }.map { "\($0.0):\($0.1)" }, ["one:push", "three:publish"])
    }

    private func log(_ repo: String, _ ats: [Double], cursor: String?) -> GitLoadedLog {
        GitLoadedLog(
            cwd: "/work/\(repo)", repo: repo,
            commits: ats.map {
                .object([
                    "hash": .string("\(repo)-\($0)"), "shortHash": .string("\(repo)"), "subject": .string("s"),
                    "author": .string("Ada"), "at": .number($0), "refs": .array([]),
                ])
            }, cursor: cursor)
    }

    func testTheLogsOfSeveralRepositoriesReadAsOneHistoryNewestFirst() {
        let merged = GitPanel.mergeLogs([log("one", [500, 400], cursor: nil), log("two", [450, 300], cursor: nil)])
        XCTAssertEqual(merged.rows.map(\.at), [500, 450, 400, 300])
        XCTAssertEqual(merged.rows.map(\.repo), ["one", "two", "one", "two"])
        XCTAssertFalse(merged.more)
    }

    func testRowsALaterPageCouldStillSlipAboveWaitForThatPage() {
        // `one` has more to give below 400, so nothing older than 400 can be placed yet.
        let merged = GitPanel.mergeLogs([log("one", [500, 400], cursor: "2"), log("two", [450, 300], cursor: nil)])
        XCTAssertEqual(merged.rows.map(\.at), [500, 450, 400])
        XCTAssertTrue(merged.more)
    }

    func testARepositoryWhosePageRanOutHoldsNothingBack() {
        let merged = GitPanel.mergeLogs([log("one", [500], cursor: nil), log("two", [200], cursor: nil)])
        XCTAssertEqual(merged.rows.map(\.at), [500, 200])
    }

    func testOnlyGitsOwnRefusalToDeleteAnUnmergedBranchEarnsASecondAsk() {
        XCTAssertTrue(gitIsUnmergedRefusal("error: the branch 'x' is not fully merged"))
        XCTAssertFalse(gitIsUnmergedRefusal("error: branch 'x' not found"))
    }
}
