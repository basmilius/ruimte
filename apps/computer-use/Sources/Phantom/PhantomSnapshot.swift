import AppKit
import ComputerUseCore
import QuartzCore
import UniformTypeIdentifiers

/// Draws the overlay offscreen, for development: a state, the session bar or a sheet of everything, at 1×, 2× or 3×.
/// Loops stand still at the moment asked for, so a render shows what the screen shows at that time.
@MainActor
public enum PhantomSnapshot {
    public struct Options {
        public var theme = PhantomTheme.light
        public var scale: CGFloat = 2
        /// Seconds since the state began; nil takes a moment that shows the state well.
        public var time: Double?
        public var label: String?
        public var dots = DotMotion.wave
        public var working = WorkingStyle.dots
        public var scrollDirection = ScrollDirection.down
        public var reduceMotion = false

        public init() {}
    }

    /// The words the sheet puts beside a state where the design shows an example.
    static func exampleLabel(_ state: PhantomState) -> String? {
        switch state {
        case .type:
            return "Q3 report final.pdf"
        case .drag:
            return "report.pdf"
        case .error:
            return "Could not find Send"
        default:
            return OverlayConfig().label(for: state)
        }
    }

    static func defaultTime(_ state: PhantomState) -> Double {
        switch state {
        case .click, .tap:
            return 0.22
        case .type:
            return 2
        case .look:
            return 0.7
        default:
            return 0.9
        }
    }

    public static func state(_ state: PhantomState, options: Options) -> CGImage? {
        let size = CGSize(width: 260, height: 190)
        let hotspot = CGPoint(x: state == .look ? 40 : state == .permission ? 16 : 70, y: state == .look ? 20 : state == .permission ? 30 : 60)
        return render(size: size, scale: options.scale) { stage in
            canvas(stage, size: size, theme: options.theme)
            stage.addSublayer(cursor(state, at: hotspot, options: options, room: CGRect(origin: .zero, size: size)))
        }
    }

    public static func bar(state: PhantomState, held: Bool, time: String, options: Options) -> CGImage? {
        let bar = SessionBarLayer()
        bar.update(SessionBarLayer.Content(title: OverlayConfig().title, state: state, held: held, time: time, theme: options.theme), accent: nil, motion: FrozenMotion(time: options.time ?? 0.9, reduceMotion: options.reduceMotion))
        let size = CGSize(width: bar.size.width + 48, height: bar.size.height + 48)
        return render(size: size, scale: options.scale) { stage in
            let palette = OverlayStyle.palette(options.theme)
            stage.backgroundColor = palette.wall
            bar.layer.position = CGPoint(x: 24, y: 20)
            stage.addSublayer(bar.layer)
        }
    }

    /// The cursor alone on a transparent ground, the size of the menu bar mark.
    public static func mark(_ state: PhantomState, theme: PhantomTheme, accent: CGColor?, scale: CGFloat) -> CGImage? {
        let style = OverlayStyle.MenuBar.self
        return render(size: style.mark, scale: scale) { stage in
            let cursor = PhantomCursor()
            var scene = PhantomScene()
            scene.theme = theme
            scene.accent = accent
            scene.effects = false
            cursor.show(PhantomLook.markState(state), scene: scene, motion: FrozenMotion(time: 0, reduceMotion: true), animated: false)
            cursor.layer.position = style.markHotspot
            cursor.layer.transform = CATransform3DMakeScale(style.markScale, style.markScale, 1)
            stage.addSublayer(cursor.layer)
        }
    }

