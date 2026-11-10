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

/// The simple commands of a shell line, as `shellCommands` in `chat/logic/embedded-code.ts` of `@adecore/agents-react`
/// splits them: enough to tell which programs a line runs, not a parser.
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
    /// The call of the machine's MCP server this run is; nil for a `ruimte-context` call.
    var mcp: ChatMcpCall?

    struct Word: Equatable {
        /// Offsets in Unicode scalars into the detail.
        let range: Range<Int>
        /// The word as the program gets it, quotes taken out.
        let text: String
        /// The option right before it, whose value it may be.
        let option: String?
    }
}

/// A call of a tool on an MCP server, the same whichever CLI made it, as `mcpCallOf` in `@adecore/agents-react`
/// reads it.
struct ChatMcpCall: Equatable {
    let server: String
    /// The tool's name on its server, without the server.
    let tool: String
    let input: [String: JSONValue]
    /// What the tool answered, out of any envelope the CLI wraps it in.
    let output: String?

    // An ACP agent titles a call of an MCP tool with the server and the tool, each agent with a separator of its own.
    private static let titleSeparators = ["__", "_", "-"]
    // The name an ACP call of kind `other` gets, which is all a call of an MCP tool is where its agent marks none.
    private static let acpToolRow = "Tool"

    private typealias Found = (server: String, tool: String, input: [String: JSONValue])

    /// The call of a tool on one of `servers` that `item` is, as `mcpCallOf` in ADE CORE reads it: `mcp__<server>__<tool>`
    /// (Claude Code, the API and an ACP agent that marks its server), `<server>/<tool>` (Codex), or an ACP call titled
    /// with the server and the tool (Grok's `use_tool`, Copilot, and calls of agents from before they were marked). A
    /// name that says which server is read before any title, over every server, the longest name first.
    static func of(_ item: ChatToolItem, servers: [String]) -> ChatMcpCall? {
        let input = item.input.objectValue ?? [:]
        let longestFirst = servers.sorted { $0.count > $1.count }
        let found: Found?
        if let named = namedCall(item.name, input: input, servers: longestFirst) {
            found = named
        } else {
            found = titledCall(item.name, input: input, servers: longestFirst)
        }
        guard let found else { return nil }
        return ChatMcpCall(server: found.server, tool: found.tool, input: found.input, output: unwrapped(item.output))
    }

    /// The call as its name says it, whatever its input holds. `.some(nil)` where the name names a server that is not
    /// in `servers`, which no title overrules; nil where the name says nothing of a server.
    private static func namedCall(_ name: String, input: [String: JSONValue], servers: [String]) -> Found?? {
        if name.hasPrefix("mcp__") {
            let named = toolOn(String(name.dropFirst(5)), servers: servers, separators: ["__"])
            return .some(named.map { ($0.server, $0.tool, input) })
        }
        if name.contains("/") {
            return .some(toolOn(name, servers: servers, separators: ["/"]).map { ($0.server, $0.tool, input) })
        }
        guard name == acpToolRow, let used = input["tool_name"]?.stringValue else { return nil }
        // Grok runs every MCP tool through its `use_tool`, which names the tool in its input.
        let named = toolOn(used, servers: servers, separators: ["__"])
        return .some(named.map { ($0.server, $0.tool, input["tool_input"]?.objectValue ?? [:]) })
    }

    /// The call as an ACP agent that marks no server titles it: a call of kind `other`, or a `Read` Copilot makes of a
    /// tool that only reads. A `Read` of a file is no MCP call.
    private static func titledCall(_ name: String, input: [String: JSONValue], servers: [String]) -> Found? {
        let titledRow = name == acpToolRow || (name == "Read" && input["file_path"] == nil)
        guard titledRow, let title = input["description"]?.stringValue,
            let titled = toolOn(title, servers: servers, separators: titleSeparators)
        else { return nil }
        // Antigravity hands the arguments over as `arguments`, Copilot beside the title.
        return (titled.server, titled.tool, input["arguments"]?.objectValue ?? input.filter { $0.key != "description" })
    }

    /// The server and the tool `text` names as `<server><separator><tool>`, on the first of `servers` it starts with.
    private static func toolOn(
        _ text: String, servers: [String], separators: [String]
    ) -> (server: String, tool: String)? {
        for server in servers {
            for separator in separators {
                let prefix = "\(server)\(separator)"
                guard text.hasPrefix(prefix) else { continue }
                let tool = String(text.dropFirst(prefix.count))
                if tool.wholeMatch(of: /[A-Za-z0-9][A-Za-z0-9_-]*/) != nil {
                    return (server, tool)
                }
            }
        }
        return nil
    }

