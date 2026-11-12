import Foundation

/// Whether text goes into a field by setting its selected text, in one write and without a key event, instead of
/// key by key. Only a native field takes it: a field inside a web area reports success and drops the text, and a
/// newline or tab is a key that may submit or move on, which a write would put in the field instead.
public enum TextInsertion {
    public static let roles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox"]

    public static func fits(_ text: String, role: String?, insideWebArea: Bool, settable: Bool) -> Bool {
        guard settable, !insideWebArea, let role, roles.contains(role) else {
            return false
        }
        return !text.contains(where: { $0 == "\n" || $0 == "\r" || $0 == "\t" })
    }

    /// Whether the write changed the value. A field may format what it got, so any change counts; only an unchanged
    /// value sends the keys after it, which keeps a slow field from getting the text twice. A selection replaced by the
    /// same text leaves the value as it was, so that write landed too; keys after it would type the text again.
    public static func landed(before: String, after: String?, replacing selected: String?, with text: String) -> Bool {
        guard let after else {
            return false
        }
        return after != before || selected == text
    }
}
