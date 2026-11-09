import AppKit
import ComputerUseCore
import QuartzCore

/// Draws the overlay offscreen, for development: a state or a sheet of everything, at 1×, 2× or 3×.
/// Loops stand still at the moment asked for, so a render shows what the screen shows at that time.
@MainActor
public enum PhantomSnapshot {
    public struct Options {
        /// The ground behind the cursor, which looks the same on both.
        public var theme = PhantomTheme.light
        public var scale: CGFloat = 2
        /// Seconds since the state began; nil takes a moment that shows the state well.
        public var time: Double?
        public var working = WorkingStyle.dots
        public var scrollDirection = ScrollDirection.down
        public var reduceMotion = false

        public init() {}
    }

    static let tile = CGSize(width: 160, height: 120)

    static func defaultTime(_ state: PhantomState) -> Double {
        switch state {
        case .click, .tap:
            return 0.22
        case .type:
            return 1
        default:
            return 0.9
        }
    }

    public static func state(_ state: PhantomState, options: Options) -> CGImage? {
        render(size: tile, scale: options.scale) { stage in
            canvas(stage, size: tile, theme: options.theme)
            stage.addSublayer(cursor(state, at: hotspot(in: tile), options: options))
        }
    }

    /// A row of the forms large, then every state in the order of the design.
    public static func sheet(options: Options) -> CGImage? {
        let caption: CGFloat = 30
        let gap: CGFloat = 16
        let columns = 6
        let rows = (PhantomState.allCases.count + columns - 1) / columns
        let formsHeight: CGFloat = 150
        let width = CGFloat(columns) * tile.width + CGFloat(columns + 1) * gap
        let height = gap + formsHeight + gap + CGFloat(rows) * (tile.height + caption + gap)
        let ground = OverlayStyle.ground(options.theme)
        return render(size: CGSize(width: width, height: height), scale: options.scale) { stage in
            stage.backgroundColor = ground.wall

            let forms = PhantomForm.allCases
            let formWidth = (width - gap * CGFloat(forms.count + 1)) / CGFloat(forms.count)
            for (index, form) in forms.enumerated() {
                let frame = CGRect(x: gap + CGFloat(index) * (formWidth + gap), y: gap, width: formWidth, height: formsHeight)
                let plate = Layers.plain(frame)
                plate.backgroundColor = ground.surface
                plate.cornerRadius = 12
                plate.masksToBounds = true
                var large = options
                large.time = 0
                let pointed = form == .arrow || form == .dot
                let hotspot = pointed ? CGPoint(x: frame.width / 2 - 30, y: 30) : CGPoint(x: frame.width / 2, y: frame.height / 2)
                let cursor = cursor(state(wearing: form), at: hotspot, options: large, effects: false)
                cursor.transform = CATransform3DMakeScale(4, 4, 1)
                plate.addSublayer(cursor)
                stage.addSublayer(plate)
            }

            let top = gap + formsHeight + gap
            for (index, state) in PhantomState.allCases.enumerated() {
                let column = index % columns
                let row = index / columns
                let origin = CGPoint(x: gap + CGFloat(column) * (tile.width + gap), y: top + CGFloat(row) * (tile.height + caption + gap))
                let cell = Layers.plain(CGRect(origin: origin, size: tile))
                cell.masksToBounds = true
                cell.cornerRadius = 12
                canvas(cell, size: tile, theme: options.theme)
                cell.addSublayer(cursor(state, at: hotspot(in: tile), options: options))
                stage.addSublayer(cell)
                let name = Layers.text(state.rawValue, font: NSFont.systemFont(ofSize: 14, weight: .semibold), color: ground.text, origin: CGPoint(x: origin.x + 4, y: origin.y + tile.height + 5), lineHeight: 20)
                stage.addSublayer(name)
            }
        }
    }

    /// A state that wears the form, for the row of forms.
    static func state(wearing form: PhantomForm) -> PhantomState {
        PhantomState.allCases.first { PhantomLook.of($0).form == form } ?? .idle
    }

    /// Room on every side for the ring of a tap and for the signs beside the arrow.
    static func hotspot(in size: CGSize) -> CGPoint {
        CGPoint(x: size.width / 2 - 14, y: size.height / 2 - 12)
    }

    static func cursor(_ state: PhantomState, at hotspot: CGPoint, options: Options, effects: Bool = true) -> CALayer {
        let cursor = PhantomCursor()
        var scene = PhantomScene()
        scene.working = options.working
        scene.scrollDirection = options.scrollDirection
        scene.effects = effects
        cursor.show(state, scene: scene, motion: FrozenMotion(time: options.time ?? defaultTime(state), reduceMotion: options.reduceMotion), animated: false)
        cursor.layer.position = hotspot
        return cursor.layer
    }

    /// The dotted ground of the design's tiles.
    static func canvas(_ layer: CALayer, size: CGSize, theme: PhantomTheme) {
        let ground = OverlayStyle.ground(theme)
        layer.backgroundColor = ground.canvas
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
        dots.fillColor = ground.canvasDot
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
}
