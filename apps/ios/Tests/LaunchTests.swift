import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

private func launch(
    _ id: String, kind: String = "service", command: String? = "bun dev", cwd: String? = nil, members: [String] = [],
    shared: Bool = false, extra: [String: JSONValue] = [:]
) -> JSONValue {
    LaunchWire.entry(id, kind: kind, command: command, cwd: cwd, members: members, shared: shared, extra: extra)
}

private func status(
    _ id: String, project: String = "p1", kind: String = "service", state: String, exit: Int? = nil,
    stopped: Bool = false, port: Int? = nil
) -> JSONValue {
    LaunchWire.status(id, project: project, kind: kind, state: state, exit: exit, stopped: stopped, port: port)
}

private func document(_ launches: [JSONValue], approved: [String], rev: Int = 3) -> JSONValue {
    LaunchWire.document(launches, approved: approved, rev: rev)
}

final class LaunchLogicTests: XCTestCase {
    private func views(_ statuses: [JSONValue], approved: [String]) -> [String: LaunchView] {
        let doc = document(
            [
                launch("web"), launch("test", kind: "task", command: "bun test"), launch("api"),
                launch("all", kind: "group", members: ["web", "api"]),
            ], approved: approved
        ).launchBook
        let byID = Dictionary(
            statuses.map(\.launchStatus).map { ($0.launchId, $0) }, uniquingKeysWith: { $1 })
        return LaunchLogic.views(document: doc, statuses: byID)
    }

    func testAPhaseFollowsTheStatusAndTheApproval() {
        let approved = ["web", "test", "api", "all"]
        XCTAssertEqual(views([], approved: ["web"])["api"]?.phase, .held)
        XCTAssertEqual(views([], approved: approved)["web"]?.phase, .idle)
        XCTAssertEqual(views([status("web", state: "running", port: 3000)], approved: approved)["web"]?.port, 3000)
        XCTAssertEqual(views([status("web", state: "exited", exit: 0)], approved: approved)["web"]?.phase, .idle)
        XCTAssertEqual(views([status("web", state: "exited", exit: 1)], approved: approved)["web"]?.phase, .failed)
        XCTAssertEqual(
            views([status("web", state: "exited", exit: 137, stopped: true)], approved: approved)["web"]?.phase, .idle)
        XCTAssertEqual(
            views([status("test", kind: "task", state: "exited", exit: 0)], approved: approved)["test"]?.phase, .passed)
        // A launch that runs reads as running even before anyone approved it here: an agent may not start it, a person may.
        XCTAssertEqual(views([status("api", state: "starting")], approved: [])["api"]?.phase, .starting)
    }

    func testAGroupReadsItsMembers() {
        let approved = ["web", "api", "all"]
        let running = views([status("web", state: "running"), status("api", state: "starting")], approved: approved)
        XCTAssertEqual(running["all"]?.phase, .starting)
        XCTAssertTrue(running["all"]?.live == true)
        let failed = views([status("web", state: "exited", exit: 2)], approved: approved)
        XCTAssertEqual(failed["all"]?.phase, .failed)
        XCTAssertEqual(failed["all"]?.exitCode, 2)
        XCTAssertEqual(views([], approved: ["web", "api"])["all"]?.phase, .held)
        let group = launch("all", kind: "group", members: ["web", "api"]).launchEntry
        XCTAssertEqual(LaunchLogic.output(views: failed, launch: group)?.launch.id, "web")
        XCTAssertEqual(LaunchLogic.output(views: running, launch: group)?.launch.id, "web")
        let statuses = ["api": status("api", state: "running").launchStatus]
        XCTAssertTrue(LaunchLogic.runs(group, statuses: statuses))
        XCTAssertFalse(LaunchLogic.runs(launch("web").launchEntry, statuses: statuses))
    }

    func testAnAddressReadsWithoutItsSchemeOrTrailingSlash() {
        XCTAssertEqual(LaunchLogic.shortAddress("http://localhost:3000/"), "localhost:3000")
    }

