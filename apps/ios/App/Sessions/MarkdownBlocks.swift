import Foundation

struct MarkdownBlock: Sendable, Equatable {
    enum Kind: Sendable, Equatable {
        case paragraph
        case heading(Int)
        case code(String)
        case quote, list, table, rule
    }
    let kind: Kind
    let text: String
    var rows: [[String]] = []
    var children: [MarkdownBlock] = []
    var marker = ""
    var checked: Bool?

    static func parse(_ markdown: String) -> [MarkdownBlock] {
        let lines = markdown.components(separatedBy: "\n")
        var result: [MarkdownBlock] = []
        var index = 0
        var paragraph: [String] = []
        func flush() {
            if !paragraph.isEmpty {
                result.append(MarkdownBlock(kind: .paragraph, text: paragraph.joined(separator: "\n")))
                paragraph = []
            }
        }
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if MarkdownInline.isReferenceDefinition(line) {
                flush()
            } else if let fence = MarkdownSegments.fence(line) {
                flush()
                let language = String(trimmed.dropFirst(fence.count)).trimmingCharacters(in: .whitespaces)
                index += 1
                var code: [String] = []
                while index < lines.count && !MarkdownSegments.closes(lines[index], fence: fence) {
                    code.append(lines[index])
                    index += 1
                }
                result.append(MarkdownBlock(kind: .code(language), text: code.joined(separator: "\n")))
            } else if line.contains("|"), index + 1 < lines.count, tableDivider(lines[index + 1]) {
                flush()
                var rows = [cells(line)]
                index += 2
                while index < lines.count && lines[index].contains("|") && !lines[index].isEmpty {
                    rows.append(cells(lines[index]))
                    index += 1
                }
                index -= 1
                result.append(MarkdownBlock(kind: .table, text: "", rows: rows))
            } else if trimmed.isEmpty {
                flush()
            } else if trimmed.hasPrefix("#"), let space = trimmed.firstIndex(of: " "),
                trimmed[..<space].allSatisfy({ $0 == "#" }), trimmed.distance(from: trimmed.startIndex, to: space) <= 6
            {
                flush()
                result.append(
                    MarkdownBlock(
                        kind: .heading(trimmed.distance(from: trimmed.startIndex, to: space)),
                        text: String(trimmed[trimmed.index(after: space)...])))
            } else if trimmed.hasPrefix(">") {
                flush()
                var quote: [String] = []
                while index < lines.count {
                    let current = lines[index].trimmingCharacters(in: .whitespaces)
                    guard current.hasPrefix(">") else { break }
                    let content = String(current.dropFirst())
                    quote.append(content.hasPrefix(" ") ? String(content.dropFirst()) : content)
                    index += 1
                }
                index -= 1
                result.append(
                    MarkdownBlock(
                        kind: .quote, text: quote.joined(separator: "\n"),
                        children: parse(quote.joined(separator: "\n"))))
            } else if ["-", "*", "_"].contains(String(trimmed.prefix(1))),
                trimmed.filter({ !$0.isWhitespace }).count >= 3, Set(trimmed.filter { !$0.isWhitespace }).count == 1
            {
                flush()
                result.append(MarkdownBlock(kind: .rule, text: ""))
            } else if let item = listItem(line) {
                flush()
                var content = [item.content]
                index += 1
                while index < lines.count {
                    let next = lines[index]
                    let indentation = next.prefix(while: { $0 == " " || $0 == "\t" }).count
                    if let nextItem = listItem(next), nextItem.indent <= item.indent { break }
                    if !next.trimmingCharacters(in: .whitespaces).isEmpty && indentation <= item.indent { break }
                    if next.isEmpty, index + 1 < lines.count, !lines[index + 1].hasPrefix(" ") { break }
                    content.append(String(next.dropFirst(min(indentation, item.contentIndent))))
                    index += 1
                }
                index -= 1
                result.append(
                    MarkdownBlock(
                        kind: .list, text: item.content, children: parse(content.joined(separator: "\n")),
                        marker: item.marker, checked: item.checked))
            } else {
                paragraph.append(line)
            }
            index += 1
        }
        flush()
        return result
    }

    private static func cells(_ line: String) -> [String] {
        var result: [String] = []
        var cell = ""
        var escaped = false
        var code = false
        for character in line {
            if character == "|" && !escaped && !code {
                result.append(cell.trimmingCharacters(in: .whitespaces))
                cell = ""
            } else {
                cell.append(character)
            }
            if character == "`" && !escaped { code.toggle() }
            escaped = character == "\\" && !escaped
        }
        result.append(cell.trimmingCharacters(in: .whitespaces))
        if result.first == "" { result.removeFirst() }
        if result.last == "" { result.removeLast() }
        return result
    }

    private static func tableDivider(_ line: String) -> Bool {
        let values = cells(line)
        return !values.isEmpty && values.allSatisfy { $0.contains("-") && $0.allSatisfy { "-: ".contains($0) } }
    }

    private static let listPattern = try! NSRegularExpression(
        pattern: #"^([ \t]*)([-+*]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$"#)
    private static func listItem(_ line: String) -> (
        indent: Int, contentIndent: Int, marker: String, content: String, checked: Bool?
    )? {
        let value = line as NSString
        guard let match = listPattern.firstMatch(in: line, range: NSRange(location: 0, length: value.length)) else {
            return nil
        }
        let task = match.range(at: 3)
        return (
            match.range(at: 1).length, match.range(at: 4).location,
            value.substring(with: match.range(at: 2)), value.substring(with: match.range(at: 4)),
            task.location == NSNotFound ? nil : value.substring(with: task).lowercased().contains("x")
        )
    }
}

