import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor
final class GitSheetTests: XCTestCase {
    private func file(_ path: String, _ state: String) -> JSONValue {
        .object([
            "path": .string(path), "state": .string(state), "status": .string(state == "untracked" ? "?" : "M"),
            "added": .number(3), "deleted": .number(1), "binary": .bool(false),
        ])
    }

    private func checkout(
        _ label: String, _ states: [String] = [], branch: String? = "main", ahead: Int = 0, behind: Int = 0,
        detached: Bool = false
    ) -> GitCheckout {
        var fields: [String: JSONValue] = [
            "repo": .bool(true), "detached": .bool(detached), "ahead": .number(Double(ahead)),
            "behind": .number(Double(behind)), "upstream": .string("origin/main"),
            "files": .array(states.enumerated().map { file("\($0.offset).ts", $0.element) }),
        ]
        fields["branch"] = branch.map { .string($0) } ?? .null
        return GitCheckout(path: "/work/\(label)", label: label, kind: "nested", status: .object(fields))
    }

    func testThePillNamesTheBranchOfOneRepositoryAndCountsSeveral() {
        XCTAssertEqual(GitPanel.pillTitle([checkout("app", branch: "ios-redesign")]), "ios-redesign")
        XCTAssertEqual(GitPanel.pillTitle([checkout("app", branch: nil, detached: true)]), "Detached HEAD")
        XCTAssertEqual(GitPanel.pillTitle([checkout("app", branch: nil)]), "No commits")
        XCTAssertEqual(GitPanel.pillTitle([checkout("one"), checkout("two"), checkout("three")]), "3 repositories")
    }

    func testTheCommitBarCountsTheStagedFilesOrEverythingWhenNothingIsStaged() {
        XCTAssertEqual(GitPanel.commitTitle([checkout("app", ["staged", "unstaged"])]), "Commit 1 file")
        XCTAssertEqual(GitPanel.commitTitle([checkout("app", ["unstaged", "untracked"])]), "Commit 2 files")
        XCTAssertEqual(GitPanel.commitTitle([checkout("one", ["unstaged"]), checkout("two", ["unstaged"])]), "Commit")
    }

    func testABranchThatMovedOnBothSidesHasDiverged() {
        XCTAssertTrue(GitPanel.diverged(checkout("api", ahead: 2, behind: 1)))
        XCTAssertFalse(GitPanel.diverged(checkout("api", ahead: 2)))
        XCTAssertFalse(GitPanel.diverged(checkout("api", behind: 2)))
        XCTAssertEqual(GitPanel.repositoryState(checkout("api", ahead: 2, behind: 1)), "diverged")
        XCTAssertEqual(GitPanel.repositoryState(checkout("api", ["unstaged", "staged"])), "2 changed")
        XCTAssertEqual(GitPanel.repositoryState(checkout("api")), "clean")
    }

    func testAPullAfterDivergingSaysHowTheBranchesComeTogether() async {
        let machine = GitSheetMachine()
        let repositories = GitRepositories()
        await repositories.act(client: machine, cwd: "/work/api", kind: "pull", extra: ["strategy": .string("rebase")])
        let pull = machine.sent.first { $0.type == "git.action" }
        XCTAssertEqual(pull?.payload["kind"], .string("pull"))
        XCTAssertEqual(pull?.payload["strategy"], .string("rebase"))
    }

    func testAHaltedCheckoutSaysWhatWaitsAndHowManyFilesConflict() {
        var halted = checkout("app", ["conflicted", "conflicted", "staged"])
        halted.status = halted.status?.setting("operation", .string("rebase"))
        XCTAssertEqual(GitHaltedText.title(halted, named: false), "A rebase waits on you")
        XCTAssertEqual(GitHaltedText.title(halted, named: true), "A rebase waits on you (app)")
        XCTAssertEqual(
            GitHaltedText.detail(halted, ours: "main", theirs: "ios-redesign"),
            "main against ios-redesign. 2 files conflict.")
        XCTAssertEqual(
            GitHaltedText.detail(checkout("app"), ours: nil, theirs: nil),
            "Every file is resolved; Continue finishes it.")
    }

    func testWriteWithTheAgentFillsTheMessageFromTheStagedDiff() async {
        let machine = GitSheetMachine()
        let repositories = GitRepositories()
        let model = GitCommitModel(repositories: repositories)
        await model.write(client: machine)
        XCTAssertTrue(machine.sent.isEmpty, "Nothing is staged in a folder with no repository to write from")

        let staged = await GitSheetRepositories.with([checkout("app", ["staged"])])
        let ready = GitCommitModel(repositories: staged)
        await ready.loadProvider(client: machine)
        XCTAssertEqual(ready.providerName, "Claude")
        await ready.write(client: machine)
        XCTAssertEqual(ready.subject, "Share one backoff")
        XCTAssertEqual(ready.body, "Caps retries at 5.")
        let asked = machine.sent.first { $0.type == "git.suggestMessage" }
        XCTAssertEqual(asked?.payload["cwd"], .string("/work/app"))
        XCTAssertEqual(asked?.payload["provider"], .string("claude"))
    }

