import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class PadRouterTests: XCTestCase {
    @MainActor private func fixture() -> (AppRuntime, Machine, MachineConnections) {
        let connections = MachineConnections(monitorPaths: false)
        let runtime = AppRuntime(connections: connections)
        let machine = Machine(
            id: "pad-\(UUID().uuidString)", name: "MacBook Pro", icon: nil,
            publicKey: DeviceKey().publicKey, brokerUrl: nil, lastSeenAt: nil)
        runtime.machines = [machine]
        return (runtime, machine, connections)
    }

    @MainActor func testAColdStartOpensOnNowWithNoProjectInTheSidebar() {
        let router = PadRouter()
        XCTAssertEqual(router.detail, .now)
        XCTAssertNil(router.project)
    }

    @MainActor func testOpeningAProjectPushesItAndGoingBackShowsNow() {
        let (runtime, machine, connections) = fixture()
        defer { connections.shutdown() }
        let router = PadRouter()
        router.inspector = .git
        let navigation = router.openProject(
            MobileWorkspace(session: runtime.session(for: machine), projectID: "app"), view: "chat")
        XCTAssertEqual(router.detail, .project)
        XCTAssertTrue(router.project === navigation)
        XCTAssertEqual(navigation.pendingViewID, "chat")
        XCTAssertNil(router.inspector)

        router.closeProject()
        XCTAssertNil(router.project)
        XCTAssertEqual(router.detail, .now)
    }

    @MainActor func testGoingBackFromAProjectLeavesAnotherPageWhereItIs() {
        let (runtime, machine, connections) = fixture()
        defer { connections.shutdown() }
        let router = PadRouter()
        router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        router.detail = .machines
        router.closeProject()
        XCTAssertEqual(router.detail, .machines)
    }

    @MainActor func testTheProjectAlreadyInTheSidebarKeepsItsState() {
        let (runtime, machine, connections) = fixture()
        defer { connections.shutdown() }
        let router = PadRouter()
        let session = runtime.session(for: machine)
        let first = router.openProject(MobileWorkspace(session: session, projectID: "app"))
        router.inspector = .files
        router.detail = .now
        let again = router.openProject(MobileWorkspace(session: session, projectID: "app"), view: "terminal")
        XCTAssertTrue(first === again)
        XCTAssertEqual(router.inspector, .files)
        XCTAssertEqual(router.detail, .project)
        XCTAssertEqual(again.pendingViewID, "terminal")

        let other = router.openProject(MobileWorkspace(session: session, projectID: "site"))
        XCTAssertFalse(first === other)
        XCTAssertNil(router.inspector)
    }

    @MainActor func testOneViewStandsInTheContentAndLeavesWhenTheProjectLostIt() {
        let (runtime, machine, connections) = fixture()
        defer { connections.shutdown() }
        let router = PadRouter()
        let navigation = router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        router.show(view: "chat")
        router.show(view: "terminal")
        XCTAssertEqual(navigation.selectedViewID, "terminal")
        XCTAssertEqual(router.shownID, "terminal")

        router.forget { $0 != "terminal" }
        XCTAssertNil(navigation.selectedViewID)
        router.show(view: "chat")
        router.forget { $0 == "chat" }
        XCTAssertEqual(navigation.selectedViewID, "chat")
    }

    @MainActor func testAFileOrSubagentTakesTheContentUntilAViewOpens() {
        let (runtime, machine, connections) = fixture()
        defer { connections.shutdown() }
        let router = PadRouter()
        let navigation = router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        router.show(view: "chat")
        router.show(file: "/repo/pool.ts")
        XCTAssertEqual(router.file, "/repo/pool.ts")
        XCTAssertNil(router.shownID, "The sidebar marks no view while a file is shown")
        router.show(subagent: PadSubagent(chatID: "chat", toolUseID: "tool", title: "Find loops"))
        XCTAssertNil(router.file)
        router.show(view: "chat")
        XCTAssertNil(router.subagent)
        XCTAssertEqual(router.shownID, "chat")
        XCTAssertEqual(navigation.selectedViewID, "chat")
    }

    @MainActor func testFilesAndGitBelongToAProjectFolder() {
        let router = PadRouter()
        router.toggle(.files)
        XCTAssertNil(router.inspector, "Without a project there is no folder")
        let (runtime, machine, connections) = fixture()
        defer { connections.shutdown() }
        router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        router.toggle(.files)
        XCTAssertEqual(router.inspector, .files)
        router.toggle(.git)
        XCTAssertEqual(router.inspector, .git)
        router.toggle(.git)
        XCTAssertNil(router.inspector)

        router.openProject(
            MobileWorkspace(
                session: runtime.session(for: machine), projectID: "chats",
                summary: .object(["projectId": .string("chats"), "scratch": .bool(true)])))
        router.toggle(.files)
        XCTAssertNil(router.inspector, "The Chats project has no folder of its own")
    }

    @MainActor func testAProjectRowOpensOnTheRouterOfTheAccountThatIsSignedInNow() {
        let (runtime, machine, connections) = fixture()
        defer { connections.shutdown() }
        let before = PadRouter()
        let after = PadRouter()
        XCTAssertEqual(before.openAction(), before.openAction())
        XCTAssertNotEqual(
            before.openAction(), after.openAction(),
            "An action equal to the old router's would never reach the rows, which kept opening there")

        var closed = false
        let open = after.openAction { closed = true }
        open(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        XCTAssertTrue(closed)
        XCTAssertEqual(after.project?.workspace.projectID, "app")
        XCTAssertEqual(after.detail, .project)
        XCTAssertNil(before.project)
    }

    @MainActor func testTheInspectorOnlyStandsBesideAProjectsContent() {
        let (runtime, machine, connections) = fixture()
        defer { connections.shutdown() }
        let router = PadRouter()
        router.inspector = .files
        XCTAssertFalse(router.showsInspector)
        router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        router.toggle(.files)
        XCTAssertTrue(router.showsInspector)
        router.detail = .now
        XCTAssertFalse(router.showsInspector)
    }

    @MainActor func testASubagentStaysInTheInspectorUntilItsChatLeavesTheContent() {
        let (runtime, machine, connections) = fixture()
        defer { connections.shutdown() }
        let router = PadRouter()
        let session = runtime.session(for: machine)
        router.openProject(
            MobileWorkspace(
                session: session, projectID: "chats",
                summary: .object(["projectId": .string("chats"), "scratch": .bool(true)])))
        router.show(view: "chat")
        let pane = PadSubagentPane(
            model: ChatModel(client: session.rpc, chatID: "chat"),
            crumb: SubagentCrumb(toolUseID: "tool", description: "Find loops"), session: nil)
        router.inspect(pane)
        XCTAssertEqual(router.inspector, .subagent(pane))
        XCTAssertTrue(router.showsInspector, "A sub-agent needs no project folder")

        router.show(view: "chat")
        XCTAssertNil(router.inspector)

        router.inspect(pane)
        router.show(subagent: PadSubagent(chatID: "chat", toolUseID: "tool", title: "Find loops"))
        XCTAssertNil(router.inspector, "Open as view takes the sub-agent out of the inspector")
        XCTAssertEqual(router.subagent?.toolUseID, "tool")
    }

    @MainActor func testANotificationFindsItsNodeAndAMachineOverviewOpensNow() {
        let router = PadRouter()
        router.detail = .machines
        let chat = NotificationDestination(machineID: "mac", nodeID: "chat", target: "chat")
        router.open(chat)
        XCTAssertEqual(router.detail, .notification(chat))
        router.open(NotificationDestination(machineID: "mac", nodeID: "", target: "machine"))
        XCTAssertEqual(router.detail, .now)
    }
}

final class ProjectWidgetRecorderTests: XCTestCase {
    private func entry(
        _ project: String, view: String, item: String? = nil, status: AgentStatus? = nil, snoozed: Bool = false
    ) -> ProjectViewEntry {
        ProjectViewEntry(
            target: ProjectViewTarget(machineID: "mac", projectID: project, viewID: view, itemID: item ?? view),
            machineName: "MacBook Pro", projectName: project.capitalized, title: item ?? view, kind: "chat",
            iconName: "message-square", status: status, snoozedUntil: snoozed ? .now.addingTimeInterval(600) : nil)
    }

    func testAViewTakesTheStateOfTheNodesOnIt() {
        let snapshot = ProjectWidgetRecorder.snapshot([
            entry("app", view: "canvas"),
            entry("app", view: "canvas", item: "logs", status: .running),
            entry("app", view: "chat", status: .needsYou),
            entry("app", view: "quiet", status: .needsYou, snoozed: true),
            entry("site", view: "notes"),
        ])
        XCTAssertEqual(snapshot.projects.map(\.projectID), ["app", "site"])
        let views = snapshot.projects[0].views
        XCTAssertEqual(views.map(\.id), ["canvas", "chat", "quiet"], "A node is no row of its own")
        XCTAssertEqual(views.map(\.state), [.working, .needsYou, .idle])
        XCTAssertEqual(snapshot.projects[1].views.map(\.state), [.idle])
    }

    func testAViewOpensThroughTheWidgetDoor() throws {
        let project = ProjectWidgetProject(
            machineID: "mac", projectID: "app", name: "App", machineName: "MacBook Pro",
            views: [ProjectWidgetView(id: "canvas", title: "Canvas", icon: "layout-grid", state: .idle)])
        let url = try XCTUnwrap(project.url(for: project.views[0]))
        XCTAssertEqual(url.absoluteString, "ruimte://node?machine=mac&node=canvas&target=view")
    }
}

final class PadProcessTableTests: XCTestCase {
    private func process(_ pid: Int, cpu: Double?) -> JSONValue {
        .object([
            "pid": .number(Double(pid)), "startTime": .number(100), "name": .string("bun"), "readable": .bool(true),
            "cpu": cpu.map(JSONValue.number) ?? .null, "memory": .number(2048), "depth": .number(0),
        ])
    }

    func testEveryProcessIsARowNamedAfterItsNodeAndProject() {
        let groups = [
            ProcessGroup(
                json: .object([
                    "id": .string("g1"), "kind": .string("terminal"), "nodeId": .string("t1"),
                    "projectId": .string("app"), "processes": .array([process(10, cpu: 3), process(11, cpu: nil)]),
                ])),
            ProcessGroup(
                json: .object([
                    "id": .string("g2"), "kind": .string("daemon"), "processes": .array([process(20, cpu: 96)]),
                ])),
        ]
        let rows = ProcessTableRow.rows(groups, titles: ["t1": "bun dev"], projectNames: ["app": "Recept Maker"])
        XCTAssertEqual(rows.map(\.pid), [10, 11, 20])
        XCTAssertEqual(rows.first?.owner, "bun dev")
        XCTAssertEqual(rows.first?.place, "Recept Maker")
        XCTAssertEqual(rows.last?.place, "Machine tasks")

        let byCPU = rows.sorted(using: KeyPathComparator(\ProcessTableRow.cpu, order: .reverse))
        XCTAssertEqual(byCPU.map(\.pid), [20, 10, 11], "An unreadable reading sorts below every reading")
    }
}
