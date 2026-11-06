import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The finished main reply a code block stands in, the only place a command can be prepared from. A sub-agent's
/// text, a thought and a block inside a quote or list carry none.
struct ChatReplySource: Equatable {
    let itemID: String
    let streaming: Bool
}

extension EnvironmentValues {
    @Entry var chatReplySource: ChatReplySource?
}

/// A shell command from a reply, put in a terminal of the project without Enter, as the desktop's Prepare in terminal
/// does. The machine shows which terminals can take it and pastes only into the one a person picks; nothing runs.
enum ChatShellPrepare {
    static let languages: Set<String> = ["sh", "bash", "zsh"]

    /// The one line a terminal can take, as `shellCommandLine` in the contracts reads it: the text exactly, except
    /// the fence's newline, and nil for anything with a control or that a shell's syntax check could pass unfinished.
    static func commandLine(_ code: String) -> String? {
        let line = code.hasSuffix("\n") ? String(code.dropLast()) : code
        // Reject invisible controls instead of silently changing what the person approved.
        let invisible = line.unicodeScalars.contains {
            [.control, .format, .lineSeparator, .paragraphSeparator].contains($0.properties.generalCategory)
        }
        if line.trimmingCharacters(in: .whitespaces).isEmpty || invisible || line.utf8.count > 1000 {
            return nil
        }
        // EOF can make an unfinished heredoc or logical list pass a shell's syntax-only mode.
        let continues = line.reversed().prefix { $0 == "\\" }.count % 2 == 1
        if line.drop(while: \.isWhitespace).hasPrefix("#") || line.contains(#/(^|[^<])<<([^<]|$)/#)
            || line.contains(#/(?:&&|\|\|?)[ ]*$/#) || continues
        {
            return nil
        }
        return line
    }

    /// Whether a code block offers the action: a closed shell fence of one command line in a finished reply.
    static func offers(language: String, code: String, closed: Bool, source: ChatReplySource?) -> Bool {
        guard let source, !source.streaming, closed, languages.contains(language) else { return false }
        return commandLine(code) != nil
    }

    /// The terminals of this project on this machine, by session id: a terminal view, or a terminal node of a canvas
    /// that no other machine runs.
    static func terminals(_ views: [StoredView]) -> Set<String> {
        var ids = Set<String>()
        for view in views {
            if case .terminal = view {
                ids.insert(view.id)
            }
            for node in view.nodes where node.kind == .terminal && node.machine == nil {
                ids.insert(node.id)
            }
        }
        return ids
    }
}

struct ChatPrepareTarget: Identifiable, Equatable {
    let token: String
    let sessionID: String
    let title: String
    var id: String { token }
}

struct ChatPreparePreview: Identifiable, Equatable {
    let machineID: String
    let machine: String
    let command: String
    let cwd: String
    let targets: [ChatPrepareTarget]
    var id: String { targets.first?.token ?? "empty:\(command)" }

    init(_ value: JSONValue) {
        machineID = value.text("machineId")
        machine = value.text("machine")
        command = value.text("command")
        cwd = value.text("cwd")
        targets = value.list("targets").map {
            ChatPrepareTarget(token: $0.text("token"), sessionID: $0.text("sessionId"), title: $0.text("title"))
        }
    }
}

/// One preparation, from the button to the paste. The machine offers only a terminal this client is attached to, so
/// the project's terminals are attached, following, for as long as the preview stands.
@MainActor @Observable final class ChatPrepareFlow {
    private let context: ChatContentContext
    private let source: ChatReplySource
    private let language: String
    private let code: String
    private(set) var busy = false
    var preview: ChatPreparePreview?
    var failure: String?
    /// The terminal the command went to, once it is there.
    var prepared: String?
    @ObservationIgnored private var attachments: [MachineAttachment] = []

    init(context: ChatContentContext, source: ChatReplySource, language: String, code: String) {
        self.context = context
        self.source = source
        self.language = language
        self.code = code
    }

    func open() async {
        guard !busy, let workspace = context.workspace else { return }
        busy = true
        defer { busy = false }
        do {
            let machineID = try await machineID()
            await attach(ChatShellPrepare.terminals(workspace.storedViews))
            let answer = try await context.client.request(
                .sessionPreparePreview,
                payload: .object([
                    "machineId": .string(machineID), "chatId": .string(context.chatID),
                    "itemId": .string(source.itemID), "language": .string(language), "code": .string(code),
                ]))
            let next = ChatPreparePreview(answer)
            guard next.machineID == machineID else { throw Self.wrongMachine }
            preview = next
        } catch {
            release()
            failure = error.localizedDescription
        }
    }

    func prepare(_ target: ChatPrepareTarget) async -> Bool {
        guard !busy, let preview else { return false }
        busy = true
        defer { busy = false }
        do {
            _ = try await context.client.request(
                .sessionPrepare,
                payload: .object(["machineId": .string(preview.machineID), "token": .string(target.token)]))
            prepared = target.title
            close()
            return true
        } catch {
            // Once sent, a broken reply cannot tell whether the editor took the line.
            let code = error.machineCode.flatMap { Self.refusals.contains($0) ? $0 : nil } ?? .terminalPrepareUnconfirmed
            failure = Self.failure(code: code, message: error.localizedDescription)
            return false
        }
    }

    func close() {
        preview = nil
        release()
    }

    private static let refusals: Set<MachineErrorCode> = [
        .terminalPrepareRefused, .terminalEditorRefused, .terminalPrepareUnconfirmed,
    ]

    static func failure(code: MachineErrorCode, message: String) -> String {
        switch code {
        case .terminalPrepareUnconfirmed:
            String(
                localized:
                    "Not confirmed. The command may already be in the terminal, so check its input first.")
        case .terminalEditorRefused:
            String(localized: "The terminal did not accept the command. Open the preview again.")
        default: message
        }
    }

    private func machineID() async throws -> String {
        let info = try await context.client.request(.endpointInfo)
        guard let id = try? info.decoded(as: EndpointInfo.self).id, !id.isEmpty else { throw Self.wrongMachine }
        return id
    }

    private static var wrongMachine: MachineClientError {
        .server(
            code: MachineErrorCode.wrongMachine.rawValue,
            message: String(localized: "This chat's machine is not connected."))
    }

    private func attach(_ terminals: Set<String>) async {
        guard
            let list = try? await context.client.request(.sessionList).decoded(as: SessionListResult.self)
        else { return }
        for info in list.sessions {
            let id = info.sessionId
            guard terminals.contains(id), !info.exited, info.agent.present == nil else { continue }
            let attachment = context.client.acquireAttachment(.session, id: id)
            if (try? await TerminalSnapshot.load(attachment: attachment, sessionID: id) { _ in }) != nil {
                attachments.append(attachment)
            } else {
                await attachment.release()
            }
        }
    }

    private func release() {
        let held = attachments
        attachments = []
        Task {
            for attachment in held { await attachment.release() }
        }
    }
}

/// The button on a shell block that starts a preparation, and the sheet that shows where the command would go.
struct ChatPrepareButton: View {
    let language: String
    let code: String
    @Environment(\.chatContent) private var context
    @Environment(\.chatReplySource) private var source
    @State private var flow: ChatPrepareFlow?
    @State private var ready: String?

    var body: some View {
        if let context, let source, context.workspace != nil, context.connected,
            (context.client as? MachineFeatures)?.answers(.sessionPreparePreview) == true
        {
            Button {
                let next = flow ?? ChatPrepareFlow(context: context, source: source, language: language, code: code)
                flow = next
                Task { await next.open() }
            } label: {
                Group {
                    if flow?.busy == true {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(lucide: "square-terminal")
                    }
                }
                .frame(width: 44, height: 44)
            }
            .disabled(flow?.busy == true)
            .accessibilityLabel("Prepare in terminal")
            .sheet(item: Binding(get: { flow?.preview }, set: { if $0 == nil { flow?.close() } })) { preview in
                if let flow {
                    ChatPrepareSheet(flow: flow, preview: preview) { title in ready = title }
                }
            }
            .alert(
                "Could not prepare the command.",
                isPresented: Binding(
                    get: { flow?.preview == nil && flow?.failure != nil }, set: { if !$0 { flow?.failure = nil } })
            ) {
                Button("OK") { flow?.failure = nil }
            } message: {
                Text(flow?.failure ?? "")
            }
            .alert(
                "Command prepared", isPresented: $ready.isPresent()
            ) {
                Button("OK") { ready = nil }
            } message: {
                Text("Ready in \(ready ?? ""). Press Enter there to run it.")
            }
        }
    }
}

private struct ChatPrepareSheet: View {
    @Bindable var flow: ChatPrepareFlow
    let preview: ChatPreparePreview
    let done: (String) -> Void
    @State private var token: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Review the command. Ruimte pastes it without Enter, so you run it yourself.")
                        .foregroundStyle(MobileStyle.muted)
                    LabeledContent("Machine", value: preview.machine)
                    LabeledContent("Working folder") {
                        Text(preview.cwd).font(.system(.footnote, design: .monospaced)).multilineTextAlignment(
                            .trailing)
                    }
                    Text(preview.command).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                }
                if preview.targets.isEmpty {
                    Section {
                        Text("No empty zsh terminal in this folder. Open one here, or clear its input.")
                            .foregroundStyle(MobileStyle.muted)
                    }
                } else {
                    Section("Terminal") {
                        Picker("Terminal", selection: $token) {
                            ForEach(preview.targets) { target in
                                Text(target.title).tag(Optional(target.token))
                            }
                        }
                        .pickerStyle(.inline).labelsHidden()
                    }
                }
                if let failure = flow.failure {
                    Section { Text(failure).foregroundStyle(MobileStyle.muted) }
                }
            }
            .disabled(flow.busy)
            .navigationTitle("Prepare in terminal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { flow.close() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Paste without Enter") {
                        guard let target = preview.targets.first(where: { $0.token == token }) else { return }
                        Task {
                            if await flow.prepare(target) { done(target.title) }
                        }
                    }
                    .disabled(flow.busy || token == nil || flow.failure != nil)
                }
            }
        }
        .onAppear { token = preview.targets.first?.token }
        .interactiveDismissDisabled(flow.busy)
    }
}
