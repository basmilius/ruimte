import RuimteVoice
import SwiftUI

/// Both sides of the conversation as a band, the newest on the right: the person above the line, Voice below it.
struct VoiceBand: View {
    let levels: VoiceLevelHistory

    var body: some View {
        Canvas { context, size in
            let count = levels.person.count
            let gap: CGFloat = 3
            let width = max(1, (size.width - gap * CGFloat(count - 1)) / CGFloat(count))
            let middle = size.height / 2
            let reach = middle - 2
            for index in 0..<count {
                let x = CGFloat(index) * (width + gap)
                let person = max(1.5, levels.person[index] * reach)
                let voice = max(1.5, levels.voice[index] * reach)
                let above = CGRect(x: x, y: middle - 1 - person, width: width, height: person)
                let below = CGRect(x: x, y: middle + 1, width: width, height: voice)
                context.fill(Path(roundedRect: above, cornerRadius: width / 2), with: .color(MobileStyle.muted))
                context.fill(Path(roundedRect: below, cornerRadius: width / 2), with: .color(VoiceStyle.voice))
            }
        }
        .accessibilityHidden(true)
    }
}

/// The band at rest: short ticks that swell and settle slowly, while Voice is off or still connecting. With Reduce
/// Motion they stand still.
struct VoiceBreathing: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
            let seconds = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, size in
                let count = VoiceLevelHistory.kept
                let gap: CGFloat = 3
                let width = max(1, (size.width - gap * CGFloat(count - 1)) / CGFloat(count))
                let middle = size.height / 2
                let breath = 0.5 + 0.5 * sin(seconds * 2 * .pi / 4)
                for index in 0..<count {
                    let x = CGFloat(index) * (width + gap)
                    let wave = 0.5 + 0.5 * sin(seconds * 1.3 + Double(index) * 0.32)
                    let height = 2 + CGFloat(wave * breath) * min(5, middle - 1)
                    let tick = CGRect(x: x, y: middle - height, width: width, height: height * 2)
                    context.fill(
                        Path(roundedRect: tick, cornerRadius: width / 2), with: .color(VoiceStyle.voice.opacity(0.75)))
                }
            }
        }
        .accessibilityHidden(true)
    }
}
