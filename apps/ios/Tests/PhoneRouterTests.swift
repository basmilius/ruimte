import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class PhoneRouterTests: XCTestCase {
    private let target = ProjectViewTarget(machineID: "mac", projectID: "app", viewID: "canvas", itemID: "chat")

    @MainActor func testAViewFromAnyTabButSearchOpensUnderNow() {
        let router = PhoneRouter()
        router.tab = .machines
        router.show(target, from: .machines)
        XCTAssertEqual(router.tab, .now)
        XCTAssertEqual(router.path(.now), [.view(target)])
        XCTAssertEqual(router.path(.machines), [])
    }

    @MainActor func testSearchKeepsTheViewItOpened() {
        let router = PhoneRouter()
        router.tab = .search
        router.show(target, from: .search)
        XCTAssertEqual(router.tab, .search)
        XCTAssertEqual(router.path(.search), [.view(target)])
        XCTAssertEqual(router.path(.now), [])
    }

    @MainActor func testANotificationLandsOnNowAndAMachineOverviewOnNowItself() {
        let router = PhoneRouter()
        router.tab = .projects
        let chat = NotificationDestination(machineID: "mac", nodeID: "chat", target: "chat")
        router.open(chat)
        XCTAssertEqual(router.tab, .now)
        XCTAssertEqual(router.path(.now), [.notification(chat)])

        router.tab = .search
        router.open(NotificationDestination(machineID: "mac", nodeID: "", target: "machine"))
        XCTAssertEqual(router.tab, .now)
        XCTAssertEqual(router.path(.now), [])
    }

    @MainActor func testEveryRouteReplacesWhatItsTabPushedSoNothingGoesDeeperThanTwoLevels() {
        let router = PhoneRouter()
        router.show(target, from: .now)
        router.show(ProjectViewTarget(machineID: "mac", projectID: "app", viewID: "canvas", itemID: "term"), from: .now)
        XCTAssertEqual(router.path(.now).count, 1)
        router.showMachine("mac")
        router.showMachine("mini")
        XCTAssertEqual(router.tab, .machines)
        XCTAssertEqual(router.path(.machines), [.machine("mini")])
        router.showRecentProjects()
        XCTAssertEqual(router.tab, .projects)
        XCTAssertEqual(router.path(.projects), [.recentProjects])
        XCTAssertEqual(router.path(.now).count, 1)
    }

    @MainActor func testOpeningAProjectGoesToProjectsWithItsView() {
        let (runtime, machine, connections) = Self.runtime()
        defer { connections.shutdown() }
        let router = PhoneRouter()
        router.showRecentProjects()
        router.tab = .search
        router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"), view: "chat")
        XCTAssertEqual(router.tab, .projects)
        XCTAssertEqual(router.path(.projects).count, 1)
        XCTAssertEqual(router.project?.workspace.projectID, "app")
        XCTAssertEqual(router.project?.pendingViewID, "chat")
    }

    @MainActor func testAViewOfAProjectGoesOverTheProject() throws {
        let (runtime, machine, connections) = Self.runtime()
        defer { connections.shutdown() }
        let router = PhoneRouter()
        router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        let navigation = try XCTUnwrap(router.project)
        router.openView("chat", in: navigation)
        XCTAssertEqual(router.path(.projects), [.project(navigation), .projectView(navigation, "chat")])
        router.openView("terminal", in: navigation)
        XCTAssertEqual(router.path(.projects), [.project(navigation), .projectView(navigation, "terminal")])
    }

    @MainActor func testOnlyAViewHidesTheTabBar() throws {
        let (runtime, machine, connections) = Self.runtime()
        defer { connections.shutdown() }
        let navigation = WorkspaceNavigation(
            workspace: MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        let chat = NotificationDestination(machineID: "mac", nodeID: "chat", target: "chat")
        XCTAssertFalse(PhoneRoute.project(navigation).hidesTabBar)
        XCTAssertFalse(PhoneRoute.machine("mac").hidesTabBar)
        XCTAssertFalse(PhoneRoute.recentProjects.hidesTabBar)
        XCTAssertTrue(PhoneRoute.projectView(navigation, "chat").hidesTabBar)
        XCTAssertTrue(PhoneRoute.view(target).hidesTabBar)
        XCTAssertTrue(PhoneRoute.notification(chat).hidesTabBar)
    }

    @MainActor func testAPopThatSettledShortensThePathAndATakenBackSwipeLeavesIt() {
        let router = PhoneRouter()
        router.show(target, from: .now)
        router.settle(.now, path: [.view(target)])
        XCTAssertEqual(router.path(.now), [.view(target)])
        router.settle(.now, path: [])
        XCTAssertEqual(router.path(.now), [])
        XCTAssertEqual(router.tab, .now)
    }

    @MainActor func testResetGoesBackToNowWithEveryStackAtItsRoot() {
        let router = PhoneRouter()
        router.showMachine("mac")
        router.show(target, from: .search)
        router.reset()
        XCTAssertEqual(router.tab, .now)
        XCTAssertTrue(PhoneTab.allCases.allSatisfy { router.path($0).isEmpty })
    }

    @MainActor private static func runtime() -> (AppRuntime, Machine, MachineConnections) {
        let connections = MachineConnections(monitorPaths: false)
        let runtime = AppRuntime(connections: connections)
        let machine = Machine(
            id: "router-\(UUID().uuidString)", name: "MacBook Pro", icon: nil,
            publicKey: DeviceKey().publicKey, brokerUrl: nil, lastSeenAt: nil)
        runtime.machines = [machine]
        return (runtime, machine, connections)
    }
}
