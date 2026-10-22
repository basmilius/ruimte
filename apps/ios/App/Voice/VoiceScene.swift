import Observation
import SwiftUI
import UIKit

/// What Voice is in one scene: its id on the wire, whether its sheet shows, and where a start from that sheet goes.
/// The mic proposes the project on screen, or the machine of the project opened last. Without a project Voice starts on
/// that machine, and the machine picks the project. There is nothing to choose: a session talks about every project of
/// its machine and moves between them, as on the desktop.
@MainActor @Observable
final class VoiceScene {
    typealias Place = (target: VoiceTarget, session: SharedMachineSession)

    let id: String
    var showsPanel = false
    /// What the mic or the keyboard proposed when the sheet opened.
    private(set) var proposal: Place?
    /// The project this scene shows, set by its home.
    @ObservationIgnored var openTarget: () -> Place? = { nil }
    /// Where a start without a project on screen goes, set by the app's home.
    @ObservationIgnored var startingPoint: () -> Place? = { nil }

    init(id: String) { self.id = id }

    /// Opens the sheet, proposing `target` as the place to talk about, else the project the scene shows.
    func showPanel(proposing target: Place? = nil) {
        proposal = target ?? openTarget()
        showsPanel = true
    }

    /// ⌘⇧M opens the sheet, and closes it again.
    func toggleSheet() {
        if showsPanel {
            showsPanel = false
        } else {
            showPanel()
        }
    }

    /// Where Start Voice goes: the place proposed while its machine offers Voice, else the starting point. Nil while no
    /// machine offers Voice.
    func place(_ voice: VoiceCoordinator) -> Place? {
        if let proposal, voice.offers(machineID: proposal.target.machineID, client: proposal.session.rpc) {
            return proposal
        }
        return startingPoint()
    }

    func start(_ voice: VoiceCoordinator, at place: Place) {
        Task { await voice.start(scene: id, target: place.target, client: place.session.rpc) }
    }
}

extension EnvironmentValues {
    @Entry var voiceScene: VoiceScene?
}

/// ⌘⇧M on a keyboard, a `UIKeyCommand` on the window's root view controller, so it answers whatever the scene shows,
/// a presented sheet included, whose responder chain runs through the controller that presented it.
@MainActor enum VoiceKeyCommand {
    static let input = "m"
    static let modifiers: UIKeyModifierFlags = [.command, .shift]
    private static var scenes: [ObjectIdentifier: Registration] = [:]

    private struct Registration {
        weak var window: UIWindow?
        weak var scene: VoiceScene?
    }

    static func install(in window: UIWindow, scene: VoiceScene) {
        scenes = scenes.filter { $0.value.window != nil }
        scenes[ObjectIdentifier(window)] = Registration(window: window, scene: scene)
        guard let root = window.rootViewController,
            !(root.keyCommands ?? []).contains(where: { $0.input == input && $0.modifierFlags == modifiers })
        else { return }
        let command = UIKeyCommand(
            title: String(localized: "Show Voice"), action: #selector(UIViewController.toggleRuimteVoice(_:)),
            input: input, modifierFlags: modifiers)
        command.discoverabilityTitle = String(localized: "Voice")
        root.addKeyCommand(command)
    }

    fileprivate static func fire(from window: UIWindow?) {
        guard let window, let registration = scenes[ObjectIdentifier(window)], let scene = registration.scene else {
            return
        }
        scene.toggleSheet()
    }
}

extension UIViewController {
    @objc func toggleRuimteVoice(_ command: UIKeyCommand) {
        VoiceKeyCommand.fire(from: viewIfLoaded?.window)
    }
}