enum MarkdownSegments {
    static func fence(_ line: String) -> String? {
        guard line.prefix(while: { $0 == " " }).count <= 3 else { return nil }
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard let first = trimmed.first, first == "`" || first == "~" else { return nil }
        let run = String(trimmed.prefix(while: { $0 == first }))
        return run.count >= 3 ? run : nil
    }

    static func closes(_ line: String, fence: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return line.prefix(while: { $0 == " " }).count <= 3 && trimmed.count >= fence.count
            && trimmed.allSatisfy { $0 == fence.first }
    }

    static func split(_ text: String) -> [String] {
        // Reference definitions can change the interpretation of an earlier paragraph.
        if text.range(of: #"(?m)^ {0,3}\[[^\]]+\]:"#, options: .regularExpression) != nil { return [text] }
        let lines = text.components(separatedBy: "\n")
        var chunks: [String] = []
        var current: [String] = []
        var openFence: String?
        for index in lines.indices {
            let line = lines[index]
            if let opened = openFence {
                if closes(line, fence: opened) { openFence = nil }
            } else if let opened = fence(line) {
                openFence = opened
            }
            current.append(line)
            if line.isEmpty, openFence == nil, index + 1 < lines.count {
                let next = lines[index + 1]
                let continues =
                    next.hasPrefix(" ") || next.hasPrefix("\t")
                    || next.range(of: #"^(?:[-+*]|\d+[.)])\s"#, options: .regularExpression) != nil
                if !next.isEmpty && !continues {
                    chunks.append(current.joined(separator: "\n") + "\n")
                    current = []
                }
            }
        }
        if !current.isEmpty { chunks.append(current.joined(separator: "\n")) }
        return chunks
    }

    /// Every chunk but the one still growing. A section title waits for the chunk under it, so it never sits
    /// alone above a chunk that is still streaming.
    static func settled(_ text: String) -> [String] {
        var chunks = Array(split(text).dropLast())
        while let last = chunks.popLast() {
            let kept = withoutTrailingTitles(last)
            if !kept.isEmpty { chunks.append(kept) }
            if kept == last { break }
        }
        return chunks
    }

    static func withoutTrailingTitles(_ chunk: String) -> String {
        let lines = chunk.components(separatedBy: "\n")
        var end = lines.count
        for index in lines.indices.reversed() {
            let line = lines[index]
            if isBlank(line) { continue }
            guard isTitle(line, after: index > 0 ? lines[index - 1] : nil) else { break }
            end = index
        }
        if end == lines.count { return chunk }
        return lines[..<end].map { $0 + "\n" }.joined()
    }

    /// An ATX heading, or a line of only bold text, which models write as a heading too.
    static func isTitle(_ line: String, after previous: String?) -> Bool {
        if line.range(of: #"^ {0,3}#{1,6}(?:[ \t]|$)"#, options: .regularExpression) != nil { return true }
        // A bold line right under a line of text continues that paragraph.
        if let previous, !isBlank(previous) { return false }
        return line.range(of: #"^ {0,3}\*\*(?:[^*]|\*(?!\*))+\*\*:?[ \t]*$"#, options: .regularExpression) != nil
    }

    static func isBlank(_ line: String) -> Bool { line.allSatisfy { $0 == " " || $0 == "\t" } }
}

actor MarkdownBlockCache {
    private var cached: [String: [MarkdownBlock]] = [:]
    func parse(_ text: String) -> [MarkdownBlock] {
        var next: [String: [MarkdownBlock]] = [:]
        var blocks: [MarkdownBlock] = []
        for segment in MarkdownSegments.split(text) {
            let parsed = cached[segment] ?? MarkdownBlock.parse(segment)
            next[segment] = parsed
            blocks += parsed
        }
        cached = next
        return blocks
    }
}

enum MarkdownInline {
    static func isReferenceDefinition(_ line: String) -> Bool {
        line.range(of: #"^ {0,3}\[[^\]]+\]:\s*\S"#, options: .regularExpression) != nil
    }

    static func references(_ text: String) -> String {
        guard text.contains("]:") else { return "" }
        return text.components(separatedBy: "\n").filter(isReferenceDefinition).joined(separator: "\n")
    }

    static func parse(_ text: String, references: String) -> AttributedString {
        let source = references.isEmpty ? text : text + "\n\n" + references
        return
            (try? AttributedString(
                markdown: source,
                options: .init(interpretedSyntax: references.isEmpty ? .inlineOnlyPreservingWhitespace : .full)))
            ?? AttributedString(text)
    }
}
