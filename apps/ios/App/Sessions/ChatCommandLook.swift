import Foundation
import RuimtePulsar

/// A word of a shell line, as offsets in Unicode scalars into the line.
struct ChatShellWord: Equatable {
    let start: Int
    let end: Int
    /// The word as the shell hands it to the program, quotes and escapes taken out.
    let text: String
    /// The source of what the program gets, for a word that is bare or one quoted string; nil for a mix.
    let body: Range<Int>?
}

/// One simple command of a shell line, as a shell would split it.
struct ChatShellCommand: Equatable {
    var words: [ChatShellWord] = []
    /// The index of the word it runs, past assignments, wrappers and runners; nil for a command of assignments only.
    var program: Int?
    var heredoc = false
    /// The lines of its one heredoc; nil without one, with more, or with one the shell fills in.
    var heredocText: String?

    var programName: String? {
        program.map {
            words[$0].text.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        }
    }
}

/// The simple commands of a shell line, as `shellCommands` in the desktop's `chat/logic/embedded-code.ts` splits
/// them: enough to tell which programs a line runs, not a parser.
enum ChatShell {
    // Programs that run the next word as the command; their own options are skipped along with them.
    private static let wrappers: Set<String> = ["sudo", "env", "exec", "nohup", "time", "command", "nice"]
    // Tools that run a program of a project's environment as `<tool> run <program>`.
    private static let runners: Set<String> = ["uv", "poetry", "pipenv"]

    static func commands(_ line: String) -> [ChatShellCommand] { commands(Array(line.unicodeScalars)) }

    static func commands(_ source: [Unicode.Scalar]) -> [ChatShellCommand] {
        var parser = ChatShellParser(source)
        return parser.parse().map { command in
            var command = command
            command.program = programIndex(command.words)
            return command
        }
    }

    private static func programIndex(_ words: [ChatShellWord]) -> Int? {
        var index = 0
        while index < words.count {
            let text = words[index].text
            let program = String(text.split(separator: "/", omittingEmptySubsequences: false).last ?? "")
            if text.firstMatch(of: /^[A-Za-z_][A-Za-z0-9_]*=/) != nil {
                index += 1
            } else if wrappers.contains(program) {
                index += 1
                while index < words.count && words[index].text.hasPrefix("-") { index += 1 }
            } else if runners.contains(program) && index + 1 < words.count && words[index + 1].text == "run" {
                index += 2
            } else {
                return index
            }
        }
        return nil
    }
}

private struct ChatShellParser {
    private static let separators: Set<Unicode.Scalar> = [";", "&", "|", "(", ")"]
    private static let blanks: Set<Unicode.Scalar> = [" ", "\t", "\r"]
    private static let redirectOperators: Set<Unicode.Scalar> = ["<", ">", "&", "|"]
    private static let escapedInQuotes: Set<Unicode.Scalar> = ["$", "`", "\"", "\\", "\n"]

    private let source: [Unicode.Scalar]
    private var commands: [ChatShellCommand] = []
    // Parallel to `commands`, so a heredoc read after its command ended still finds it.
    private var serials: [Int] = []
    private var current = ChatShellCommand()
    private var serial = 0
    private var redirects = 0
    private var pending: [(serial: Int, delimiter: String, strip: Bool, literal: Bool)] = []

    init(_ source: [Unicode.Scalar]) {
        self.source = source
    }

