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
        XCTAssertEqual(router.path, [.view(target)])
    }

    @MainActor func testSearchKeepsTheViewItOpened() {
        let router = PhoneRouter()
        router.tab = .search
        router.show(target, from: .search)
        XCTAssertEqual(router.tab, .search)
        XCTAssertEqual(router.path, [.view(target)])
    }

    @MainActor func testANotificationLandsOnNowAndAMachineOverviewOnNowItself() {
        let router = PhoneRouter()
        router.tab = .projects
        let chat = NotificationDestination(machineID: "mac", nodeID: "chat", target: "chat")
        router.open(chat)
        XCTAssertEqual(router.tab, .now)
        XCTAssertEqual(router.path, [.notification(chat)])

        router.tab = .search
        router.open(NotificationDestination(machineID: "mac", nodeID: "", target: "machine"))
        XCTAssertEqual(router.tab, .now)
        XCTAssertEqual(router.path, [])
    }

    @MainActor func testEveryRouteReplacesWhatWasPushedSoNothingGoesDeeperThanTwoLevels() {
        let router = PhoneRouter()
        router.tab = .machines
        router.showMachine("mac")
        XCTAssertEqual(router.path, [.machine("mac")])
        router.show(target, from: .machines)
        XCTAssertEqual(router.path, [.view(target)])
        router.tab = .projects
        router.showRecentProjects()
        XCTAssertEqual(router.path, [.recentProjects])
    }

    @MainActor func testOpeningAProjectGoesToProjectsWithItsView() {
        let connections = MachineConnections(monitorPaths: false)
        defer { connections.shutdown() }
        let runtime = AppRuntime(connections: connections)
        let machine = Machine(
            id: "router-\(UUID().uuidString)", name: "MacBook Pro", icon: nil,
            publicKey: DeviceKey().publicKey, brokerUrl: nil, lastSeenAt: nil)
        runtime.machines = [machine]
        let router = PhoneRouter()
        router.showRecentProjects()
        router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"), view: "chat")
        XCTAssertEqual(router.tab, .projects)
        XCTAssertEqual(router.path.count, 1)
        XCTAssertEqual(router.project?.workspace.projectID, "app")
        XCTAssertEqual(router.project?.pendingViewID, "chat")
    }
}