    func testCommitAndPushIsOneActionPerRepositoryWithTheSameWords() async {
        let machine = GitSheetMachine()
        let repositories = await GitSheetRepositories.with([checkout("one", ["staged"]), checkout("two", ["staged"])])
        let model = GitCommitModel(repositories: repositories)
        model.subject = "Share one backoff"
        let line = await model.commit(client: machine, push: true)
        XCTAssertEqual(line, "Committed and pushed in 2 repositories.")
        let commits = machine.sent.filter { $0.type == "git.action" }
        XCTAssertEqual(commits.map { $0.payload["cwd"] }, [.string("/work/one"), .string("/work/two")])
        XCTAssertTrue(commits.allSatisfy { $0.payload["kind"] == .string("commit-push") })
        XCTAssertTrue(commits.allSatisfy { $0.payload["subject"] == .string("Share one backoff") })
        XCTAssertEqual(model.subject, "")
    }

    func testAPullRequestTakesTheLastSubjectAndReportsWhatTheBranchCarries() async {
        let machine = GitSheetMachine()
        let repositories = await GitSheetRepositories.with([checkout("app", branch: "ios-redesign")])
        let model = GitPullRequestModel(repositories: repositories, path: "/work/app", subject: "")
        await model.load(client: machine)
        XCTAssertEqual(model.title, "Share one backoff across transport endpoints")
        XCTAssertEqual(model.stats?.files, 2)
        XCTAssertEqual(
            GitPullRequestModel.summary(
                files: model.stats!.files, added: model.stats!.added, deleted: model.stats!.deleted),
            "2 files · +27 −10")
        let line = await model.create(client: machine)
        XCTAssertEqual(line, "Pull request ready: https://example.test/pull/7")
        XCTAssertEqual(model.url?.absoluteString, "https://example.test/pull/7")
        let created = machine.sent.last { $0.type == "git.action" }
        XCTAssertEqual(created?.payload["kind"], .string("create-pr"))
        XCTAssertEqual(created?.payload["subject"], .string("Share one backoff across transport endpoints"))
    }

    func testAWorktreeSaysWhoWorksInIt() {
        let views: [JSONValue] = [
            .object([
                "id": .string("main"), "kind": .string("canvas"),
                "nodes": .array([
                    .object(["id": .string("a"), "kind": .string("chat"), "cwd": .string("/wt/redesign")]),
                    .object(["id": .string("b"), "kind": .string("chat"), "cwd": .string("/wt/redesign/apps")]),
                    .object(["id": .string("c"), "kind": .string("terminal"), "cwd": .string("/work/app")]),
                    .object([
                        "id": .string("g"), "kind": .string("group"), "title": .string("Login"),
                        "worktree": .object(["path": .string("/wt/login"), "branch": .string("login")]),
                    ]),
                ]),
            ]),
            .object([
                "id": .string("t"), "kind": .string("terminal"), "node": .object(["cwd": .string("/wt/redesign")]),
            ]),
        ]
        XCTAssertEqual(GitWorktreeOccupants.line(in: views, path: "/wt/redesign"), "2 chats and 1 terminal work here")
        XCTAssertEqual(GitWorktreeOccupants.line(in: views, path: "/wt/login"), "bound to Login")
        XCTAssertNil(GitWorktreeOccupants.line(in: views, path: "/wt/redesign-2"))
    }

    func testAGroupTitleBecomesABranchNameGitAccepts() {
        XCTAssertEqual(GitWorktreeBinding.branchName(fromTitle: "Shopping list"), "shopping-list")
        XCTAssertEqual(GitWorktreeBinding.branchName(fromTitle: "  Fix: login / redirect!  "), "fix-login-/-redirect")
        XCTAssertEqual(GitWorktreeBinding.branchName(fromTitle: "🙂"), "work")
    }