    mutating func parse() -> [ChatShellCommand] {
        let end = source.count
        var index = 0
        while index < end {
            let char = source[index]
            if char == "\n" {
                index += 1
                for heredoc in pending {
                    let (bodyEnd, next) = heredocEnd(from: index, delimiter: heredoc.delimiter, strip: heredoc.strip)
                    let body = String(String.UnicodeScalarView(source[index..<bodyEnd]))
                    let filled = !heredoc.literal && body.contains { "$`\\".contains($0) }
                    markHeredoc(heredoc.serial, text: filled ? nil : body)
                    index = next
                }
                pending.removeAll()
                finish()
            } else if Self.blanks.contains(char) {
                index += 1
            } else if char == "\\" && scalar(at: index + 1) == "\n" {
                index += 2
            } else if char == "#" {
                index = source[index...].firstIndex(of: "\n") ?? end
            } else if starts("<<<", at: index) {
                index = word(from: skipBlanks(index + 3)).end
            } else if starts("<<", at: index) {
                let strip = scalar(at: index + 2) == "-"
                let delimiter = word(from: skipBlanks(index + (strip ? 3 : 2)))
                if !delimiter.text.isEmpty {
                    let quoted = source[delimiter.start..<delimiter.end].contains { $0 == "'" || $0 == "\"" || $0 == "\\" }
                    pending.append((serial, delimiter.text, strip, quoted))
                }
                index = delimiter.end
            } else if char == "<" || char == ">" || (char == "&" && scalar(at: index + 1) == ">") {
                var operatorEnd = index + 1
                while operatorEnd < end && Self.redirectOperators.contains(source[operatorEnd]) { operatorEnd += 1 }
                let target = word(from: skipBlanks(operatorEnd))
                redirects += 1
                index = max(target.end, operatorEnd)
            } else if Self.separators.contains(char) {
                index += 1
                finish()
            } else {
                let word = word(from: index)
                // The `2` of `2>&1` is a file descriptor, not an argument.
                let next = scalar(at: word.end)
                let descriptor =
                    !word.text.isEmpty && word.text.allSatisfy { ("0"..."9").contains($0) }
                    && (next == ">" || next == "<")
                if !descriptor {
                    current.words.append(word)
                }
                index = max(word.end, index + 1)
            }
        }
        finish()
        return commands
    }

    private func scalar(at index: Int) -> Unicode.Scalar? {
        index >= 0 && index < source.count ? source[index] : nil
    }

    private func starts(_ text: String, at index: Int) -> Bool {
        let scalars = Array(text.unicodeScalars)
        return index + scalars.count <= source.count && Array(source[index..<index + scalars.count]) == scalars
    }

    private func skipBlanks(_ start: Int) -> Int {
        var index = start
        while index < source.count && Self.blanks.contains(source[index]) { index += 1 }
        return index
    }

    private mutating func finish() {
        if !current.words.isEmpty || redirects > 0 {
            commands.append(current)
            serials.append(serial)
        }
        current = ChatShellCommand()
        serial += 1
        redirects = 0
    }

    private mutating func markHeredoc(_ owner: Int, text: String?) {
        if owner == serial {
            current.heredocText = current.heredoc ? nil : text
            current.heredoc = true
        } else if let index = serials.firstIndex(of: owner) {
            commands[index].heredocText = commands[index].heredoc ? nil : text
            commands[index].heredoc = true
        }
    }

    /// Where the lines of a heredoc end, and where the line after its delimiter starts.
    private func heredocEnd(from start: Int, delimiter: String, strip: Bool) -> (body: Int, next: Int) {
        var index = start
        while index < source.count {
            let lineEnd = source[index...].firstIndex(of: "\n") ?? source.count
            var line = Substring(String(String.UnicodeScalarView(source[index..<lineEnd])))
            if line.hasSuffix("\r") { line = line.dropLast() }
            if strip { line = line.drop { $0 == "\t" } }
            if line == delimiter {
                return (index, min(lineEnd + 1, source.count))
            }
            index = lineEnd + 1
        }
        return (source.count, source.count)
    }

