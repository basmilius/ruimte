import Foundation

/// A key combination with Command as a menu shows it, so a combo can be matched to the menu item it stands for.
/// Keys posted to an app behind the person's work reach its views but never its menu's key equivalents, so such a
/// combo is pressed as its menu item instead.
public enum MenuShortcut {
    /// `ctrl+option+shift+cmd+<key>` in that order with a lowercase key, as `Menus` lists a shortcut; nil for a
    /// combo without Command or without one printable key.
    public static func canonical(_ combo: String) -> String? {
        let parts = combo.trimmingCharacters(in: .whitespaces).lowercased().split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        guard let key = parts.last, key.count == 1, let scalar = key.unicodeScalars.first, scalar.properties.isAlphabetic || scalar.properties.generalCategory != .control else {
            return nil
        }
        var modifiers = Set<String>()
        for part in parts.dropLast() {
            switch part {
            case "cmd", "command":
                modifiers.insert("cmd")
            case "shift":
                modifiers.insert("shift")
            case "alt", "option", "opt":
                modifiers.insert("option")
            case "ctrl", "control":
                modifiers.insert("ctrl")
            default:
                return nil
            }
        }
        guard modifiers.contains("cmd") else {
            return nil
        }
        return (["ctrl", "option", "shift", "cmd"].filter(modifiers.contains) + [key]).joined(separator: "+")
    }
}
