import Foundation

/// The heights of the band's columns, each from 0 to 1: the person's voice above the line and Voice's below it. A port
/// of the desktop's `VoiceWaveform.tsx` and `idle-waveform.ts` in `apps/client/src/voice`, kept to the same numbers so
/// both draw the same band.
public struct VoiceWaveformBands: Sendable, Equatable {
    /// `WAVEFORM_BAND_COUNT` in `apps/client/src/audio/waveform.ts`.
    public static let count = 40
    /// The time constant of the easing toward the target, in milliseconds.
    public static let responseMs = 110.0

    public var input: [Double]
    public var output: [Double]

    public init(input: [Double], output: [Double]) {
        self.input = input
        self.output = output
    }

    public static let silent = VoiceWaveformBands(
        input: Array(repeating: 0, count: count), output: Array(repeating: 0, count: count))

    /// Whether the person speaks, as the desktop's label reads the input bands.
    public static func inputSpeaks(_ bands: [Double]) -> Bool { (bands.max() ?? 0) > 0.06 }

    /// Whether Voice speaks, as the desktop's label reads the output bands.
    public static func outputSpeaks(_ bands: [Double]) -> Bool { (bands.max() ?? 0) > 0.04 }

    /// The share of the way a column moves toward its target in a frame that took `elapsedMs`.
    public static func response(elapsedMs: Double) -> Double {
        1 - exp(-elapsedMs / responseMs)
    }

    /// Moves each column a `response` share of the way from where it is drawn toward `target`.
    public func eased(toward target: VoiceWaveformBands, response: Double) -> VoiceWaveformBands {
        func ease(_ current: [Double], _ target: [Double]) -> [Double] {
            (0..<Self.count).map { index in
                let value = index < target.count ? target[index] : 0
                let from = index < current.count ? current[index] : value
                return from + (value - from) * response
            }
        }
        return VoiceWaveformBands(input: ease(input, target.input), output: ease(output, target.output))
    }

    /// The band at rest, `atMs` after it first showed: eight patterns of 8 seconds each, each blending into the next over
    /// its last 2.4 seconds.
    public static func idle(atMs: Double, count: Int = count) -> VoiceWaveformBands {
        let seconds = atMs / 1_000
        let cycle = seconds / IdlePattern.seconds
        let current = Int(cycle.rounded(.down)) % IdlePattern.count
        let elapsed = seconds.truncatingRemainder(dividingBy: IdlePattern.seconds)
        let start = IdlePattern.seconds - IdlePattern.transitionSeconds
        let transition = IdlePattern.smooth(max(0, min(1, (elapsed - start) / IdlePattern.transitionSeconds)))
        var input: [Double] = []
        var output: [Double] = []
        for index in 0..<count {
            let x = count <= 1 ? 0.5 : Double(index) / Double(count - 1)
            let from = IdlePattern.pattern(current, x: x, seconds: seconds)
            let to = IdlePattern.pattern((current + 1) % IdlePattern.count, x: x, seconds: seconds)
            input.append(IdlePattern.clamp(IdlePattern.amplify(IdlePattern.mix(from.0, to.0, transition))))
            output.append(IdlePattern.clamp(IdlePattern.amplify(IdlePattern.mix(from.1, to.1, transition))))
        }
        return VoiceWaveformBands(input: input, output: output)
    }
}

private enum IdlePattern {
    static let tau = Double.pi * 2
    static let seconds = 8.0
    static let transitionSeconds = 2.4
    static let count = 8

    static func clamp(_ value: Double) -> Double { max(0.04, min(0.7, value)) }
    static func amplify(_ value: Double) -> Double { 0.04 + (value - 0.04) * 1.5 }
    static func wave(_ turns: Double) -> Double { 0.5 + 0.5 * sin(turns * tau) }
    static func pulse(_ distance: Double, _ width: Double) -> Double { exp(-(distance * distance) / width) }
    static func loop(_ value: Double) -> Double {
        (value.truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1)
    }
    static func wrappedPulse(_ x: Double, _ center: Double, _ width: Double) -> Double {
        pulse(x - center, width) + pulse(x - center - 1, width) + pulse(x - center + 1, width)
    }
    static func smooth(_ value: Double) -> Double { value * value * (3 - 2 * value) }
    static func mix(_ from: Double, _ to: Double, _ amount: Double) -> Double { from + (to - from) * amount }