    private func word(from start: Int) -> ChatShellWord {
        let end = source.count
        var index = start
        var text = String.UnicodeScalarView()
        var quoted: Range<Int>?
        var parts = 0
        var bare = true
        while index < end {
            let char = source[index]
            if Self.blanks.contains(char) || char == "\n" || Self.separators.contains(char) || char == "<"
                || char == ">"
            {
                break
            }
            parts += 1
            if char == "'" {
                let close = source[(index + 1)...].firstIndex(of: "'") ?? end
                text.append(contentsOf: source[(index + 1)..<close])
                quoted = (index + 1)..<close
                bare = false
                index = min(close + 1, end)
            } else if char == "\"" {
                var close = index + 1
                while close < end && source[close] != "\"" {
                    if source[close] == "\\", close + 1 < end, Self.escapedInQuotes.contains(source[close + 1]) {
                        text.append(source[close + 1])
                        close += 2
                    } else {
                        text.append(source[close])
                        close += 1
                    }
                }
                quoted = (index + 1)..<close
                bare = false
                index = min(close + 1, end)
            } else if char == "\\" {
                if let escaped = scalar(at: index + 1) { text.append(escaped) }
                bare = false
                index += 2
            } else if char == "$" && scalar(at: index + 1) == "(" {
                let close = closingParen(index + 1)
                text.append(contentsOf: source[index..<close])
                index = close
            } else {
                text.append(char)
                index += 1
            }
        }
        let wordEnd = min(index, end)
        let body = bare ? start..<wordEnd : parts == 1 ? quoted : nil
        return ChatShellWord(start: start, end: wordEnd, text: String(text), body: body)
    }

    /// Where the `)` that closes the `(` at `open` is, past it; quotes inside do not count.
    private func closingParen(_ open: Int) -> Int {
        var depth = 0
        var quote: Unicode.Scalar?
        var index = open
        while index < source.count {
            let char = source[index]
            if let closing = quote {
                if char == closing {
                    quote = nil
                } else if char == "\\" && closing == "\"" {
                    index += 1
                }
            } else if char == "'" || char == "\"" {
                quote = char
            } else if char == "(" {
                depth += 1
            } else if char == ")" {
                depth -= 1
                if depth == 0 { return index + 1 }
            }
            index += 1
        }
        return source.count
    }
}

/// A `ruimte-context` call as a tool of Ruimte's own: the first one of a shell line, as the desktop's
/// `chat/ruimte-command-look.ts` reads it.
struct RuimteCommandRun: Equatable {
    /// The name of the part of Ruimte the verb works on; empty for a verb this app does not know.
    let label: String
    /// What a run of calls is counted by; nil for a verb this app does not know.
    let groupKey: String?
    /// The call from the word that says what it does, without redirects and with long values cut.
    let detail: String
    /// The words of the detail that are no option.
    let words: [Word]
    /// The programs of the other commands in the line, each once, in the order they run.
    let others: [String]
    /// How many more `ruimte-context` calls the line makes.
    let more: Int
    let heredoc: Bool
    /// The words after the program, quotes taken out.
    var args: [String] = []
    /// The lines of its one heredoc, when the shell leaves them alone.
    var heredocText: String?
    /// Whether the shell fills in a part of a word, so its text here is not what the program gets.
    var expands = false

    struct Word: Equatable {
        /// Offsets in Unicode scalars into the detail.
        let range: Range<Int>
        /// The word as the program gets it, quotes taken out.
        let text: String
        /// The option right before it, whose value it may be.
        let option: String?
    }
}

/// What a view or node of the project is called now, by its id.
struct ChatCommandName: Equatable {
    let name: String
    let icon: String
    let view: Bool
}

enum ChatCommandDetailPart: Equatable {
    case text(String)
    case name(ChatCommandName, word: String)
}

/// A message this chat's agent sent another node, read from its call.
struct ChatAgentSent: Equatable {
    enum State: Equatable {
        case sending, delivered, waiting, failed
    }

    let to: String
    /// What the node was called when the message went, or where it is when that is not known.
    let title: String?
    /// The project it went to, when that is not this one.
    let hint: String?
    let text: String
    let state: State
    let reason: String?
}

enum RuimteCommandLook {
    static let program = "ruimte-context"
    static let brand = "Ruimte"

    private struct VerbLook {
        let name: String
        /// The word the detail starts at, the verb itself being 0.
        let from: Int
    }

