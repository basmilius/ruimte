import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit
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
        detached: Bool = false, operation: String? = nil
    ) -> GitCheckout {
        var fields: [String: JSONValue] = [
            "repo": .bool(true), "detached": .bool(detached), "ahead": .number(Double(ahead)),
            "behind": .number(Double(behind)), "upstream": .string("origin/main"),
            "files": .array(states.enumerated().map { file("\($0.offset).ts", $0.element) }),
        ]
        fields["branch"] = branch.map { .string($0) } ?? .null
        if let operation { fields["operation"] = .string(operation) }
        return GitCheckout(path: "/work/\(label)", label: label, kind: .nested, status: GitWire.status(fields))
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

    func testAPullSendsItsSelectedStrategyToTheRepository() async throws {
        let machine = GitSheetMachine()
        let repositories = GitRepositories()
        let window = try host(
            GitDivergedRow(
                client: machine, repositories: repositories, checkout: checkout("api", ahead: 2, behind: 1),
                named: false))
        defer {
            window.close()
        }
        XCTAssertTrue(machine.sent.isEmpty)
        let sent = expectation(description: "The chosen pull reaches the checkout")
        machine.onAction = { sent.fulfill() }
        let activated = await activate("Rebase", in: window)
        XCTAssertTrue(activated)
        await fulfillment(of: [sent], timeout: 2)
        let pull = machine.sent.first { $0.type == .gitAction }
        XCTAssertEqual(pull?.payload["kind"], .string("pull"))
        XCTAssertEqual(pull?.payload["strategy"], .string("rebase"))
        XCTAssertEqual(pull?.payload["cwd"], .string("/work/api"))
    }

    func testConfirmingARebaseSendsTheTargetAndClearsTheQuestion() async {
        let machine = GitSheetMachine()
        let actions = GitBranchActions(repositories: GitRepositories(), path: "/work/api")
        let pending = GitConfirmation.rebase(cwd: "/work/api", onto: "main")
        XCTAssertEqual(pending.title, "Rebase onto main?")
        XCTAssertEqual(pending.confirmLabel, "Rebase")
        actions.confirmation = pending
        XCTAssertTrue(machine.sent.isEmpty)
        await actions.confirm(client: machine, pending)
        let rebase = machine.sent.first { $0.type == .gitAction }
        XCTAssertEqual(rebase?.payload["kind"], .string("rebase"))
        XCTAssertEqual(rebase?.payload["ref"], .string("main"))
        XCTAssertEqual(rebase?.payload["cwd"], .string("/work/api"))
        XCTAssertNil(actions.confirmation)
    }

    func testOnlyGitsOwnRefusalToDeleteAnUnmergedBranchEarnsASecondAsk() async {
        let machine = ScriptedMachine()
        let actions = GitBranchActions(repositories: GitRepositories(), path: "/work/api")
        let pending = GitConfirmation.deleteBranch(cwd: "/work/api", ref: "old", force: false)
        machine.refusals[.gitAction] = "git-failed"
        await actions.confirm(client: machine, pending)
        XCTAssertNil(actions.confirmation)
        machine.refusals[.gitAction] = "branch-not-merged"
        await actions.confirm(client: machine, pending)
        guard case .deleteBranch(_, "old", true)? = actions.confirmation else {
            return XCTFail("The forced delete was not asked")
        }
    }

    private func host<Content: View>(_ content: Content) throws -> UIWindow {
        try NativePresentationProbe.enableAccessibility()
        return UIWindow.showing(UIHostingController(rootView: content), size: CGSize(width: 402, height: 874))
    }

    private func activate(_ label: String, in window: UIWindow) async -> Bool {
        for _ in 0..<120 {
            await displayFrames()
            for element in NativePresentationProbe.elements(in: window) {
                if element.accessibilityLabel == label, element.accessibilityActivate() { return true }
            }
        }
        return false
    }

    func testAHaltedCheckoutSaysWhatWaitsAndHowManyFilesConflict() {
        let halted = checkout("app", ["conflicted", "conflicted", "staged"], operation: "rebase")
        XCTAssertEqual(GitHaltedText.title(halted, named: false), "A rebase waits on you")
        XCTAssertEqual(GitHaltedText.title(halted, named: true), "A rebase waits on you (app)")
        XCTAssertEqual(
            GitHaltedText.detail(halted, ours: "main", theirs: "ios-redesign"),
            "main against ios-redesign. 2 files conflict.")
        XCTAssertEqual(
            GitHaltedText.detail(checkout("app"), ours: nil, theirs: nil),
            "Every file is resolved. Continue finishes it.")
    }

    func testWriteWithTheAgentFillsTheMessageFromTheStagedDiff() async {
        let machine = GitSheetMachine()
        let repositories = GitRepositories()
        let model = GitCommitModel(repositories: repositories)
        await model.write(client: machine)
        XCTAssertTrue(machine.sent.isEmpty, "Nothing is staged in a folder with no repository to write from")

        let staged = await GitSheetRepositories.with([checkout("app", ["staged"])])
        let ready = GitCommitModel(repositories: staged)
        addTeardownBlock { await AgentDirectory.shared.reset() }
        XCTAssertEqual(ready.providerName, "an agent")
        await ready.loadProvider(client: machine)
        XCTAssertEqual(ready.providerName, "Claude Code")
        await ready.write(client: machine)
        XCTAssertEqual(ready.subject, "Share one backoff")
        XCTAssertEqual(ready.body, "Caps retries at 5.")
        let asked = machine.sent.first { $0.type == .gitSuggestMessage }
        XCTAssertEqual(asked?.payload["cwd"], .string("/work/app"))
        XCTAssertEqual(asked?.payload["provider"], .string("claude"))
    }

    func testCommitAndPushIsOneActionPerRepositoryWithTheSameWords() async {
        let machine = GitSheetMachine()
        let repositories = await GitSheetRepositories.with([checkout("one", ["staged"]), checkout("two", ["staged"])])
        let model = GitCommitModel(repositories: repositories)
        XCTAssertEqual(model.files.map(\.file.path), ["0.ts", "0.ts"])
        XCTAssertEqual(Set(model.files.map(\.id)).count, 2, "The same path in two repositories is two rows")
        model.subject = "Share one backoff"
        let line = await model.commit(client: machine, push: true)
        XCTAssertEqual(line, "Committed and pushed in 2 repositories.")
        let commits = machine.sent.filter { $0.type == .gitAction }
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
        let created = machine.sent.last { $0.type == .gitAction }
        XCTAssertEqual(created?.payload["kind"], .string("create-pr"))
        XCTAssertEqual(created?.payload["subject"], .string("Share one backoff across transport endpoints"))
    }

    func testAWorktreeSaysWhoWorksInIt() {
        let views = ProjectWire.stored([
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
        ])
        XCTAssertEqual(GitWorktreeOccupants.line(in: views, path: "/wt/redesign"), "2 chats and 1 terminal work here")
        XCTAssertEqual(GitWorktreeOccupants.line(in: views, path: "/wt/login"), "bound to Login")
        XCTAssertNil(GitWorktreeOccupants.line(in: views, path: "/wt/redesign-2"))
    }

    func testAGroupTitleBecomesABranchNameGitAccepts() {
        XCTAssertEqual(GitWorktreeBinding.branchName(fromTitle: "Shopping list"), "shopping-list")
        XCTAssertEqual(GitWorktreeBinding.branchName(fromTitle: "  Fix: login / redirect!  "), "fix-login-/-redirect")
        XCTAssertEqual(GitWorktreeBinding.branchName(fromTitle: "🙂"), "work")
        for (title, expected) in [
            ("a..b", "a-b"), ("foo.lock", "foo-lock"), (".hidden//branch/", "hidden/branch"),
            ("///", "work"), ("topic/.lock", "topic/lock"), ("/-/-branch", "branch"),
            ("/-.a", "a"), (".-.a", "a"), ("/-/-.a", "a"), ("feature/-name", "feature/-name"),
        ] {
            XCTAssertEqual(GitWorktreeBinding.branchName(fromTitle: title), expected, title)
        }
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
        let groups = GitWorktreeBinding.groups(in: ProjectWire.stored(document.list("views")))
        XCTAssertEqual(groups.map(\.title), ["Shopping list"])
        XCTAssertNil(groups[0].worktree)
        let bound = GitWorktreeBinding.bind(
            document, viewID: "main", groupID: "g", worktree: (path: "/wt/shopping-list", branch: "shopping-list"))
        let nodes = bound.list("views")[0].list("nodes")
        XCTAssertEqual(nodes[0]["worktree"]?["path"], .string("/wt/shopping-list"))
        XCTAssertNil(nodes[1]["worktree"])
        XCTAssertEqual(GitWorktreeBinding.groups(in: ProjectWire.stored(bound.list("views")))[0].worktree?.branch, "shopping-list")
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
        let wire = GitBindingWire()
        session.rpc = wire.client
        defer { wire.client.shutdown() }
        let workspace = MobileWorkspace(
            session: session, projectID: "project",
            summary: .object([
                "folder": .string("/work/project")
            ]))
        await workspace.edit { _ in
            .object([
                "name": .string("Project"), "color": .string("#155dfc"),
                "views": .array([
                    .object([
                        "id": .string("main"), "kind": .string("canvas"),
                        "name": .string("Main"), "texts": .array([]), "edges": .array([]), "layouts": .array([]),
                        "nodes": .array([
                            .object([
                                "id": .string("g"), "kind": .string("group"), "title": .string("Shopping list"),
                                "x": .number(0), "y": .number(0), "w": .number(320), "h": .number(200),
                            ])
                        ]),
                    ])
                ]),
            ])
        }
        let model = GitWorktreeBindModel(workspace: workspace)
        XCTAssertEqual(model.branch, "shopping-list")
        let machine = GitSheetMachine()
        let bound = await model.bind(client: machine)
        XCTAssertTrue(bound)
        let added = machine.sent.first { $0.type == .gitWorktreeAdd }
        XCTAssertEqual(added?.payload["branch"], .string("shopping-list"))
        XCTAssertEqual(added?.payload["projectId"], .string("project"))
        XCTAssertEqual(added?.payload["repo"], .string("/work/project"))
        XCTAssertEqual(
            workspace.views[0].list("nodes")[0]["worktree"],
            .object(["path": .string("/wt/shopping-list"), "branch": .string("shopping-list")]))
        XCTAssertEqual(wire.saves.count, 2)
        XCTAssertEqual(wire.saves.last?["projectId"], .string("project"))
        XCTAssertEqual(wire.saves.last?["baseRev"], .number(1))
        XCTAssertEqual(
            wire.saves.last?["content"]?["views"]?.arrayValue?.first?["nodes"]?.arrayValue?.first?["worktree"],
            .object(["path": .string("/wt/shopping-list"), "branch": .string("shopping-list")]))
        XCTAssertEqual(workspace.document["rev"], .number(2))
        XCTAssertNil(workspace.problem)
    }
}

