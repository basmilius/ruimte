import Foundation

/// Whether the operated app coming to the front during the agent's work behind the person's should be undone. Apps
/// such as Chromium, Electron and Safari activate themselves on launch or on a press, whatever the caller asked;
/// the person's own app goes back in front then. A click or key of the person just before is their own switch,
/// which stays, and counts as taking over.
public enum ActivationUndo {
    /// How recent the person's own click or key has to be to count as theirs.
    public static let personWindow: TimeInterval = 0.5

    public static func shouldUndo(now: TimeInterval, keepUntil: TimeInterval?, sinceMouseDown: TimeInterval, sinceKey: TimeInterval) -> Bool {
        guard let keepUntil, now < keepUntil else {
            return false
        }
        return sinceMouseDown >= personWindow && sinceKey >= personWindow
    }
}
