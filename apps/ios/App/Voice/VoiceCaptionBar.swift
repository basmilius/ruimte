import RuimtePulsar
import RuimteVoice
import SwiftUI
import UIKit

extension VoiceTarget {
    /// A project's page as Voice works in it, with the canvas on screen when the page shows one.
    @MainActor init(_ workspace: MobileWorkspace, shown: String?) {
        self.init(
            machineID: workspace.session.machine.id, projectID: workspace.projectID, projectName: workspace.title,
            viewID: Self.canvas(shown: shown, views: workspace.views))
    }

    /// The canvas a shown id stands for: a canvas itself, or the canvas of a node opened on its own, which is what both
    /// the iPhone and the iPad name as shown then.
    static func canvas(shown: String?, views: [JSONValue]) -> String? {
        guard let shown else { return nil }
        let canvases = views.filter { $0.text("kind") == "canvas" }
        if let canvas = canvases.first(where: { $0.stableID == shown }) { return canvas.stableID }
        return canvases.first { $0.list("nodes").contains { $0.stableID == shown } }?.stableID
    }
}

/// The line above every tab of a scene while Voice runs in it: what is said now, and Stop. Another scene of an iPad
/// shows where Voice runs instead, and the scene a session ended in says why. A tap opens the panel.
struct VoiceCaptionBar: View {
    let voice: VoiceCoordinator
    let scene: VoiceScene

    var body: some View {
        if voice.isOwner(scene.id) {
            bar {
                indicator
                Text(line).lineLimit(2).truncationMode(.head)
                    .foregroundStyle(voice.transcript.current == nil ? MobileStyle.muted : MobileStyle.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button(String(localized: "Stop Voice"), lucideIcon: "square") { voice.stop(scene: scene.id) }
                    .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                    .accessibilityIdentifier("voice.bar.stop")
            }
        } else if voice.runsElsewhere(than: scene.id) {
            bar {
                Image(lucide: "mic", size: 14).foregroundStyle(MobileStyle.muted).accessibilityHidden(true)
                Text("Voice runs in another window").foregroundStyle(MobileStyle.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else if let problem = voice.problem(in: scene.id) {
            bar {
                Image(lucide: "triangle-alert", size: 14).foregroundStyle(MobileStyle.statusError)
                    .accessibilityHidden(true)
                Text(VoiceText.problem(problem)).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                if problem == .microphoneDenied {
                    Button("Settings") { VoiceText.openSettings() }
                }
                Button(String(localized: "Dismiss"), lucideIcon: "x") { voice.dismissProblem() }
                    .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
            }
        }
    }

    private func bar<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 10) { content() }
            .font(.subheadline)
            .padding(.leading, 16).padding(.trailing, 6)
            .frame(minHeight: 48)
            .frame(maxWidth: .infinity)
            .background(.thinMaterial)
            .contentShape(Rectangle())
            .onTapGesture { scene.showPanel() }
            .accessibilityElement(children: .contain)
            .accessibilityAction(named: Text("Show Voice")) { scene.showPanel() }
            .accessibilityIdentifier("voice.bar")
    }

    @ViewBuilder private var indicator: some View {
        if voice.phase == .active {
            Image(lucide: "audio-lines", size: 16).foregroundStyle(MobileStyle.accent)
                .accessibilityLabel("Voice listens")
        } else {
            Spinner(size: 14, label: VoiceText.phase(voice.phase)).foregroundStyle(MobileStyle.muted)
        }
    }

    private var line: String {
        voice.transcript.current?.text ?? VoiceText.phase(voice.phase)
    }
}

/// The sentences Voice shows in more than one place.
@MainActor enum VoiceText {
    static func phase(_ phase: VoiceCoordinator.Phase) -> String {
        switch phase {
        case .idle: String(localized: "Voice is off")
        case .connecting: String(localized: "Connecting to Voice")
        case .active: String(localized: "Listening")
        case .stopping: String(localized: "Stopping Voice")
        }
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
