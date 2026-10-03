import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The diagram a chat is asked about, and where in its project a new chat for it goes.
struct DiagramAgentTarget {
    let workspace: MobileWorkspace
    /// The diagram's view, or its node on a canvas.
    let item: JSONValue
    let title: String
}

/// Who draws: a new chat with one of the machine's agents, or a chat the project already has.
enum DiagramAgentChoice: Hashable {
    case new(provider: String)
    case chat(id: String)
}

/// What the agent is asked. Diagrams are written by an agent, never drawn on a phone, so the message names the verb
/// that writes one and the file it is in.
enum DiagramAgentPrompt {
    static func text(name: String, diagramID: String, request: String, empty: Bool) -> String {
        let request = request.trimmingCharacters(in: .whitespacesAndNewlines)
        if empty {
            return "Fill the empty diagram \"\(name)\" with `ruimte-context view diagram \(diagramID)`. It should show "
                + request
        }
        return "Change the diagram \"\(name)\" with `ruimte-context view diagram \(diagramID)`. "
            + "Read what it holds now in .ruimte/diagrams/\(diagramID).json first. " + request
    }

    /// Chats of the project an agent could take the question in: chat views first, then chat nodes on its canvases.
    static func chats(in views: [JSONValue]) -> [JSONValue] {
        views.filter { $0.text("kind") == "chat" }
            + views.flatMap { $0.list("nodes") }.filter { $0.text("kind") == "chat" }
    }

    /// Where a new chat view goes: right after the diagram's own view, or after the canvas that holds its node.
    static func insertion(after item: JSONValue, in views: [JSONValue]) -> Int {
        let index = views.firstIndex { view in
            view.stableID == item.stableID || view.list("nodes").contains { $0.stableID == item.stableID }
        }
        return index.map { $0 + 1 } ?? views.count
    }
}

/// Sends a diagram to an agent with the requests a chat already has: a new chat view next to the diagram
/// (`project.save`, then `chat.create`), or an existing chat, and `chat.send` with the question.
@MainActor @Observable
final class DiagramAgentModel {
    let target: DiagramAgentTarget
    var request = ""
    var choice: DiagramAgentChoice?
    private(set) var sending = false
    var problem: String?
    private let catalog: NewChatModel

    init(target: DiagramAgentTarget) {
        self.target = target
        catalog = NewChatModel(client: target.workspace.client, machineID: target.workspace.session.machine.id)
    }

    var diagramID: String { target.item.text("viewId", fallback: target.item.stableID) }
    var agents: [JSONValue] { catalog.agents ?? [] }
    var loaded: Bool { catalog.agents != nil }
    var chats: [JSONValue] { DiagramAgentPrompt.chats(in: target.workspace.views) }
    var canSend: Bool {
        !sending && choice != nil && target.workspace.session.connected
            && !request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func name(of choice: DiagramAgentChoice) -> String {
        switch choice {
        case .new(let provider):
            let agent = agents.first { $0.agentKind == provider }
            return "New \(agent?["name"]?.stringValue ?? provider) chat"
        case .chat(let id):
            return target.workspace.item(id).map { $0.text("name", fallback: $0.text("title", fallback: "Chat")) }
                ?? "Chat"
        }
    }

    func load() async {
        await catalog.load()
        problem = catalog.problem
        if choice == nil, let first = agents.first { choice = .new(provider: first.agentKind) }
    }

    /// Sends the question and answers with the chat it went to, to open; nil when it did not go out.
    func send(empty: Bool) async -> String? {
        guard canSend, let choice else { return nil }
        sending = true
        defer { sending = false }
        problem = nil
        let workspace = target.workspace
        let text = DiagramAgentPrompt.text(name: target.title, diagramID: diagramID, request: request, empty: empty)
        do {
            let chat: JSONValue
            switch choice {
            case .new(let provider):
                let id = "chat-" + UUID().uuidString
                chat = NewChat.projectView(id: id, provider: provider, account: catalog.account(for: provider))
                let item = target.item
                await workspace.edit { document in
                    var views = document.list("views")
                    views.insert(chat, at: DiagramAgentPrompt.insertion(after: item, in: views))
                    return document.setting("views", .array(views))
                }
                if let failure = workspace.problem { throw MachineClientError.invalid(failure) }
            case .chat(let id):
                guard let existing = workspace.item(id) else {
                    throw MachineClientError.invalid("That chat is no longer in this project.")
                }
                chat = existing
            }
            try await workspace.ensureSession(chat)
            _ = try await workspace.client.request(
                "chat.send", payload: .object(["chatId": .string(chat.stableID), "text": .string(text)]))
            request = ""
            return chat.stableID
        } catch {
            problem = error.localizedDescription
            return nil
        }
    }
}

/// Picks who draws: a new chat per installed agent, or a chat of the project.
struct DiagramAgentPicker: View {
    @Bindable var model: DiagramAgentModel

