import LucideSwift
import RuimtePulsar
import RuimteVoice
import SwiftUI
import UIKit

/// The Voice sheet of a scene, the same on an iPhone and an iPad.
struct VoicePanel: View {
    let runtime: AppRuntime
    let scene: VoiceScene

    var body: some View {
        VoiceSheet(
            voice: runtime.voice, scene: scene.id, place: scene.place(runtime.voice)?.target,
            namesMachine: runtime.voiceMachines.count > 1,
            start: {
                guard let place = scene.place(runtime.voice) else { return }
                scene.start(runtime.voice, at: place)
            },
            close: { scene.showsPanel = false }
        )
        .modifier(VoiceSheetSurface())
    }
}

/// The sheet's ground is the canvas and its rows the panel, as in a form, so a row stands out in light and dark alike.
struct VoiceSheetSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .foregroundStyle(MobileStyle.text)
            .tint(MobileStyle.accent)
            .background(MobileStyle.canvas.ignoresSafeArea())
            .presentationBackground(MobileStyle.canvas)
            .presentationDragIndicator(.visible)
            .presentationSizing(.form)
    }
}

/// What the sheet shows: Voice's band, the timeline of the conversation, and Start or Mute and Stop. While no session
/// runs it explains Voice.
struct VoiceSheet: View {
    let voice: VoiceCoordinator
    let scene: String
    /// Where Start Voice goes; nil while no machine offers Voice.
    let place: VoiceTarget?
    /// Whether more than one machine offers Voice, so the sheet says which one a start goes to.
    var namesMachine = false
    let start: () -> Void
    let close: () -> Void

    private var running: Bool { voice.isOwner(scene) }
    private var elsewhere: Bool { voice.runsElsewhere(than: scene) }

