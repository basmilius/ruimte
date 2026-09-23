import SwiftUI

/// The sky behind a usage widget, faint enough to stay behind the numbers. The plain widget has stars and an orbit;
/// Claude's is a warm sun over a constellation of its own marks, Codex's a terminal of ASCII stars with a shooting one.
/// Nothing solid sits in a corner, where the header and the cost are.
struct UsageBackdrop: View {
    let theme: UsageTheme

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        switch theme {
        case .plain: plain
        case .claude: claude
        case .codex: codex
        }
    }

    private var ink: Color { colorScheme == .dark ? .white : .black }

    private var plain: some View {
        ZStack {
            Rectangle().fill(.background)
            Canvas { context, size in
                for star in Self.stars {
                    let rect = CGRect(
                        x: star.x * size.width - star.radius, y: star.y * size.height - star.radius,
                        width: star.radius * 2, height: star.radius * 2)
                    context.fill(Path(ellipseIn: rect), with: .color(ink.opacity(star.opacity)))
                }
                let corner = CGPoint(x: size.width, y: 0)
                let radius = size.height * 0.95
                for (scale, opacity) in [(1.0, 0.09), (1.4, 0.045)] {
                    context.stroke(circle(at: corner, radius: radius * scale), with: .color(ink.opacity(opacity)))
                }
                let angle = 2.15
                let planet = CGPoint(x: corner.x + cos(angle) * radius, y: corner.y + sin(angle) * radius)
                glow(&context, at: planet, radius: 14, color: ink.opacity(0.1))
                context.fill(circle(at: planet, radius: 3), with: .color(ink.opacity(0.34)))
                context.fill(
                    sparkle(at: CGPoint(x: size.width * 0.86, y: size.height * 0.72), radius: 5),
                    with: .color(ink.opacity(0.22)))
            }
        }
    }

    /// Hand-placed, so the lines read as a constellation and not as a scribble.
    private static let constellation: [(x: Double, y: Double, size: Double)] = [
        (0.48, 0.34, 7), (0.6, 0.56, 5), (0.74, 0.5, 9), (0.86, 0.8, 6), (0.66, 0.84, 5),
    ]

    private var claude: some View {
        ZStack {
            Rectangle().fill(colorScheme == .dark ? UsageTheme.charcoal : UsageTheme.paper)
            Canvas { context, size in
                let sun = CGPoint(x: size.width + size.height * 0.1, y: -size.height * 0.1)
                glow(&context, at: sun, radius: size.height * 1.1, color: UsageTheme.terracotta.opacity(0.34))
                for (scale, opacity) in [(0.75, 0.16), (1.15, 0.08)] {
                    context.stroke(
                        circle(at: sun, radius: size.height * scale),
                        with: .color(UsageTheme.terracotta.opacity(opacity)), lineWidth: 1)
                }
                let points = Self.constellation.map {
                    CGPoint(x: $0.x * size.width, y: $0.y * size.height)
                }
                var lines = Path()
                lines.addLines(Array(points.prefix(4)))
                lines.move(to: points[2])
                lines.addLine(to: points[4])
                context.stroke(lines, with: .color(UsageTheme.terracotta.opacity(0.11)), lineWidth: 0.75)
                for (star, point) in zip(Self.constellation, points) {
                    mark(&context, "ClaudeMark", at: point, size: star.size, color: UsageTheme.terracotta.opacity(0.28))
                }
            }
        }
    }

    private var codex: some View {
        ZStack {
            Rectangle().fill(.background)
            Canvas { context, size in
                let cell = 14.0
                let columns = Int(size.width / cell)
                let rows = Int(size.height / cell)
                // One draw per cell from a hash of its place, so the sky stays put and never depends on the size.
                for row in 0..<rows {
                    for column in 0..<columns {
                        var hash = UInt64(row * 131 + column) &* 0x9e37_79b9_7f4a_7c15
                        hash ^= hash >> 29
                        guard hash % 100 < 9 else { continue }
                        let glyph = [".", "·", "+", "*"][Int((hash >> 8) % 4)]
                        let opacity = 0.09 + Double((hash >> 16) % 100) / 100 * 0.17
                        context.draw(
                            Text(glyph).font(.system(size: 10, design: .monospaced)).foregroundStyle(
                                ink.opacity(opacity)),
                            at: CGPoint(x: (Double(column) + 0.5) * cell, y: (Double(row) + 0.5) * cell))
                    }
                }
                // A shooting star in the same characters, brightening towards its head.
                let trail = [".", "·", "·", "+", "*"]
                for (index, glyph) in trail.enumerated() {
                    let step = Double(index) / Double(trail.count - 1)
                    context.draw(
                        Text(glyph).font(.system(size: 11, design: .monospaced)).foregroundStyle(
                            ink.opacity(0.06 + step * 0.26)),
                        at: CGPoint(x: size.width * (0.5 + step * 0.3), y: size.height * (0.2 + step * 0.22)))
                }
            }
        }
    }

    private struct Star {
        let x: Double
        let y: Double
        let radius: Double
        let opacity: Double
    }

    /// Fixed positions, so a widget does not rearrange its sky on every reload.
    private static let stars: [Star] = {
        var seed: UInt64 = 0x5275_696d_7465
        func next() -> Double {
            seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Double(seed >> 11) / Double(1 << 53)
        }
        return (0..<22).map { _ in
            Star(x: next(), y: next(), radius: 0.5 + next() * 0.8, opacity: 0.09 + next() * 0.22)
        }
    }()

    private func circle(at center: CGPoint, radius: Double) -> Path {
        Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
    }

    private func glow(_ context: inout GraphicsContext, at center: CGPoint, radius: Double, color: Color) {
        context.fill(
            circle(at: center, radius: radius),
            with: .radialGradient(
                Gradient(colors: [color, color.opacity(0)]), center: center, startRadius: 0, endRadius: radius))
    }

    private func mark(_ context: inout GraphicsContext, _ name: String, at center: CGPoint, size: Double, color: Color)
    {
        var image = context.resolve(Image(name).renderingMode(.template))
        image.shading = .color(color)
        context.draw(image, in: CGRect(x: center.x - size / 2, y: center.y - size / 2, width: size, height: size))
    }

    /// Four points drawn with curves through the center, the star the AI marks share.
    private func sparkle(at center: CGPoint, radius: Double) -> Path {
        var path = Path()
        let points = [(0.0, -radius), (radius, 0.0), (0.0, radius), (-radius, 0.0)]
        path.move(to: CGPoint(x: center.x + points[0].0, y: center.y + points[0].1))
        for index in 1...points.count {
            let point = points[index % points.count]
            path.addQuadCurve(to: CGPoint(x: center.x + point.0, y: center.y + point.1), control: center)
        }
        path.closeSubpath()
        return path
    }
}
