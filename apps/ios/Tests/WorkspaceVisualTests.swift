import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit
import XCTest

@testable import Ruimte

final class WorkspaceVisualTests: XCTestCase {
    @MainActor func testLongProjectNamesKeepTheSameRowHeight() async throws {
        for typeSize in [DynamicTypeSize.large, .xxxLarge] {
            let runtime = AppRuntime(connections: MachineConnections(monitorPaths: false))
            let machine = Machine(
                id: "project-long-name-\(UUID().uuidString)", name: "MacBook Pro",
                icon: MachineIcon(kind: "lucide", value: "laptop"),
                publicKey: DeviceKey().publicKey, brokerUrl: nil, lastSeenAt: nil)
            let session = runtime.session(for: machine)
            let host = UIHostingController(
                rootView: NavigationStack {
                    List {
                        ForEach(["Ruimte", "A project with a very long name that must fit on one line"], id: \.self) {
                            name in
                            ProjectHomeRow(
                                summary: ProjectRowWire.summary(name, name: name).projectSummary, machine: machine.name,
                                connected: true, session: session
                            )
                            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                        }
                    }.listStyle(.insetGrouped).navigationTitle("Projects")
                }.dynamicTypeSize(typeSize))
            let window = UIWindow.showing(host, size: CGSize(width: 402, height: 874))
            defer {
                window.close()
                runtime.connections.shutdown()
            }
            await displayFrames(20)
            let list = try XCTUnwrap(host.view.descendant(of: UICollectionView.self))
            let heights = list.visibleCells.map(\.bounds.height)
            XCTAssertEqual(heights.count, 2)
            XCTAssertEqual(try XCTUnwrap(heights.min()), try XCTUnwrap(heights.max()), accuracy: 1)
            capture(window, name: typeSize == .large ? "project-long-name-iphone" : "project-long-name-large-type")
        }
    }

    @MainActor func testRealWorkspaceSectionsAcrossPhoneTabletAndTypeSizes() async throws {
        try NativePresentationProbe.enableAccessibility()
        for (name, size, dark, typeSize, horizontalClass) in [
            (
                "workspace-sections-iphone", CGSize(width: 402, height: 874), false, DynamicTypeSize.large,
                UserInterfaceSizeClass.compact
            ),
            ("workspace-sections-dark", CGSize(width: 402, height: 874), true, .large, .compact),
            ("workspace-sections-ipad", CGSize(width: 1194, height: 834), false, .large, .regular),
            ("workspace-sections-large-type", CGSize(width: 402, height: 874), false, .xxxLarge, .compact),
        ] {
            let pool = MachineConnections(monitorPaths: false)
            let runtime = AppRuntime(connections: pool)
            let machine = Machine(
                id: "workspace-visual-\(UUID().uuidString)", name: "MacBook Pro", icon: nil,
                publicKey: DeviceKey().publicKey, brokerUrl: nil, lastSeenAt: nil)
            runtime.machines = [machine]
            let session = runtime.session(for: machine)
            let wire = try WorkspaceVisualWire(snapshot: snapshot)
            session.rpc = wire.client
            let workspace = MobileWorkspace(session: session, projectID: "visual-project")
            defer {
                workspace.stop()
                wire.client.shutdown()
                pool.shutdown()
                UserDefaults.standard.removeObject(forKey: workspace.storageKey)
            }
            workspace.start()
            await workspace.open()
            XCTAssertTrue(workspace.ready, workspace.problem ?? "The fixture did not open")
            XCTAssertTrue(wire.requests.contains(.projectOpen))
            XCTAssertEqual(WorkspaceViewSections.split(workspace.views).map(\.title), [nil, "Build & run", nil])
            XCTAssertEqual(WorkspaceViewSections.split(workspace.views).map { $0.items.count }, [1, 2, 2])
            XCTAssertFalse(session.connected)
            if horizontalClass == .regular { workspace.selectedID = nil }

            let host = UIHostingController(
                rootView: WorkspaceNavigationFixture(workspace: workspace, sidebar: horizontalClass == .regular)
                    .tint(MobileStyle.accent)
                    .preferredColorScheme(dark ? .dark : .light)
                    .dynamicTypeSize(typeSize)
                    .environment(\.horizontalSizeClass, horizontalClass))
            host.traitOverrides.horizontalSizeClass = horizontalClass == .regular ? .regular : .compact
            let window = UIWindow.showing(host, size: size)
            await displayFrames(20)
            XCTAssertTrue(containsList(host.view), "The real workspace sidebar must be mounted")
            let list = try XCTUnwrap(host.view.descendant(of: UICollectionView.self))
            let expected = [
                ["Overview of the workspace and all its running projects"],
                ["Native iOS app", "Project checks"],
                ["Device acceptance checklist", "Connection flow"],
            ]
            var rendered: [[String]] = []
            var headingShown = NativePresentationProbe.labels(in: host.view).contains { $0.contains("Build & run") }
            for section in 0..<list.numberOfSections {
                var names: [String] = []
                for row in 0..<list.numberOfItems(inSection: section) {
                    let index = IndexPath(item: row, section: section)
                    list.scrollToItem(at: index, at: .centeredVertically, animated: false)
                    list.layoutIfNeeded()
                    await displayFrames()
                    if NativePresentationProbe.labels(in: host.view).contains(where: { $0.contains("Build & run") }) {
                        headingShown = true
                    }
                    let cell = try XCTUnwrap(list.cellForItem(at: index))
                    let labels = NativePresentationProbe.labels(in: cell).joined(separator: "\n")
                    names += expected.flatMap { $0 }.filter { labels.contains($0) }
                }
                if !names.isEmpty { rendered.append(names) }
            }
            XCTAssertEqual(rendered, expected, name)
            XCTAssertTrue(headingShown, name)
            XCTAssertEqual(wire.client.pendingRequestCount, 0)
            capture(window, name: name)
            window.close()
        }
    }

