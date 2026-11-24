import Foundation

/// The caps of a shortcut written as `mod+K`, as `uiKeyCaps` in `@adecore/agents-react` prints them. Keys a shortcut
/// cannot hold, such as two letters or a key it has no name for, stand as written, with only `mod` translated.
enum UiKeyCaps {
    private static let words: [String: String] = [
        "mod": "Mod", "ctrl": "Ctrl", "control": "Ctrl", "alt": "Alt", "option": "Alt", "opt": "Alt",
        "shift": "Shift", "meta": "Meta", "cmd": "Meta", "command": "Meta", "enter": "Enter", "return": "Enter",
        "escape": "Escape", "esc": "Escape", "backspace": "Backspace", "delete": "Delete", "del": "Delete",
        "tab": "Tab", "space": "Space", "left": "ArrowLeft", "right": "ArrowRight", "up": "ArrowUp",
        "down": "ArrowDown", "arrowleft": "ArrowLeft", "arrowright": "ArrowRight", "arrowup": "ArrowUp",
        "arrowdown": "ArrowDown",
    ]
    private static let modifiers: Set<String> = ["Mod", "Ctrl", "Meta", "Alt", "Shift"]
    private static let namedKeys: Set<String> = [
        "Enter", "Escape", "Backspace", "Delete", "Tab", "Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
    ]
    private static let punctuation: Set<String> = [",", ".", "/", ";", "'", "`", "\\", "[", "]", "+", "-", "="]
    private static let labels: [String: (apple: String, other: String)] = [
        "Enter": ("↩", "Enter"), "Backspace": ("⌫", "Backspace"), "Delete": ("⌦", "Delete"),
        "Escape": ("Esc", "Esc"), "Tab": ("⇥", "Tab"), "Space": ("Space", "Space"), "ArrowLeft": ("←", "←"),
        "ArrowRight": ("→", "→"), "ArrowUp": ("↑", "↑"), "ArrowDown": ("↓", "↓"),
    ]
    /// The key names VoiceOver should say for the symbols a cap shows. They are names, so they stay English.
    private static let names: [String: String] = [
        "⌘": "Command", "⌃": "Control", "⌥": "Option", "⇧": "Shift", "↩": "Return", "⌫": "Delete",
        "⌦": "Forward Delete", "⇥": "Tab", "Esc": "Escape",
    ]

    static func caps(_ text: String, apple: Bool = true) -> [String] {
        let written = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // A trailing `++` is the plus key itself, which a plain split would read as two empty words.
        let parts =
            written.hasSuffix("++")
            ? written.dropLast(2).components(separatedBy: "+") + ["+"]
            : written == "+" ? ["+"] : written.components(separatedBy: "+")
        let keys = parts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            .map { word in
                words[word.lowercased()]
                    ?? (word.wholeMatch(of: /[fF]\d{1,2}/) == nil ? word : word.uppercased())
            }
        return shortcut(keys, apple: apple)
            ?? keys.map { $0 == "Mod" ? (apple ? "⌘" : "Ctrl") : $0 }
    }

    static func spoken(_ caps: [String]) -> String {
        caps.map { names[$0] ?? $0 }.joined(separator: " ")
    }

    /// The modifiers in the order the platform prints them, then the one key; nil for words that are no shortcut.
    private static func shortcut(_ keys: [String], apple: Bool) -> [String]? {
        var held: Set<String> = []
        var key = ""
        for word in keys {
            if modifiers.contains(word) {
                held.insert(word)
                continue
            }
            guard isKey(word), key.isEmpty else { return nil }
            key = word.count == 1 ? word.uppercased() : word
        }
        let order: [(String, Bool)] =
            apple
            ? [
                ("⌃", held.contains("Ctrl")), ("⌥", held.contains("Alt")), ("⇧", held.contains("Shift")),
                ("⌘", held.contains("Meta") || held.contains("Mod")),
            ]
            : [
                ("Ctrl", held.contains("Ctrl") || held.contains("Mod")), ("Alt", held.contains("Alt")),
                ("Shift", held.contains("Shift")), ("Meta", held.contains("Meta")),
            ]
        var parts = order.filter(\.1).map(\.0)
        if !key.isEmpty { parts.append(labels[key].map { apple ? $0.apple : $0.other } ?? key) }
        return parts
    }

    private static func isKey(_ word: String) -> Bool {
        word.wholeMatch(of: /[A-Za-z0-9]/) != nil || punctuation.contains(word) || namedKeys.contains(word)
            || word.wholeMatch(of: /F([1-9]|1[0-2])/) != nil
    }
}