    var body: some View {
        Menu {
            Section("New chat") {
                ForEach(model.agents, id: \.agentKind) { agent in
                    choiceButton(.new(provider: agent.agentKind), icon: "message-square-plus")
                }
            }
            if !model.chats.isEmpty {
                Section("Chats in this project") {
                    ForEach(model.chats, id: \.stableID) { chat in
                        choiceButton(.chat(id: chat.stableID), icon: "message-square")
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(model.choice.map(model.name(of:)) ?? (model.loaded ? "Pick a chat" : "Looking for agents"))
                    .lineLimit(1)
                Image(lucide: "chevron-down", size: 12)
            }
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(MobileStyle.hover, in: .capsule)
        }
        .disabled(!model.loaded)
        .accessibilityLabel("Who draws")
    }

    private func choiceButton(_ choice: DiagramAgentChoice, icon: String) -> some View {
        Button {
            model.choice = choice
        } label: {
            Label(model.name(of: choice), lucideIcon: model.choice == choice ? "check" : icon)
        }
    }
}

/// "Change with an agent": what should change, and who does it.
struct DiagramAgentSheet: View {
    @Bindable var model: DiagramAgentModel
    let sent: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    TextField("What should change?", text: $model.request, axis: .vertical)
                        .lineLimit(3...8)
                        .focused($focused)
                    HStack {
                        Text("Sent to").foregroundStyle(MobileStyle.muted)
                        Spacer()
                        DiagramAgentPicker(model: model)
                    }
                } footer: {
                    Text("The chat gets the diagram's id and file, and writes it with ruimte-context.")
                }
                if let problem = model.problem {
                    Section { Text(problem).foregroundStyle(MobileStyle.statusError) }
                }
            }
            .navigationTitle("Change with an agent").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if model.sending {
                        ProgressView()
                    } else {
                        Button("Send") {
                            Task {
                                guard let chat = await model.send(empty: false) else { return }
                                dismiss()
                                sent(chat)
                            }
                        }
                        .disabled(!model.canSend)
                    }
                }
            }
        }
        .onAppear { focused = true }
        .task { if !model.loaded { await model.load() } }
    }
}

/// An empty diagram asks what it should show and which chat draws it, as `ruimte-context view diagram` would.
struct DiagramEmptyState: View {
    @Bindable var model: DiagramAgentModel
    let sent: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            VStack(spacing: 10) {
                Image(lucide: "workflow", size: 22)
                    .frame(width: 52, height: 52)
                    .background(MobileStyle.hover, in: .rect(cornerRadius: 14))
                Text("Nothing in this diagram yet").font(.title3.weight(.semibold))
                Text("An agent draws it from the project. Describe what it should show, or pick a chat that knows.")
                    .font(.subheadline).foregroundStyle(MobileStyle.muted).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)
            .accessibilityIdentifier("diagram.empty")
            Spacer(minLength: 24)
            VStack(alignment: .leading, spacing: 10) {
                TextField("What should it show?", text: $model.request, axis: .vertical)
                    .lineLimit(2...6)
                HStack {
                    DiagramAgentPicker(model: model)
                    Spacer()
                    Button {
                        Task { if let chat = await model.send(empty: true) { sent(chat) } }
                    } label: {
                        if model.sending {
                            ProgressView().frame(minWidth: 60)
                        } else {
                            Label("Draw", lucideIcon: "sparkles").font(.subheadline.weight(.semibold))
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .tint(MobileStyle.accent)
                    .disabled(!model.canSend)
                }
                if let problem = model.problem {
                    Text(problem).font(.footnote).foregroundStyle(MobileStyle.statusError)
                }
            }
            .padding(14)
            .glassEffect(.regular, in: .rect(cornerRadius: 24))
            .padding(.horizontal, 12).padding(.bottom, 8)
        }
        .task { if !model.loaded { await model.load() } }
    }
}
