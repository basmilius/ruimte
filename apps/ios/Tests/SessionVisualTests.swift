import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit
import XCTest

@testable import Ruimte

final class SessionVisualTests: XCTestCase {
    @MainActor func testChatAtPhoneAndTabletWidths() async throws {
        let client = VisualSessionClient()
        let highlighted = await CodeHighlighter.shared.highlight(
            "let snapshot = try await client.request(\"session.attach\", payload: payload)", language: "swift",
            dark: false)
        XCTAssertNotNil(highlighted)
        XCTAssertGreaterThan(Set(highlighted?.runs.compactMap { $0.swiftUI.foregroundColor } ?? []).count, 1)
        for (name, size, dark, typeSize) in [
            ("chat-iphone", CGSize(width: 402, height: 874), false, DynamicTypeSize.large),
            ("chat-ipad", CGSize(width: 1024, height: 768), false, .large),
            ("chat-dark", CGSize(width: 402, height: 874), true, .large),
            ("chat-large-type", CGSize(width: 402, height: 874), false, .xxxLarge),
        ] {
            let host = UIHostingController(
                rootView: NavigationStack { ChatScreen(client: client, chatID: name, title: "Native iOS app") }
                    .tint(MobileStyle.accent).preferredColorScheme(dark ? .dark : .light).dynamicTypeSize(typeSize))
            let window = makeWindow(host, size: size)
            await client.waitFor("provider.list")
            // Capture after the highlighter's streaming coalescence window and native cell layout.
            for _ in 0..<20 { await displayFrame() }
            await displayFrame()
            capture(window, name: name)
            XCTAssertTrue(host.view.recursiveContains(identifier: "chat.timeline"))
            let timeline = try XCTUnwrap(host.view.descendant(of: ChatTimelineCollection.self))
            XCTAssertEqual(timeline.keyboardDismissMode, .interactive)
            XCTAssertGreaterThan(timeline.contentInset.bottom, 72)
            let timelineFrame = timeline.convert(timeline.bounds, to: window)
            XCTAssertGreaterThan(timelineFrame.maxY, window.bounds.maxY - 60)
            XCTAssertEqual(timeline.verticalScrollIndicatorInsets.bottom, timeline.contentInset.bottom)
            XCTAssertTrue(
                timeline.gestureRecognizers?.contains {
                    $0 is UITapGestureRecognizer && !$0.cancelsTouchesInView
                } == true)
            window.isHidden = true
            window.rootViewController = nil
        }
    }

