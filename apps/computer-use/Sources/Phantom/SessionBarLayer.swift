import AppKit
import ComputerUseCore
import QuartzCore

/// The quiet bar at the top of the screen: a mini cursor with the state, the title, the time, pause and stop.
/// It hangs in a geometry-flipped layer; its origin is the top-left corner of the bar.
@MainActor
public final class SessionBarLayer {
    public enum Button: Sendable {
        case pause
        case stop
    }

    public struct Content: Equatable {
        public var title: String
        public var state: PhantomState
        /// Paused or taken over: the clock stands still and the pause button plays.
        public var held: Bool
        public var time: String
        public var theme: PhantomTheme
        public var hovered: Button?

        public init(title: String, state: PhantomState, held: Bool, time: String, theme: PhantomTheme, hovered: Button? = nil) {
            self.title = title
            self.state = state
            self.held = held
            self.time = time
            self.theme = theme
            self.hovered = hovered
        }
    }

    public let layer = CALayer()
    public private(set) var size = CGSize.zero
    private var surface: CALayer?
    private let mark = PhantomCursor()
    private let markHolder = CALayer()
    private let title = CATextLayer()
    private let time = CATextLayer()
    private let pauseBackground = CALayer()
    private let stopBackground = CALayer()
    private let pauseIcon = CAShapeLayer()
    private let stopIcon = CAShapeLayer()
    private var content: Content?
    private var markState: PhantomState?
    private var markTheme: PhantomTheme?
    private var buttonFrames: [(Button, CGRect)] = []

    public init() {
        layer.anchorPoint = .zero
        markHolder.anchorPoint = .zero
        markHolder.addSublayer(mark.layer)
        for background in [pauseBackground, stopBackground] {
            background.cornerRadius = OverlayStyle.Bar.buttonRadius
        }
        pauseBackground.addSublayer(pauseIcon)
        stopBackground.addSublayer(stopIcon)
        for text in [title, time] {
            text.truncationMode = .none
            text.isWrapped = false
        }
    }

    /// Lays the bar out again; the mini cursor keeps its loop unless its state or theme changes.
    public func update(_ content: Content, accent: CGColor?, motion: MotionHost) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer {
            CATransaction.commit()
        }
        let style = OverlayStyle.Bar.self
        let palette = OverlayStyle.palette(content.theme)
        let font = Layers.font(size: style.fontSize)
        let timeFont = Layers.font(size: style.fontSize, monospacedDigits: true)
        let titleWidth = Layers.textWidth(content.title, font: font)
        let timeWidth = max(style.timeMinWidth, Layers.textWidth(content.time, font: timeFont))
        let buttonsWidth = style.button * 2 + style.buttonGap
        let width = style.leadingPadding + style.mark + style.gap + titleWidth + style.gap + timeWidth + style.gap + buttonsWidth + style.trailingPadding
        let newSize = CGSize(width: width, height: style.height)

        if newSize != size || content.theme != self.content?.theme {
            surface?.removeFromSuperlayer()
            let built = Layers.surface(size: newSize, radius: style.cornerRadius, fill: palette.raised, border: palette.border, shadow: palette.floatShadow)
            built.root.anchorPoint = .zero
            built.root.position = .zero
            layer.insertSublayer(built.root, at: 0)
            surface = built.root
            size = newSize
            layer.bounds = CGRect(origin: .zero, size: newSize)
        }
        for sublayer in [markHolder, title, time, pauseBackground, stopBackground] where sublayer.superlayer == nil {
            layer.addSublayer(sublayer)
        }

        var x = style.leadingPadding
        markHolder.frame = CGRect(x: x, y: (style.height - style.mark) / 2, width: style.mark, height: style.mark)
        mark.layer.position = style.markHotspot
        mark.layer.transform = CATransform3DMakeScale(style.markScale, style.markScale, 1)
        let shownMark = PhantomLook.markState(content.state)
        if shownMark != markState || content.theme != markTheme {
            var scene = PhantomScene()
            scene.theme = content.theme
            scene.accent = accent
            scene.effects = false
            mark.show(shownMark, scene: scene, motion: motion, animated: markState != nil)
            markState = shownMark
            markTheme = content.theme
        }
        x += style.mark + style.gap

        let lineY = (style.height - 20) / 2
        title.string = NSAttributedString(string: content.title, attributes: [.font: font, .foregroundColor: NSColor(cgColor: palette.text) ?? .labelColor])
        title.frame = Layers.text(content.title, font: font, color: palette.text, origin: CGPoint(x: x, y: lineY), lineHeight: 20).frame
        x += titleWidth + style.gap

        time.string = NSAttributedString(string: content.time, attributes: [.font: timeFont, .foregroundColor: NSColor(cgColor: palette.faint) ?? .tertiaryLabelColor])
        time.frame = Layers.text(content.time, font: timeFont, color: palette.faint, origin: CGPoint(x: x, y: lineY), lineHeight: 20, width: timeWidth).frame
        x += timeWidth + style.gap

        let buttonY = (style.height - style.button) / 2
        let pauseFrame = CGRect(x: x, y: buttonY, width: style.button, height: style.button)
        let stopFrame = CGRect(x: x + style.button + style.buttonGap, y: buttonY, width: style.button, height: style.button)
        buttonFrames = [(.pause, pauseFrame), (.stop, stopFrame)]
        let iconScale = style.icon / 24
        let iconInset = (style.button - style.icon) / 2
        let icons: [(CALayer, CAShapeLayer, CGRect, BarIcon, Button)] = [
            (pauseBackground, pauseIcon, pauseFrame, content.held ? .play : .pause, .pause),
            (stopBackground, stopIcon, stopFrame, .stop, .stop),
        ]
        for (background, icon, frame, kind, button) in icons {
            let hovered = content.hovered == button
            background.frame = frame
            background.backgroundColor = hovered ? palette.hover : nil
            var transform = CGAffineTransform(scaleX: iconScale, y: iconScale)
            icon.frame = CGRect(x: iconInset, y: iconInset, width: style.icon, height: style.icon)
            icon.path = kind.path.copy(using: &transform)
            icon.fillColor = hovered ? (button == .stop ? palette.error : palette.text) : palette.muted
        }
        self.content = content
    }

    /// Which button a point in the bar falls on, from its top-left corner.
    public func button(at point: CGPoint) -> Button? {
        buttonFrames.first { $0.1.contains(point) }?.0
    }

    public func setContentsScale(_ scale: CGFloat) {
        Layers.setScale(layer, scale)
    }
}
