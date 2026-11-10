import SwiftUI

/// What the desktop hands its `Eclipse` (`apps/client/src/ui/Eclipse.tsx`, with its colors and keyframes in
/// `apps/client/src/styles.css`), in points for its pixels.
struct EclipseScene {
    enum Sky {
        case full
        /// A sky that runs out into the page under it, for a scene at the head of a page.
        case fade
    }

    struct Orbit {
        let size: CGFloat
        let alpha: Double
    }

    let sky: Sky
    /// Where the eclipse sits from the top of the scene.
    let center: CGFloat
    /// Nil for a scene as tall as the view.
    let height: CGFloat?
    let glows: (warm: CGFloat, white: CGFloat)
    let rings: (warm: CGFloat, cool: CGFloat)
    let orbits: [Orbit]
    let density: Double

    /// The onboarding's welcome (`OnboardingDialog.tsx`).
    static let welcome = EclipseScene(
        sky: .full, center: 202, height: nil, glows: (380, 200), rings: (150, 190),
        orbits: [
            Orbit(size: 300, alpha: 0.1),
            Orbit(size: 460, alpha: 0.07),
            Orbit(size: 680, alpha: 0.05),
        ],
        density: 0.9)

    /// The extra 68 points carry the sky behind the phone's navigation bar.
    static let about = EclipseScene(
        sky: .fade, center: 200, height: 468, glows: (360, 170), rings: (112, 144),
        orbits: [
            Orbit(size: 230, alpha: 0.1),
            Orbit(size: 350, alpha: 0.07),
            Orbit(size: 520, alpha: 0.05),
            Orbit(size: 720, alpha: 0.04),
            Orbit(size: 980, alpha: 0.03),
        ],
        density: 1)
}

/// The sky follows the icon's global anchor as its page scrolls, behind the page's content.
struct Eclipse: View {
    let scene: EclipseScene
    /// The global y of the eclipse; nil while what it centers on is not on screen.
    let anchor: CGFloat?
    var interaction: EclipseInteraction?
    /// The page a fading sky runs out into.
    var ground: Color = MobileStyle.canvas

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var start = Date()

