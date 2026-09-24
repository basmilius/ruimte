import QuartzCore

/// A CSS timing function. `cubic` may leave 0...1 on the y axis, which is what makes a spring overshoot.
public enum Easing: Equatable, Sendable {
    case linear
    case cubic(CGFloat, CGFloat, CGFloat, CGFloat)
    /// `steps(n)`, jumping at the end of each step.
    case steps(Int)

    public static let ease = Easing.cubic(0.25, 0.1, 0.25, 1)
    public static let easeIn = Easing.cubic(0.42, 0, 1, 1)
    public static let easeOut = Easing.cubic(0, 0, 0.58, 1)
    public static let easeInOut = Easing.cubic(0.42, 0, 0.58, 1)

    public func progress(_ fraction: CGFloat) -> CGFloat {
        let x = min(max(fraction, 0), 1)
        switch self {
        case .linear:
            return x
        case .steps(let count):
            guard count > 0, x < 1 else {
                return x
            }
            return (x * CGFloat(count)).rounded(.down) / CGFloat(count)
        case let .cubic(x1, y1, x2, y2):
            return Self.bezier(x, x1, y1, x2, y2)
        }
    }

    /// Solves the curve's x for its parameter, then reads y there.
    private static func bezier(_ x: CGFloat, _ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) -> CGFloat {
        if x <= 0 || x >= 1 {
            return x
        }
        let curve = { (t: CGFloat, p1: CGFloat, p2: CGFloat) -> CGFloat in
            let inverse = 1 - t
            return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t
        }
        var low: CGFloat = 0
        var high: CGFloat = 1
        var t = x
        for _ in 0..<40 {
            let value = curve(t, x1, x2)
            if abs(value - x) < 1e-6 {
                break
            }
            if value < x {
                low = t
            } else {
                high = t
            }
            t = (low + high) / 2
        }
        return curve(t, y1, y2)
    }
}

/// One property of one layer over time. Every animation of the cursor is one of these, so the overlay plays it
/// and a snapshot reads the very same value at any moment.
public struct Track {
    public let keyPath: String
    public let duration: Double
    /// For a loop this shifts its phase, so a staggered loop is never caught outside its cycle.
    public var delay: Double = 0
    public var repeats = false
    /// Holds each value until the next, as `steps()` does.
    public var discrete = false
    let sample: (Double) -> Any

    public init(keyPath: String, duration: Double, delay: Double = 0, repeats: Bool = false, discrete: Bool = false, sample: @escaping (Double) -> Any) {
        self.keyPath = keyPath
        self.duration = max(duration, 0.001)
        self.delay = delay
        self.repeats = repeats
        self.discrete = discrete
        self.sample = sample
    }

    /// Time since the track started, in seconds.
    public func value(at time: Double) -> Any {
        if repeats {
            var local = (time - delay).truncatingRemainder(dividingBy: duration)
            if local < 0 {
                local += duration
            }
            return sample(local)
        }
        return sample(min(max(time - delay, 0), duration))
    }

    public var finalValue: Any {
        repeats ? value(at: delay) : sample(duration)
    }

    /// Scalar keyframes as CSS writes them: offsets 0...1, and the easing applies to every stretch between two.
    public static func keyframes(_ keyPath: String, duration: Double, _ frames: [(CGFloat, CGFloat)], easing: Easing = .ease, repeats: Bool = false, delay: Double = 0) -> Track {
        Track(keyPath: keyPath, duration: duration, delay: delay, repeats: repeats, discrete: { if case .steps = easing { return true }; return false }()) { time in
            NSNumber(value: Double(interpolate(frames, at: CGFloat(time / duration), easing: easing)))
        }
    }

    public static func transition(_ keyPath: String, from: CGFloat, to: CGFloat, duration: Double, easing: Easing, delay: Double = 0) -> Track {
        keyframes(keyPath, duration: duration, [(0, from), (1, to)], easing: easing, delay: delay)
    }