    @MainActor func testLongHostedMessagePixelsMoveWithTheScrollOffset() async throws {
        let client = VisualSessionClient()
        client.chatSnapshot = .object([
            "info": .object(["provider": .string("codex")]),
            "items": .array([
                .object([
                    "id": .string("long"), "kind": .string("assistant"),
                    "text": .string(
                        (0..<45).map {
                            "Paragraph \($0): The visible message must move with its cell, including **bold text** and `inline code`."
                        }.joined(separator: "\n\n")),
                ]),
                .object(["id": .string("next"), "kind": .string("user"), "text": .string("The next message")]),
            ]),
        ])
        let controller = UIHostingController(
            rootView: NavigationStack {
                ChatScreen(client: client, chatID: "scroll-regression", title: "Scrolling")
            })
        let window = makeWindow(controller, size: CGSize(width: 402, height: 874))
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }
        await client.waitFor("provider.list")
        for _ in 0..<24 { await displayFrame() }
        let timeline = try XCTUnwrap(controller.view.descendant(of: ChatTimelineCollection.self))
        timeline.beginUserScroll()
        timeline.setContentOffset(CGPoint(x: 0, y: 120), animated: false)
        for _ in 0..<4 { await displayFrame() }
        let before = pixelRegion(window, rect: CGRect(x: 36, y: 240, width: 300, height: 300))
        capture(window, name: "chat-scroll-before")
        timeline.setContentOffset(CGPoint(x: 0, y: 200), animated: false)
        for _ in 0..<4 { await displayFrame() }
        let after = pixelRegion(window, rect: CGRect(x: 36, y: 160, width: 300, height: 300))
        capture(window, name: "chat-scroll-after")
        XCTAssertEqual(timeline.contentOffset.y, 200, accuracy: 1)
        XCTAssertEqual(before.count, after.count)
        let difference = zip(before, after).reduce(0.0) { $0 + abs(Double($1.0) - Double($1.1)) } / Double(before.count)
        XCTAssertLessThan(
            difference, 3,
            "A visible message must translate by the same 80 points as the collection, instead of staying pinned inside its cell"
        )
        XCTAssertGreaterThan(Set(before).count, 30, "Compare rendered text, not an empty background")
    }

    @MainActor private func pixelRegion(_ window: UIWindow, rect: CGRect) -> [UInt8] {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: rect.size, format: format).image { context in
            context.cgContext.translateBy(x: -rect.minX, y: -rect.minY)
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        guard let image = image.cgImage else { return [] }
        var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
        pixels.withUnsafeMutableBytes { storage in
            let context = CGContext(
                data: storage.baseAddress, width: image.width, height: image.height,
                bitsPerComponent: 8, bytesPerRow: image.width * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        return pixels
    }

    @MainActor func testHomeAtPhoneWidths() async throws {
        let client = AddressBookClient(fetch: { request in
            (
                Data(#"{"providers":["github","apple"]}"#.utf8),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            )
        })
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "ruimte.visual.home"))
        defer { defaults.removePersistentDomain(forName: "ruimte.visual.home") }
        let runtime = AppRuntime(client: client, defaults: defaults)
        await runtime.start()
        for (name, dark, signedIn, size, typeSize) in [
            ("welcome-iphone", false, false, CGSize(width: 402, height: 874), DynamicTypeSize.large),
            ("welcome-dark", true, false, CGSize(width: 402, height: 874), .large),
            ("welcome-ipad", false, false, CGSize(width: 1024, height: 768), .large),
            ("welcome-large-type", false, false, CGSize(width: 402, height: 874), .xxxLarge),
            ("projects-iphone", false, true, CGSize(width: 402, height: 874), .large),
            ("projects-dark", true, true, CGSize(width: 402, height: 874), .large),
            ("projects-ipad", false, true, CGSize(width: 1024, height: 768), .large),
            ("projects-large-type", false, true, CGSize(width: 402, height: 874), .xxxLarge),
        ] {
            runtime.account = signedIn ? Account(id: "visual", provider: .github, login: "basmilius") : nil
            runtime.machines =
                signedIn
                ? [
                    Machine(
                        id: "visual", name: "MacBook Pro", icon: nil, publicKey: DeviceKey().publicKey,
                        brokerUrl: nil, lastSeenAt: nil),
                    Machine(
                        id: "studio", name: "Mac Studio", icon: nil, publicKey: DeviceKey().publicKey,
                        brokerUrl: nil, lastSeenAt: nil),
                ] : []
            for machine in runtime.machines {
                let summaries: [JSONValue] =
                    machine.id == "visual"
                    ? [
                        visualProject("ruimte", name: "Ruimte", opened: 30),
                        visualProject("homey", name: "Homey dashboard", opened: 10),
                        visualProject("website", name: "Personal website", opened: 0, closed: 40),
                    ]
                    : [
                        visualProject("flux", name: "Flux", opened: 20),
                        visualProject("archive", name: "Design experiments", opened: 0, closed: 20, available: false),
                    ]
                defaults.set(try JSONValue.array(summaries).encoded(), forKey: "ruimte.ios.projects.\(machine.id)")
                defaults.set(machine.publicKey, forKey: "ruimte.ios.projects.\(machine.id).publicKey")
            }
            let model = UnifiedProjects(defaults: defaults)
            let host = UIHostingController(
                rootView: AppHome(runtime: runtime, projects: model).tint(MobileStyle.accent)
                    .preferredColorScheme(dark ? .dark : .light).dynamicTypeSize(typeSize))
            let window = makeWindow(host, size: size)
            for _ in 0..<20 { await displayFrame() }
            capture(window, name: name)
            if signedIn {
                XCTAssertEqual(model.open.map { $0.summary.text("name") }, ["Ruimte", "Flux", "Homey dashboard"])
                let recentHost = UIHostingController(
                    rootView: NavigationStack { RecentProjectsPage(runtime: runtime, projects: model) }
                        .tint(MobileStyle.accent)
                        .preferredColorScheme(dark ? .dark : .light).dynamicTypeSize(typeSize))
                window.rootViewController = recentHost
                recentHost.view.frame = window.bounds
                for _ in 0..<20 { await displayFrame() }
                capture(window, name: name.replacingOccurrences(of: "projects", with: "recent-projects"))
            }
            window.isHidden = true
            window.rootViewController = nil
            model.stop()
        }
        runtime.connections.shutdown()
    }

    @MainActor func testInitialProjectLoadingState() async {
        let client = AddressBookClient(fetch: { request in
            (
                Data(#"{"providers":["github","apple"]}"#.utf8),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            )
        })
        let runtime = AppRuntime(client: client)
        await runtime.start()
        runtime.account = Account(id: "loading-fixture", provider: .github, login: "basmilius")
        runtime.loading = true
        let host = UIHostingController(rootView: AppHome(runtime: runtime).tint(MobileStyle.accent))
        let window = makeWindow(host, size: CGSize(width: 402, height: 874))
        for _ in 0..<20 { await displayFrame() }
        capture(window, name: "projects-loading")
        runtime.loading = false
        window.isHidden = true
        window.rootViewController = nil
        runtime.connections.shutdown()
    }

    private func visualProject(
        _ id: String, name: String, opened: Double, closed: Double? = nil, available: Bool = true
    ) -> JSONValue {
        .object([
            "projectId": .string(id), "name": .string(name), "color": .string("#155dfc"), "folder": .null,
            "lastOpenedAt": .number(opened), "closedAt": closed.map(JSONValue.number) ?? .null,
            "available": .bool(available),
            "icon": .object(["kind": .string("initial"), "value": .string(String(name.prefix(1)))]),
            "nameSource": .string("chosen"),
        ])
    }

    @MainActor func testPairingAtPhoneWidth() async {
        let runtime = AppRuntime()
        let host = UIHostingController(rootView: PairMachinePage(runtime: runtime).tint(MobileStyle.accent))
        let window = makeWindow(host, size: CGSize(width: 402, height: 874))
        for _ in 0..<20 { await displayFrame() }
        capture(window, name: "pairing-iphone")
        window.isHidden = true
        window.rootViewController = nil
    }

    @MainActor func testTerminalSnapshotAtPhoneWidth() async throws {
        let client = VisualSessionClient()
        let host = UIHostingController(
            rootView: NavigationStack {
                TerminalScreen(client: client, sessionID: "terminal", title: "Project terminal")
            }.tint(MobileStyle.accent))
        let window = makeWindow(host, size: CGSize(width: 402, height: 874))
        await client.waitFor("session.list")
        await displayFrame()
        await displayFrame()
        capture(window, name: "terminal-iphone")
        XCTAssertTrue(host.view.recursiveContains(identifier: "terminal.screen"))
        window.isHidden = true
        window.rootViewController = nil
    }

    @MainActor func testCanvasOverviewAtTabletWidth() async {
        let controller = UIViewController()
        let canvas = CanvasScrollView()
        controller.view = canvas
        let window = makeWindow(controller, size: CGSize(width: 1024, height: 768))
        let nodes: [JSONValue] = [
            .object([
                "id": .string("chat"), "kind": .string("chat"), "title": .string("Native iOS app"), "x": .number(0),
                "y": .number(0), "w": .number(480), "h": .number(320),
            ]),
            .object([
                "id": .string("terminal"), "kind": .string("terminal"), "title": .string("Project checks"),
                "x": .number(560), "y": .number(0), "w": .number(480), "h": .number(320),
            ]),
            .object([
                "id": .string("note"), "kind": .string("note"), "title": .string("Device checklist"),
                "body": .string("Wi-Fi and 5G\nDirect connection first\nReconnect after background"), "x": .number(0),
                "y": .number(400), "w": .number(480), "h": .number(280),
            ]),
        ]
        let document: JSONValue = .object([
            "nodes": .array(nodes),
            "edges": .array([.object(["id": .string("link"), "from": .string("chat"), "to": .string("terminal")])]),
            "texts": .array([]),
        ])
        canvas.update(document, camera: nil, fit: 0)
        canvas.setAttention(
            statuses: ["chat": .running, "terminal": .needsYou], unseen: [], needingYou: ["terminal"])
        canvas.layoutIfNeeded()
        await displayFrame()
        capture(window, name: "canvas-ipad")
        XCTAssertGreaterThan(canvas.contentSize.width, 0)
        XCTAssertEqual(canvas.visibleNodeCount, 3)
        window.isHidden = true
        window.rootViewController = nil
    }

    @MainActor private func makeWindow(_ controller: UIViewController, size: CGSize) -> UIWindow {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
            fatalError("Visual tests require an active window scene")
        }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController = controller
        window.windowLevel = .alert + 1
        window.makeKeyAndVisible()
        controller.view.frame = window.bounds
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        return window
    }

    @MainActor private func capture(_ window: UIWindow, name: String) {
        window.layoutIfNeeded()
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
        let image = renderer.image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        if name.hasPrefix("welcome-") { assertLogoVisible(image, name: name) }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor private func assertLogoVisible(_ image: UIImage, name: String) {
        guard let source = image.cgImage else {
            XCTFail("Missing screenshot pixels: \(name)")
            return
        }
        var pixels = [UInt8](repeating: 0, count: source.width * source.height * 4)
        pixels.withUnsafeMutableBytes { storage in
            guard
                let context = CGContext(
                    data: storage.baseAddress, width: source.width, height: source.height,
                    bitsPerComponent: 8, bytesPerRow: source.width * 4,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                )
            else {
                XCTFail("Cannot read screenshot pixels: \(name)")
                return
            }
            context.draw(source, in: CGRect(x: 0, y: 0, width: source.width, height: source.height))
        }
        var navy = 0
        var silver = 0
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            let red = Int(pixels[offset])
            let green = Int(pixels[offset + 1])
            let blue = Int(pixels[offset + 2])
            if abs(red - 15) <= 4 && abs(green - 21) <= 4 && abs(blue - 41) <= 4 { navy += 1 }
            if abs(red - 214) <= 4 && abs(green - 217) <= 4 && abs(blue - 224) <= 4 { silver += 1 }
        }
        // Both original fills must survive initial rendering and the fixture's light/dark transitions.
        XCTAssertGreaterThan(navy, 200, "Missing navy logo shape: \(name)")
        XCTAssertGreaterThan(silver, 200, "Missing silver logo shape: \(name)")
    }

    @MainActor private func displayFrame() async {
        await withCheckedContinuation { continuation in _ = VisualFrameWaiter { continuation.resume() } }
    }
}

@MainActor private final class VisualFrameWaiter: NSObject {
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

extension UIView {
    fileprivate func descendant<T: UIView>(of type: T.Type) -> T? {
        if let match = self as? T { return match }
        return subviews.lazy.compactMap { $0.descendant(of: type) }.first
    }

    fileprivate func recursiveContains(identifier: String) -> Bool {
        accessibilityIdentifier == identifier || subviews.contains { $0.recursiveContains(identifier: identifier) }
    }
}

@MainActor private final class VisualSessionClient: MachineRequesting {
    var chatSnapshot: JSONValue?
    private var counts: [String: Int] = [:]
    private var waits: [String: CheckedContinuation<Void, Never>] = [:]
    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        counts[type, default: 0] += 1
        defer { waits.removeValue(forKey: type)?.resume() }
        switch type {
        case "chat.attach": return try chatSnapshot ?? JSONValue.decode(Data(Self.chat.utf8))
        case "provider.list": return .object(["providers": .array([])])
        case "session.attach":
            return .object([
                "screen": .string(
                    "\u{1b}[2J\u{1b}[H\u{1b}[32mbas@studio\u{1b}[0m ~/Development/ruimte\r\n$ bun run check\r\n\r\n\u{1b}[32m✓\u{1b}[0m TypeScript workspaces\r\n\u{1b}[32m✓\u{1b}[0m Contract generation\r\n\u{1b}[32m✓\u{1b}[0m Lint\r\n\r\n$ "
                ), "cols": .number(80), "rows": .number(24), "exited": .bool(false),
            ])
        case "session.list": return .object(["sessions": .array([])])
        default: return .object([:])
        }
    }
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
    func waitFor(_ type: String) async {
        if counts[type, default: 0] > 0 {
            counts[type] = 0
            return
        }
        await withCheckedContinuation { waits[type] = $0 }
        counts[type] = 0
    }
    private static let chat = #"""
        {"info":{"chatId":"visual","provider":"codex","cwd":"/project","agentSessionId":null,"model":"gpt-6","selection":{"model":"gpt-6","options":{}},"runtimeMode":"supervised","status":"needs-you","running":true,"activeTurnId":"turn","slashCommands":[],"usage":{"contextTokens":4096,"contextWindow":128000,"costUsd":0,"turns":1},"createdAt":0},"items":[{"id":"user","kind":"user","text":"Build the native app and preserve the desktop terminal size.","createdAt":0,"turnId":"turn"},{"id":"tool","kind":"tool","name":"Read project contracts","toolUseId":"tool-call","parentToolUseId":null,"input":{"path":"packages/contracts"},"output":"Contract schemas loaded.","state":"done","createdAt":1,"turnId":"turn"},{"id":"reply","kind":"assistant","text":"## Ready for review\n\nThe terminal follows the existing screen. Direct connections use TURN only when needed.\n\n```swift\nlet snapshot = try await client.request(\"session.attach\", payload: payload)\n```\n\n| Surface | State |\n| --- | --- |\n| Chat | Streaming |\n| Terminal | Following |","streaming":false,"createdAt":2,"turnId":"turn"},{"id":"approval","kind":"approval","requestId":"approval","toolUseId":null,"toolName":"Run checks","input":{"command":"bun run check"},"description":"Run the project's validation checks.","canAllowAlways":false,"decision":"pending","createdAt":3,"turnId":"turn"}]}
        """#
}
