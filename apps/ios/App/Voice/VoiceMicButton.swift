import RuimtePulsar
import RuimteVoice
import SwiftUI

/// The mic in a bar, which opens the Voice sheet and proposes `target` as the place to talk about. While Voice runs in
/// this scene it stands out in Voice's color, so the app shows Voice is on wherever the person goes. It shows only
/// where Voice is offered, so a machine without the request or the key, and a build without the microphone, never
/// show it.
struct VoiceMicButton: View {
    let voice: VoiceCoordinator
    let scene: VoiceScene
    var target: VoiceScene.Place?

    var body: some View {
        if voice.isOwner(scene.id) {
            Button(action: open) {
                Image(lucide: voice.muted ? "mic-off" : "audio-lines").accessibilityLabel("Voice is on")
            }
            .buttonStyle(.glassProminent)
            .tint(VoiceStyle.voice)
            .accessibilityIdentifier("voice.toggle")
        } else {
            Button(action: open) {
                Image(lucide: "mic").accessibilityLabel("Voice")
            }
            .accessibilityIdentifier("voice.toggle")
        }
    }

    private func open() {
        scene.showPanel(proposing: target)
    }
}

/// Reads per machine whether it holds the key and how Voice talks there, whenever its link comes back, so the mic
/// button knows where it shows and a start sends what the machine keeps.
struct VoiceKeyWatch: View {
    let runtime: AppRuntime

    var body: some View {
        if runtime.voice.declaresMicrophone {
            ZStack {
                ForEach(runtime.machines, id: \.id) { machine in
                    let session = runtime.session(for: machine)
                    Color.clear.task(id: "\(machine.id):\(session.generation):\(session.connected)") {
                        guard session.connected else { return }
                        await runtime.voice.refreshKey(machineID: machine.id, client: session.rpc)
                        await runtime.voice.refreshPreferences(machineID: machine.id, client: session.rpc)
                    }
                }
            }
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        }
    }
}

extension VoiceTarget {
    /// A project's page as Voice works in it, with the canvas on screen when the page shows one.
    @MainActor init(_ workspace: MobileWorkspace, shown: String?) {
        self.init(
            machineID: workspace.session.machine.id, projectID: workspace.projectID, projectName: workspace.title,
            viewID: Self.canvas(shown: shown, views: workspace.views), machineName: workspace.session.machine.name)
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

extension NowModel {
    /// When a project of this machine was opened last, as its feed says; 0 for a machine without one.
    func lastOpened(on machineID: String) -> Double {
        (feeds[machineID]?.projects ?? []).compactMap { project in
            project["summary"].flatMap { NewChat.isChats($0) ? nil : $0.number("lastOpenedAt") }
        }.max() ?? 0
    }
}

extension AppRuntime {
    /// Where Voice starts without a project on screen: the machine of the project opened last among the machines that
    /// offer Voice, else the first that offers it. No project goes with it, so the machine starts in the one opened
    /// last there.
    func voiceStartingPoint(now: NowModel) -> VoiceScene.Place? {
        guard let machine = voiceMachines.max(by: { now.lastOpened(on: $0.id) < now.lastOpened(on: $1.id) }) else {
            return nil
        }
        return (VoiceTarget(machineID: machine.id, machineName: machine.name), session(for: machine))
    }

    var voiceMachines: [Machine] {
        machines.filter { voice.offers(machineID: $0.id, client: session(for: $0).rpc) }
    }

    /// Whether a bar shows the mic: a machine offers Voice, or Voice runs in this scene.
    func showsVoice(in scene: VoiceScene?) -> Bool {
        guard let scene else { return false }
        return voice.isOwner(scene.id) || !voiceMachines.isEmpty
    }
}