    static func interpolate(_ frames: [(CGFloat, CGFloat)], at offset: CGFloat, easing: Easing) -> CGFloat {
        guard let first = frames.first, let last = frames.last else {
            return 0
        }
        if offset <= first.0 {
            return first.1
        }
        if offset >= last.0 {
            return last.1
        }
        for index in 0..<(frames.count - 1) {
            let (startOffset, startValue) = frames[index]
            let (endOffset, endValue) = frames[index + 1]
            if offset >= startOffset && offset <= endOffset {
                let span = endOffset - startOffset
                let local = span > 0 ? (offset - startOffset) / span : 1
                return startValue + (endValue - startValue) * easing.progress(local)
            }
        }
        return last.1
    }

    static let framesPerSecond: Double = 60

    func animation() -> CAKeyframeAnimation {
        let span = repeats ? duration : delay + duration
        let count = max(2, Int((span * Self.framesPerSecond).rounded(.up)) + 1)
        let animation = CAKeyframeAnimation(keyPath: keyPath)
        animation.values = (0..<count).map { value(at: span * Double($0) / Double(count - 1)) }
        animation.keyTimes = (0..<count).map { NSNumber(value: Double($0) / Double(count - 1)) }
        animation.duration = span
        animation.calculationMode = discrete ? .discrete : .linear
        if repeats {
            animation.repeatCount = .infinity
        }
        return animation
    }
}

/// Where a track goes: onto the screen as an animation, or into a snapshot as its value at one moment.
@MainActor
public protocol MotionHost {
    /// False drops every loop and one-shot and makes every transition instant.
    var moves: Bool { get }
    func run(_ track: Track, on layer: CALayer)
    /// Fades a layer that leaves and takes it out.
    func retire(_ layer: CALayer, fade: Double)
}

public extension MotionHost {
    func run(_ tracks: [Track], on layer: CALayer) {
        for track in tracks {
            run(track, on: layer)
        }
    }

    /// A loop or a one-shot that only decorates: gone under Reduce Motion.
    func play(_ track: Track, on layer: CALayer) {
        if moves {
            run(track, on: layer)
        }
    }
}

@MainActor
public struct LiveMotion: MotionHost {
    public let moves: Bool

    public init(reduceMotion: Bool) {
        moves = !reduceMotion
    }

    public func run(_ track: Track, on layer: CALayer) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.setValue(track.finalValue, forKeyPath: track.keyPath)
        if moves {
            layer.add(track.animation(), forKey: track.keyPath)
        } else {
            layer.removeAnimation(forKey: track.keyPath)
        }
        CATransaction.commit()
    }

    public func retire(_ layer: CALayer, fade: Double) {
        guard moves, fade > 0 else {
            layer.removeFromSuperlayer()
            return
        }
        let from = layer.presentation()?.opacity ?? layer.opacity
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        CATransaction.setCompletionBlock {
            layer.removeFromSuperlayer()
        }
        layer.opacity = 0
        let animation = CABasicAnimation(keyPath: "opacity")
        animation.fromValue = from
        animation.toValue = 0
        animation.duration = fade
        layer.add(animation, forKey: "retire")
        CATransaction.commit()
    }
}

@MainActor
public struct FrozenMotion: MotionHost {
    public let time: Double
    public let moves: Bool

    public init(time: Double, reduceMotion: Bool = false) {
        self.time = time
        moves = !reduceMotion
    }

    public func run(_ track: Track, on layer: CALayer) {
        let value = moves ? track.value(at: time) : track.finalValue
        // A snapshot drops any transform that is not affine, and `transform.scale` scales z as well.
        if track.keyPath == "transform.scale" {
            layer.setValue(value, forKeyPath: "transform.scale.x")
            layer.setValue(value, forKeyPath: "transform.scale.y")
        } else {
            layer.setValue(value, forKeyPath: track.keyPath)
        }
    }

    public func retire(_ layer: CALayer, fade: Double) {
        layer.removeFromSuperlayer()
    }
}