@MainActor private final class GitBindingWire {
    var saves: [JSONValue] = []
    lazy var client = MachineClient(send: { [weak self] text in try self?.receive(text) }, connected: true)

    private func receive(_ text: String) throws {
        let frame = try JSONValue.decode(Data(text.utf8))
        guard frame["type"] == .string(WireRequest.projectSave.rawValue), let payload = frame["payload"] else {
            throw MachineClientError.invalid("Unexpected worktree binding request")
        }
        saves.append(payload)
        let response: JSONValue = .object([
            "id": frame["id"]!, "ok": .bool(true), "result": .object(["rev": .number(Double(saves.count))]),
        ])
        client.receive(String(decoding: try response.encoded(), as: UTF8.self))
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

        func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
            switch type {
            case .gitRepos:
                return GitWire.repos(checkouts.map { GitWire.repo(path: $0.path, label: $0.label, kind: $0.kind) })
            case .gitStatus:
                return GitWire.json(checkouts.first { $0.path == payload.text("cwd") }?.status)
            default:
                return .object([:])
            }
        }

        func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
            {}
        }
    }
}

@MainActor private final class GitSheetMachine: MachineRequesting {
    var sent: [(type: WireRequest, payload: JSONValue)] = []
    var onAction: (() -> Void)?

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        if type == .gitAction { onAction?() }
        switch type {
        case .gitCapabilities:
            return .object(["gh": .bool(true), "messageProvider": .string("claude")])
        case .providerList:
            return ProviderWire.list([ProviderWire.provider("claude", name: "Claude Code")])
        case .gitSuggestMessage:
            return .object(["subject": .string("Share one backoff"), "body": .string("Caps retries at 5.")])
        case .gitLog:
            return .object([
                "commits": .array([
                    .object([
                        "hash": .string("abc1234def"), "shortHash": .string("abc1234"),
                        "subject": .string("Share one backoff across transport endpoints"), "author": .string("Ada"),
                        "at": .number(1000), "refs": .array([]),
                    ])
                ]),
                "cursor": .null,
            ])
        case .gitDiff:
            let file = { (path: String, added: Double, deleted: Double) -> JSONValue in
                .object([
                    "path": .string(path), "diff": .string(""), "added": .number(added), "deleted": .number(deleted),
                    "binary": .bool(false),
                ])
            }
            return .object([
                "path": .string(""), "diff": .string(""), "added": .number(27), "deleted": .number(10),
                "binary": .bool(false), "files": .array([file("a.ts", 24, 9), file("b.ts", 3, 1)]),
            ])
        case .gitAction where payload["kind"] == .string("create-pr"):
            return .object([
                "actionId": .string("a1"), "summary": .string("Pull request ready: https://example.test/pull/7"),
                "output": .string(""), "url": .string("https://example.test/pull/7"),
            ])
        case .gitWorktreeAdd:
            return .object([
                "worktree": .object(["path": .string("/wt/shopping-list"), "branch": .string("shopping-list")]),
                "created": .bool(true),
            ])
        case .gitStatus:
            return GitWire.json(GitWire.status([:]))
        default:
            return .object(["actionId": .string("a1"), "summary": .string("Done."), "output": .string("")])
        }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