    /// Every state in the order of the design, a row of the forms large, and the session bar in four moments.
    public static func sheet(options: Options) -> CGImage? {
        let tile = CGSize(width: 260, height: 190)
        let caption: CGFloat = 30
        let gap: CGFloat = 16
        let columns = 4
        let rows = (PhantomState.allCases.count + columns - 1) / columns
        let formsHeight: CGFloat = 150
        let barsHeight: CGFloat = 2 * (36 + 40)
        let width = CGFloat(columns) * tile.width + CGFloat(columns + 1) * gap
        let height = gap + formsHeight + gap + CGFloat(rows) * (tile.height + caption + gap) + barsHeight + gap
        let palette = OverlayStyle.palette(options.theme)
        return render(size: CGSize(width: width, height: height), scale: options.scale) { stage in
            stage.backgroundColor = palette.wall

            let forms: [(PhantomForm, PhantomState)] = [(.arrow, .idle), (.arrow, .takeover), (.dot, .waiting), (.dot, .think), (.small, .paused), (.finger, .tap)]
            let formWidth = (width - gap * CGFloat(forms.count + 1)) / CGFloat(forms.count)
            for (index, pair) in forms.enumerated() {
                let frame = CGRect(x: gap + CGFloat(index) * (formWidth + gap), y: gap, width: formWidth, height: formsHeight)
                let ground = Layers.plain(frame)
                ground.backgroundColor = palette.surface
                ground.cornerRadius = 12
                ground.masksToBounds = true
                var large = options
                large.time = 0
                let hotspot = pair.0 == .finger ? CGPoint(x: frame.width / 2, y: frame.height / 2) : CGPoint(x: frame.width / 2 - 30, y: 30)
                let cursor = cursor(pair.1, at: hotspot, options: large, room: nil, effects: false, labels: false)
                cursor.transform = CATransform3DMakeScale(4, 4, 1)
                ground.addSublayer(cursor)
                stage.addSublayer(ground)
            }

            let top = gap + formsHeight + gap
            for (index, state) in PhantomState.allCases.enumerated() {
                let column = index % columns
                let row = index / columns
                let origin = CGPoint(x: gap + CGFloat(column) * (tile.width + gap), y: top + CGFloat(row) * (tile.height + caption + gap))
                let ground = Layers.plain(CGRect(origin: origin, size: tile))
                ground.masksToBounds = true
                ground.cornerRadius = 12
                canvas(ground, size: tile, theme: options.theme)
                let hotspot = CGPoint(x: state == .look ? 40 : state == .permission ? 16 : 70, y: state == .look ? 20 : state == .permission ? 30 : 60)
                ground.addSublayer(cursor(state, at: hotspot, options: options, room: CGRect(origin: .zero, size: tile)))
                stage.addSublayer(ground)
                let name = Layers.text(state.rawValue, font: Layers.font(size: 14, weight: .semibold), color: palette.text, origin: CGPoint(x: origin.x + 4, y: origin.y + tile.height + 5), lineHeight: 20)
                stage.addSublayer(name)
            }

            var barTop = top + CGFloat(rows) * (tile.height + caption + gap)
            let moments: [(PhantomState, Bool, String)] = [(.idle, false, "02:14"), (.think, false, "02:31"), (.waiting, false, "03:02"), (.paused, true, "03:10")]
            var x = gap
            for (index, moment) in moments.enumerated() {
                let bar = SessionBarLayer()
                bar.update(
                    SessionBarLayer.Content(title: OverlayConfig().title, state: moment.0, held: moment.1, time: moment.2, theme: options.theme, hovered: index == 3 ? .pause : nil),
                    accent: nil,
                    motion: FrozenMotion(time: options.time ?? 0.9, reduceMotion: options.reduceMotion)
                )
                if x + bar.size.width > width - gap {
                    x = gap
                    barTop += 36 + 40
                }
                bar.layer.position = CGPoint(x: x, y: barTop + 20)
                stage.addSublayer(bar.layer)
                x += bar.size.width + gap * 2
            }
        }
    }

    static func cursor(_ state: PhantomState, at hotspot: CGPoint, options: Options, room: CGRect?, effects: Bool = true, labels: Bool = true) -> CALayer {
        let cursor = PhantomCursor()
        var scene = PhantomScene()
        scene.theme = options.theme
        scene.label = labels ? (options.label ?? exampleLabel(state)) : nil
        scene.dots = options.dots
        scene.working = options.working
        scene.scrollDirection = options.scrollDirection
        scene.effects = effects
        scene.room = room.map { $0.offsetBy(dx: -hotspot.x, dy: -hotspot.y) }
        cursor.show(state, scene: scene, motion: FrozenMotion(time: options.time ?? defaultTime(state), reduceMotion: options.reduceMotion), animated: false)
        cursor.layer.position = hotspot
        return cursor.layer
    }

    /// The dotted ground of the design's tiles.
    static func canvas(_ layer: CALayer, size: CGSize, theme: PhantomTheme) {
        let palette = OverlayStyle.palette(theme)
        layer.backgroundColor = palette.canvas
        let dots = CAShapeLayer()
        let path = CGMutablePath()
        var y: CGFloat = 8
        while y < size.height {
            var x: CGFloat = 8
            while x < size.width {
                path.addEllipse(in: CGRect(x: x - 1, y: y - 1, width: 2, height: 2))
                x += 16
            }
            y += 16
        }
        dots.path = path
        dots.fillColor = palette.canvasDot
        layer.addSublayer(dots)
    }

    /// Renders a y-down stage into a bitmap `scale` times its size in points.
    public static func render(size: CGSize, scale: CGFloat, build: (CALayer) -> Void) -> CGImage? {
        let pixelWidth = Int((size.width * scale).rounded(.up))
        let pixelHeight = Int((size.height * scale).rounded(.up))
        // The scale and the flip live in the tree and not in the context: Core Graphics draws shadows in device space.
        let root = CALayer()
        root.bounds = CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight)
        root.anchorPoint = .zero
        let stage = CALayer()
        stage.isGeometryFlipped = true
        stage.bounds = CGRect(origin: .zero, size: size)
        stage.anchorPoint = .zero
        stage.transform = CATransform3DMakeScale(scale, scale, 1)
        root.addSublayer(stage)
        build(stage)
        Layers.setScale(stage, scale)
        guard let context = CGContext(
            data: nil,
            width: pixelWidth,
            height: pixelHeight,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }
        root.render(in: context)
        return context.makeImage()
    }

    public static func writePNG(_ image: CGImage, to url: URL) throws {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw CocoaError(.fileWriteUnknown)
        }
    }
}
