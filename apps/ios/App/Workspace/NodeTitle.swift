import Foundation

/// Text as the desktop's JavaScript reads it. Swift's own whitespace set differs (it has the next-line mark and lacks
/// the byte order mark), and a rule that decides on it has to agree with the one that wrote the file.
enum JSText {
    /// The characters `\s` and `trim()` take for whitespace.
    static func isSpace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
        default: false
        }
    }

    static func trimmed(_ text: String) -> String {
        var scalars = Substring(text).unicodeScalars
        while let first = scalars.first, isSpace(first) { scalars.removeFirst() }
        while let last = scalars.last, isSpace(last) { scalars.removeLast() }
        return String(scalars)
    }

    static func collapsed(_ text: String) -> String {
        var result = String.UnicodeScalarView()
        var gap = false
        for scalar in text.unicodeScalars {
            if isSpace(scalar) {
                gap = true
                continue
            }
            if gap && !result.isEmpty { result.append(" ") }
            gap = false
            result.append(scalar)
        }
        return String(result)
    }
}

/// The name a node takes from the prompt that opened it, as `deriveNodeTitle` in `packages/contracts` cuts it. The
/// phone has no page to ask, so it names a browser from the address in the same way.
enum NodeTitle {
    /// Past this a title stops being a name and starts being the message it came from.
    static let limit = 48

    /// The first line that says anything, cut on a word when a word is worth using, without closing punctuation; nil
    /// leaves the node the name it has.
    static func derive(_ prompt: String) -> String? {
        let lines = prompt.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false)
        guard let first = lines.first(where: { !JSText.trimmed(String($0)).isEmpty }) else { return nil }
        let line = JSText.collapsed(String(first))
        if line.utf16.count <= limit {
            let name = withoutTail(line)
            return name.isEmpty ? nil : name
        }
        let cut = clipped(line, to: limit)
        let units = Array(cut.utf16)
        let space = units.lastIndex(of: 0x20)
        let head: String
        if let space, space > limit / 2 {
            head = withoutTail(String(decoding: units[..<space], as: UTF16.self))
        } else {
            head = withoutTail(cut)
        }
        return head.isEmpty ? nil : head + "…"
    }

    /// The longest start of `text` that fits in `max` UTF-16 units, cut only between characters as a person sees them.
    static func clipped(_ text: String, to max: Int) -> String {
        var result = ""
        var used = 0
        for character in text {
            let units = character.utf16.count
            if used + units > max { break }
            used += units
            result.append(character)
        }
        return result
    }

    private static func withoutTail(_ text: String) -> String {
        var scalars = Substring(text).unicodeScalars
        while let last = scalars.last, JSText.isSpace(last) || ".,;:!?".unicodeScalars.contains(last) {
            scalars.removeLast()
        }
        return String(scalars)
    }
}
