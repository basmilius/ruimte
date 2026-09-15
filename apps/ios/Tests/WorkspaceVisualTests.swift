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
                icon: MachineIcon(kind: .lucide, value: "laptop"),
                publicKey: DeviceKey().publicKey, brokerUrl: nil, lastSeenAt: nil)
            let session = runtime.session(for: machine)
            let host = UIHostingController(
                rootView: NavigationStack {
                    List {
                        ForEach(["Ruimte", "A project with a very long name that must fit on one line"], id: \.self) {
                            name in
                            ProjectHomeRow(
                                summary: .object(["name": .string(name)]), machine: machine.name,
                                connected: true, session: session
                            )
                            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                        }
                    }.listStyle(.insetGrouped).navigationTitle("Projects")
                }.dynamicTypeSize(typeSize))
            let window = makeWindow(host, size: CGSize(width: 402, height: 874))
            defer {
                window.isHidden = true
                window.rootViewController = nil
                runtime.connections.shutdown()
            }
            for _ in 0..<20 { await displayFrame() }
            let list = try XCTUnwrap(descendant(UICollectionView.self, in: host.view))
            let heights = list.visibleCells.map(\.bounds.height)
            XCTAssertEqual(heights.count, 2)
            XCTAssertEqual(try XCTUnwrap(heights.min()), try XCTUnwrap(heights.max()), accuracy: 1)
            capture(window, name: typeSize == .large ? "project-long-name-iphone" : "project-long-name-large-type")
        }
    }

    @MainActor func testRealWorkspaceSectionsAcrossPhoneTabletAndTypeSizes() async throws {
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
            XCTAssertTrue(wire.requests.contains("project.open"))
            XCTAssertEqual(WorkspaceViewSections.split(workspace.views).map(\.title), [nil, "Build & run", nil])
            XCTAssertEqual(WorkspaceViewSections.split(workspace.views).map { $0.items.count }, [1, 2, 2])
            XCTAssertFalse(session.connected)
            if horizontalClass == .regular { workspace.selectedID = nil }

            let host = UIHostingController(
                rootView: WorkspacePage(workspace: workspace, close: {})
                    .tint(MobileStyle.accent)
                    .preferredColorScheme(dark ? .dark : .light)
                    .dynamicTypeSize(typeSize)
                    .environment(\.horizontalSizeClass, horizontalClass))
            host.traitOverrides.horizontalSizeClass = horizontalClass == .regular ? .regular : .compact
            let window = makeWindow(host, size: size)
            for _ in 0..<20 { await displayFrame() }
            XCTAssertTrue(containsList(host.view), "The real workspace sidebar must be mounted")
            XCTAssertEqual(wire.client.pendingRequestCount, 0)
            capture(window, name: name)
            window.isHidden = true
            window.rootViewController = nil
        }
    }

    @MainActor func testNativeRowActivationOpensCanvasOnPhoneAndTablet() async throws {
        for horizontalClass in [UserInterfaceSizeClass.compact, .regular] {
            let pool = MachineConnections(monitorPaths: false)
            let runtime = AppRuntime(connections: pool)
            let machine = Machine(
                id: "workspace-navigation-\(UUID().uuidString)", name: "MacBook Pro", icon: nil,
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
            XCTAssertTrue(workspace.ready)
            workspace.selectedID = nil
            let host = UIHostingController(
                rootView: WorkspacePage(workspace: workspace, close: {})
                    .tint(MobileStyle.accent)
                    .environment(\.horizontalSizeClass, horizontalClass))
            host.traitOverrides.horizontalSizeClass = horizontalClass == .regular ? .regular : .compact
            let size = horizontalClass == .regular ? CGSize(width: 1194, height: 834) : CGSize(width: 402, height: 874)
            let window = makeWindow(host, size: size)
            defer {
                window.isHidden = true
                window.rootViewController = nil
            }
            for _ in 0..<20 { await displayFrame() }
            let tabs = try XCTUnwrap(childController(UITabBarController.self, in: host))
            let searchTab = try XCTUnwrap(tabs.tabs.first { $0 is UISearchTab } as? UISearchTab)
            XCTAssertTrue(searchTab.automaticallyActivatesSearch)
            if horizontalClass == .regular {
                let split = try XCTUnwrap(childController(UISplitViewController.self, in: host))
                let sidebar = try XCTUnwrap(split.viewController(for: .primary))
                let barFrame = tabs.tabBar.convert(tabs.tabBar.bounds, to: sidebar.view)
                XCTAssertLessThanOrEqual(barFrame.maxX, sidebar.view.bounds.width + 1)
                XCTAssertGreaterThan(barFrame.minY, sidebar.view.bounds.height / 2)
            }
            let list = try XCTUnwrap(descendant(UICollectionView.self, in: host.view))
            let first = try XCTUnwrap(
                list.indexPathsForVisibleItems.min { left, right in
                    let leftY = list.layoutAttributesForItem(at: left)?.frame.minY ?? .greatestFiniteMagnitude
                    let rightY = list.layoutAttributesForItem(at: right)?.frame.minY ?? .greatestFiniteMagnitude
                    return leftY < rightY
                })
            let row = try XCTUnwrap(list.cellForItem(at: first))
            XCTAssertGreaterThanOrEqual(row.bounds.height, 44)
            XCTAssertNil(descendant(CanvasScrollView.self, in: host.view))
            // UIKit separates row selection from its primary action, which activates a SwiftUI List button.
            XCTAssertEqual(list.delegate?.collectionView?(list, canPerformPrimaryActionForItemAt: first), true)
            list.delegate?.collectionView?(list, performPrimaryActionForItemAt: first)
            for _ in 0..<20 { await displayFrame() }
            XCTAssertEqual(workspace.selectedID, "overview")
            XCTAssertNotNil(
                descendant(CanvasScrollView.self, in: host.view), "Activating the row must mount the real canvas")
            capture(window, name: horizontalClass == .regular ? "workspace-opened-ipad" : "workspace-opened-iphone")
        }
    }

    @MainActor private func childController<Controller: UIViewController>(
        _ type: Controller.Type, in controller: UIViewController
    ) -> Controller? {
        if let found = controller as? Controller { return found }
        for child in controller.children {
            if let found = childController(type, in: child) { return found }
        }
        return nil
    }

    @MainActor private func descendant<ViewType: UIView>(_ type: ViewType.Type, in view: UIView) -> ViewType? {
        if let found = view as? ViewType { return found }
        for child in view.subviews {
            if let found = descendant(type, in: child) { return found }
        }
        return nil
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
                "icon": .object(["kind": .string("emoji"), "value": .string("📋")]),
            ]),
            .object([
                "id": .string("diagram"), "kind": .string("diagram"), "name": .string("Connection flow"),
            ]),
            .object(["id": .string("trailing"), "kind": .string("separator")]),
        ]
        return .object([
            "summary": .object([
                "projectId": .string("visual-project"), "name": .string("Ruimte"), "color": .string("#155dfc"),
                "folder": .null, "lastOpenedAt": .number(1), "closedAt": .null, "available": .bool(true),
                "icon": .object(["kind": .string("initial"), "value": .string("R")]), "nameSource": .string("chosen"),
            ]),
            "document": .object([
                "version": .number(2), "rev": .number(1), "name": .string("Ruimte"), "color": .string("#155dfc"),
                "views": .array(views),
            ]),
            "local": .object(["activeViewId": .string("overview"), "views": .object([:])]),
        ])
    }

    @MainActor private func containsList(_ view: UIView) -> Bool {
        view is UICollectionView || view is UITableView || view.subviews.contains(where: containsList)
    }

    @MainActor private func makeWindow(_ host: UIViewController, size: CGSize) -> UIWindow {
        let window: UIWindow
        if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
            window = UIWindow(windowScene: scene)
        } else {
            window = UIWindow(frame: CGRect(origin: .zero, size: size))
        }
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController = host
        window.windowLevel = .alert + 1
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        return window
    }

    @MainActor private func capture(_ window: UIWindow, name: String) {
        window.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor private func displayFrame() async {
        await withCheckedContinuation { continuation in
            _ = WorkspaceVisualFrame { continuation.resume() }
        }
    }
}

