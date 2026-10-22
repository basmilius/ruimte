import AppIntents
import LucideSwift
import RuimtePulsar
import SwiftUI

/// The lock screen card of Voice's Live Activity. The widget extension draws it; the app compiles it too, so a test can
/// render the very view the lock screen shows.
struct VoiceLiveCard: View {
    let content: VoiceLiveContent
    let machine: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                VoiceLiveGlyph(content: content, size: 18).frame(width: 36, height: 36)
                    .background(VoiceLiveColors.voice.opacity(0.16), in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text(VoiceLiveText.title(content)).font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white).lineLimit(1)
                    Text(VoiceLiveText.subtitle(content, machine: machine)).font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.55))
                        .lineLimit(content.problem == nil ? 1 : 2)
                        .truncationMode(content.problem == nil ? .middle : .tail)
                }
                Spacer(minLength: 4)
                VoiceLiveTimer(content: content).font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.8))
            }
            if content.phase != .ended {
                VoiceLiveButtons(content: content, height: 36)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Mute and Stop, which act on the session in the app without opening it.
struct VoiceLiveButtons: View {
    let content: VoiceLiveContent
    let height: CGFloat

    var body: some View {
        HStack(spacing: 8) {
            Button(intent: ToggleVoiceMuteIntent()) {
                Label {
                    content.muted ? Text("Unmute") : Text("Mute")
                } icon: {
                    LucideSwift.LucideIcon(content.muted ? .mic : .micOff, size: 15)
                }
                .frame(maxWidth: .infinity, minHeight: height)
                .background(.white.opacity(0.14), in: .capsule)
            }
            Button(intent: StopVoiceIntent()) {
                Label {
                    Text("Stop")
                } icon: {
                    LucideSwift.LucideIcon(.square, style: .filled, size: 13)
                }
                .frame(maxWidth: .infinity, minHeight: height)
                .background(VoiceLiveColors.stop, in: .capsule)
            }
            .disabled(content.phase == .stopping)
        }
        .buttonStyle(.plain)
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(.white)
    }
}

/// What Voice does now, as one icon: the line of its band while it talks or listens, the microphone crossed out while
/// the person muted it.
struct VoiceLiveGlyph: View {
    let content: VoiceLiveContent
    var size: CGFloat = 16

    var body: some View {
        LucideSwift.LucideIcon(icon, size: size).foregroundStyle(color)
            .accessibilityLabel(Text(VoiceLiveText.title(content)))
    }

    private var icon: LucideIconName {
        switch content.phase {
        case .connecting, .stopping: .loaderCircle
        case .ended: content.problem == nil ? .check : .triangleAlert
        case .listening, .speaking, .acting: content.muted ? .micOff : .audioLines
        }
    }

    private var color: Color {
        switch content.phase {
        case .ended: content.problem == nil ? .white.opacity(0.7) : VoiceLiveColors.stop
        case .connecting, .stopping: .white.opacity(0.7)
        case .listening, .speaking, .acting: content.muted ? .white : VoiceLiveColors.voice
        }
    }
}

/// How long the conversation runs, counted by the system so the activity needs no update for it.
struct VoiceLiveTimer: View {
    let content: VoiceLiveContent

    var body: some View {
        if let startedAt = content.startedAt, content.phase != .ended {
            Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
                .monospacedDigit().lineLimit(1).multilineTextAlignment(.trailing)
        }
    }
}

enum VoiceLiveText {
    static func title(_ content: VoiceLiveContent) -> String {
        if content.muted, [.listening, .speaking, .acting].contains(content.phase) {
            return String(localized: "Microphone muted")
        }
        return switch content.phase {
        case .connecting: String(localized: "Connecting to Voice")
        case .stopping: String(localized: "Stopping Voice")
        case .ended: content.problem == nil ? String(localized: "Voice ended") : String(localized: "Voice stopped")
        case .acting: content.action ?? String(localized: "Voice is working")
        case .speaking: String(localized: "Voice is speaking")
        case .listening: String(localized: "Voice is listening")
        }
    }

    /// Where Voice works, or why it stopped.
    static func subtitle(_ content: VoiceLiveContent, machine: String) -> String {
        if content.phase == .ended, let problem = content.problem { return problem }
        return [content.project ?? "", machine].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// A Live Activity draws on its own dark tint whatever the system appearance is, so these take the dark values.
enum VoiceLiveColors {
    static let tint = RuimteColors.activityTint.onDark
    static let voice = RuimteColors.statusRunning.onDark
    static let stop = RuimteColors.statusError.onDark
}
