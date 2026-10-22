import Foundation
import Synchronization

/// The newest samples of one side of the conversation, from -1 to 1, written on WebRTC's audio thread and taken on the
/// main actor. It holds only the last `size`, a few milliseconds of sound, and never more.
public final class VoiceSampleWindow: Sendable {
    /// The desktop analyser's `fftSize`, the samples one measure of the band reads.
    public static let size = 256

    private struct State {
        var ring = [Float](repeating: 0, count: VoiceSampleWindow.size)
        var next = 0
        var fresh = false
    }

    private let state = Mutex(State())

    public init() {}

    /// Keeps the last of `frames` samples, `sample` giving each by its index. Allocates nothing, so it can run on the
    /// audio thread.
    public func write(frames: Int, _ sample: (Int) -> Float) {
        state.withLock { state in
            for frame in max(0, frames - Self.size)..<frames {
                state.ring[state.next] = sample(frame)
                state.next = (state.next + 1) % Self.size
            }
            state.fresh = state.fresh || frames > 0
        }
    }

    /// The window, oldest first, or nil when no audio came since the last take.
    public func take() -> [Float]? {
        state.withLock { state in
            guard state.fresh else { return nil }
            state.fresh = false
            return Array(state.ring[state.next...] + state.ring[..<state.next])
        }
    }

    public func clear() {
        state.withLock { $0 = State() }
    }
}

/// The newest window of both sides; nil for a side that sent no audio since the last read.
public struct VoiceSamples: Sendable, Equatable {
    public var person: [Float]?
    public var voice: [Float]?

    public init(person: [Float]?, voice: [Float]?) {
        self.person = person
        self.voice = voice
    }

    public static let silent = VoiceSamples(person: nil, voice: nil)
}

/// One side's columns as the desktop's `WaveformMonitor` in `apps/client/src/audio/microphone.ts` measures them: the
/// bytes Chromium's analyser makes of the newest samples, `timeDomainBands` over them and `easeBands` from the last
/// measure, both in `apps/client/src/audio/waveform.ts`.
public struct VoiceWaveformMeter: Sendable, Equatable {
    public private(set) var bands = [Double](repeating: 0, count: VoiceWaveformBands.count)

    public init() {}

    /// Measures the newest window; a side without new audio measures as silence.
    public mutating func measure(_ window: [Float]?) {
        bands = Self.eased(bands, toward: Self.bands(of: window ?? []))
    }

    public mutating func clear() {
        self = VoiceWaveformMeter()
    }

    /// `timeDomainBands`: per column the root mean square of its slice, times 4 and at most 1.
    static func bands(of samples: [Float]) -> [Double] {
        let count = VoiceWaveformBands.count
        guard !samples.isEmpty else { return [Double](repeating: 0, count: count) }
        return (0..<count).map { index in
            let start = index * samples.count / count
            let end = max(start + 1, (index + 1) * samples.count / count)
            var squares = 0.0
            for sample in samples[start..<min(end, samples.count)] {
                let amplitude = (Double(byte(sample)) - 128) / 128
                squares += amplitude * amplitude
            }
            return min(1, (squares / Double(end - start)).squareRoot() * 4)
        }
    }

    /// Chromium's `RealtimeAnalyser::GetByteTimeDomainData`: scaled in float arithmetic, clamped and truncated.
    static func byte(_ sample: Float) -> UInt8 {
        let scaled: Float = 128 * (sample + 1)
        return UInt8(max(0, min(255, scaled)))
    }

    /// `easeBands`: a column rises 38% of the way and falls 16%, so a voice reads as a voice and not as a flicker.
    static func eased(_ previous: [Double], toward next: [Double]) -> [Double] {
        next.enumerated().map { index, level in
            let before = index < previous.count ? previous[index] : 0
            return before + (level - before) * (level > before ? 0.38 : 0.16)
        }
    }
}
