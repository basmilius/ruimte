import Foundation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// How Voice talks on a machine, which keeps it for every client that starts Voice there. The languages and voices are
/// the ones the machine takes, read from the generated schema, so the picker never offers what the machine refuses.
struct VoicePreferences: Equatable {
    static let defaultVoice = "marin"

    var language: String
    var voice: String
    // No switch for asking before a deletion: Voice on a machine deletes nothing yet. When it does, the choice rides on
    // `voice.start` and the machine's policy holds it, not this phone.

    static var languages: [String] { options("language") }
    static var voices: [String] { options("voice") }

    private static func options(_ field: String) -> [String] {
        WireSchema.schema("request.voice.setPreferences.payload")?["properties"]?[field]?["enum"]?.arrayValue?
            .compactMap(\.stringValue) ?? []
    }

    /// The first language of the device Voice speaks, else English: what a machine that stores none starts with.
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
}

/// Voice in Settings, per machine: whether it holds the OpenAI key, which a person sets on the machine itself, and the
/// language and voice Voice speaks there, which the machine keeps.
struct VoiceSettingsPage: View {
    let runtime: AppRuntime

    var body: some View {
        MobileForm {
            ForEach(runtime.machines, id: \.id) { machine in
                Section {
                    VoiceMachineRows(voice: runtime.voice, session: runtime.session(for: machine))
                } header: {
                    Text(machine.name)
                } footer: {
                    if machine.id == runtime.machines.last?.id {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(
                                "Changes apply when you start the next conversation. Only an active conversation sends microphone audio to OpenAI."
                            )
                            Text(
                                "The key stays on the machine and never reaches this phone. Set it in Ruimte on that computer, under Settings, Voice, or there with ruimte voice key set."
                            )
                        }
                    }
                }
            }
        }
        .navigationTitle("Voice")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One machine's key, language and voice, read again whenever its link comes back.
private struct VoiceMachineRows: View {
    let voice: VoiceCoordinator
    let session: SharedMachineSession
    @State private var lease: MachineNavigationLease?

    var body: some View {
        LabeledContent("OpenAI key", value: keyState)
            .task {
                if lease == nil { lease = MachineNavigationLease(session) }
            }
            .task(id: session.generation) {
                guard session.connected else { return }
                await voice.refreshKey(machineID: session.machine.id, client: session.rpc)
                await voice.refreshPreferences(machineID: session.machine.id, client: session.rpc)
            }
        if session.connected && voice.keepsPreferences(client: session.rpc) {
            Picker("Language", selection: choice(\.language)) {
                ForEach(VoicePreferences.languages, id: \.self) { id in
                    Text(VoicePreferences.languageName(id)).tag(id)
                }
            }
            .pickerStyle(.navigationLink)
            .accessibilityIdentifier("settings.voice.language")
            Picker("Voice", selection: choice(\.voice)) {
                ForEach(VoicePreferences.voices, id: \.self) { id in
                    Text(VoicePreferences.voiceName(id)).tag(id)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("settings.voice.voice")
        }
    }

    /// One field of what the machine keeps; a pick stores both, so a machine that stored none keeps what it showed.
    private func choice(_ field: WritableKeyPath<VoicePreferences, String>) -> Binding<String> {
        let machineID = session.machine.id
        return Binding(
            get: { voice.preferences(machineID: machineID)[keyPath: field] },
            set: { value in
                var chosen = voice.preferences(machineID: machineID)
                chosen[keyPath: field] = value
                Task { await voice.setPreferences(chosen, machineID: machineID, client: session.rpc) }
            })
    }

    private var keyState: String {
        guard session.connected else { return String(localized: "Not connected") }
        guard session.rpc.answers(.voiceKeyStatus) else { return String(localized: "Voice is off") }
        switch voice.keys[session.machine.id] {
        case true?: return String(localized: "Set")
        case false?: return String(localized: "Not set")
        case nil: return String(localized: "Checking")
        }
    }
}