    static func pattern(_ index: Int, x: Double, seconds: Double) -> (Double, Double) {
        switch index {
        case 0:
            let envelope = 0.35 + 0.65 * pow(sin(.pi * x), 2)
            return (
                0.05 + 0.3 * envelope * wave(seconds * 0.14 + x * 0.18),
                0.05 + 0.24 * envelope * wave(seconds * 0.11 - x * 0.22 + 0.35)
            )
        case 1:
            return (
                0.05 + 0.32 * pow(wave(x * 1.25 - seconds * 0.22), 2),
                0.05 + 0.28 * pow(wave(x * 1.05 + seconds * 0.18 + 0.2), 3)
            )
        case 2:
            let inputCenter = 0.5 + 0.34 * sin(seconds * 0.7)
            let outputCenter = 0.5 + 0.34 * sin(seconds * 0.61 + .pi)
            return (0.05 + 0.34 * pulse(x - inputCenter, 0.025), 0.05 + 0.3 * pulse(x - outputCenter, 0.032))
        case 3:
            return (
                0.05 + 0.13 * wave(x * 2.1 + seconds * 0.17) + 0.15 * pow(wave(x * 0.7 - seconds * 0.13), 2),
                0.05 + 0.12 * wave(x * 1.7 - seconds * 0.14 + 0.4) + 0.14 * pow(wave(x * 0.55 + seconds * 0.16), 2)
            )
        case 4:
            let left = pulse(x - 0.2, 0.012)
            let center = pulse(x - 0.5, 0.016)
            let right = pulse(x - 0.8, 0.012)
            let input =
                left * wave(seconds * 0.18) + center * wave(seconds * 0.18 - 0.33) + right * wave(seconds * 0.18 - 0.66)
            let output =
                left * wave(seconds * 0.15 - 0.5) + center * wave(seconds * 0.15 - 0.16)
                + right * wave(seconds * 0.15 + 0.16)
            return (0.05 + 0.33 * input, 0.05 + 0.29 * output)
        case 5:
            let inputCenter = loop(seconds * 0.075)
            let outputCenter = loop(1 - seconds * 0.065)
            return (
                0.05 + 0.4 * wrappedPulse(x, inputCenter, 0.009) * (0.55 + 0.45 * wave(x * 2.4 - seconds * 0.11)),
                0.05 + 0.36 * wrappedPulse(x, outputCenter, 0.012) * (0.5 + 0.5 * wave(x * 2 + seconds * 0.1 + 0.3))
            )
        case 6:
            return (
                0.05 + 0.37 * pow(wave(seconds * 0.22 - x * 0.38), 7) * (0.45 + 0.55 * pow(sin(.pi * x), 2)),
                0.05 + 0.32 * pow(wave(seconds * 0.19 + x * 0.34 + 0.45), 6) * (0.5 + 0.5 * pow(sin(.pi * x), 2))
            )
        default:
            let inputEnvelope = 0.3 + 0.7 * wave(seconds * 0.055 + x * 0.2)
            let outputEnvelope = 0.3 + 0.7 * wave(seconds * 0.05 - x * 0.18 + 0.5)
            return (
                0.05 + inputEnvelope
                    * (0.11 * wave(x * 3.2 - seconds * 0.12) + 0.16 * pow(wave(x * 0.8 + seconds * 0.08), 2)),
                0.05 + outputEnvelope
                    * (0.1 * wave(x * 2.7 + seconds * 0.1 + 0.3) + 0.15 * pow(wave(x * 0.7 - seconds * 0.09), 2))
            )
        }
    }
}
