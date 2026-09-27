import Foundation

struct ChatDraftToken: Equatable {
    let range: NSRange
    let value: String
    let kind: String
}

struct ChatDraftQuery: Equatable, Hashable {
    let kind: String
    let text: String
    let range: NSRange
}

enum ChatDraftSyntax {
    static func query(in text: String, selection: NSRange) -> ChatDraftQuery? {
        let source = text as NSString
        guard selection.length == 0, selection.location > 0, selection.location <= source.length else { return nil }
        let prefix = source.substring(to: selection.location)
        guard let match = matches(#"(?:^|\s)([@$/])([^\s@$]*)$"#, in: prefix).last else { return nil }
        let kind = (prefix as NSString).substring(with: match.range(at: 1))
        let start = match.range(at: 1).location
        if kind == "/" && !source.substring(to: start).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return nil
        }
        let range = NSRange(location: start, length: selection.location - start)
        guard !codeRanges(in: text).contains(where: { NSIntersectionRange($0, range).length > 0 }) else { return nil }
        let line = prefix.components(separatedBy: "\n").last ?? ""
        if line.filter({ $0 == "`" }).count % 2 != 0 { return nil }
        return ChatDraftQuery(kind: kind, text: (prefix as NSString).substring(with: match.range(at: 2)), range: range)
    }

    static func matches(_ pattern: String, in text: String) -> [NSTextCheckingResult] {
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
        return expression.matches(in: text, range: NSRange(location: 0, length: (text as NSString).length))
    }

    static func codeRanges(in text: String) -> [NSRange] {
        matches(#"(?m)^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\s*\1\s*$|\z)|(`+)[^`\n]*?\2"#, in: text).map(\.range)
    }

    static func tokens(in text: String, mentions: [String], skills: [String]) -> [ChatDraftToken] {
        guard !mentions.isEmpty || !skills.isEmpty else { return [] }
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
        let replacing = query(in: text, selection: selection).flatMap { $0.kind == kind ? $0.range : nil } ?? selection
        let location = min(max(0, replacing.location), source.length)
        let length = min(max(0, replacing.length), source.length - location)
        let prefix = source.substring(to: location)
        let needsSpace = prefix.last.map { !$0.isWhitespace } ?? false
        let inserted = (needsSpace ? " " : "") + kind + value + " "
        return (
            source.replacingCharacters(in: NSRange(location: location, length: length), with: inserted),
            NSRange(location: location + (inserted as NSString).length, length: 0)
        )
    }
}
