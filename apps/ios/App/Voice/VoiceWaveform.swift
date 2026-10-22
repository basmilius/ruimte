import RuimteVoice
import SwiftUI

/// Both sides of the conversation as the desktop draws them (`apps/client/src/voice/VoiceWaveform.tsx`), to its
/// measures: a column per band over the full width, the person's voice growing up from the line and Voice's down from
/// it, each eased toward its target every frame. While Voice does not listen the band runs the idle patterns, and with
/// Reduce Motion it stands still.
struct VoiceWaveform: View {
    let listening: Bool
    /// The bands while Voice listens.
    let live: VoiceWaveformBands
    /// Whether each side speaks now, by `VoiceWaveformBands.inputSpeaks` and `outputSpeaks`.
    var inputSpeaks = false
    var outputSpeaks = false
    var muted = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var motion = VoiceWaveformMotion()

    var body: some View {
        VStack(spacing: 12) {
            labels
            TimelineView(.animation(paused: reduceMotion)) { timeline in
                let bands = displayed(at: timeline.date)
                Canvas { context, size in Self.draw(bands, in: &context, size: size) }
            }
            .frame(height: 56)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
    }

    private var labels: some View {
        let inputSpeaks = listening && !muted && self.inputSpeaks
        let outputSpeaks = listening && self.outputSpeaks
        return HStack {
            Text(personLabel(speaks: inputSpeaks))
                .foregroundStyle(muted ? MobileStyle.statusError : inputSpeaks ? MobileStyle.text : MobileStyle.muted)
            Spacer()
            Text(voiceLabel(speaks: outputSpeaks))
                .foregroundStyle(outputSpeaks ? VoiceStyle.voice : MobileStyle.muted)
        }
        .font(.caption.weight(.medium).monospacedDigit())
        .lineLimit(1)
    }

    private func personLabel(speaks: Bool) -> String {
        if listening && muted { return String(localized: "You · muted") }
        if !listening { return String(localized: "You · idle") }
        return speaks ? String(localized: "You · speaking") : String(localized: "You · listening")
    }

    private func voiceLabel(speaks: Bool) -> String {
        if !listening { return String(localized: "Voice · idle") }
        return speaks ? String(localized: "Voice · speaking") : String(localized: "Voice · listening")
    }

    private func displayed(at date: Date) -> VoiceWaveformBands {
        if reduceMotion {
            return listening ? live : .idle(atMs: 0)
        }
        return motion.step(toward: listening ? live : .idle(atMs: motion.idleMs(at: date)), at: date)
    }

    /// `waveformHeight`: at least 2 points, 26 at full level, from the middle of the 56 point field.
    static func height(_ value: Double) -> CGFloat {
        max(2, value * 26)
    }

    static func draw(_ bands: VoiceWaveformBands, in context: inout GraphicsContext, size: CGSize) {
        let count = bands.input.count
        guard count > 0 else { return }
        let gap: CGFloat = 2
        let width = (size.width - gap * CGFloat(count - 1)) / CGFloat(count)
        let middle = size.height / 2
        for index in 0..<count {
            let x = CGFloat(index) * (width + gap)
            let input = height(bands.input[index])
            let output = height(index < bands.output.count ? bands.output[index] : 0)
            let above = CGRect(x: x, y: middle - input, width: width, height: input)
            let below = CGRect(x: x, y: middle, width: width, height: output)
            context.fill(
                UnevenRoundedRectangle(
                    topLeadingRadius: radius(width: width, height: input),
                    topTrailingRadius: radius(width: width, height: input)
                ).path(in: above),
                with: .color(VoiceStyle.voice.opacity(0.6)))
            context.fill(
                UnevenRoundedRectangle(
                    bottomLeadingRadius: radius(width: width, height: output),
                    bottomTrailingRadius: radius(width: width, height: output)
                ).path(in: below),
                with: .color(VoiceStyle.voice))
        }
        context.fill(Path(CGRect(x: 0, y: middle, width: size.width, height: 1)), with: .color(MobileStyle.canvas))
    }

    /// `rounded-t-sm` and `rounded-b-sm`: 4 points, shrunk as CSS shrinks a radius that does not fit its bar.
    static func radius(width: CGFloat, height: CGFloat) -> CGFloat {
        4 * min(1, width / 8, height / 4)
    }
}

/// What the band drew last and when, so each frame eases on from there. Not observed: the timeline redraws it.
@MainActor final class VoiceWaveformMotion {
    private var origin: Date?
    private var previous: Date?
    private var shown = VoiceWaveformBands.idle(atMs: 0)

    /// How long the idle patterns have run, from the first frame the band drew.
    func idleMs(at date: Date) -> Double {
        let origin = origin ?? date
        self.origin = origin
        return max(0, date.timeIntervalSince(origin) * 1_000)
    }

    func step(toward target: VoiceWaveformBands, at date: Date) -> VoiceWaveformBands {
        let elapsed = previous.map { max(0, date.timeIntervalSince($0) * 1_000) } ?? 0
        previous = date
        shown = shown.eased(toward: target, response: VoiceWaveformBands.response(elapsedMs: elapsed))
        return shown
    }
}
