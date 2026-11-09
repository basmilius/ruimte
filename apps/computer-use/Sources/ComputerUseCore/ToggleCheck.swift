import Foundation

/// Whether a press on a checkbox or radio button happened, read from its value. Some apps perform the press and still
/// answer it with an AX error, which alone would send the agent to the front for a click that already worked.
public enum ToggleCheck {
    public static let roles: Set<String> = ["AXCheckBox", "AXRadioButton"]

    /// A checkbox changes state; a radio button becomes selected, since one turning off was another's press.
    public static func pressed(role: String?, before: Double?, now: Double?) -> Bool {
        guard let before, let now else {
            return false
        }
        switch role {
        case "AXCheckBox":
            return now != before
        case "AXRadioButton":
            return before != 1 && now == 1
        default:
            return false
        }
    }
}