    func testLaunchesAreGroupedByTheCheckoutTheyRunIn() {
        let launches = [
            launch("site", cwd: "apps/site").launchEntry, launch("root").launchEntry,
            launch("lib", cwd: "/work/p/libs/core/src").launchEntry,
            launch("all", kind: "group", members: ["site"]).launchEntry,
        ]
        let repos = [
            GitRepo(path: "/work/p", label: "p", kind: .root),
            GitRepo(path: "/work/p/libs/core", label: "libs/core", name: "Core", kind: .nested),
        ]
        let sections = LaunchLogic.sections(launches, folder: "/work/p/", repos: repos)
        XCTAssertEqual(sections.map(\.label), [nil, "Core"])
        XCTAssertEqual(sections[0].launches.map(\.id), ["site", "root", "all"])
        XCTAssertEqual(sections[1].launches.map(\.id), ["lib"])
        XCTAssertEqual(
            LaunchLogic.sections(Array(launches.prefix(2)), folder: "/work/p", repos: repos).map(\.label), [nil])
        let overlaid = launch("x", cwd: "a", extra: ["overlay": .object(["cwd": .string("/elsewhere")])]).launchEntry
        XCTAssertEqual(LaunchLogic.folder(of: overlaid, in: "/work/p"), "/elsewhere")
    }
}

final class LaunchEditingTests: XCTestCase {
    func testANewLaunchIsNamedAfterItselfAndItsGroupFollows() {
        var site = LaunchEditing.newDraft(id: "new:1")
        site.name = "Dev Server!"
        site.command = "  bun dev  "
        site.cwd = "apps/site/"
        site.url = " http://localhost:3000 "
        site.env = [LaunchEnvRow(id: 0, key: " PORT ", value: "3000"), LaunchEnvRow(id: 1, key: " ", value: "x")]
        var group = LaunchEditing.newDraft(id: "new:2", kind: .group)
        group.name = "All"
        group.members = ["new:1"]
        let existing = LaunchEditing.draft(of: launch("dev-server", extra: ["future": .bool(true)]).launchEntry)
        let saved = LaunchEditing.saved([existing, site, group])
        XCTAssertEqual(saved[0]["future"], .bool(true))
        XCTAssertEqual(saved[1].text("id"), "dev-server-2")
        XCTAssertEqual(saved[1].text("command"), "bun dev")
        XCTAssertEqual(saved[1].text("cwd"), "apps/site")
        XCTAssertEqual(saved[1].text("url"), "http://localhost:3000")
        XCTAssertEqual(saved[1]["env"], .object(["PORT": .string("3000")]))
        XCTAssertEqual(saved[2].text("id"), "all")
        XCTAssertEqual(saved[2]["launches"], .array([.string("dev-server-2")]))
        XCTAssertNil(saved[2]["command"])
    }

    func testAKindKeepsOnlyTheFieldsItReads() {
        var draft = LaunchEditing.draft(
            of: launch("t", cwd: ".", extra: ["url": .string("http://x")]).launchEntry)
        draft.kind = .task
        let saved = LaunchEditing.saved([draft])[0]
        XCTAssertNil(saved["url"])
        XCTAssertNil(saved["cwd"])
        XCTAssertNil(saved["autostart"])
    }

    func testAnEditKeepsWhatTheMachineSentBesideIt() {
        let overlaid = launch(
            "web", shared: true, extra: ["overlay": .object(["cwd": .string("/elsewhere")]), "future": .number(2)]
        ).launchEntry
        let draft = LaunchEditing.draft(of: overlaid)
        XCTAssertTrue(draft.hasOverlay)
        let saved = LaunchEditing.saved([draft])[0]
        XCTAssertEqual(saved["overlay"], .object(["cwd": .string("/elsewhere")]))
        XCTAssertEqual(saved["future"], .number(2))
        XCTAssertEqual(saved["shared"], .bool(true))
    }

