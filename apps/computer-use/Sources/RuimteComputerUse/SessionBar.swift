import AppKit
import Phantom

/// The session bar in a panel of its own: unlike the cursor it takes clicks, and it never takes the focus.
@MainActor
final class SessionBar {
    /// Room around the bar for its shadow.
    private static let margin: CGFloat = 24

    private let panel: NSPanel
    private let view: BarView
    private var content: SessionBarLayer.Content?
    private var accent: CGColor?
    private var reduceMotion = false
    private weak var screen: NSScreen?

    init(onButton: @escaping (SessionBarLayer.Button) -> Void) {
        panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.assistiveTechHighWindow)))
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.sharingType = .none
        view = BarView(margin: Self.margin)
        panel.contentView = view
        view.onButton = onButton
        view.onHover = { [weak self] button in
            self?.hover(button)
        }
    }

    func show(on screen: NSScreen, _ content: SessionBarLayer.Content, accent: CGColor?, reduceMotion: Bool) {
        self.screen = screen
        update(content, accent: accent, reduceMotion: reduceMotion)
        if !panel.isVisible {
            panel.alphaValue = 0
            panel.orderFrontRegardless()
            NSAnimationContext.runAnimationGroup { context in
                context.duration = OverlayStyle.Motion.label.duration
                panel.animator().alphaValue = 1
            }
        }
    }

    func update(_ content: SessionBarLayer.Content, accent: CGColor?, reduceMotion: Bool) {
        var content = content
        content.hovered = view.hovered
        guard content != self.content || accent != self.accent || reduceMotion != self.reduceMotion else {
            return
        }
        self.content = content
        self.accent = accent
        self.reduceMotion = reduceMotion
        view.bar.update(content, accent: accent, motion: LiveMotion(reduceMotion: reduceMotion))
        layout()
    }

    func hide() {
        panel.orderOut(nil)
        content = nil
    }

    private func hover(_ button: SessionBarLayer.Button?) {
        guard var content else {
            return
        }
        content.hovered = button
        self.content = content
        view.bar.update(content, accent: accent, motion: LiveMotion(reduceMotion: reduceMotion))
    }

    private func layout() {
        guard let screen else {
            return
        }
        let size = view.bar.size
        let frame = CGRect(
            x: floor(screen.frame.midX - size.width / 2) - Self.margin,
            y: screen.visibleFrame.maxY - OverlayStyle.Bar.topMargin - size.height - Self.margin,
            width: size.width + 2 * Self.margin,
            height: size.height + 2 * Self.margin
        )
        if panel.frame != frame {
            panel.setFrame(frame, display: true)
        }
        view.bar.setContentsScale(panel.backingScaleFactor)
    }
}

private final class BarView: NSView {
    let bar = SessionBarLayer()
    var onButton: ((SessionBarLayer.Button) -> Void)?
    var onHover: ((SessionBarLayer.Button?) -> Void)?
    private(set) var hovered: SessionBarLayer.Button?
    private var pressed: SessionBarLayer.Button?
    private let margin: CGFloat

    init(margin: CGFloat) {
        self.margin = margin
        super.init(frame: .zero)
        wantsLayer = true
        layer?.addSublayer(bar.layer)
        bar.layer.position = CGPoint(x: margin, y: margin)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override var isFlipped: Bool {
        true
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas {
            removeTrackingArea(area)
        }
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }

    private func button(for event: NSEvent) -> SessionBarLayer.Button? {
        let point = convert(event.locationInWindow, from: nil)
        return bar.button(at: CGPoint(x: point.x - margin, y: point.y - margin))
    }

    override func mouseMoved(with event: NSEvent) {
        setHovered(button(for: event))
    }

    override func mouseExited(with event: NSEvent) {
        setHovered(nil)
    }

    override func mouseDown(with event: NSEvent) {
        pressed = button(for: event)
    }

    override func mouseUp(with event: NSEvent) {
        let released = button(for: event)
        if let released, released == pressed {
            onButton?(released)
        }
        pressed = nil
    }

    private func setHovered(_ button: SessionBarLayer.Button?) {
        guard button != hovered else {
            return
        }
        hovered = button
        onHover?(button)
    }
}