    func testBindingSetsAndClearsTheWorktreeOfOneGroupOnly() {
        let document = JSONValue.object([
            "views": .array([
                .object([
                    "id": .string("main"), "kind": .string("canvas"),
                    "nodes": .array([
                        .object(["id": .string("g"), "kind": .string("group"), "title": .string("Shopping list")]),
                        .object(["id": .string("n"), "kind": .string("note"), "title": .string("Note")]),
                    ]),
                ])
            ])
        ])
        let groups = GitWorktreeBinding.groups(in: document.list("views"))
        XCTAssertEqual(groups.map(\.title), ["Shopping list"])
        XCTAssertNil(groups[0].worktree)
        let bound = GitWorktreeBinding.bind(
            document, viewID: "main", groupID: "g", worktree: (path: "/wt/shopping-list", branch: "shopping-list"))
        let nodes = bound.list("views")[0].list("nodes")
        XCTAssertEqual(nodes[0]["worktree"]?["path"], .string("/wt/shopping-list"))
        XCTAssertNil(nodes[1]["worktree"])
        XCTAssertEqual(GitWorktreeBinding.groups(in: bound.list("views"))[0].worktree?.branch, "shopping-list")
        let unbound = GitWorktreeBinding.bind(bound, viewID: "main", groupID: "g", worktree: nil)
        XCTAssertNil(unbound.list("views")[0].list("nodes")[0]["worktree"])
    }

    func testBindingAGroupMakesTheWorktreeInTheProjectFolderAndWritesItOnTheGroup() async {
        let runtime = AppRuntime(connections: MachineConnections(monitorPaths: false))
        defer { runtime.connections.shutdown() }
        let session = SharedMachineSession(
            machine: Machine(
                id: "machine", name: "Machine", icon: nil, publicKey: String(repeating: "A", count: 43),
                brokerUrl: "wss://broker.test", lastSeenAt: nil),
            runtime: runtime)
        let workspace = MobileWorkspace(session: session, projectID: "project")
        await workspace.edit { _ in
            .object([
                "views": .array([
                    .object([
                        "id": .string("main"), "kind": .string("canvas"),
                        "nodes": .array([
                            .object(["id": .string("g"), "kind": .string("group"), "title": .string("Shopping list")])
                        ]),
                    ])
                ])
            ])
        }
        let model = GitWorktreeBindModel(workspace: workspace)
        XCTAssertEqual(model.branch, "shopping-list")
        let machine = GitSheetMachine()
        let bound = await model.bind(client: machine)
        XCTAssertTrue(bound)
        let added = machine.sent.first { $0.type == "git.worktree-add" }
        XCTAssertEqual(added?.payload["branch"], .string("shopping-list"))
        XCTAssertEqual(added?.payload["projectId"], .string("project"))
        XCTAssertEqual(
            workspace.views[0].list("nodes")[0]["worktree"],
            .object(["path": .string("/wt/shopping-list"), "branch": .string("shopping-list")]))
    }
}

/// Repositories with checkouts read through the requests the sheet makes, as the watch would leave them.
@MainActor enum GitSheetRepositories {
    static func with(_ checkouts: [GitCheckout]) async -> GitRepositories {
        let repositories = GitRepositories()
        await repositories.reload(client: SeedMachine(checkouts: checkouts), folder: "/work")
        return repositories
    }

    private final class SeedMachine: MachineRequesting {
        let checkouts: [GitCheckout]

        init(checkouts: [GitCheckout]) {
            self.checkouts = checkouts
        }

        func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
            switch type {
            case "git.repos":
                return .object([
                    "repos": .array(
                        checkouts.map {
                            .object(["path": .string($0.path), "label": .string($0.label), "kind": .string($0.kind)])
                        })
                ])
            case "git.status":
                return checkouts.first { $0.path == payload.text("cwd") }?.status ?? .object([:])
            default:
                return .object([:])
            }
        }

        func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
            {}
        }
    }
}

@MainActor private final class GitSheetMachine: MachineRequesting {
    var sent: [(type: String, payload: JSONValue)] = []

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        switch type {
        case "git.capabilities":
            return .object(["gh": .bool(true), "messageProvider": .string("claude")])
        case "git.suggestMessage":
            return .object(["subject": .string("Share one backoff"), "body": .string("Caps retries at 5.")])
        case "git.log":
            return .object([
                "commits": .array([.object(["subject": .string("Share one backoff across transport endpoints")])])
            ])
        case "git.diff":
            return .object([
                "files": .array([
                    .object(["path": .string("a.ts"), "added": .number(24), "deleted": .number(9)]),
                    .object(["path": .string("b.ts"), "added": .number(3), "deleted": .number(1)]),
                ])
            ])
        case "git.action" where payload["kind"] == .string("create-pr"):
            return .object([
                "summary": .string("Pull request ready: https://example.test/pull/7"),
                "url": .string("https://example.test/pull/7"),
            ])
        case "git.worktree-add":
            return .object([
                "worktree": .object(["path": .string("/wt/shopping-list"), "branch": .string("shopping-list")]),
                "created": .bool(true),
            ])
        case "git.status":
            return .object(["repo": .bool(true), "branch": .string("main"), "files": .array([])])
        default:
            return .object(["summary": .string("Done.")])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
