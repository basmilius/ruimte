import Observation
import SwiftUI
import UIKit

/// What Voice is in one scene: its id on the wire, whether its panel shows, and the project it has open, which a
/// start from the keyboard or the caption bar works in. Without a project the scene asks for one first.
@MainActor @Observable
final class VoiceScene {
    let id: String
    /// The iPhone's sheet with the timeline.
    var showsPanel = false
    /// The sheet that picks a machine and a project, for a start from Now.
    var picking = false
    /// The project this scene shows, set by its home.
    @ObservationIgnored var openTarget: () -> (VoiceTarget, SharedMachineSession)? = { nil }
    /// The iPad puts the panel in its inspector instead of a sheet.
    @ObservationIgnored var presentPanel: (() -> Void)?

    init(id: String) { self.id = id }

    func showPanel() {
        if let presentPanel { presentPanel() } else { showsPanel = true }
    }

    /// The mic button and ⌘⇧M: stop Voice here, or start it in what the scene shows, or ask where.
    func toggle(_ voice: VoiceCoordinator) {
        if voice.isOwner(id) {
            voice.stop(scene: id)
            return
        }
        guard !voice.runsElsewhere(than: id) else {
            showPanel()
            return
        }
        guard let open = openTarget(), voice.offers(machineID: open.0.machineID, client: open.1.rpc) else {
            picking = true
            return
        }
        start(voice, target: open.0, session: open.1)
    }

    func start(_ voice: VoiceCoordinator, target: VoiceTarget, session: SharedMachineSession) {
        if presentPanel != nil { showPanel() }
        Task { await voice.start(scene: id, target: target, client: session.rpc) }
    }
}

extension EnvironmentValues {
    @Entry var voiceScene: VoiceScene?
}

/// ⌘⇧M on an iPad keyboard, a `UIKeyCommand` on the window's root view controller, so it answers whatever the scene
/// shows, a presented sheet included, whose responder chain runs through the controller that presented it.
@MainActor enum VoiceKeyCommand {
    static let input = "m"
    static let modifiers: UIKeyModifierFlags = [.command, .shift]
    private static var scenes: [ObjectIdentifier: Registration] = [:]

    private struct Registration {
        weak var window: UIWindow?
        weak var scene: VoiceScene?
        let voice: VoiceCoordinator
    }

    static func install(in window: UIWindow, scene: VoiceScene, voice: VoiceCoordinator) {
        scenes = scenes.filter { $0.value.window != nil }
        scenes[ObjectIdentifier(window)] = Registration(window: window, scene: scene, voice: voice)
        guard let root = window.rootViewController,
            !(root.keyCommands ?? []).contains(where: { $0.input == input && $0.modifierFlags == modifiers })
        else { return }
        let command = UIKeyCommand(
            title: String(localized: "Start or stop Voice"), action: #selector(UIViewController.toggleRuimteVoice(_:)),
            input: input, modifierFlags: modifiers)
        command.discoverabilityTitle = String(localized: "Voice")
        root.addKeyCommand(command)
    }

    fileprivate static func fire(from window: UIWindow?) {
        guard let window, let registration = scenes[ObjectIdentifier(window)], let scene = registration.scene else {
            return
        }
        scene.toggle(registration.voice)
    }
}

extension UIViewController {
    @objc func toggleRuimteVoice(_ command: UIKeyCommand) {
        VoiceKeyCommand.fire(from: viewIfLoaded?.window)
    }
}
