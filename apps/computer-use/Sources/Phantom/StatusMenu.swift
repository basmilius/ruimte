import AppKit
import ComputerUseCore

/// The menu bar item while a session runs (1a of the session design): a template arrow and the time, or a pulsing
/// amber dot and what the agent waits for. Its menu holds a head with the title, the step and the time, then pause,
/// take over and stop. It is the only control of a session on the screen.
@MainActor
public final class StatusMenu: NSObject, NSMenuDelegate {
    public struct Content: Equatable {
        /// Names the app while the agent works in the background.
        public var title: String
        public var state: PhantomState
        public var mode: SessionMode
        public var time: String
        public var step: String
        /// False when another app holds the key, so the menu offers no shortcut for it.
        public var pauseKey: Bool
        public var stopKey: Bool

        public init(title: String, state: PhantomState, mode: SessionMode, time: String, step: String, pauseKey: Bool, stopKey: Bool) {
            self.title = title
            self.state = state
            self.mode = mode
            self.time = time
            self.step = step
            self.pauseKey = pauseKey
            self.stopKey = stopKey
        }
    }

    public var onTogglePause: (() -> Void)?
    public var onTakeOver: (() -> Void)?
    public var onStop: (() -> Void)?
    private var item: NSStatusItem?
    private var content: Content?
    private var config = OverlayConfig()
    private let head = MenuHeadView()
    private let dot = PulsingDot()

    override public init() {
        super.init()
    }

