import AppKit
import ComputerUseCore
import QuartzCore

/// AX and CGEvent use global points with the origin at the top-left of the primary screen; AppKit uses the bottom-left.
@MainActor
enum Geometry {
    static var primaryHeight: CGFloat {
        NSScreen.screens.first?.frame.height ?? 0
    }

    static func cocoa(fromGlobal point: CGPoint) -> CGPoint {
        CGPoint(x: point.x, y: primaryHeight - point.y)
    }

    static func global(fromCocoa point: CGPoint) -> CGPoint {
        CGPoint(x: point.x, y: primaryHeight - point.y)
    }

    static func screen(containingGlobal point: CGPoint) -> NSScreen? {
        let cocoaPoint = cocoa(fromGlobal: point)
        return NSScreen.screens.first { NSMouseInRect(cocoaPoint, $0.frame, false) } ?? NSScreen.main
    }
}

/// The visible part of the agent: a virtual pointer and a status pill in a click-through window above everything.
@MainActor
final class Overlay {
    private static let linger: Duration = .seconds(3)

    private(set) var isActive = false
    private var window: NSWindow?
    private var screen: NSScreen?
    private let configPath: String
    private var config = OverlayConfig()
    private var accent = OverlayStyle.cursor.accent
    private var cursor: CALayer
    private var pill: PillView
    private var cursorPoint: CGPoint?
    private var generation = 0
    private var lingerTask: Task<Void, Never>?

    init(configPath: String) {
        self.configPath = configPath
        cursor = CursorArtwork.makeLayer(style: OverlayStyle.cursor, accent: accent)
        pill = PillView(style: OverlayStyle.pill, text: config.pillText)
        cursor.isHidden = true
    }

    func begin(near globalPoint: CGPoint?) {
        lingerTask?.cancel()
        generation += 1
        let anchor = globalPoint ?? SyntheticInput.currentPointer()
        guard let target = Geometry.screen(containingGlobal: anchor) else {
            return
        }
        applyConfig(OverlayConfig.load(from: configPath))
        if window == nil {
            window = makeWindow()
        }
        if screen != target {
            place(on: target)
        }
        guard let window else {
            return
        }
        // Through the animator, so a fade-out still running from the previous sequence is replaced instead of finishing.
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.1
            window.animator().alphaValue = 1
        }
        window.orderFrontRegardless()
        isActive = true
    }

    /// Eases the virtual pointer from where it last stood to the target; the real pointer stays put.
    func glide(to globalPoint: CGPoint) async throws {
        guard let window, let screen else {
            return
        }
        let target = local(globalPoint, on: screen)
        let bounds = CGRect(origin: .zero, size: screen.frame.size)
        let pointer = local(SyntheticInput.currentPointer(), on: screen)
        let start = cursorPoint ?? (bounds.contains(pointer) ? pointer : CGPoint(x: target.x + 120, y: target.y - 90))
        let distance = hypot(target.x - start.x, target.y - start.y)
        let duration = min(0.7, max(0.25, Double(distance) / 1600))

        cursor.contentsScale = window.backingScaleFactor
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        cursor.isHidden = false
        cursor.position = target
        let animation = CABasicAnimation(keyPath: "position")
        animation.fromValue = NSValue(point: start)
        animation.toValue = NSValue(point: target)
        animation.duration = duration
        animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        cursor.add(animation, forKey: "glide")
        CATransaction.commit()
        cursorPoint = target
        try await Task.sleep(for: .milliseconds(Int(duration * 1000)))
    }

    func pulse() {
        guard let root = window?.contentView?.layer, let cursorPoint else {
            return
        }
        let ring = CAShapeLayer()
        ring.path = CGPath(ellipseIn: CGRect(x: -16, y: -16, width: 32, height: 32), transform: nil)
        ring.fillColor = nil
        ring.strokeColor = accent.cgColor
        ring.lineWidth = 2
        ring.position = cursorPoint
        ring.opacity = 0
        root.insertSublayer(ring, below: cursor)

        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 0.3
        scale.toValue = 1.4
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.9
        fade.toValue = 0
        let group = CAAnimationGroup()
        group.animations = [scale, fade]
        group.duration = 0.4
        group.timingFunction = CAMediaTimingFunction(name: .easeOut)
        ring.add(group, forKey: "pulse")
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            ring.removeFromSuperlayer()
        }
    }

    /// Keeps the overlay up for a moment after the last action so a sequence reads as one, then fades it.
    func linger() {
        lingerTask?.cancel()
        lingerTask = Task { [weak self] in
            try? await Task.sleep(for: Self.linger)
            guard !Task.isCancelled else {
                return
            }
            self?.fadeOut(duration: 0.4)
        }
    }

    func dismiss() {
        lingerTask?.cancel()
        fadeOut(duration: 0.15)
    }

    private func fadeOut(duration: Double) {
        guard let window else {
            return
        }
        isActive = false
        let fadingGeneration = generation
        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            window.animator().alphaValue = 0
        }
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(Int(duration * 1000) + 50))
            guard let self, self.generation == fadingGeneration else {
                return
            }
            self.window?.orderOut(nil)
        }
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.isReleasedWhenClosed = false
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.assistiveTechHighWindow)))
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.sharingType = .none
        let root = NSView()
        root.wantsLayer = true
        window.contentView = root
        root.addSubview(pill)
        root.layer?.addSublayer(cursor)
        return window
    }

    private func place(on screen: NSScreen) {
        guard let window else {
            return
        }
        self.screen = screen
        cursorPoint = nil
        cursor.isHidden = true
        window.setFrame(screen.frame, display: false)
        window.contentView?.frame = CGRect(origin: .zero, size: screen.frame.size)
        positionPill(on: screen)
    }

    private func positionPill(on screen: NSScreen) {
        let top = screen.visibleFrame.maxY - screen.frame.minY
        pill.frame.origin = CGPoint(x: floor((screen.frame.width - pill.frame.width) / 2), y: top - pill.frame.height - OverlayStyle.pill.topMargin)
    }

    /// Read at the start of every sequence, so a language switched in Ruimte reaches a helper that is already running.
    private func applyConfig(_ latest: OverlayConfig) {
        guard latest != config else {
            return
        }
        config = latest
        accent = latest.accentComponents.map { NSColor(srgbRed: $0.red, green: $0.green, blue: $0.blue, alpha: 1) } ?? OverlayStyle.cursor.accent

        let newPill = PillView(style: OverlayStyle.pill, text: latest.pillText)
        pill.removeFromSuperview()
        window?.contentView?.addSubview(newPill)
        pill = newPill

        let newCursor = CursorArtwork.makeLayer(style: OverlayStyle.cursor, accent: accent)
        newCursor.isHidden = true
        cursor.superlayer?.replaceSublayer(cursor, with: newCursor)
        cursor = newCursor
        cursorPoint = nil

        if let screen {
            positionPill(on: screen)
        }
    }

    private func local(_ globalPoint: CGPoint, on screen: NSScreen) -> CGPoint {
        let cocoaPoint = Geometry.cocoa(fromGlobal: globalPoint)
        return CGPoint(x: cocoaPoint.x - screen.frame.minX, y: cocoaPoint.y - screen.frame.minY)
    }
}