    var body: some View {
        let items = elsewhere ? [] : voice.timeline(in: scene)
        VStack(spacing: 0) {
            header.padding(.horizontal, 20).padding(.top, 18)
            band.padding(.horizontal, 20).padding(.top, 14)
            Group {
                if !items.isEmpty {
                    VoiceTimelineList(items: items, voice: voice, problem: voice.problem(in: scene))
                } else {
                    middle.padding(.horizontal, 32).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxHeight: .infinity)
            footer.padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 12)
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Voice").font(.title2.weight(.semibold))
                if running, let target = voice.target {
                    HStack(spacing: 0) {
                        Text(VoiceText.place(target)).lineLimit(1).truncationMode(.middle)
                        if let startedAt = voice.startedAt {
                            Text(verbatim: " · ")
                            Text(timerInterval: startedAt...Date.distantFuture, countsDown: false).monospacedDigit()
                                .fixedSize()
                        }
                    }
                    .font(.subheadline).foregroundStyle(MobileStyle.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            Button(action: close) {
                Image(lucide: "x", size: 18).frame(width: 32, height: 32)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .accessibilityLabel("Close")
            .accessibilityIdentifier("voice.panel.close")
        }
    }

    // MARK: Band

    private var band: some View {
        let listening = running && voice.phase == .active
        let bands = voice.bands
        return VoiceWaveform(
            listening: listening, live: bands, inputSpeaks: VoiceWaveformBands.inputSpeaks(bands.input),
            outputSpeaks: VoiceWaveformBands.outputSpeaks(bands.output), muted: running && voice.muted
        )
        .task(id: listening) {
            guard listening else { return }
            while !Task.isCancelled {
                voice.measureBands()
                try? await Task.sleep(for: .milliseconds(32))
            }
        }
    }

    // MARK: Middle

    @ViewBuilder private var middle: some View {
        if elsewhere {
            VoiceHero(
                title: String(localized: "Voice runs in another window"),
                message: String(localized: "Stop it there to talk to Voice here."))
        } else if running {
            switch voice.phase {
            case .active:
                VoiceHero(title: String(localized: "Voice is listening"), message: VoiceText.explanation)
            default:
                VStack(spacing: 12) {
                    Spinner(size: 20)
                    Text(VoiceText.phase(voice.phase)).font(.callout).foregroundStyle(MobileStyle.muted)
                }
            }
        } else if let problem = voice.problem(in: scene) {
            VoiceHero(
                title: problem == .microphoneDenied
                    ? String(localized: "Ruimte may not use the microphone") : String(localized: "Voice stopped"),
                message: problem == .microphoneDenied
                    ? String(localized: "Turn on the microphone for Ruimte in Settings to talk to Voice.")
                    : VoiceText.problem(problem)
            ) {
                if problem == .microphoneDenied {
                    Button("Open Settings") { VoiceText.openSettings() }.font(.callout.weight(.semibold))
                }
            }
        } else if place == nil {
            VoiceHero(
                title: String(localized: "No machine offers Voice"),
                message: String(localized: "A machine offers Voice once it has an OpenAI key."))
        } else {
            VoiceHero(title: String(localized: "Talk to your workspace"), message: VoiceText.explanation)
        }
    }

    // MARK: Footer

    @ViewBuilder private var footer: some View {
        if running {
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    muteButton
                    stopButton
                }
                Text(VoiceText.route(voice.route, machine: voice.target?.machineName))
                    .font(.footnote).foregroundStyle(MobileStyle.muted).multilineTextAlignment(.center)
                    .lineLimit(2)
            }
        } else if !elsewhere, let place {
            VStack(spacing: 12) {
                Button(action: start) {
                    Label(String(localized: "Start Voice"), lucideIcon: "mic")
                }
                .buttonStyle(SolidCapsuleButtonStyle())
                .accessibilityIdentifier("voice.panel.start")
                if namesMachine, let machine = place.machineName, !machine.isEmpty {
                    Text("Voice starts on \(machine)")
                        .font(.footnote).foregroundStyle(MobileStyle.muted).lineLimit(1).truncationMode(.middle)
                }
            }
        }
    }

    private var muteButton: some View {
        let muted = voice.muted
        return Button {
            voice.setMuted(!muted, scene: scene)
        } label: {
            Image(lucide: muted ? "mic-off" : "mic", size: 22)
                .foregroundStyle(muted ? MobileStyle.canvas : MobileStyle.text)
                .frame(width: 56, height: 56)
                .background(muted ? MobileStyle.text : MobileStyle.panel, in: .circle)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .disabled(voice.phase == .stopping)
        .accessibilityLabel(muted ? Text("Unmute") : Text("Mute"))
        .accessibilityIdentifier("voice.panel.mute")
    }

    private var stopButton: some View {
        Button {
            voice.stop(scene: scene)
        } label: {
            Label {
                Text("Stop Voice")
            } icon: {
                LucideSwift.LucideIcon(.square, style: .filled, size: 14)
            }
            .font(.body.weight(.semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(MobileStyle.statusError, in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .disabled(voice.phase == .stopping)
        .accessibilityIdentifier("voice.panel.stop")
    }
}

/// A title and a sentence in the middle of the sheet, for every state without a timeline.
private struct VoiceHero<Actions: View>: View {
    let title: String
    let message: String
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(spacing: 10) {
            Text(title).font(.title2.weight(.semibold))
            Text(message).font(.body).foregroundStyle(MobileStyle.muted)
            actions.padding(.top, 6)
        }
        .multilineTextAlignment(.center)
    }
}

extension VoiceHero where Actions == EmptyView {
    init(title: String, message: String) {
        self.init(title: title, message: message) { EmptyView() }
    }
}

/// Voice's own color: its half of the band, its name in the timeline and an action that runs.
enum VoiceStyle {
    static let voice = MobileStyle.statusRunning
}

/// The sentences Voice shows in more than one place.
@MainActor enum VoiceText {
    static let explanation = String(
        localized:
            "Ask what runs in your projects and chats, have a chat pick up a task, start a new chat or move to another project."
    )

    static func phase(_ phase: VoiceCoordinator.Phase) -> String {
        switch phase {
        case .idle: String(localized: "Voice is off")
        case .connecting: String(localized: "Connecting to Voice")
        case .active: String(localized: "Listening")
        case .stopping: String(localized: "Stopping Voice")
        }
    }

    static func place(_ target: VoiceTarget) -> String {
        [target.projectName ?? "", target.machineName ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// Where the reply plays and where the audio goes.
    static func route(_ route: String?, machine: String?) -> String {
        let machine = machine.flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "your machine")
        guard let route, !route.isEmpty else { return String(localized: "Audio goes to OpenAI via \(machine)") }
        return String(localized: "\(route) · audio goes to OpenAI via \(machine)")
    }

    static func problem(_ problem: VoiceCoordinator.Problem) -> String {
        switch problem {
        case .microphoneDenied:
            String(localized: "Ruimte may not use the microphone. Turn it on in Settings to talk to Voice.")
        case .message(let message): message
        }
    }

    static func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}
