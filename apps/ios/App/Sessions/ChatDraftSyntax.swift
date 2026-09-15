import Foundation

struct ChatDraftToken: Equatable {
    let range: NSRange
    let value: String
    let kind: String
}

enum ChatDraftSyntax {
    static func matches(_ pattern: String, in text: String) -> [NSTextCheckingResult] {
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
        return expression.matches(in: text, range: NSRange(location: 0, length: (text as NSString).length))
    }

    static func codeRanges(in text: String) -> [NSRange] {
        matches(#"(?m)^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\s*\1\s*$|\z)|(`+)[^`\n]*?\2"#, in: text).map(\.range)
    }

    static func tokens(in text: String, mentions: [String], skills: [String]) -> [ChatDraftToken] {
        let code = codeRanges(in: text)
        let choices = mentions.map { ("@", $0) } + skills.map { ("$", $0) }
        var found: [ChatDraftToken] = []
        for (kind, value) in choices.sorted(by: { $0.1.count > $1.1.count }) where !value.isEmpty {
            let pattern = #"(?<!\S)"# + NSRegularExpression.escapedPattern(for: kind + value) + #"(?=$|\s|[.,;:!?)])"#
            for match in matches(pattern, in: text) {
                guard !code.contains(where: { NSIntersectionRange($0, match.range).length > 0 }),
                    !found.contains(where: { NSIntersectionRange($0.range, match.range).length > 0 })
                else { continue }
                found.append(ChatDraftToken(range: match.range, value: value, kind: kind))
            }
        }
        return found.sorted { $0.range.location < $1.range.location }
    }

    static func insertion(text: String, selection: NSRange, kind: String, value: String) -> (
        text: String, selection: NSRange
    ) {
        let source = text as NSString
        let location = min(max(0, selection.location), source.length)
        let length = min(max(0, selection.length), source.length - location)
        let prefix = source.substring(to: location)
        let needsSpace = prefix.last.map { !$0.isWhitespace } ?? false
        let inserted = (needsSpace ? " " : "") + kind + value + " "
        return (
            source.replacingCharacters(in: NSRange(location: location, length: length), with: inserted),
            NSRange(location: location + (inserted as NSString).length, length: 0)
        )
    }
}