    // Names of parts of Ruimte, so they stay English in Dutch too; a sentence around one is translated.
    private static let verbs: [String: VerbLook] = [
        "help": VerbLook(name: "Help", from: 1),
        "list": VerbLook(name: "Context", from: 0),
        "read": VerbLook(name: "Context", from: 0),
        "done": VerbLook(name: "Task", from: 0),
        "notify": VerbLook(name: "Message", from: 0),
        "alert": VerbLook(name: "Notification", from: 1),
        "answer": VerbLook(name: "Message", from: 0),
        "agent": VerbLook(name: "Agent", from: 1),
        "team": VerbLook(name: "Team", from: 1),
        "fork": VerbLook(name: "Agent", from: 0),
        "flag": VerbLook(name: "Flag", from: 1),
        "node": VerbLook(name: "Canvas", from: 0),
        "link": VerbLook(name: "Canvas", from: 0),
        "browser": VerbLook(name: "Browser", from: 1),
        "device": VerbLook(name: "Device", from: 1),
        "view": VerbLook(name: "View", from: 1),
        "task": VerbLook(name: "Task", from: 1),
        "plan": VerbLook(name: "Plan", from: 1),
        "visual": VerbLook(name: "Visual", from: 1),
        "chat": VerbLook(name: "Chat", from: 1),
        "ui": VerbLook(name: "Help", from: 0),
        "worktree": VerbLook(name: "Worktree", from: 1),
        "operation": VerbLook(name: "Task", from: 1),
        "launches": VerbLook(name: "Launches", from: 1),
        "secret": VerbLook(name: "Launches", from: 1),
        "project": VerbLook(name: "Project", from: 1),
        "database": VerbLook(name: "Database", from: 1),
        "language": VerbLook(name: "Language", from: 1),
        "provider": VerbLook(name: "Providers", from: 1),
        "computer": VerbLook(name: "Computer Use", from: 1),
    ]

    private static let noVerb = VerbLook(name: "Context", from: 0)
    // Long values an agent writes into a call, cut so the options after them stay in the line.
    private static let folded: Set<String> = ["--prompt", "--text", "--result", "--roles", "--answers"]
    private static let foldLength = 40
    // Past this the desktop draws a command without looking inside it.
    private static let lengthLimit = 20_000

    static func run(of tool: ChatToolItem) -> RuimteCommandRun? {
        guard tool.name == "Bash", let command = tool.input["command"]?.stringValue else { return nil }
        return match(command)
    }

    /// The first `ruimte-context` call of a shell line; only where the shell runs it, so `grep ruimte-context` is none.
    static func match(_ line: String) -> RuimteCommandRun? {
        guard line.contains(program), line.utf16.count <= lengthLimit else { return nil }
        let source = Array(line.unicodeScalars)
        var found: ChatShellCommand?
        var more = 0
        var others: [String] = []
        for command in ChatShell.commands(source) {
            guard let name = command.programName else { continue }
            if name != program {
                if !others.contains(name) { others.append(name) }
            } else if found == nil {
                found = command
            } else {
                more += 1
            }
        }
        guard let found, let index = found.program else { return nil }
        let verb = found.words.count > index + 1 ? found.words[index + 1].text : nil
        let look: VerbLook? = if let verb { verbs[verb] } else { noVerb }
        let (detail, words) = detailOf(source, found, from: index + 1 + (look?.from ?? 0))
        return RuimteCommandRun(
            label: look?.name ?? "", groupKey: look?.name, detail: detail, words: words, others: others, more: more,
            heredoc: found.heredoc, args: found.words.dropFirst(index + 1).map(\.text),
            heredocText: found.heredocText,
            expands: found.words.contains { expandsInShell(source[$0.start..<$0.end]) })
    }

    /// Whether the shell would fill in a part of this source: a `$` or backtick outside single quotes and not escaped.
    private static func expandsInShell(_ source: ArraySlice<Unicode.Scalar>) -> Bool {
        var single = false
        var double = false
        var escaped = false
        for char in source {
            if single {
                single = char != "'"
            } else if escaped {
                escaped = false
            } else if char == "\\" {
                escaped = true
            } else if char == "$" || char == "`" {
                return true
            } else if char == "'" && !double {
                single = true
            } else if char == "\"" {
                double.toggle()
            }
        }
        return false
    }

