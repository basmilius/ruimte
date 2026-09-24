import CoreGraphics
import Foundation

public struct KeyCombo: Sendable {
    public let keyCode: CGKeyCode
    public let flags: CGEventFlags
    public let name: String

    public init(keyCode: CGKeyCode, flags: CGEventFlags, name: String) {
        self.keyCode = keyCode
        self.flags = flags
        self.name = name
    }

    /// ANSI virtual key codes. A letter goes by its position on a US keyboard, not by the active layout.
    private static let keys: [String: CGKeyCode] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
        "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
        "=": 24, "equal": 24, "9": 25, "7": 26, "-": 27, "minus": 27, "8": 28, "0": 29, "]": 30,
        "rightbracket": 30, "o": 31, "u": 32, "[": 33, "leftbracket": 33, "i": 34, "p": 35, "l": 37,
        "j": 38, "'": 39, "quote": 39, "k": 40, ";": 41, "semicolon": 41, "\\": 42, "backslash": 42,
        ",": 43, "comma": 43, "/": 44, "slash": 44, "n": 45, "m": 46, ".": 47, "period": 47, "`": 50,
        "grave": 50, "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51,
        "escape": 53, "esc": 53, "forwarddelete": 117, "home": 115, "end": 119, "pageup": 116,
        "pagedown": 121, "left": 123, "right": 124, "down": 125, "up": 126, "f1": 122, "f2": 120,
        "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103,
        "f12": 111, "help": 114,
    ]

    /// Hardware sends these with the fn and keypad bits set, and some apps only react when they are.
    private static let navigationKeys: Set<String> = ["left", "right", "up", "down"]
    private static let functionKeys: Set<String> = ["home", "end", "pageup", "pagedown", "forwarddelete", "help"]

    public static let escapeKeyCode: CGKeyCode = 53

    public static func parse(_ text: String) throws -> KeyCombo {
        var normalized = text.trimmingCharacters(in: .whitespaces).lowercased()
        var keyName: String
        if normalized == "+" || normalized.hasSuffix("++") {
            normalized = String(normalized.dropLast(normalized == "+" ? 1 : 2))
            keyName = "plus"
        } else {
            keyName = ""
        }
        var parts = normalized.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        if keyName.isEmpty {
            guard let last = parts.popLast(), !last.isEmpty else {
                throw AgentError("\"\(text)\" has no key; write it like cmd+n, shift+tab or return")
            }
            keyName = last
        }
        if parts == [""] {
            parts = []
        }

        var flags: CGEventFlags = []
        for modifier in parts {
            switch modifier {
            case "cmd", "command":
                flags.insert(.maskCommand)
            case "shift":
                flags.insert(.maskShift)
            case "alt", "option", "opt":
                flags.insert(.maskAlternate)
            case "ctrl", "control":
                flags.insert(.maskControl)
            case "fn":
                flags.insert(.maskSecondaryFn)
            default:
                throw AgentError("unknown modifier \"\(modifier)\" in \"\(text)\"; use cmd, shift, option, ctrl or fn")
            }
        }

        let code: CGKeyCode
        if keyName == "plus" {
            code = 24
            flags.insert(.maskShift)
        } else if let known = keys[keyName] {
            code = known
        } else {
            throw AgentError("unknown key \"\(keyName)\" in \"\(text)\"; use a letter, digit, return, escape, tab, space, delete, arrows, home/end, pageup/pagedown or f1-f12")
        }
        if navigationKeys.contains(keyName) {
            flags.formUnion([.maskNumericPad, .maskSecondaryFn])
        } else if functionKeys.contains(keyName) {
            flags.insert(.maskSecondaryFn)
        }
        return KeyCombo(keyCode: code, flags: flags, name: text)
    }
}