    func testTheFirstLaunchThatCannotBeSavedIsNamed() {
        var nameless = LaunchEditing.newDraft(id: "a")
        nameless.command = "x"
        XCTAssertTrue(LaunchEditing.problem([nameless])! == ("a", .name))
        var commandless = LaunchEditing.newDraft(id: "b")
        commandless.name = "B"
        XCTAssertTrue(LaunchEditing.problem([commandless])! == ("b", .command))
        var empty = LaunchEditing.newDraft(id: "c", kind: .group)
        empty.name = "C"
        XCTAssertTrue(LaunchEditing.problem([empty])! == ("c", .members))
    }

    func testALaunchThatGoesLeavesEveryGroup() {
        let drafts = [launch("web"), launch("api"), launch("all", kind: "group", members: ["web", "api"])].map {
            LaunchEditing.draft(of: $0.launchEntry)
        }
        let rest = LaunchEditing.without(drafts, id: "web")
        XCTAssertEqual(rest.map(\.id), ["api", "all"])
        XCTAssertEqual(rest[1].members, ["api"])
    }

    func testAFolderSplitsIntoItsCheckoutAndThePathBelow() {
        let roots = LaunchEditing.folderRoots([
            GitRepo(path: "/p", label: "p", kind: .root), GitRepo(path: "/p/apps/site", label: "apps/site", kind: .nested),
            GitRepo(path: "/elsewhere", label: "../elsewhere", kind: .nested),
        ])
        XCTAssertEqual(roots, ["", "apps/site"])
        XCTAssertTrue(LaunchEditing.splitFolder("./apps/site/web", roots: roots) == ("apps/site", "web"))
        XCTAssertTrue(LaunchEditing.splitFolder("tools", roots: roots) == ("", "tools"))
        XCTAssertEqual(LaunchEditing.joinFolder(root: "apps/site", sub: "web"), "apps/site/web")
        XCTAssertEqual(LaunchEditing.joinFolder(root: "apps/site", sub: "/abs"), "/abs")
        XCTAssertEqual(LaunchEditing.joinFolder(root: "", sub: "./x"), "x")
    }

    func testAnImportOffersOnlyWhatIsNotALaunchYet() throws {
        let suggestions = [
            LaunchWire.suggestion(launch("dev")),
            LaunchWire.suggestion(
                launch("test", command: "bun test"), path: "apps/site/package.json", detail: "test", isPrivate: true),
            LaunchWire.suggestion(
                launch("Docker", command: "docker"), source: "run-xml", path: ".run/Docker.run.xml", detail: "Docker",
                unsupported: "Docker"),
        ].map(\.launchSuggestion)
        let existing = [launch("mine", command: " bun dev ").launchEntry]
        let offered = LaunchEditing.newSuggestions(suggestions, existing: existing)
        XCTAssertEqual(offered.map(\.id), ["test", "Docker"])
        let imported = try LaunchEditing.imported(
            Array(suggestions.prefix(2)), share: true, existing: [launch("dev").launchEntry])
        XCTAssertEqual(imported.map(\.id), ["dev-2", "test"])
        XCTAssertEqual(imported.map { $0.entry["shared"] }, [.bool(true), .bool(false)])
        XCTAssertEqual(LaunchEditing.foundText(suggestions), "2 scripts in 2 files.")
        XCTAssertEqual(LaunchEditing.source(suggestions[1]), "apps/site · package.json")
        XCTAssertEqual(LaunchEditing.source(suggestions[2]), "Docker")
        XCTAssertNil(LaunchEditing.foundText([suggestions[2]]))
        XCTAssertEqual(LaunchEditing.uniqueID("  ", taken: []), "launch")
        XCTAssertEqual(LaunchEditing.uniqueID("Web: Dev", taken: ["web-dev"]), "web-dev-2")
    }

