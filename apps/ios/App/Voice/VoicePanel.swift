import LucideSwift
import RuimtePulsar
import RuimteVoice
import SwiftUI
import UIKit

/// The Voice sheet of a scene, the same on an iPhone and an iPad: the sheet itself, and the project picker it pushes
/// for the place to talk about.
struct VoicePanel: View {
    let runtime: AppRuntime
    let now: NowModel
    let scene: VoiceScene
    @State private var picking = false

    var body: some View {
        NavigationStack {
            VoiceSheet(
                voice: runtime.voice, scene: scene.id, place: scene.place(runtime.voice)?.target,
                start: {
                    guard let place = scene.place(runtime.voice) else { return }
                    scene.start(runtime.voice, at: place)
                },
                pickPlace: { picking = true }, close: { scene.showsPanel = false }
            )
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(isPresented: $picking) {
                VoiceProjectPicker(runtime: runtime, now: now) { place in
                    scene.picked = place
                    picking = false
                }
            }
        }
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
            .containerBackground(MobileStyle.canvas, for: .navigation)
            .presentationBackground(MobileStyle.canvas)
            .presentationDragIndicator(.visible)
            .presentationSizing(.form)
    }
}

/// What the sheet shows: Voice's band, the timeline of the conversation, and Start or Mute and Stop. While no session
/// runs it explains Voice and names the place a start talks about.
struct VoiceSheet: View {
    let voice: VoiceCoordinator
    let scene: String
    /// Where Start Voice goes; nil while no machine offers Voice.
    let place: VoiceTarget?
    let start: () -> Void
    let pickPlace: () -> Void
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

    @ViewBuilder private var band: some View {
        if running {
            VStack(spacing: 10) {
                HStack {
                    Text(voice.muted ? VoiceText.mutedLabel : String(localized: "You"))
                        .foregroundStyle(voice.muted ? MobileStyle.statusError : MobileStyle.muted)
                    Spacer()
                    Text(VoiceText.bandState(voice)).foregroundStyle(VoiceStyle.voice)
                }
                .font(.caption.weight(.semibold)).textCase(.uppercase).kerning(0.6)
                .accessibilityElement(children: .combine)
                if voice.phase == .active {
                    VoiceBand(levels: voice.levels).frame(height: 56)
                } else {
                    VoiceBreathing().frame(height: 56)
                }
            }
            .task(id: voice.phase == .active) {
                guard voice.phase == .active else { return }
                while !Task.isCancelled {
                    await voice.sampleLevels()
                    try? await Task.sleep(for: .milliseconds(80))
                }
            }
        } else {
            VoiceBreathing().frame(height: 24)
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
                Button(action: pickPlace) { VoicePlaceRow(place: place) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("voice.panel.place")
                Button(action: start) {
                    Label(String(localized: "Start Voice"), lucideIcon: "mic")
                }
                .buttonStyle(SolidCapsuleButtonStyle())
                .accessibilityIdentifier("voice.panel.start")
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

/// The place a start talks about, which opens the picker.
private struct VoicePlaceRow: View {
    let place: VoiceTarget

    var body: some View {
        HStack(spacing: 12) {
            Image(lucide: "folder", size: 20).foregroundStyle(MobileStyle.muted)
            VStack(alignment: .leading, spacing: 2) {
                Text("Talk about").font(.footnote).foregroundStyle(MobileStyle.muted)
                Text(line).font(.body).lineLimit(1).truncationMode(.middle)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(lucide: "chevrons-up-down", size: 16).foregroundStyle(MobileStyle.muted)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 16))
        .contentShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Choose another project")
    }

    /// The project in the text color and its machine muted beside it.
    private var line: AttributedString {
        var project = AttributedString(place.projectName ?? String(localized: "The project opened last"))
        project.foregroundColor = MobileStyle.text
        guard let machine = place.machineName, !machine.isEmpty else { return project }
        var rest = AttributedString(" · \(machine)")
        rest.foregroundColor = MobileStyle.muted
        return project + rest
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

    static let mutedLabel = String(localized: "You · Muted")

    static func phase(_ phase: VoiceCoordinator.Phase) -> String {
        switch phase {
        case .idle: String(localized: "Voice is off")
        case .connecting: String(localized: "Connecting to Voice")
        case .active: String(localized: "Listening")
        case .stopping: String(localized: "Stopping Voice")
        }
    }

    /// What Voice does now, beside its half of the band.
    static func bandState(_ voice: VoiceCoordinator) -> String {
        switch voice.phase {
        case .idle, .connecting: String(localized: "Voice · Connecting")
        case .stopping: String(localized: "Voice · Stopping")
        case .active:
            if voice.activity.contains(where: { $0.status == "running" }) {
                String(localized: "Voice · Working")
            } else if voice.speaking {
                String(localized: "Voice · Speaking")
            } else {
                String(localized: "Voice · Listening")
            }
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
