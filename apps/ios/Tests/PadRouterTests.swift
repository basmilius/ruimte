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

    @MainActor func testAColdStartOpensOnNowWithTheLastProjectInTheSidebar() {
        let (runtime, machine, connections) = fixture()
        defer { connections.shutdown() }
        let router = PadRouter()
        XCTAssertEqual(router.detail, .now)
        router.restore(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        XCTAssertEqual(router.project?.workspace.projectID, "app")
        XCTAssertEqual(router.detail, .now)
    }

    @MainActor func testOpeningAProjectShowsItsCellsAndRemembersIt() {
        let (runtime, machine, connections) = fixture()
        let defaults = UserDefaults.standard
        let previous = defaults.data(forKey: LastProject.storageKey)
        defer {
            connections.shutdown()
            if let previous { defaults.set(previous, forKey: LastProject.storageKey) } else { LastProject.forget() }
        }
        let router = PadRouter()
        router.inspector = .git
        let navigation = router.openProject(
            MobileWorkspace(session: runtime.session(for: machine), projectID: "app"), view: "chat")
        XCTAssertEqual(router.detail, .project)
        XCTAssertEqual(navigation.pendingViewID, "chat")
        XCTAssertNil(router.inspector)
        XCTAssertEqual(LastProject.read(), LastProject(machineID: machine.id, projectID: "app"))

        router.closeProject()
        XCTAssertNil(router.project)
        XCTAssertEqual(router.detail, .now)
        XCTAssertNil(LastProject.read())
    }

    @MainActor func testTheProjectAlreadyInTheSidebarKeepsItsState() {
        let (runtime, machine, connections) = fixture()
        defer {
            connections.shutdown()
            LastProject.forget()
        }
        let router = PadRouter()
        let session = runtime.session(for: machine)
        let first = router.openProject(MobileWorkspace(session: session, projectID: "app"))
        router.inspector = .files
        router.showNow()
        let again = router.openProject(MobileWorkspace(session: session, projectID: "app"), view: "terminal")
        XCTAssertTrue(first === again)
        XCTAssertEqual(router.inspector, .files)
        XCTAssertEqual(router.detail, .project)
        XCTAssertEqual(again.pendingViewID, "terminal")

        let other = router.openProject(MobileWorkspace(session: session, projectID: "site"))
        XCTAssertFalse(first === other)
        XCTAssertNil(router.inspector)
    }

    @MainActor func testAViewOpensInTheFirstCellAndBesideItInTheSecond() {
        let (runtime, machine, connections) = fixture()
        defer {
            connections.shutdown()
            LastProject.forget()
        }
        let router = PadRouter()
        let navigation = router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        router.showBeside(view: "chat")
        XCTAssertEqual(navigation.selectedViewID, "chat", "Beside nothing, a view takes the first cell")
        XCTAssertNil(router.secondViewID)

        router.showBeside(view: "terminal")
        XCTAssertEqual(router.secondViewID, "terminal")
        router.show(view: "terminal")
        XCTAssertEqual(navigation.selectedViewID, "terminal")
        XCTAssertNil(router.secondViewID, "One view never stands in both cells")

        router.showBeside(view: "chat")
        router.forget { $0 != "terminal" }
        XCTAssertEqual(navigation.selectedViewID, "chat", "The second cell moves up when the first one's view went")
        XCTAssertNil(router.secondViewID)
    }

    @MainActor func testAFileOrSubagentTakesTheFirstCellUntilAViewOpens() {
        let (runtime, machine, connections) = fixture()
        defer {
            connections.shutdown()
            LastProject.forget()
        }
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
        defer {
            connections.shutdown()
            LastProject.forget()
        }
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

    @MainActor func testANotificationFindsItsNodeAndAMachineOverviewOpensNow() {
        let router = PadRouter()
        router.detail = .projects
        let chat = NotificationDestination(machineID: "mac", nodeID: "chat", target: "chat")
        router.open(chat)
        XCTAssertEqual(router.detail, .notification(chat))
        router.open(NotificationDestination(machineID: "mac", nodeID: "", target: "machine"))
        XCTAssertEqual(router.detail, .now)
    }

    func testTheSidebarListsTheFirstWaitingItemsOfEveryProject() {
        let entries = (0..<5).map { index in
            ProjectViewEntry(
                target: ProjectViewTarget(
                    machineID: "mac", projectID: "p\(index)", viewID: "v\(index)", itemID: "v\(index)"),
                machineName: "MacBook Pro", projectName: "Project \(index)", title: "Chat \(index)", kind: "chat",
                iconName: "message-square", status: .needsYou)
        }
        let board = NowBoard(needsYou: entries)
        XCTAssertEqual(PadSidebarLogic.waiting(board).map(\.target.projectID), ["p0", "p1", "p2"])
        XCTAssertEqual(PadSidebarLogic.waiting(NowBoard()).count, 0)
    }

    func testTheSwitcherNamesTheProjectAndItsMachine() {
        XCTAssertTrue(
            PadSidebarLogic.switcherLines(summary: nil, title: nil, machine: nil) == ("Choose a project", "No project open"))
        XCTAssertTrue(
            PadSidebarLogic.switcherLines(summary: .object([:]), title: "Recept Maker", machine: "MacBook Pro")
                == ("Recept Maker", "MacBook Pro"))
        XCTAssertTrue(
            PadSidebarLogic.switcherLines(
                summary: .object(["scratch": .bool(true)]), title: "scratch", machine: "Studio") == ("Chats", "Studio"))
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
