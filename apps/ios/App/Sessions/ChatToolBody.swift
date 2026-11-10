import RuimtePulsar
import RuimteTransport
import SwiftUI

struct ChatToolCallLines: Equatable {
    struct Argument: Equatable {
        let key: String
        let value: String
    }

    var command: String?
    var arguments: [Argument] = []
    /// An input that is not an object, as text.
    var text: String?

    var isEmpty: Bool { command == nil && arguments.isEmpty && text == nil }
}

/// What an opened tool row shows, as `ToolBody` in the desktop's chat lays it out.
enum ChatToolBody {
    static let outputLimit = 4000

    // A shell call's description is already the detail of its row.
    private static let shellShown: Set<String> = ["command", "description"]

    static func lines(_ tool: ChatToolItem) -> ChatToolCallLines { lines(name: tool.name, input: tool.input) }

    /// The input as lines: a shell command as itself, every other key as key and value, null included. A decoded
    /// object has no order, so the keys are sorted.
    static func lines(name: String, input: JSONValue) -> ChatToolCallLines {
        guard let object = input.objectValue else {
            if case .null = input { return ChatToolCallLines() }
            if input.stringValue == "" { return ChatToolCallLines() }
            return ChatToolCallLines(text: valueText(input))
        }
        let command = shellCommand(name: name, input: input)
        let arguments = object.keys.sorted()
            .filter { command == nil || !shellShown.contains($0) }
            .map { ChatToolCallLines.Argument(key: $0, value: valueText(object[$0] ?? .null)) }
        return ChatToolCallLines(command: command, arguments: arguments)
    }

    /// The command of a shell call, as it was run; nil for any other call or one without a command.
    static func shellCommand(name: String, input: JSONValue) -> String? {
        guard name == "Bash", let command = input["command"]?.stringValue,
            !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return command
    }

    /// A failed call's output without the exit code its tool put on the first line ("Exit code 1"), as Claude Code's
    /// shell does; a zero code is no failure of the command and stays in the text.
    static func exitCode(_ output: String) -> (code: Int?, rest: String) {
        let firstLine = output.prefix { !$0.isNewline }
        guard let match = firstLine.wholeMatch(of: /Exit code (-?\d+)[ \t]*/), let code = Int(match.1), code != 0 else {
            return (nil, output)
        }
        return (code, String(output.dropFirst(firstLine.count + 1)))
    }

    static func clipped(_ text: String) -> String {
        guard text.count > outputLimit else { return text }
        let more = text.count - outputLimit
        return String(text.prefix(outputLimit)) + "\n" + String(localized: "[\(more) more characters]")
    }

    static func output(_ tool: ChatToolItem) -> String { tool.output ?? tool.progress?.output ?? "" }

    /// Whether opening the call shows anything: a diff, the input it was given or what it answered.
    static func opens(_ tool: ChatToolItem) -> Bool {
        ChatFileChanges.hasChanges(tool) || hasOutput(output(tool)) || !lines(tool).isEmpty
    }

    static func hasOutput(_ output: String) -> Bool {
        !ChatAnsi.strip(output).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private static func valueText(_ value: JSONValue) -> String {
        // An empty string can be the point of a call (clearing a field), so it shows as one.
        if let text = value.stringValue, !text.isEmpty { return text }
        return (try? value.encoded()).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }
}

struct ChatToolBodyView: View {
    let item: ChatToolItem

    var body: some View {
        let changes = ChatFileChanges.grouped(ChatFileChanges.fromTool(item))
        let output = ChatToolBody.output(item)
        if changes.isEmpty {
            let lines = ChatToolBody.lines(item)
            VStack(alignment: .leading, spacing: 6) {
                if let command = lines.command {
                    ChatToolPane { ChatShellCommandText(command: ChatToolBody.clipped(command)) }
                }
                if !lines.arguments.isEmpty {
                    ChatToolPane {
                        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 4) {
                            ForEach(lines.arguments, id: \.key) { argument in
                                GridRow {
                                    Text(argument.key).foregroundStyle(MobileStyle.faint).fixedSize()
                                    Text(ChatToolBody.clipped(argument.value)).foregroundStyle(MobileStyle.text)
                                }
                            }
                        }
                    }
                }
                if let text = lines.text {
                    ChatToolPane { Text(ChatToolBody.clipped(text)).foregroundStyle(MobileStyle.text) }
                }
                ChatToolOutput(item: item)
            }
            .modifier(ChatToolText())
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(changes) { change in ChatFileChangeView(change: change, ruled: change.id != changes.first?.id) }
            }
            .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 10))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(MobileStyle.border) }
            // The answer to a reported patch only repeats the paths it touched.
            if (item.changes ?? []).allSatisfy(\.diff.isEmpty), ChatToolBody.hasOutput(output) {
                VStack(alignment: .leading, spacing: 6) {
                    ChatToolOutput(item: item)
                }
                .modifier(ChatToolText())
            }
        }
    }
}

/// The whole of what the thread keeps only the beginning of, read once a person asks, as the desktop's chat does. A
/// failure can be tried again.
@MainActor @Observable final class ChatWhole<Value> {
    enum State {
        case idle, loading
        case loaded(Value)
        case failed
    }

    private(set) var state = State.idle

    var value: Value? {
        if case .loaded(let value) = state { return value }
        return nil
    }

    var loading: Bool {
        if case .loading = state { return true }
        return false
    }

