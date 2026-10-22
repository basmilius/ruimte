import ActivityKit
import AppIntents
import RuimtePulsar

/// What the buttons of Voice's Live Activity ask of the session. A `LiveActivityIntent` runs in the app's process,
/// which sets the handler; the widget extension compiles these too, for its buttons, and never runs them.
@MainActor enum VoiceLiveCommands {
    enum Command {
        case stop
        case toggleMute
    }

    static var handler: ((Command) -> Void)?

    static func perform(_ command: Command) async {
        if let handler {
            handler(command)
            return
        }
        // No session runs in this process, so the activity was left by one that ended with an earlier process.
        await endAll()
    }

    nonisolated static func endAll() async {
        for activity in Activity<VoiceLiveAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}

struct StopVoiceIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop Voice"
    static let isDiscoverable = false

    func perform() async throws -> some IntentResult {
        await VoiceLiveCommands.perform(.stop)
        return .result()
    }
}

struct ToggleVoiceMuteIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Mute or unmute the microphone"
    static let isDiscoverable = false

    func perform() async throws -> some IntentResult {
        await VoiceLiveCommands.perform(.toggleMute)
        return .result()
    }
}