    @MainActor func testAVSCodeImportReadsAsARunConfigurationAndStaysUnapproved() async throws {
        let suggestion = LaunchWire.suggestion(
            launch("api", command: "node server.js"), source: "vscode-launch", path: ".vscode/launch.json",
            detail: "node"
        ).launchSuggestion
        XCTAssertEqual(LaunchEditing.foundText([suggestion]), "1 run configuration in .vscode.")
        XCTAssertEqual(LaunchEditing.source(suggestion), "node")
        let imported = try LaunchEditing.imported([suggestion], share: false, existing: [])
        XCTAssertEqual(imported.map(\.id), ["api"])
        let importedEntry = imported[0].entry.launchEntry
        XCTAssertTrue(LaunchEditing.newSuggestions([suggestion], existing: [importedEntry]).isEmpty)
        let drafts = [LaunchEditing.draft(of: importedEntry)]
        XCTAssertEqual(LaunchEditing.importedIDs(drafts, existing: []), ["api"])
        XCTAssertEqual(LaunchEditing.importedIDs(drafts, existing: [importedEntry]), [])
        let machine = LaunchMachine()
        let store = ProjectLaunches(client: machine, projectID: "p1", folder: "/p")
        try await store.save(imported.map(\.entry), baseRev: 3, imported: imported.map(\.id))
        XCTAssertEqual(
            machine.last(.launchesSave),
            .object([
                "projectId": .string("p1"), "baseRev": .number(3), "launches": .array(imported.map(\.entry)),
                "imported": .array([.string("api")]),
            ]))
        XCTAssertFalse(machine.sent.contains { $0.0 == .launchStart || $0.0 == .launchRestart })
    }
}

@MainActor final class ProjectLaunchesTests: XCTestCase {
    func testTheLaunchesOfThisProjectAndWhatRunsAreRead() async {
        let machine = LaunchMachine()
        let store = ProjectLaunches(client: machine, projectID: "p1", folder: "/p")
        await store.load()
        XCTAssertEqual(store.document?.launches.map(\.id), ["web", "api"])
        XCTAssertEqual(Array(store.statuses.keys), ["web"])
        XCTAssertEqual(store.views["web"]?.phase, .running)
        XCTAssertEqual(store.views["api"]?.phase, .held)
    }

    func testEventsOfThisProjectUpdateTheList() {
        let machine = LaunchMachine()
        let store = ProjectLaunches(client: machine, projectID: "p1", folder: "/p")
        store.start()
        machine.emit(
            .launchesChanged,
            .object(["projectId": .string("p1"), "document": document([launch("x")], approved: ["x"])]))
        machine.emit(.launchStatus, status("x", state: "running"))
        machine.emit(.launchStatus, status("x", project: "other", state: "exited", exit: 1))
        XCTAssertEqual(store.views["x"]?.phase, .running)
        store.stop()
        XCTAssertTrue(machine.handlers.values.allSatisfy(\.isEmpty))
    }

    func testAHeldStartAsksAndOnlyTheAnswerApproves() async {
        let machine = LaunchMachine()
        let store = ProjectLaunches(client: machine, projectID: "p1", folder: "/p")
        await store.load()
        machine.outcome = .object([
            "outcome": .string("held"),
            "held": .array([
                .object([
                    "launchId": .string("api"), "command": .string("bun api"), "cwd": .string("/p"),
                    "env": .object(["TOKEN": .string("x")]),
                ])
            ]),
        ])
        await store.press(store.document!.launch("api")!)
        XCTAssertNil(machine.last(.launchStart)?["approve"])
        guard case .held(let launchID, let restart, let held, _) = store.ask else { return XCTFail("No question") }
        XCTAssertEqual(launchID, "api")
        XCTAssertFalse(restart)
        XCTAssertEqual(held.first?.env, ["TOKEN": "x"])
        machine.outcome = .object([
            "outcome": .string("busy"),
            "busy": .object([
                "projectId": .string("p1"), "launchId": .string("web"), "port": .number(3000),
            ]),
        ])
        await store.run("api", approve: true)
        XCTAssertEqual(machine.last(.launchStart)?["approve"], .bool(true))
        XCTAssertEqual(store.ask, .busy(launchID: "api", restart: false, holder: "web", port: 3000, approve: true))
        machine.outcome = .object(["outcome": .string("started")])
        await store.run("api", approve: true, replace: true)
        XCTAssertEqual(machine.last(.launchStart)?["replace"], .bool(true))
        XCTAssertNil(store.ask)
        await store.press(store.document!.launch("web")!)
        XCTAssertNotNil(machine.last(.launchRestart))
        await store.stop("web", force: true)
        XCTAssertEqual(machine.last(.launchStop)?["force"], .bool(true))
    }

