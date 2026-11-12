import Foundation

/// Whether the operated app coming to the front during the agent's work behind the person's should be undone. Apps
/// such as Chromium, Electron and Safari activate themselves on launch or on a press, whatever the caller asked;
/// the person's own app goes back in front then. A click or key of the person just before is their own switch,
/// which stays, and counts as taking over.
public enum ActivationUndo {
    public enum Outcome: Equatable, Sendable {
        case left
        case restored
        case refused
    }

    /// What follows the activation once the helper tried to undo it.
    public enum Consequence: Equatable, Sendable {
        case nothing
        /// The person brought the app forward.
        case takeOver
        /// macOS kept the operated app in front of the person's, which holds the session as a take-over does.
        case keptInFront
        /// macOS kept the operated app in front where nothing takes over, such as during the agent's own launch, so only a
        /// result's `note` says so.
        case note
    }

    /// How recent the person's own click or key has to be to count as theirs.
    public static let personWindow: TimeInterval = 0.5

    public static func shouldUndo(now: TimeInterval, keepUntil: TimeInterval?, sinceMouseDown: TimeInterval, sinceKey: TimeInterval) -> Bool {
        guard let keepUntil, now < keepUntil else {
            return false
        }
        return sinceMouseDown >= personWindow && sinceKey >= personWindow
    }

    /// Calls `activate` only when the activation should be undone. macOS may refuse to activate the person's app, and
    /// then the operated app is still in front.
    public static func undo(now: TimeInterval, keepUntil: TimeInterval?, sinceMouseDown: TimeInterval, sinceKey: TimeInterval, activate: () -> Bool) -> Outcome {
        guard shouldUndo(now: now, keepUntil: keepUntil, sinceMouseDown: sinceMouseDown, sinceKey: sinceKey) else {
            return .left
        }
        return activate() ? .restored : .refused
    }

    /// `inGrace` is while the agent's own launch may bring the app forward, which is never the person's switch.
    public static func consequence(of outcome: Outcome, inGrace: Bool, acceptsTakeover: Bool) -> Consequence {
        let holds = !inGrace && acceptsTakeover
        switch outcome {
        case .restored:
            return .nothing
        case .left:
            return holds ? .takeOver : .nothing
        case .refused:
            return holds ? .keptInFront : .note
        }
    }

    public static func refusal(operated: String, person: String) -> String {
        "macOS kept \(operated) in front of \(person) and did not bring \(person) back"
    }
}