    var body: some View {
        GeometryReader { proxy in
            if let anchor {
                let layout = EclipseLayout(
                    scene: scene, size: proxy.size, center: anchor - proxy.frame(in: .global).minY)
                let palette = colorScheme == .dark ? EclipsePalette.dark : EclipsePalette.light
                ZStack {
                    Canvas { context, _ in
                        layout.drawSky(in: &context, palette: palette, ground: ground)
                    }
                    TimelineView(
                        .animation(
                            minimumInterval: 1.0 / 30, paused: reduceMotion || !visible || scenePhase != .active)
                    ) { timeline in
                        let time = reduceMotion ? nil : timeline.date.timeIntervalSince(start)
                        let frame = proxy.frame(in: .global)
                        let bounds = layout.box.offsetBy(dx: frame.minX, dy: frame.minY)
                        let touch =
                            reduceMotion
                            ? EclipseInteraction.Frame()
                            : interaction?.frame(in: bounds, at: timeline.date) ?? EclipseInteraction.Frame()
                        ZStack {
                            EclipseStars(
                                size: layout.box.size,
                                center: CGPoint(x: layout.point.x, y: layout.point.y - layout.box.minY),
                                density: scene.density, time: time, dark: colorScheme == .dark, interaction: touch
                            )
                            .frame(width: layout.box.width, height: layout.box.height)
                            .position(x: layout.box.midX, y: layout.box.midY)
                            Canvas { context, _ in
                                layout.drawScene(in: &context, palette: palette, at: time)
                            }
                        }
                    }
                }
                .mask { layout.mask }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { visible = true }
        .onDisappear { visible = false }
    }
}

extension View {
    /// Reports where this view's middle sits on screen, for an `Eclipse` behind the page to center on.
    func eclipseAnchor(_ anchor: Binding<CGFloat?>) -> some View {
        onGeometryChange(for: CGFloat.self) { proxy in
            proxy.frame(in: .global).midY
        } action: { value in
            anchor.wrappedValue = value
        }
        .onDisappear { anchor.wrappedValue = nil }
    }
}

/// The desktop palette, with the sky mixed from the native panel surface and black.
private struct EclipsePalette {
    let core: Color
    let deep: Color
    let fadeCore: Color
    let fadeDeep: Color
    let glowWarm: Color
    let glowWhite: Color
    let ringWarm: Color
    let ringCool: Color
    let orbit: Color

    static let light = EclipsePalette(
        core: rgb(0xebebeb), deep: rgb(0xf0f0f0), fadeCore: rgb(0xebebeb), fadeDeep: rgb(0xf7f7f7),
        glowWarm: rgb(0xffb864, 0.22), glowWhite: rgb(0xffb050, 0.18), ringWarm: rgb(0xe88c1e, 0.95),
        ringCool: rgb(0x155dfc, 0.8), orbit: rgb(0x000000))

    static let dark = EclipsePalette(
        core: rgb(0x131316), deep: rgb(0x08080a), fadeCore: rgb(0x131316), fadeDeep: rgb(0x0b0b0d),
        glowWarm: rgb(0xffd696, 0.22), glowWhite: rgb(0xffffff, 0.18), ringWarm: rgb(0xffeccd, 0.95),
        ringCool: rgb(0x79b8ff, 0.8), orbit: rgb(0xffffff))

    private static func rgb(_ hex: UInt32, _ alpha: Double = 1) -> Color {
        Color(
            .sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255, opacity: alpha)
    }
}

/// The scene placed in a view: the eclipse at `point`, and the desktop's scene box around it, which a scene as tall as
/// the view fills and a scene of its own height hangs from the eclipse.
private struct EclipseLayout {
    let scene: EclipseScene
    let size: CGSize
    let point: CGPoint
    let box: CGRect

    init(scene: EclipseScene, size: CGSize, center: CGFloat) {
        self.scene = scene
        self.size = size
        point = CGPoint(x: size.width / 2, y: center)
        if let height = scene.height {
            box = CGRect(x: 0, y: center - scene.center, width: size.width, height: height)
        } else {
            box = CGRect(origin: .zero, size: size)
        }
    }

    /// A fading scene runs out from 52% of its box to its bottom; above that it stays whole.
    @ViewBuilder var mask: some View {
        if scene.sky == .fade, size.height > 0 {
            LinearGradient(
                colors: [.black, .black.opacity(0)],
                startPoint: UnitPoint(x: 0.5, y: (box.minY + box.height * 0.52) / size.height),
                endPoint: UnitPoint(x: 0.5, y: box.maxY / size.height))
        } else {
            Color.black
        }
    }

    func drawSky(in context: inout GraphicsContext, palette: EclipsePalette, ground: Color) {
        let bounds = CGRect(origin: .zero, size: size)
        switch scene.sky {
        case .full:
            fillEllipse(
                in: &context, bounds: bounds,
                center: CGPoint(x: box.midX, y: box.minY + box.height * 0.3),
                radii: CGSize(width: box.width * 0.7, height: box.height * 0.8),
                stops: [.init(color: palette.core, location: 0), .init(color: palette.deep, location: 0.72)])
        case .fade:
            fillEllipse(
                in: &context, bounds: bounds, center: CGPoint(x: box.midX, y: point.y),
                radii: CGSize(width: box.width * 0.7, height: box.height * 0.9),
                stops: [
                    .init(color: palette.fadeCore, location: 0), .init(color: palette.fadeDeep, location: 0.6),
                    .init(color: ground, location: 1),
                ])
        }
    }

    /// One frame at `time` seconds since the scene appeared, or the scene standing still for nil.
    func drawScene(in context: inout GraphicsContext, palette: EclipsePalette, at time: Double?) {
        drawGlow(scene.glows.warm, color: palette.glowWarm, period: 9, delay: 0, in: &context, at: time)
        drawGlow(scene.glows.white, color: palette.glowWhite, period: 7, delay: -3, in: &context, at: time)
        drawRing(scene.rings.warm, color: palette.ringWarm, from: 200, period: 70, in: &context, at: time)
        drawRing(scene.rings.cool, color: palette.ringCool, from: 20, period: -110, in: &context, at: time)
        for orbit in scene.orbits {
            drawOrbit(orbit, in: &context, palette: palette)
        }
    }

    private func drawGlow(
        _ diameter: CGFloat, color: Color, period: Double, delay: Double, in context: inout GraphicsContext,
        at time: Double?
    ) {
        let swing = time.map { EclipseMotion.swing($0, duration: period, delay: delay) }
        let opacity = swing.map { 0.7 + 0.3 * $0 } ?? 1
        let radius = diameter / 2 * (swing.map { 1 + 0.07 * $0 } ?? 1)
        context.fill(
            Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)),
            with: .radialGradient(
                Gradient(colors: [color.opacity(opacity), color.opacity(0)]), center: point, startRadius: 0,
                endRadius: radius))
    }