    private var snapshot: JSONValue {
        let views: [JSONValue] = [
            .object([
                "id": .string("overview"), "kind": .string("canvas"),
                "name": .string("Overview of the workspace and all its running projects"),
                "nodes": .array([]), "texts": .array([]), "edges": .array([]), "layouts": .array([]),
            ]),
            .object(["id": .string("adjacent-empty"), "kind": .string("separator")]),
            .object(["id": .string("sessions"), "kind": .string("separator"), "name": .string("Build & run")]),
            .object([
                "id": .string("chat"), "kind": .string("chat"), "name": .string("Native iOS app"),
                "node": .object(["provider": .string("codex")]),
                "icon": .object(["kind": .string("lucide"), "value": .string("rocket")]),
            ]),
            .object([
                "id": .string("terminal"), "kind": .string("terminal"), "name": .string("Project checks"),
                "node": .object([:]),
            ]),
            .object(["id": .string("reference"), "kind": .string("separator")]),
            .object([
                "id": .string("notes"), "kind": .string("file"), "name": .string("Device acceptance checklist"),
                "path": .string("docs/ios.md"),
                "icon": .object(["kind": .string("lucide"), "value": .string("bookmark")]),
            ]),
            .object([
                "id": .string("diagram"), "kind": .string("diagram"), "name": .string("Connection flow"),
            ]),
            .object(["id": .string("trailing"), "kind": .string("separator")]),
        ]
        return .object([
            "summary": .object([
                "projectId": .string("visual-project"), "name": .string("Ruimte"), "color": .string("#155dfc"),
                "folder": .string("/work/ruimte"), "lastOpenedAt": .number(1), "closedAt": .null,
                "available": .bool(true), "icon": .object(["kind": .string("initial"), "value": .string("R")]),
                "nameSource": .string("chosen"),
            ]),
            "document": .object([
                "version": .number(3), "rev": .number(1), "name": .string("Ruimte"), "color": .string("#155dfc"),
                "views": .array(views),
            ]),
            "local": .object(["activeViewId": .string("overview"), "views": .object([:])]),
        ])
    }

    @MainActor private func containsList(_ view: UIView) -> Bool {
        view is UICollectionView || view is UITableView || view.subviews.contains(where: containsList)
    }

}

@MainActor private final class WorkspaceVisualWire {
    let snapshot: JSONValue
    private(set) var requests: [WireRequest] = []
    lazy var client = MachineClient(send: { [weak self] text in try self?.receive(text) }, connected: true)

    init(snapshot: JSONValue) throws {
        self.snapshot = try WireRequest.projectOpen.validateResult(snapshot)
    }

    private func receive(_ text: String) throws {
        let frame = try JSONValue.decode(Data(text.utf8))
        let name = frame.text("type")
        guard let type = WireRequest(rawValue: name) else {
            throw MachineClientError.invalid("Unexpected visual-fixture request: \(name)")
        }
        requests.append(type)
        let result: JSONValue
        switch type {
        case .projectOpen: result = snapshot
        case .projectRelease, .projectSaveLocal: result = .object([:])
        default: throw MachineClientError.invalid("Unexpected visual-fixture request: \(name)")
        }
        let answer = JSONValue.object(["id": frame["id"]!, "ok": .bool(true), "result": result])
        client.receive(String(decoding: try answer.encoded(), as: UTF8.self))
    }
}

private struct WorkspaceNavigationFixture: View {
    @State private var navigation: WorkspaceNavigation
    @State private var opened = false
    let sidebar: Bool

    init(workspace: MobileWorkspace, sidebar: Bool) {
        _navigation = State(initialValue: WorkspaceNavigation(workspace: workspace))
        self.sidebar = sidebar
    }

    var body: some View {
        if sidebar {
            NavigationSplitView {
                NavigationStack { WorkspacePage(navigation: navigation, navigator: PadRouter()) }
            } detail: {
                NavigationStack { Text("Select a view") }
            }
        } else {
            NavigationStack {
                Text("Projects")
                    .navigationTitle("Projects")
                    .navigationDestination(isPresented: $opened) {
                        WorkspacePage(navigation: navigation, navigator: PhoneRouter())
                    }
            }
            .onAppear { opened = true }
        }
    }
}
