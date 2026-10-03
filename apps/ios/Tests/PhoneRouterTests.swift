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
        XCTAssertEqual(router.now, .view(target))
        XCTAssertNil(router.search)
    }

    @MainActor func testSearchKeepsTheViewItOpened() {
        let router = PhoneRouter()
        router.tab = .search
        router.show(target, from: .search)
        XCTAssertEqual(router.tab, .search)
        XCTAssertEqual(router.search, .view(target))
        XCTAssertNil(router.now)
    }

    @MainActor func testANotificationLandsOnNowAndAMachineOverviewOnNowItself() {
        let router = PhoneRouter()
        router.tab = .projects
        let chat = NotificationDestination(machineID: "mac", nodeID: "chat", target: "chat")
        router.open(chat)
        XCTAssertEqual(router.tab, .now)
        XCTAssertEqual(router.now, .notification(chat))

        router.tab = .search
        router.open(NotificationDestination(machineID: "mac", nodeID: "", target: "machine"))
        XCTAssertEqual(router.tab, .now)
        XCTAssertNil(router.now)
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
        router.showingRecent = true
        router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: "app"), view: "chat")
        XCTAssertEqual(router.tab, .projects)
        XCTAssertFalse(router.showingRecent)
        XCTAssertEqual(router.project?.workspace.projectID, "app")
        XCTAssertEqual(router.project?.pendingViewID, "chat")
        // The accessory waits for the project to open, and stands down while one of its views is on screen.
        XCTAssertFalse(router.showsProjectAccessory)
        router.tab = .now
        XCTAssertFalse(router.showsProjectAccessory)
    }
}
