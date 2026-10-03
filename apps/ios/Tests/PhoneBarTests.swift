import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit
import XCTest

@testable import Ruimte

final class PhoneBarTests: XCTestCase {
    @MainActor func testEveryBarEndsOnTheAvatarUnderOneIdentifier() {
        let (runtime, machine, connections) = Self.runtime()
        defer { connections.shutdown() }
        let bars = PhoneBars(runtime: runtime, showSettings: {})
        let navigation = WorkspaceNavigation(
            workspace: MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        let all = [
            bars.now(requests: BarRequests()), bars.projects(UnifiedProjects()),
            bars.machines(pair: {}, signIn: {}), bars.search(), bars.project(navigation),
            bars.machine(runtime.session(for: machine), requests: BarRequests()),
        ]
        for bar in all {
            XCTAssertEqual(bar.items.last?.identifier, "settings")
            XCTAssertEqual(bar.items.filter { $0.identifier == "settings" }.count, 1)
        }
        XCTAssertFalse(all[0].items.last === all[1].items.last)
    }

    @MainActor func testThePageHasItsItemsAndTitleBeforeItIsPushed() throws {
        let (runtime, machine, connections) = Self.runtime()
        defer { connections.shutdown() }
        let navigation = WorkspaceNavigation(
            workspace: MobileWorkspace(session: runtime.session(for: machine), projectID: "app"))
        let page = PhonePageController(
            route: .project(navigation), page: AnyView(EmptyView()),
            bar: PhoneBars(runtime: runtime, showSettings: {}).project(navigation))
        let items = try XCTUnwrap(page.navigationItem.rightBarButtonItems)
        XCTAssertEqual(items.map(\.identifier), ["settings", "project.menu"])
        XCTAssertEqual(page.navigationItem.subtitle, "MacBook Pro")
        XCTAssertEqual(page.navigationItem.largeTitleDisplayMode, .never)
        XCTAssertFalse(items[1].isEnabled)
        let titles = items[1].menu?.children.flatMap { ($0 as? UIMenu)?.children ?? [] }.compactMap {
            ($0 as? UIAction)?.title
        }
        XCTAssertEqual(titles, ["New view", "Files", "Git", "Launches", "Usage"])
    }

    @MainActor func testNowWritesOnlyWithAMachine() {
        let (runtime, _, connections) = Self.runtime()
        defer { connections.shutdown() }
        let bar = PhoneBars(runtime: runtime, showSettings: {}).now(requests: BarRequests())
        bar.update(UINavigationItem())
        XCTAssertEqual(bar.items.first?.isHidden, false)
        runtime.machines = []
        bar.update(UINavigationItem())
        XCTAssertEqual(bar.items.first?.isHidden, true)
    }

    @MainActor private static func runtime() -> (AppRuntime, Machine, MachineConnections) {
        let connections = MachineConnections(monitorPaths: false)
        let runtime = AppRuntime(connections: connections)
        let machine = Machine(
            id: "bar-\(UUID().uuidString)", name: "MacBook Pro", icon: nil,
            publicKey: DeviceKey().publicKey, brokerUrl: nil, lastSeenAt: nil)
        runtime.machines = [machine]
        return (runtime, machine, connections)
    }
}
