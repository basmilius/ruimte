import Foundation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// How Voice talks, stored on this phone and sent with every `voice.start`. The languages and voices are the ones the
/// request takes, read from the generated schema, so the picker never offers what the machine refuses.
struct VoicePreferences: Equatable {
    static let languageKey = "ruimte.voice.language"
    static let voiceKey = "ruimte.voice.voice"
    static let defaultVoice = "marin"

    var language: String
    var voice: String
    // No switch for asking before a deletion: Voice on a machine deletes nothing yet. When it does, the choice rides on
    // `voice.start` and the machine's policy holds it, not this phone.

    static var languages: [String] { options("language") }
    static var voices: [String] { options("voice") }

    private static func options(_ field: String) -> [String] {
        WireSchema.schema("request.voice.start.payload")?["properties"]?[field]?["enum"]?.arrayValue?
            .compactMap(\.stringValue) ?? []
    }

    /// The first language of the device Voice speaks, else English.
    static func defaultLanguage(preferred: [String] = Locale.preferredLanguages, offered: [String] = languages)
        -> String
    {
        for identifier in preferred {
            if let code = Locale(identifier: identifier).language.languageCode?.identifier, offered.contains(code) {
                return code
            }
        }
        return "en"
    }

    /// A language in its own words, as the desktop's picker shows it.
    static func languageName(_ id: String) -> String {
        let own = Locale(identifier: id)
        return own.localizedString(forLanguageCode: id).map { $0.capitalized(with: own) } ?? id
    }

    static func voiceName(_ id: String) -> String { id.capitalized }

    static func current(_ defaults: UserDefaults = .standard) -> VoicePreferences {
        let language = defaults.string(forKey: languageKey).flatMap { languages.contains($0) ? $0 : nil }
        let voice = defaults.string(forKey: voiceKey).flatMap { voices.contains($0) ? $0 : nil }
        return VoicePreferences(language: language ?? defaultLanguage(), voice: voice ?? defaultVoice)
    }
}

/// Voice in Settings: the language and the voice, and per machine whether it holds the OpenAI key, which a person sets
/// on the machine itself.
struct VoiceSettingsPage: View {
    let runtime: AppRuntime
    @AppStorage(VoicePreferences.languageKey) private var language = VoicePreferences.defaultLanguage()
    @AppStorage(VoicePreferences.voiceKey) private var voice = VoicePreferences.defaultVoice

    var body: some View {
        MobileForm {
            Section {
                Picker("Language", selection: $language) {
                    ForEach(VoicePreferences.languages, id: \.self) { id in
                        Text(VoicePreferences.languageName(id)).tag(id)
                    }
                }
                .pickerStyle(.navigationLink)
                .accessibilityIdentifier("settings.voice.language")
                Picker("Voice", selection: $voice) {
                    ForEach(VoicePreferences.voices, id: \.self) { id in
                        Text(VoicePreferences.voiceName(id)).tag(id)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("settings.voice.voice")
            } header: {
                Text("Conversation")
            } footer: {
                Text(
                    "Changes apply when you start the next conversation. Only an active conversation sends microphone audio to OpenAI."
                )
            }
            Section {
                ForEach(runtime.machines, id: \.id) { machine in
                    VoiceKeyRow(voice: runtime.voice, session: runtime.session(for: machine))
                }
            } header: {
                Text("OpenAI key")
            } footer: {
                Text(
                    "The key stays on the machine and never reaches this phone. Set it in Ruimte on that computer, under Settings, Voice, or there with ruimte voice key set."
                )
            }
        }
        .navigationTitle("Voice")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Whether one machine holds the key, read again whenever its link comes back.
private struct VoiceKeyRow: View {
    let voice: VoiceCoordinator
    let session: SharedMachineSession
    @State private var lease: MachineNavigationLease?

    var body: some View {
        LabeledContent(session.machine.name, value: state)
            .task {
                if lease == nil { lease = MachineNavigationLease(session) }
            }
            .task(id: session.generation) {
                guard session.connected else { return }
                await voice.refreshKey(machineID: session.machine.id, client: session.rpc)
            }
    }

    private var state: String {
        guard session.connected else { return String(localized: "Not connected") }
        guard session.rpc.answers(.voiceKeyStatus) else { return String(localized: "Voice is off") }
        switch voice.keys[session.machine.id] {
        case true?: return String(localized: "Set")
        case false?: return String(localized: "Not set")
        case nil: return String(localized: "Checking")
        }
    }
}