    /// A tool's answer out of the envelope Grok puts around an MCP answer,
    /// `{"type":"MCP",...,"output":{"OkayOutput":"..."}}`, whatever the order of its keys.
    private static func unwrapped(_ output: String?) -> String? {
        guard let output, output.drop(while: \.isWhitespace).hasPrefix("{"),
            let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(output.utf8)),
            parsed["type"]?.stringValue == "MCP",
            let inner = parsed["output"]?.objectValue, inner.count == 1, let text = inner.values.first?.stringValue
        else { return output }
        return text
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
        "artifact": VerbLook(name: "Output", from: 1),
        "chat": VerbLook(name: "Chat", from: 1),
        "ui": VerbLook(name: "Help", from: 0),
        "worktree": VerbLook(name: "Worktree", from: 1),
        "operation": VerbLook(name: "Task", from: 1),
        "tool": VerbLook(name: "Using an extension tool", from: 2),
        "launches": VerbLook(name: "Launches", from: 1),
        "routine": VerbLook(name: "Routines", from: 1),
        "secret": VerbLook(name: "Launches", from: 1),
        "project": VerbLook(name: "Project", from: 1),
        "database": VerbLook(name: "Database", from: 1),
        "language": VerbLook(name: "Language", from: 1),
        "template": VerbLook(name: "Templates", from: 1),
        "provider": VerbLook(name: "Providers", from: 1),
        "computer": VerbLook(name: "Computer Use", from: 1),
    ]

    /// The machine's MCP server, whose tools read as the `ruimte-context` calls they were.
    static let server = "ruimte"
    // The tools whose part of Ruimte is not their first word, by the verb they were.
    private static let toolVerbs: [String: String] = [
        "context_list": "list", "context_read": "read", "task_done": "done", "agent_answer": "answer",
        "agent_team": "team", "agent_fork": "fork", "guide": "help",
    ]
    private static let toolkitVerbs: [String: String] = ["launch": "launches"]
    private static let viewOptions: Set<String> = ["--view", "view", "view_id"]

    private static let noVerb = VerbLook(name: "Context", from: 0)
    // Long values an agent writes into a call, cut so the options after them stay in the line.
    private static let folded: Set<String> = ["--prompt", "--text", "--result", "--roles", "--answers"]
    private static let foldLength = 40
    // Past this the desktop draws a command without looking inside it.
    private static let lengthLimit = 20_000

    static func run(of tool: ChatToolItem) -> RuimteCommandRun? {
        if tool.name == "Bash" {
            return tool.input["command"]?.stringValue.flatMap(match)
        }
        return ChatMcpCall.of(tool, servers: [server]).flatMap(toolRun)
    }

    /// A tool of the machine's MCP server, as `describeTool` on the desktop reads it: the part of Ruimte and its
    /// words from where the call's verb would have started the detail, then its fields as `field=value`. The fields
    /// come in the order of their names, since the input reaches the phone without the order the agent wrote.
    static func toolRun(_ call: ChatMcpCall) -> RuimteCommandRun? {
        let parts = call.tool.split(separator: "_").map(String.init)
        guard let toolkit = parts.first else { return nil }
        let verb = toolVerbs[call.tool] ?? toolkitVerbs[toolkit] ?? toolkit
        guard let look = verbs[verb] else { return nil }
        let (detail, words) = fieldsDetail(lead: parts.dropFirst(look.from).joined(separator: " "), call.input)
        return RuimteCommandRun(
            label: look.name, groupKey: look.name, detail: detail, words: words, others: [], more: 0, heredoc: false,
            mcp: call)
    }

    private static func fieldsDetail(lead: String, _ input: [String: JSONValue]) -> (String, [RuimteCommandRun.Word]) {
        var detail = Array(lead.unicodeScalars)
        var words: [RuimteCommandRun.Word] = []
        for field in input.keys.sorted() {
            guard let value = input[field], value != .null else { continue }
            if !detail.isEmpty { detail.append(" ") }
            detail += Array("\(field)=".unicodeScalars)
            let values = value.arrayValue ?? [value]
            let texts = values.compactMap(scalarText)
            guard texts.count == values.count else {
                detail += Array((value.arrayValue == nil ? "{…}" : "[…]").unicodeScalars)
                continue
            }
            for (index, text) in texts.enumerated() {
                let quoted = text.isEmpty || text.contains { $0.isWhitespace || $0 == "\"" || $0 == "," }
                if index > 0 { detail.append(",") }
                if quoted { detail.append("\"") }
                let start = detail.count
                detail += foldedValue(text)
                words.append(RuimteCommandRun.Word(range: start..<detail.count, text: text, option: field))
                if quoted { detail.append("\"") }
            }
        }
        return (String(String.UnicodeScalarView(detail)), words)
    }

    private static func scalarText(_ value: JSONValue) -> String? {
        switch value {
        case .string(let text): text
        case .number(let number):
            number.rounded() == number && abs(number) < 1e15 ? String(Int(number)) : String(number)
        case .bool(let flag): flag ? "true" : "false"
        default: nil
        }
    }

    private static func foldedValue(_ text: String) -> [Unicode.Scalar] {
        let line = Array(text.split(whereSeparator: \.isWhitespace).joined(separator: " ").unicodeScalars)
        return line.count > foldLength ? Array(line[..<foldLength]) + ["…"] : line
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
        guard let run = run(of: tool) else { return nil }
        if let call = run.mcp {
            return sent(ofTool: call, state: tool.state)
        }
        guard run.args.first == "notify", run.others.isEmpty, run.more == 0, !run.expands,
            let words = notifyWords(run.args),
            let text = words.text == "-" ? run.heredocText : unescape(words.text)
        else { return nil }
        return sentMessage(to: words.id, text: text, project: words.project, output: tool.output, state: tool.state)
    }

    /// A call of the `notify` tool as the message it sent; the server takes its text as it is.
    private static func sent(ofTool call: ChatMcpCall, state: ChatToolState) -> ChatAgentSent? {
        let project = call.input["project"]
        guard call.tool == "notify", let id = call.input["id"]?.stringValue, let text = call.input["text"]?.stringValue,
            project == nil || project?.stringValue != nil
        else { return nil }
        return sentMessage(to: id, text: text, project: project?.stringValue, output: call.output, state: state)
    }

    private static func sentMessage(
        to id: String, text: String, project: String?, output: String?, state: ChatToolState
    )
        -> ChatAgentSent?
    {
        guard !text.isEmpty, let outcome = notifyOutcome(output: output, state: state) else { return nil }
        let elsewhere = project != nil ? String(localized: "In another project") : nil
        return ChatAgentSent(
            to: id, title: outcome.title ?? elsewhere, hint: project, text: text, state: outcome.state,
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

    private static func notifyOutcome(output: String?, state: ChatToolState) -> (
        state: ChatAgentSent.State, title: String?, reason: String?
    )? {
        let lines = (output ?? "").components(separatedBy: "\n")
        // A CLI may put its own line above what a failed call answered, so a refusal is looked for in all of them.
        // `refused\t<code>` comes from the command, `refused <code>: <sentence>` from the MCP server.
        let refused = lines.lazy.compactMap { $0.firstMatch(of: /^refused[\t ]([a-z-]+)/) }.first
        if refused != nil || state == .error {
            return (.failed, nil, refused.flatMap { refusal(String($0.1)) })
        }
        if state == .running { return (.sending, nil, nil) }
        let fields = lines[0].components(separatedBy: "\t")
        guard fields.count >= 3, fields[0] == "notified", fields[2] == "now" || fields[2] == "waiting" else {
            return nil
        }
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
    static func projectNames(_ views: [StoredView]) -> [String: ChatCommandName] {
        var names: [String: ChatCommandName] = [:]
        for view in views {
            names[view.id] = ChatCommandName(name: view.name, icon: WorkspaceViewIcon.name(for: view), view: true)
            for node in view.nodes {
                names[node.id] = ChatCommandName(name: node.title, icon: WorkspaceViewIcon.name(for: node), view: false)
            }
        }
        return names
    }

    /// The name a word of the detail reads as; a view id such as `main` is only taken for one as the value of a view
    /// option or field.
    static func name(of word: RuimteCommandRun.Word, in names: [String: ChatCommandName]) -> ChatCommandName? {
        guard let named = names[word.text], !named.name.isEmpty,
            word.text.wholeMatch(of: /[a-z]+-[a-z0-9]+/) != nil
                || (named.view && word.option.map(viewOptions.contains) == true)
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