    /// The message a `notify` call sent, as `sentByNotify` on the desktop reads it, for a line that holds only that
    /// call and nothing the shell fills in; nil leaves it a tool line.
    static func sent(of tool: ChatToolItem) -> ChatAgentSent? {
        guard let run = run(of: tool), run.args.first == "notify", run.others.isEmpty, run.more == 0, !run.expands,
            let words = notifyWords(run.args),
            let text = words.text == "-" ? run.heredocText : unescape(words.text), !text.isEmpty,
            let outcome = notifyOutcome(tool)
        else { return nil }
        let elsewhere = words.project != nil ? String(localized: "In another project") : nil
        return ChatAgentSent(
            to: words.id, title: outcome.title ?? elsewhere, hint: words.project, text: text, state: outcome.state,
            reason: outcome.reason)
    }

    private static func notifyWords(_ args: [String]) -> (id: String, text: String, project: String?)? {
        var ids: [String] = []
        var flags: [String: String] = [:]
        var index = 1
        while index < args.count {
            let word = args[index]
            index += 1
            guard word.hasPrefix("--") else {
                ids.append(word)
                continue
            }
            let parts = word.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
            let name = parts[0]
            var value = parts.count > 1 ? parts[1] : nil
            if value == nil, index < args.count {
                value = args[index]
                index += 1
            }
            guard name == "--text" || name == "--project", flags[name] == nil, let value else { return nil }
            flags[name] = value
        }
        guard ids.count == 1, let text = flags["--text"] else { return nil }
        return (ids[0], text, flags["--project"])
    }

    private static func notifyOutcome(_ tool: ChatToolItem) -> (state: ChatAgentSent.State, title: String?, reason: String?)? {
        let lines = (tool.output ?? "").components(separatedBy: "\n")
        // A CLI may put its own line above what a failed command wrote, so a refusal is looked for in all of them.
        let refused = lines.first { $0.hasPrefix("refused\t") }
        if refused != nil || tool.state == .error {
            let code = refused?.components(separatedBy: "\t").dropFirst().first
            return (.failed, nil, code.flatMap(refusal))
        }
        if tool.state == .running { return (.sending, nil, nil) }
        let fields = lines[0].components(separatedBy: "\t")
        guard fields.count >= 3, fields[0] == "notified", fields[2] == "now" || fields[2] == "waiting" else { return nil }
        let title = fields.count > 4 && !fields[4].isEmpty ? fields[4] : nil
        return (fields[2] == "now" ? .delivered : .waiting, title, nil)
    }

    private static func refusal(_ code: String) -> String? {
        switch code {
        case "self-notify": String(localized: "That is this chat itself")
        case "not-an-agent": String(localized: "That runs no agent")
        case "unknown-node": String(localized: "No such terminal or chat")
        case "node-on-other-machine": String(localized: "That is on another machine")
        default: nil
        }
    }

    /// `\\n`, `\\t` and `\\\\` as the machine reads them (`unescapeText`); any other backslash stays.
    private static func unescape(_ value: String) -> String {
        var result = String.UnicodeScalarView()
        var scalars = value.unicodeScalars.makeIterator()
        var next = scalars.next()
        while let char = next {
            next = scalars.next()
            guard char == "\\", let escaped = next, escaped == "n" || escaped == "t" || escaped == "\\" else {
                result.append(char)
                continue
            }
            result.append(escaped == "n" ? "\n" : escaped == "t" ? "\t" : "\\")
            next = scalars.next()
        }
        return String(result)
    }