    public func show(_ content: Content, config: OverlayConfig) {
        self.config = config
        if item == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
            let menu = NSMenu()
            menu.delegate = self
            menu.autoenablesItems = false
            item.menu = menu
            item.button?.imagePosition = .imageLeading
            item.button?.addSubview(dot)
            self.item = item
        }
        update(content)
    }

    public func hide() {
        if let item {
            NSStatusBar.system.removeStatusItem(item)
        }
        dot.removeFromSuperview()
        item = nil
        content = nil
    }

    private func update(_ content: Content) {
        guard let button = item?.button, content != self.content else {
            return
        }
        self.content = content
        let needs = content.state.waitsOnPerson
        let font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
        if needs {
            let dark = button.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let text = "\(config.step(for: content.state, target: nil)) · \(content.time)"
            button.image = MenuBarLook.placeholder
            button.attributedTitle = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: MenuBarLook.needsText(dark: dark)])
        } else {
            button.image = MenuBarLook.arrow
            button.attributedTitle = NSAttributedString(string: content.time, attributes: [.font: font])
        }
        button.layoutSubtreeIfNeeded()
        dot.isHidden = !needs
        if needs, let cell = button.cell as? NSButtonCell {
            let rect = cell.imageRect(forBounds: button.bounds)
            let size = MenuBarLook.dot
            dot.frame = CGRect(x: rect.minX + MenuBarLook.dotLead, y: rect.midY - size / 2, width: size, height: size)
            dot.pulse(!NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
        }
        head.update(title: content.title, line: "\(content.step) · \(content.time)", state: content.state)
    }

    public func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        guard let content else {
            return
        }
        let headItem = NSMenuItem()
        headItem.view = head
        menu.addItem(headItem)

        let pause = NSMenuItem(title: content.mode == .running ? config.pause : config.resume, action: #selector(togglePause), keyEquivalent: content.pauseKey ? " " : "")
        pause.keyEquivalentModifierMask = .option
        pause.target = self
        menu.addItem(pause)
        let takeOver = NSMenuItem(title: config.takeOver, action: #selector(takeOver), keyEquivalent: "")
        takeOver.target = self
        takeOver.isEnabled = content.mode != .takenOver
        menu.addItem(takeOver)
        menu.addItem(.separator())

        let stop = NSMenuItem(title: config.stop, action: #selector(stop), keyEquivalent: content.stopKey ? "\u{1b}" : "")
        stop.keyEquivalentModifierMask = .option
        stop.attributedTitle = NSAttributedString(string: config.stop, attributes: [
            .foregroundColor: NSColor.systemRed,
            .font: NSFont.menuFont(ofSize: 0),
        ])
        stop.target = self
        menu.addItem(stop)
    }

    @objc private func togglePause() {
        onTogglePause?()
    }

    @objc private func takeOver() {
        onTakeOver?()
    }

    @objc private func stop() {
        onStop?()
    }
}

/// The sizes and images of the menu bar item and its head.
@MainActor
public enum MenuBarLook {
    public static let mark: CGFloat = 14
    public static let dot: CGFloat = 7
    public static let pulse: Double = 2.4
    public static let tile: CGFloat = 28
    public static let tileRadius: CGFloat = 8
    public static let tileMark: CGFloat = 16
    /// The button puts its image against the edge of its highlight; these keep the mark off the rounded end.
    static let markLead: CGFloat = 3
    static let markTrail: CGFloat = 1
    /// The dot sits in the rounded end and a little further from the words than the arrow.
    static let dotLead: CGFloat = 4
    static let dotTrail: CGFloat = 5

    /// The arrow as a template image, so it takes the color of the menu bar.
    public static let arrow: NSImage = {
        let image = form(.arrow, size: mark, color: .black, lead: markLead, trail: markTrail)
        image.isTemplate = true
        return image
    }()

    /// Holds the dot's place in the button; the dot itself is a view that pulses.
    static let placeholder = NSImage(size: NSSize(width: dotLead + dot + dotTrail, height: dot), flipped: false) { _ in true }

    /// A darker amber on a light menu bar, as the design has it, so the words stay legible.
    public static func needsText(dark: Bool) -> NSColor {
        NSColor(cgColor: dark ? OverlayStyle.color(.needs) : .hex(0xB45309)) ?? .systemOrange
    }

    /// A form of the cursor filled with one color, in a square of `size` points as its 24-point box, with room
    /// beside it.
    public static func form(_ form: PhantomForm, size: CGFloat, color: NSColor, lead: CGFloat = 0, trail: CGFloat = 0) -> NSImage {
        NSImage(size: NSSize(width: lead + size + trail, height: size), flipped: true) { _ in
            guard let context = NSGraphicsContext.current?.cgContext else {
                return false
            }
            context.translateBy(x: lead, y: 0)
            context.scaleBy(x: size / OverlayStyle.Cursor.box, y: size / OverlayStyle.Cursor.box)
            context.addPath(form.path)
            context.setFillColor(color.cgColor)
            context.fillPath()
            return true
        }
    }
}

/// The head of the menu, which nothing chooses: a graphite tile with the cursor in white, the title and the step with the time.
@MainActor
public final class MenuHeadView: NSView {
    private let tile = NSImageView()
    private let title = NSTextField(labelWithString: "")
    private let line = NSTextField(labelWithString: "")
    private static let padding = NSEdgeInsets(top: 8, left: 9, bottom: 10, right: 9)
    private static let gap: CGFloat = 10
    private static let minimumWidth: CGFloat = 260

    public init() {
        super.init(frame: .zero)
        let size = NSFont.menuFont(ofSize: 0).pointSize
        title.font = .systemFont(ofSize: size, weight: .semibold)
        line.font = .monospacedDigitSystemFont(ofSize: size, weight: .regular)
        line.textColor = .secondaryLabelColor
        tile.wantsLayer = true
        tile.layer?.backgroundColor = OverlayStyle.Ink.fill
        tile.layer?.cornerRadius = MenuBarLook.tileRadius
        tile.imageScaling = .scaleNone
        for view in [tile, title, line] {
            addSubview(view)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    public func update(title text: String, line lineText: String, state: PhantomState) {
        let form = PhantomLook.of(PhantomLook.markState(state)).form
        tile.image = MenuBarLook.form(form, size: MenuBarLook.tileMark, color: .white)
        title.stringValue = text
        line.stringValue = lineText
        layoutContent()
    }

    private func layoutContent() {
        let padding = Self.padding
        let tileSize = MenuBarLook.tile
        title.sizeToFit()
        line.sizeToFit()
        let textLeft = padding.left + tileSize + Self.gap
        let width = max(Self.minimumWidth, textLeft + max(title.frame.width, line.frame.width) + padding.right)
        let textHeight = title.frame.height + line.frame.height
        let height = padding.top + max(tileSize, textHeight) + padding.bottom
        setFrameSize(NSSize(width: width, height: height))
        // AppKit's y runs up: the first line sits at the top.
        let top = height - padding.top
        tile.frame = CGRect(x: padding.left, y: top - tileSize, width: tileSize, height: tileSize)
        title.frame.origin = CGPoint(x: textLeft, y: top - title.frame.height)
        line.frame.origin = CGPoint(x: textLeft, y: top - title.frame.height - line.frame.height)
    }
}

/// The amber dot that stands in for the arrow while the agent waits for the person.
@MainActor
final class PulsingDot: NSView {
    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = OverlayStyle.color(.needs)
        layer?.cornerRadius = MenuBarLook.dot / 2
        isHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    func pulse(_ moves: Bool) {
        guard let layer else {
            return
        }
        guard moves else {
            layer.removeAnimation(forKey: "pulse")
            return
        }
        guard layer.animation(forKey: "pulse") == nil else {
            return
        }
        let animation = CABasicAnimation(keyPath: "opacity")
        animation.fromValue = 1
        animation.toValue = 0.35
        animation.duration = MenuBarLook.pulse / 2
        animation.autoreverses = true
        animation.repeatCount = .infinity
        animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(animation, forKey: "pulse")
    }
}
