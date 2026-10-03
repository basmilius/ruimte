import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class PhoneRouterTests: XCTestCase {
    private let target = ProjectViewTarget(machineID: "mac", projectID: "app", viewID: "canvas", itemID: "chat")

    @MainActor func testAViewFromAnyTabButSearchOpensOverNow() {
        let router = PhoneRouter()
        router.tab = .machines
        router.show(target, from: .machines)
        XCTAssertEqual(router.tab, .now)
        XCTAssertEqual(router.views, [.view(target)])
        XCTAssertTrue(PhoneTab.allCases.allSatisfy { router.path($0).isEmpty })
    }

    @MainActor func testSearchStaysUnderTheViewItOpened() {
        let router = PhoneRouter()
        router.tab = .search
        router.show(target, from: .search)
        XCTAssertEqual(router.tab, .search)
        XCTAssertEqual(router.views, [.view(target)])
        XCTAssertEqual(router.path(.search), [])
    }

    @MainActor func testANotificationLandsOverNowAndAMachineOverviewOnNowItself() {
        let router = PhoneRouter()
        router.tab = .projects
        let chat = NotificationDestination(machineID: "mac", nodeID: "chat", target: "chat")
        router.open(chat)
        XCTAssertEqual(router.tab, .now)
        XCTAssertEqual(router.views, [.notification(chat)])

        router.tab = .search
        router.open(NotificationDestination(machineID: "mac", nodeID: "", target: "machine"))
        XCTAssertEqual(router.tab, .now)
        XCTAssertEqual(router.views, [])
    }

    @MainActor func testEveryRouteReplacesWhatItsStackPushedSoNothingGoesDeeperThanTwoLevels() {
        let router = PhoneRouter()
        router.show(target, from: .now)
        router.show(ProjectViewTarget(machineID: "mac", projectID: "app", viewID: "canvas", itemID: "term"), from: .now)
        XCTAssertEqual(router.views.count, 1)
        router.showMachine("mac")
        router.showMachine("mini")
        XCTAssertEqual(router.tab, .machines)
        XCTAssertEqual(router.path(.machines), [.machine("mini")])
        router.showRecentProjects()
        XCTAssertEqual(router.tab, .projects)
        XCTAssertEqual(router.path(.projects), [.recentProjects])
        XCTAssertEqual(router.path(.machines), [.machine("mini")])
    }

    @MainActor func testAListLevelRouteTakesTheViewOffTheTabs() {
        let router = PhoneRouter()
        router.show(target, from: .now)
        router.showMachine("mac")
        XCTAssertEqual(router.views, [])
        router.show(target, from: .search)
        router.showRecentProjects()
        XCTAssertEqual(router.views, [])
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

    @MainActor func testAViewOfAProjectGoesOverTheTabsWithTheProjectUnderIt() throws {
        let (runtime, machine, connections) = Self.runtime()
        defer { connections.shutdown() }
        let router = PhoneRouter()
        router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        let navigation = try XCTUnwrap(router.project)
        router.openView("chat", in: navigation)
        XCTAssertEqual(router.path(.projects), [.project(navigation)])
        XCTAssertEqual(router.views, [.projectView(navigation, "chat")])
        router.openView("terminal", in: navigation)
        XCTAssertEqual(router.views, [.projectView(navigation, "terminal")])

        router.settleViews([])
        XCTAssertEqual(router.tab, .projects)
        XCTAssertEqual(router.path(.projects), [.project(navigation)])
        XCTAssertEqual(router.views, [])
    }

    @MainActor func testOpeningAProjectTakesTheViewOffTheTabs() {
        let (runtime, machine, connections) = Self.runtime()
        defer { connections.shutdown() }
        let router = PhoneRouter()
        router.show(target, from: .now)
        router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        XCTAssertEqual(router.views, [])
        XCTAssertEqual(router.path(.projects).count, 1)
    }

    @MainActor func testAPopThatSettledShortensThePathAndATakenBackSwipeLeavesIt() {
        let router = PhoneRouter()
        router.show(target, from: .now)
        router.settleViews([.view(target)])
        XCTAssertEqual(router.views, [.view(target)])
        router.settleViews([])
        XCTAssertEqual(router.views, [])
        XCTAssertEqual(router.tab, .now)

        router.showMachine("mac")
        router.settle(.machines, path: [.machine("mac")])
        XCTAssertEqual(router.path(.machines), [.machine("mac")])
        router.settle(.machines, path: [])
        XCTAssertEqual(router.path(.machines), [])
    }

    @MainActor func testResetGoesBackToNowWithEveryStackAtItsRoot() {
        let router = PhoneRouter()
        router.showMachine("mac")
        router.show(target, from: .search)
        router.reset()
        XCTAssertEqual(router.tab, .now)
        XCTAssertTrue(PhoneTab.allCases.allSatisfy { router.path($0).isEmpty })
        XCTAssertEqual(router.views, [])
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
