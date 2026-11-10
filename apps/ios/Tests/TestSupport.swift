import RuimtePulsar
import RuimteTransport
import UIKit
import XCTest

/// The host app's scene, which every window a test puts up joins.
@MainActor var testScene: UIWindowScene {
    guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
        fatalError("This test requires an active window scene")
    }
    return scene
}

extension UIWindow {
    /// A key window above whatever the host app shows, laid out at `size`, or at the scene's size without one.
    static func showing(_ controller: UIViewController, size: CGSize? = nil) -> UIWindow {
        let window = UIWindow(windowScene: testScene)
        if let size { window.frame = CGRect(origin: .zero, size: size) }
        window.rootViewController = controller
        window.windowLevel = .alert + 1
        window.makeKeyAndVisible()
        controller.view.frame = window.bounds
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        return window
    }

    func close() {
        isHidden = true
        rootViewController = nil
    }

    /// What the window shows now, its pending updates drawn first.
    func snapshot() -> UIImage {
        layoutIfNeeded()
        return UIGraphicsImageRenderer(bounds: bounds).image { _ in
            drawHierarchy(in: bounds, afterScreenUpdates: true)
        }
    }
}

extension UIView {
    func descendant<T: UIView>(of type: T.Type) -> T? {
        if let match = self as? T { return match }
        return subviews.lazy.compactMap { $0.descendant(of: type) }.first
    }
}

extension XCTestCase {
    /// Keeps a screenshot of the window with the test's results, and hands it back for a look at its pixels.
    @MainActor @discardableResult func capture(_ window: UIWindow, name: String) -> UIImage {
        let image = window.snapshot()
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        return image
    }
}

/// Waits for the screen to draw `count` more frames, so what a layout pass or an animation set has reached the screen.
@MainActor func displayFrames(_ count: Int = 1) async {
    for _ in 0..<count {
        await withCheckedContinuation { continuation in
            DisplayFrame.wait { continuation.resume() }
        }
    }
}

@MainActor private final class DisplayFrame: NSObject {
    private var link: CADisplayLink?
    private var completion: (() -> Void)?

    /// The display link holds the waiter until it fires.
    static func wait(_ completion: @escaping () -> Void) {
        let frame = DisplayFrame()
        frame.completion = completion
        let link = CADisplayLink(target: frame, selector: #selector(fire))
        frame.link = link
        link.add(to: .main, forMode: .common)
    }

    @objc private func fire() {
        link?.invalidate()
        link = nil
        completion?()
        completion = nil
    }
}

/// A machine that answers from a table per request type and records what it was asked. A request type can be held
/// until the test releases it, and events and link changes reach whoever subscribed.
@MainActor final class ScriptedMachine: MachineRequesting {
    var answers: [WireRequest: (JSONValue) throws -> JSONValue] = [:]
    /// Request types the machine refuses, with the error code it refuses them with.
    var refusals: [WireRequest: String] = [:]
    private(set) var sent: [(type: WireRequest, payload: JSONValue)] = []
    private var held = Set<WireRequest>()
    private var pending: [WireRequest: CheckedContinuation<Void, Never>] = [:]
    private var arrivals: [WireRequest: NativeArrival] = [:]
    private var handlers: [WireEvent: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]
    private var connections: [UUID: @MainActor @Sendable (Bool) -> Void] = [:]
    private var connected = true

    init(_ answers: [WireRequest: (JSONValue) throws -> JSONValue] = [:]) {
        self.answers = answers
    }

    var requests: [WireRequest] { sent.map(\.type) }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        if held.contains(type) {
            await withCheckedContinuation {
                pending[type] = $0
                arrival(type).record()
            }
        } else {
            arrival(type).record()
        }
        if let code = refusals[type] { throw MachineClientError.server(code: code, message: code) }
        return try answers[type]?(payload) ?? .object([:])
    }

    func hold(_ type: WireRequest) { held.insert(type) }

    func release(_ type: WireRequest) {
        held.remove(type)
        pending.removeValue(forKey: type)?.resume()
    }

    func waitForRequest(_ type: WireRequest) async { await arrival(type).wait() }

    private func arrival(_ type: WireRequest) -> NativeArrival {
        if let arrival = arrivals[type] { return arrival }
        let arrival = NativeArrival()
        arrivals[type] = arrival
        return arrival
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        let id = UUID()
        handlers[event, default: [:]][id] = handler
        return { [weak self] in self?.handlers[event]?[id] = nil }
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        let id = UUID()
        connections[id] = handler
        handler(connected)
        return { [weak self] in self?.connections[id] = nil }
    }

    func emit(_ event: WireEvent, _ payload: JSONValue = .object([:])) {
        for handler in (handlers[event] ?? [:]).values { handler(payload) }
    }

    func setConnected(_ value: Bool) {
        connected = value
        for handler in connections.values { handler(value) }
    }
}
