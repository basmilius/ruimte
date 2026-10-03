import Foundation

/// One star of the eclipse's sky, laid out by `apps/client/src/ui/eclipse-stars.ts`, so a seed gives the desktop's
/// stars.
struct EclipseStar: Equatable {
    enum Tone: Equatable {
        case white, cool, warm
    }

    /// Percent of the scene, from its left and its top edge.
    let left: Double
    let top: Double
    /// Whole points, 1 or 2.
    let size: CGFloat
    let tone: Tone
    let alpha: Double
    /// A glint flares up and glows; every other star only twinkles.
    let glint: Bool
    /// Seconds. The delay is negative, so every star is somewhere in its cycle from the first frame.
    let duration: Double
    let delay: Double

    /// The stars of one scene: mostly white, a few cool and warm, about one in five a glint.
    static func field(count: Int, seed: Int) -> [EclipseStar] {
        var random = EclipseRandom(seed: seed)
        return (0..<count).map { _ in
            let left = rounded(random.next() * 100, digits: 1)
            let top = rounded(random.next() * 100, digits: 1)
            let toneRoll = random.next()
            let glint = random.next() < 0.2
            let size: CGFloat = random.next() < 0.15 ? 2 : 1
            let alpha = rounded(0.18 + random.next() * 0.32, digits: 2)
            let duration = (glint ? 6 : 4) + (random.next() * 4).rounded(.down)
            let delay = -(random.next() * 9).rounded(.down)
            return EclipseStar(
                left: left, top: top, size: size,
                tone: toneRoll < 0.6 ? .white : toneRoll < 0.8 ? .cool : .warm,
                alpha: alpha, glint: glint, duration: duration, delay: delay)
        }
    }

    /// `Number.toFixed`, apart from a value exactly halfway, which `toFixed` rounds up and this to even.
    private static func rounded(_ value: Double, digits: Int) -> Double {
        Double(String(format: "%.\(digits)f", value)) ?? value
    }
}

/// Mulberry32, with the 32-bit wrapping arithmetic the desktop gets from `Math.imul` and `>>>`.
struct EclipseRandom {
    private var state: UInt32

    init(seed: Int) {
        state = UInt32(truncatingIfNeeded: seed)
    }

    mutating func next() -> Double {
        state = state &+ 0x6d2b_79f5
        var mixed = (state ^ (state >> 15)) &* (1 | state)
        mixed = (mixed &+ ((mixed ^ (mixed >> 7)) &* (61 | mixed))) ^ mixed
        return Double(mixed ^ (mixed >> 14)) / 4_294_967_296
    }
}
