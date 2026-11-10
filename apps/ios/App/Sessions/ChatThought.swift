import Foundation

/// What a thought shows on its one line, as the desktop's `thoughtPreview` and `thoughtLine` read it.
enum ChatThought {
    // A line that is nothing but bold, the way a model titles a stretch of its reasoning.
    private static var headingLine: Regex<(Substring, Substring)> { #/^[ \t]*\*\*([^*\n]+?)\*\*[ \t]*$/# }
    private static var listMarker: Regex<Substring> { #/(?m)^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/# }
    // A sentence ends on a stop with white space after it, so `a.ts` and `1.5` stay whole.
    private static var sentenceEnd: Regex<Substring> { #/[.!?]["'”’)\]]*(?=\s)/# }

    /// The thought as one line of plain text: the marks gone and every run of white space one space.
    static func flatten(_ text: String) -> String {
        stripMarkdown(text.replacing(listMarker, with: ""))
            .replacing(#/\s+/#, with: " ")
            .trimmingCharacters(in: .whitespaces)
    }

    /// What a folded thought shows: the heading it opens with, or the whole thought flattened for the row to cut off.
    static func preview(_ text: String) -> String {
        let trimmed = text.drop { $0.isWhitespace }
        let first = trimmed.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
        return flatten(heading(first).map(String.init) ?? text)
    }

    /// What the model is thinking about now: the heading of the last stretch it titled, or the first sentence of a
    /// thought that titles nothing.
    static func line(_ text: String) -> String {
        if let last = text.split(separator: "\n", omittingEmptySubsequences: false).compactMap(heading).last {
            return flatten(String(last))
        }
        let flat = flatten(text)
        guard let end = flat.firstMatch(of: sentenceEnd) else { return flat }
        return String(flat[..<end.range.upperBound])
    }

    private static func heading(_ line: Substring) -> Substring? {
        line.wholeMatch(of: headingLine)?.output.1
    }

    static func stripMarkdown(_ text: String) -> String {
        text
            .replacing(#/(?m)^ *```[^\n]*\n?/#, with: "")
            .replacing(#/(?m)^ *#{1,6} +/#, with: "")
            .replacing(#/(?m)^ *> ?/#, with: "")
            .replacing(#/!\[([^\]]*)\]\([^)]*\)/#) { String($0.output.1) }
            .replacing(#/\[([^\]]*)\]\([^)]*\)/#) { String($0.output.1) }
            .replacing(#/(\*\*|__)(?=\S)([\s\S]*?\S)\1/#) { String($0.output.2) }
            .replacing(#/\*(?=\S)([^*\n]*\S)\*/#) { String($0.output.1) }
            .replacing(#/`+([^`]+)`+/#) { String($0.output.1) }
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
