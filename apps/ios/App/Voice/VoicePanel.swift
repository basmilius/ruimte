import RuimteVoice
import SwiftUI

/// Voice's timeline: where it works, what was said and what it did on the machine, and Start or Stop. A sheet on an
/// iPhone, the inspector on an iPad. The phone runs no tool; every line of what Voice did comes from the machine.
struct VoicePanel: View {
    let runtime: AppRuntime
    let now: NowModel
    let scene: VoiceScene
    var close: (() -> Void)?

    private var voice: VoiceCoordinator { runtime.voice }

    var body: some View {
        NavigationStack {
            List {
                Section { status }
                if !voice.transcript.lines.isEmpty {
                    Section("Conversation") {
                        ForEach(voice.transcript.lines) { line in VoiceUtteranceRow(line: line) }
                    }
                }
                if !voice.activity.isEmpty {
                    Section("What Voice did") {
                        ForEach(voice.activity) { line in VoiceActivityRow(line: line) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(MobileStyle.canvas)
            .safeAreaInset(edge: .bottom, spacing: 0) { action.padding(16).background(.bar) }
            .navigationTitle("Voice")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: $choosing) {
                VoiceProjectPicker(runtime: runtime, now: now) { target, session in
                    choosing = false
                    scene.start(voice, target: target, session: session)
                }
            }
            .toolbar {
                if let close {
                    ToolbarItem(placement: .confirmationAction) { Button(role: .close, action: close) }
                }
            }
        }
    }

    @State private var choosing = false

    @ViewBuilder private var status: some View {
        VStack(alignment: .leading, spacing: 4) {
            if voice.runsElsewhere(than: scene.id) {
                Text("Voice runs in another window").font(.callout.weight(.semibold))
                Text("Stop it there to talk to Voice here.").font(.footnote).foregroundStyle(MobileStyle.muted)
            } else {
                Text(VoiceText.phase(voice.isOwner(scene.id) ? voice.phase : .idle)).font(.callout.weight(.semibold))
                if let target = voice.target {
                    Text(placeLine(target)).font(.footnote).foregroundStyle(MobileStyle.muted)
                }
                if voice.isOwner(scene.id), let route = voice.route {
                    Label(route, lucideIcon: "speaker").font(.footnote).foregroundStyle(MobileStyle.muted)
                }
            }
            if let problem = voice.problem(in: scene.id) {
                Text(VoiceText.problem(problem)).font(.footnote).foregroundStyle(MobileStyle.statusError)
                if problem == .microphoneDenied {
                    Button("Open Settings") { VoiceText.openSettings() }.font(.footnote)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var action: some View {
        if voice.isOwner(scene.id) {
            Button(role: .destructive) {
                voice.stop(scene: scene.id)
            } label: {
                Label(String(localized: "Stop Voice"), lucideIcon: "square").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .accessibilityIdentifier("voice.panel.stop")
        } else if !voice.runsElsewhere(than: scene.id) {
            Button {
                if let again = startAgain {
                    scene.start(voice, target: again.0, session: again.1)
                } else {
                    choosing = true
                }
            } label: {
                Label(startTitle, lucideIcon: "mic").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .accessibilityIdentifier("voice.panel.start")
        }
    }

    /// The project the last session worked in, while its machine still offers Voice.
    private var startAgain: (VoiceTarget, SharedMachineSession)? {
        guard let target = voice.target, let machine = runtime.machines.first(where: { $0.id == target.machineID })
        else { return nil }
        let session = runtime.session(for: machine)
        return voice.offers(machineID: machine.id, client: session.rpc) ? (target, session) : nil
    }

    private var startTitle: String {
        startAgain.map { String(localized: "Talk about \($0.0.projectName)") } ?? String(localized: "Choose a project")
    }

    private func placeLine(_ target: VoiceTarget) -> String {
        let machine = runtime.machines.first { $0.id == target.machineID }?.name ?? ""
        return machine.isEmpty ? target.projectName : "\(target.projectName) · \(machine)"
    }
}

private struct VoiceUtteranceRow: View {
    let line: VoiceUtterance

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(line.speaker == .person ? String(localized: "You") : String(localized: "Voice"))
                .font(.caption.weight(.semibold)).foregroundStyle(MobileStyle.muted)
            Text(line.text).font(.callout).textSelection(.enabled)
            if line.interrupted {
                Text("Interrupted").font(.caption).foregroundStyle(MobileStyle.faint)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct VoiceActivityRow: View {
    let line: VoiceActivityLine

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Group {
                switch line.status {
                case "running": Spinner(size: 14, label: String(localized: "Running"))
                case "failed": Image(lucide: "circle-x", size: 16).foregroundStyle(MobileStyle.statusError)
                default: Image(lucide: "check", size: 16).foregroundStyle(MobileStyle.positive)
                }
            }
            .frame(width: 18, height: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(line.label).font(.callout)
                if !line.detail.isEmpty {
                    Text(line.detail).font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Where a start from Now talks: an open project of a machine that offers Voice.
struct VoiceProjectPicker: View {
    let runtime: AppRuntime
    let now: NowModel
    let picked: (VoiceTarget, SharedMachineSession) -> Void

    private var voice: VoiceCoordinator { runtime.voice }

    var body: some View {
        MobileForm {
            let offering = runtime.machines.filter {
                voice.offers(machineID: $0.id, client: runtime.session(for: $0).rpc)
            }
            if offering.isEmpty {
                ContentUnavailableView(
                    String(localized: "No machine offers Voice"), lucideIcon: "mic-off",
                    description: Text("A machine offers Voice once it has an OpenAI key and Voice is turned on there."))
            }
            ForEach(offering, id: \.id) { machine in
                Section(machine.name) {
                    let projects = now.chatProjects(on: machine.id)
                    if projects.isEmpty {
                        Text("No open projects").foregroundStyle(MobileStyle.muted)
                    }
                    ForEach(projects) { project in
                        Button {
                            picked(
                                VoiceTarget(
                                    machineID: machine.id, projectID: project.projectID, projectName: project.name),
                                runtime.session(for: machine))
                        } label: {
                            Label(project.name, lucideIcon: "folder")
                        }
                        .accessibilityIdentifier("voice.project.\(project.projectID)")
                    }
                }
            }
        }
        .navigationTitle("Talk about")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The sheet a start from Now puts up when the scene has no project open.
struct VoiceStartSheet: View {
    let runtime: AppRuntime
    let now: NowModel
    let scene: VoiceScene
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VoiceProjectPicker(runtime: runtime, now: now) { target, session in
                dismiss()
                scene.start(runtime.voice, target: target, session: session)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }
}

/// The mic in a bar: Voice on in this scene, in `target` or else in what the scene shows, or off again. It shows
/// only where Voice is offered, so a machine without the request or the key, and a build without the microphone,
/// never show it.
struct VoiceMicButton: View {
    let voice: VoiceCoordinator
    let scene: VoiceScene
    var target: (VoiceTarget, SharedMachineSession)?

    var body: some View {
        let on = voice.isOwner(scene.id)
        Button {
            if !on, let target, !voice.runsElsewhere(than: scene.id) {
                scene.start(voice, target: target.0, session: target.1)
            } else {
                scene.toggle(voice)
            }
        } label: {
            Image(lucide: on ? "mic-off" : "mic").accessibilityLabel(on ? "Stop Voice" : "Start Voice")
        }
        .accessibilityIdentifier("voice.toggle")
    }
}

/// Reads per machine whether it holds the key, whenever its link comes back, so the mic button knows where it shows.
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
                    }
                }
            }
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        }
    }
}

extension AppRuntime {
    /// Whether a bar shows the mic: a machine offers Voice, or Voice runs in this scene and the mic stops it.
    func showsVoice(in scene: VoiceScene?) -> Bool {
        guard let scene else { return false }
        return voice.isOwner(scene.id)
            || machines.contains { voice.offers(machineID: $0.id, client: session(for: $0).rpc) }
    }
}
