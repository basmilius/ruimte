import Foundation
import Synchronization

struct ChatDraftToken: Equatable {
    let range: NSRange
    /// The path, the skill's name or, for a `#` reference, its id.
    let value: String
    let kind: String
}

struct ChatDraftQuery: Equatable, Hashable {
    let kind: String
    let text: String
    let range: NSRange
}

enum ChatDraftSyntax {
    private static let expressions = Mutex<[String: NSRegularExpression]>([:])

    /// The punctuation that ends a token, as the shared composer's `TOKEN_END`: "open @a.ts." mentions a.ts.
    private static let tokenEnd = #"[.,;:!?)\]}"'\x{201D}\x{2019}]"#

    static func query(in text: String, selection: NSRange) -> ChatDraftQuery? {
        let source = text as NSString
        guard selection.length == 0, selection.location > 0, selection.location <= source.length else { return nil }
        let prefix = source.substring(to: selection.location)
        guard let match = matches(#"(?:^|\s)([@$/#])([^\s@$]*)$"#, in: prefix).last else { return nil }
        let kind = (prefix as NSString).substring(with: match.range(at: 1))
        let start = match.range(at: 1).location
        if kind == "/" && !source.substring(to: start).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return nil
        }
        let typed = (prefix as NSString).substring(with: match.range(at: 2))
        // A `# ` heading, `#123` and a bare `#` stay text, and so does `#Admin?` once its punctuation closed it.
        if kind == "#"
            && (matches(#"^\p{L}"#, in: typed).isEmpty
                || !matches(tokenEnd + "$", in: typed).isEmpty)
        {
            return nil
        }
        let range = NSRange(location: start, length: selection.location - start)
        guard !codeRanges(in: text).contains(where: { NSIntersectionRange($0, range).length > 0 }) else { return nil }
        let line = prefix.components(separatedBy: "\n").last ?? ""
        if line.filter({ $0 == "`" }).count % 2 != 0 { return nil }
        return ChatDraftQuery(kind: kind, text: typed, range: range)
    }

    static func matches(_ pattern: String, in text: String) -> [NSTextCheckingResult] {
        let expression = expressions.withLock { cached -> NSRegularExpression? in
            if let expression = cached[pattern] { return expression }
            guard let expression = try? NSRegularExpression(pattern: pattern) else { return nil }
            // Picked names create patterns too, so the cache must not retain every name used in a session.
            if cached.count >= 128 { cached.removeAll(keepingCapacity: true) }
            cached[pattern] = expression
            return expression
        }
        guard let expression else { return [] }
        return expression.matches(in: text, range: NSRange(location: 0, length: (text as NSString).length))
    }

    static func codeRanges(in text: String) -> [NSRange] {
        matches(#"(?m)^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\s*\1\s*$|\z)|(`+)[^`\n]*?\2"#, in: text).map(\.range)
    }

    /// Whether the character at `index` closes a token: the end of the text, whitespace or closing punctuation.
    static func endsToken(at index: Int, in source: NSString) -> Bool {
        guard index < source.length else { return true }
        return !matches(
            #"^(?:\s|"# + tokenEnd + ")$", in: source.substring(with: NSRange(location: index, length: 1))
        ).isEmpty
    }

    /// Where the picked files, skills and references sit in the text, longest first when one prefixes another. A
    /// reference is spelled by the name it was picked with and carries its id.
    static func tokens(
        in text: String, mentions: [String], skills: [String], references: [ChatDraftReference] = []
    ) -> [ChatDraftToken] {
        guard !mentions.isEmpty || !skills.isEmpty || !references.isEmpty else { return [] }
        let code = codeRanges(in: text)
        let choices =
            mentions.map { ("@", $0, $0) } + skills.map { ("$", $0, $0) } + references.map { ("#", $0.title, $0.id) }
        var found: [ChatDraftToken] = []
        for (kind, spelled, value) in choices.sorted(by: { $0.1.count > $1.1.count }) where !spelled.isEmpty {
            let pattern =
                #"(?<!\S)"# + NSRegularExpression.escapedPattern(for: kind + spelled) + #"(?=$|\s|"# + tokenEnd + ")"
            for match in matches(pattern, in: text) {
                guard !code.contains(where: { NSIntersectionRange($0, match.range).length > 0 }),
                    !found.contains(where: { NSIntersectionRange($0.range, match.range).length > 0 })
                else { continue }
                found.append(ChatDraftToken(range: match.range, value: value, kind: kind))
            }
        }
        return found.sorted { $0.range.location < $1.range.location }
    }

    /// The ids among `references` whose `#name` still stands in the text, in text order and once each.
    static func presentReferences(in text: String, references: [ChatDraftReference]) -> [String] {
        var seen = Set<String>()
        return tokens(in: text, mentions: [], skills: [], references: references).map(\.value).filter {
            seen.insert($0).inserted
        }
    }

    /// `text` with a `#name` in front for each picked reference it no longer spells, so a chat attached beside the
    /// text before `#` existed stays attached.
    static func spelling(_ references: [ChatDraftReference], in text: String) -> String {
        let present = Set(presentReferences(in: text, references: references))
        let missing = references.filter { !present.contains($0.id) && !$0.title.isEmpty }
        guard !missing.isEmpty else { return text }
        let lead = missing.map { "#" + $0.title }.joined(separator: " ")
        return text.isEmpty ? lead + " " : lead + " " + text
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