@MainActor private final class WorkspaceVisualWire {
    let snapshot: JSONValue
    private(set) var requests: [String] = []
    lazy var client = MachineClient(send: { [weak self] text in try self?.receive(text) }, connected: true)

    init(snapshot: JSONValue) throws {
        self.snapshot = try WireRequest.projectOpen.validateResult(snapshot)
    }

    private func receive(_ text: String) throws {
        let frame = try JSONValue.decode(Data(text.utf8))
        let type = frame.text("type")
        requests.append(type)
        let result: JSONValue
        switch type {
        case "project.open": result = snapshot
        case "project.release", "project.save-local": result = .object([:])
        default: throw MachineClientError.invalid("Unexpected visual-fixture request: \(type)")
        }
        let answer = JSONValue.object(["id": frame["id"]!, "ok": .bool(true), "result": result])
        client.receive(String(decoding: try answer.encoded(), as: UTF8.self))
    }
}

@MainActor private final class WorkspaceVisualFrame: NSObject {
    private var link: CADisplayLink?
    private var completion: (() -> Void)?

    init(completion: @escaping () -> Void) {
        self.completion = completion
        super.init()
        let link = CADisplayLink(target: self, selector: #selector(frame))
        self.link = link
        link.add(to: .main, forMode: .common)
    }
    @objc private func frame() {
        link?.invalidate()
        link = nil
        completion?()
        completion = nil
    }
}