    /// An arc of light: a cone of color from `from` degrees (clockwise from the top, as CSS turns) over 150 degrees,
    /// on a 3-point ring whose inner point fades in.
    private func drawRing(
        _ diameter: CGFloat, color: Color, from: Double, period: Double, in context: inout GraphicsContext,
        at time: Double?
    ) {
        let turn = time.map { EclipseMotion.turn($0, period: period) } ?? 0
        let gradient = Gradient(stops: [
            .init(color: color.opacity(0), location: 0), .init(color: color, location: 70.0 / 360),
            .init(color: color.opacity(0), location: 150.0 / 360), .init(color: color.opacity(0), location: 1),
        ])
        let shading = GraphicsContext.Shading.conicGradient(
            gradient, center: point, angle: .degrees(from - 90 + turn))
        let outer = diameter / 2
        context.stroke(circle(radius: outer - 1), with: shading, lineWidth: 2)
        var inner = context
        inner.opacity = 0.5
        inner.stroke(circle(radius: outer - 2.5), with: shading, lineWidth: 1)
    }

    private func drawOrbit(_ orbit: EclipseScene.Orbit, in context: inout GraphicsContext, palette: EclipsePalette) {
        context.stroke(
            circle(radius: orbit.size / 2 - 0.5), with: .color(palette.orbit.opacity(orbit.alpha)), lineWidth: 1)
    }

    /// CSS's `radial-gradient(<rx> <ry> at <center>)`: a circle's gradient squeezed across into the ellipse.
    private func fillEllipse(
        in context: inout GraphicsContext, bounds: CGRect, center: CGPoint, radii: CGSize, stops: [Gradient.Stop]
    ) {
        guard radii.width > 0, radii.height > 0 else {
            return
        }
        let stretch = radii.width / radii.height
        var squeezed = context
        squeezed.translateBy(x: center.x, y: center.y)
        squeezed.scaleBy(x: stretch, y: 1)
        let area = CGRect(
            x: (bounds.minX - center.x) / stretch, y: bounds.minY - center.y, width: bounds.width / stretch,
            height: bounds.height)
        squeezed.fill(
            Path(area),
            with: .radialGradient(Gradient(stops: stops), center: .zero, startRadius: 0, endRadius: radii.height))
    }

    private func circle(radius: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
    }
}

/// The timing of the desktop's `eclipse-*` keyframes.
enum EclipseMotion {
    /// How far a keyframe that swings from its rest to its 50% frame and back is at `time`, from 0 to 1, eased per half
    /// with CSS's `ease-in-out`.
    static func swing(_ time: Double, duration: Double, delay: Double) -> Double {
        let elapsed = (time - delay).truncatingRemainder(dividingBy: duration)
        let progress = (elapsed < 0 ? elapsed + duration : elapsed) / duration
        let ease = SpinnerMotion.easeInOut
        return progress < 0.5 ? ease(progress * 2) : 1 - ease(progress * 2 - 1)
    }

    /// Degrees turned at `time` by a linear spin of `period` seconds a turn, the other way for a negative period.
    static func turn(_ time: Double, period: Double) -> Double {
        360 * time.truncatingRemainder(dividingBy: abs(period)) / period
    }
}