    /// A read that answers nil found nothing on the machine, which fails like a refusal does.
    func load(_ read: () async throws -> Value?) async {
        guard !loading else { return }
        state = .loading
        do {
            if let value = try await read() {
                state = .loaded(value)
            } else {
                state = .failed
            }
        } catch {
            state = .failed
        }
    }
}

enum ChatWholeReads {
    /// Only a machine that answers `chat.toolOutput` keeps an output apart, so on any other there is nothing to ask.
    @MainActor static func offersToolOutput(_ client: any MachineRequesting) -> Bool {
        (client as? MachineFeatures)?.answers(.chatToolOutput) == true
    }

    @MainActor static func toolOutput(client: any MachineRequesting, chatID: String, itemID: String) async throws
        -> String?
    {
        let result = try await client.request(
            .chatToolOutput,
            payload: .object(["chatId": .string(chatID), "itemId": .string(itemID)]))
        return result["output"]?.stringValue
    }

    @MainActor static func turnDiff(client: any MachineRequesting, chatID: String, turnID: String) async throws
        -> ChatTurnItemCheckpointDiff?
    {
        let result = try await client.request(
            .chatTurnDiff,
            payload: .object(["chatId": .string(chatID), "turnId": .string(turnID)]))
        guard let diff = result["diff"], diff != .null else { return nil }
        return try diff.decoded(as: ChatTurnItemCheckpointDiff.self)
    }
}

/// The line under a beginning that offers the rest: its size when known, and Try again after a failure.
struct ChatWholeBar<Value>: View {
    let whole: ChatWhole<Value>
    let label: LocalizedStringKey
    let failedLabel: LocalizedStringKey
    var bytes: Int64? = nil
    let read: () async throws -> Value?

    var body: some View {
        if whole.value == nil {
            let failed = if case .failed = whole.state { true } else { false }
            HStack(spacing: 8) {
                if failed {
                    Text(failedLabel).foregroundStyle(MobileStyle.statusError)
                } else if let bytes {
                    Text("\(mobileByteCount(Double(bytes))) in total", comment: "%@ is the size of a whole output")
                        .foregroundStyle(MobileStyle.faint)
                }
                Button {
                    Task { await whole.load(read) }
                } label: {
                    HStack(spacing: 6) {
                        if whole.loading { ProgressView().controlSize(.small) }
                        Text(failed ? "Try again" : label)
                    }
                    .frame(minHeight: 44)
                }
                .disabled(whole.loading)
            }
            .font(.caption)
        }
    }
}

private struct ChatToolText: ViewModifier {
    func body(content: Content) -> some View {
        content.font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
    }
}

/// A part of an opened call, which scrolls inside the thread past a few lines.
private struct ChatToolPane<Content: View>: View {
    @ViewBuilder let content: Content
    @State private var height: CGFloat = 0
    private static var maxHeight: CGFloat { 256 }

    var body: some View {
        ScrollView {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    height = $0
                }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(height: min(height, Self.maxHeight))
        .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(MobileStyle.border) }
    }
}

/// What a call answered, and the whole of it on request when the thread keeps only its beginning.
private struct ChatToolOutput: View {
    let item: ChatToolItem
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.chatContent) private var context
    @State private var expanded = false
    @State private var whole = ChatWhole<String>()

    var body: some View {
        let text = whole.value ?? ChatToolBody.output(item)
        let failed = item.state == .error
        // A beginning whose rest the machine keeps has no count of what it leaves out, so only the whole expands here.
        let beginning = item.outputRef != nil && whole.value == nil
        let exit = failed ? ChatToolBody.exitCode(text) : (code: nil, rest: text)
        if ChatToolBody.hasOutput(exit.rest) {
            let base = failed && exit.code == nil ? MobileStyle.statusError : MobileStyle.muted
            let output = ChatAnsi.parse(exit.rest, limit: expanded ? nil : ChatToolBody.outputLimit)
            ChatToolPane {
                Text(
                    ChatAnsi.attributed(
                        output.tokens, dark: colorScheme == .dark, base: base, ground: MobileStyle.panel)
                )
                .foregroundStyle(base)
            }
            if output.omitted > 0 && !beginning {
                ChatExpansionButton(expanding: true) {
                    expanded = true
                } label: {
                    Text("Show all output")
                }
                .font(.caption).frame(minHeight: 44)
            }
        }
        if ChatToolBody.hasOutput(text), let ref = item.outputRef, let context,
            ChatWholeReads.offersToolOutput(context.client)
        {
            ChatWholeBar(
                whole: whole, label: "Show full output", failedLabel: "Could not load the full output", bytes: ref.bytes
            ) {
                try await ChatWholeReads.toolOutput(client: context.client, chatID: context.chatID, itemID: item.id)
            }
        }
        if let code = exit.code {
            Text("Exit code \(code)").foregroundStyle(MobileStyle.statusError)
        }
    }
}

private struct ChatShellCommandText: View {
    let command: String
    @Environment(\.colorScheme) private var colorScheme
    @State private var colors = CodeHighlightState()

    var body: some View {
        Text(colors.displayed(command)).foregroundStyle(MobileStyle.text)
            .task(id: "\(colorScheme == .dark):\(command)") {
                colors.update(command, language: "bash", dark: colorScheme == .dark)
            }
            .onDisappear { colors.cancel() }
    }
}