    /// The words of a command from `first` on with their spacing, a redirect between them a single space.
    private static func detailOf(_ source: [Unicode.Scalar], _ command: ChatShellCommand, from first: Int) -> (
        String, [RuimteCommandRun.Word]
    ) {
        var detail: [Unicode.Scalar] = []
        var words: [RuimteCommandRun.Word] = []
        var previous: ChatShellWord?
        var option: String?
        for word in command.words.dropFirst(first) {
            if let previous {
                let gap = source[previous.end..<word.start]
                detail += gap.allSatisfy { $0 == " " || $0 == "\t" } ? Array(gap) : [" "]
            }
            let start = detail.count
            detail += foldedWord(source, word, fold: option.map(folded.contains) ?? false)
            let isOption = word.text.hasPrefix("-") && word.text != "-"
            if !isOption {
                words.append(RuimteCommandRun.Word(range: start..<detail.count, text: word.text, option: option))
            }
            option = isOption ? word.text : nil
            previous = word
        }
        return (String(String.UnicodeScalarView(detail)), words)
    }

    private static func foldedWord(_ source: [Unicode.Scalar], _ word: ChatShellWord, fold: Bool) -> [Unicode.Scalar] {
        let text = Array(source[word.start..<word.end])
        guard fold else { return text }
        if let body = word.body.map({ ($0.lowerBound - word.start)..<($0.upperBound - word.start) }) {
            guard body.count > foldLength else { return text }
            let cut = body.lowerBound + foldLength
            return Array(text[..<cut]) + ["…"] + Array(text[body.upperBound...])
        }
        return text.count > foldLength ? Array(text[..<foldLength]) + ["…"] : text
    }

    /// "Ruimte" and the part the call works on, the brand in bold.
    static func title(_ run: RuimteCommandRun) -> AttributedString {
        emphasizingBrand(run.label.isEmpty ? brand : "\(brand) \(run.label)")
    }

    /// What else the line ran, as quiet tags: the other programs and a heredoc, and how many more calls it made.
    static func tags(_ run: RuimteCommandRun) -> [String] {
        let also = run.heredoc ? run.others + [String(localized: "heredoc", comment: "A shell heredoc")] : run.others
        var tags: [String] = []
        if !also.isEmpty { tags.append("+ \(also.joined(separator: ", "))") }
        if run.more > 0 { tags.append("+\(run.more)") }
        return tags
    }

    static func emphasizingBrand(_ text: String) -> AttributedString {
        var attributed = AttributedString(text)
        if let range = attributed.range(of: brand) {
            attributed[range].inlinePresentationIntent = .stronglyEmphasized
        }
        return attributed
    }

    /// Every view and node of a project by id, under the title it has now.
    static func projectNames(_ views: [JSONValue]) -> [String: ChatCommandName] {
        var names: [String: ChatCommandName] = [:]
        for view in views {
            names[view.stableID] = ChatCommandName(
                name: view.text("name"), icon: WorkspaceViewIcon.name(for: view), view: true)
            for node in view.list("nodes") {
                let kind = JSONValue.object(["kind": .string(node.text("kind"))])
                names[node.stableID] = ChatCommandName(
                    name: node.text("title"), icon: WorkspaceViewIcon.name(for: kind), view: false)
            }
        }
        return names
    }

    /// The name a word of the detail reads as; a view id such as `main` is only taken for one after `--view`.
    static func name(of word: RuimteCommandRun.Word, in names: [String: ChatCommandName]) -> ChatCommandName? {
        guard let named = names[word.text], !named.name.isEmpty,
            word.text.wholeMatch(of: /[a-z]+-[a-z0-9]+/) != nil || (named.view && word.option == "--view")
        else { return nil }
        return named
    }

    /// The detail cut where its words read as the names of views and nodes; an id nobody knows stays as it is.
    static func detailParts(_ run: RuimteCommandRun, names: [String: ChatCommandName]) -> [ChatCommandDetailPart] {
        let scalars = Array(run.detail.unicodeScalars)
        let text = { (range: Range<Int>) in String(String.UnicodeScalarView(scalars[range])) }
        var parts: [ChatCommandDetailPart] = []
        var at = 0
        for word in run.words {
            guard let named = name(of: word, in: names) else { continue }
            if word.range.lowerBound > at { parts.append(.text(text(at..<word.range.lowerBound))) }
            parts.append(.name(named, word: word.text))
            at = word.range.upperBound
        }
        if at < scalars.count { parts.append(.text(text(at..<scalars.count))) }
        return parts
    }
}
