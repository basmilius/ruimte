import Foundation

/// Whether the focus went where the helper asked for it. An app may answer the request with success and keep the
/// focus where it was (TextEdit's font size box in its toolbar, 2026-11-12), and keys sent then land in that element.
public enum FocusLanding {
    /// A combo box or search field hands the focus to a text field it holds, and a field being edited to its field
    /// editor, so the focus anywhere inside the requested element counts. An app that names no focused element
    /// cannot show where keys go, so that does not.
    /// - Parameter focusedAncestors: The ancestors of the focused element, nearest first.
    public static func reached<Node: Equatable>(_ requested: Node, focused: Node?, focusedAncestors: [Node]) -> Bool {
        guard let focused else {
            return false
        }
        return focused == requested || focusedAncestors.contains(requested)
    }
}