    func testARefusedReadShowsTheMachinesMessage() async {
        let machine = LaunchMachine()
        machine.refusal = "forbidden"
        let store = ProjectLaunches(client: machine, projectID: "p1", folder: "/p")
        await store.load()
        XCTAssertNil(store.document)
        XCTAssertEqual(store.problem, "forbidden")
    }

    func testAnEditorSavesAgainstTheRevItReadAndStartsOverAfterAConflict() async {
        let machine = LaunchMachine()
        let store = ProjectLaunches(client: machine, projectID: "p1", folder: "/p")
        await store.load()
        let editor = LaunchEditorModel(store: store, launchID: nil)
        let saved = await editor.save()
        XCTAssertFalse(saved)
        XCTAssertTrue(editor.problem! == (editor.draftID, .name))
        editor.draft.name = "Docs"
        editor.draft.command = "bun docs"
        editor.root = ""
        editor.sub = "docs"
        editor.moveFolder()
        machine.refusal = "rev-conflict"
        let conflicted = await editor.save()
        XCTAssertFalse(conflicted)
        XCTAssertTrue(editor.conflict)
        machine.refusal = nil
        machine.read = document([launch("web")], approved: [], rev: 9)
        await store.load()
        editor.startOver()
        XCTAssertEqual(editor.baseRev, 9)
        XCTAssertEqual(editor.draft.name, "Docs")
        let landed = await editor.save()
        XCTAssertTrue(landed)
        let sent = machine.last(.launchesSave)
        XCTAssertEqual(sent?["baseRev"], .number(9))
        XCTAssertEqual(sent?["launches"]?.arrayValue?.map { $0.text("id") }, ["web", "docs"])
        XCTAssertEqual(sent?["launches"]?.arrayValue?.last?.text("cwd"), "docs")
    }

    func testDeletingALaunchSavesTheRestWithoutIt() async {
        let machine = LaunchMachine()
        let store = ProjectLaunches(client: machine, projectID: "p1", folder: "/p")
        await store.load()
        await store.delete("web")
        XCTAssertEqual(machine.last(.launchesSave)?["launches"]?.arrayValue?.map { $0.text("id") }, ["api"])
        XCTAssertEqual(machine.last(.launchesSave)?["baseRev"], .number(3))
    }
}

@MainActor private final class LaunchMachine: MachineRequesting {
    var sent: [(WireRequest, JSONValue)] = []
    var refusal: String?
    var outcome: JSONValue = .object(["outcome": .string("started")])
    var read: JSONValue?
    var handlers: [WireEvent: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        if let refusal { throw MachineClientError.server(code: refusal, message: refusal) }
        switch type {
        case .launchesRead:
            return read
                ?? document([launch("web"), launch("api", command: "bun api", shared: true)], approved: ["web"])
        case .launchList:
            return .object([
                "launches": .array([status("web", state: "running"), status("dev", project: "p2", state: "running")])
            ])
        case .gitRepos:
            return GitWire.repos([])
        case .launchStart, .launchRestart:
            return outcome
        case .launchesSave:
            return .object(["rev": .number(4)])
        default:
            return .object([:])
        }
    }

    func last(_ type: WireRequest) -> JSONValue? { sent.last { $0.0 == type }?.1 }

    func emit(_ event: WireEvent, _ payload: JSONValue) {
        for handler in (handlers[event] ?? [:]).values { handler(payload) }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        let id = UUID()
        handlers[event, default: [:]][id] = handler
        return { [weak self] in self?.handlers[event]?[id] = nil }
    }
}
