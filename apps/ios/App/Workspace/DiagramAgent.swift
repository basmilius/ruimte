import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The diagram a chat is asked about, and where in its project a new chat for it goes.
struct DiagramAgentTarget {
    let workspace: MobileWorkspace
    /// The diagram's view, or its node on a canvas.
    let item: ProjectItem
    let title: String
}

/// Who draws: a new chat with one of the machine's agents, or a chat the project already has.
enum DiagramAgentChoice: Hashable {
    case new(provider: String)
    case chat(id: String)
}

/// What the agent is asked. Diagrams are written by an agent, never drawn on a phone, so the message names the tool
/// that writes one and the file it is in.
enum DiagramAgentPrompt {
    static func text(name: String, diagramID: String, request: String, empty: Bool) -> String {
        let request = request.trimmingCharacters(in: .whitespacesAndNewlines)
        if empty {
            return "Fill the empty diagram \"\(name)\" with `view_diagram \(diagramID)`. It should show "
                + request
        }
        return "Change the diagram \"\(name)\" with `view_diagram \(diagramID)`. "
            + "Read what it holds now in .ruimte/diagrams/\(diagramID).json first. " + request
    }

    /// Chats of the project an agent could take the question in: chat views first, then chat nodes on its canvases.
    static func chats(in views: [ProjectItem]) -> [ProjectItem] {
        views.filter { $0.kind == "chat" } + views.flatMap(\.nodes).filter { $0.kind == "chat" }
    }

    /// Where a new chat view goes: right after the diagram's own view, or after the canvas that holds its node.
    static func insertion(after item: ProjectItem, in views: [ProjectItem]) -> Int {
        let index = views.firstIndex { view in
            view.id == item.id || view.nodes.contains { $0.id == item.id }
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
    let catalog: NewChatModel

    init(target: DiagramAgentTarget) {
        self.target = target
        catalog = NewChatModel(client: target.workspace.client, machineID: target.workspace.session.machine.id)
    }

    var diagramID: String { target.item.viewId ?? target.item.id }
    var agents: [ProviderInfo] { catalog.agents ?? [] }
    var loaded: Bool { catalog.agents != nil }
    var chats: [ProjectItem] { DiagramAgentPrompt.chats(in: target.workspace.items) }
    var canSend: Bool {
        guard !sending, let choice, target.workspace.session.connected,
            !request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return false }
        if case .new(let provider) = choice {
            return catalog.refusal(provider: provider, project: target.workspace.document) == nil
        }
        return true
    }

    func name(of choice: DiagramAgentChoice) -> String {
        switch choice {
        case .new(let provider):
            let name = agents.first { $0.kind == provider }?.name ?? provider
            return String(localized: "New \(name) chat", comment: "%@ is the name of an agent, such as Claude Code")
        case .chat(let id):
            let fallback = String(localized: "Chat")
            return target.workspace.item(id)?.name ?? fallback
        }
    }

    func load() async {
        await catalog.load()
        problem = catalog.problem
        if choice == nil, let first = agents.first { choice = .new(provider: first.kind) }
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
            let chat: ProjectItem
            switch choice {
            case .new(let provider):
                let id = "chat-" + UUID().uuidString
                let account = try await catalog.prepare(provider: provider, project: workspace.document)
                let view = NewChat.projectView(id: id, provider: provider, account: account)
                let item = target.item
                await workspace.edit { document in
                    var views = document.list("views")
                    let items = views.compactMap(\.projectItem)
                    views.insert(view, at: DiagramAgentPrompt.insertion(after: item, in: items))
                    return document.setting("views", .array(views))
                }
                if let failure = workspace.problem { throw MachineClientError.invalid(failure) }
                guard let created = workspace.item(id) else {
                    throw MachineClientError.invalid(String(localized: "That chat is no longer in this project."))
                }
                chat = created
            case .chat(let id):
                guard let existing = workspace.item(id) else {
                    throw MachineClientError.invalid(String(localized: "That chat is no longer in this project."))
                }
                chat = existing
            }
            try await workspace.ensureSession(chat)
            _ = try await workspace.client.request(
                .chatSend, payload: .object(["chatId": .string(chat.id), "text": .string(text)]))
            request = ""
            return chat.id
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
                ForEach(model.agents, id: \.kind) { agent in
                    choiceButton(.new(provider: agent.kind), icon: "message-square-plus")
                }
            }
            if !model.chats.isEmpty {
                Section("Chats in this project") {
                    ForEach(model.chats) { chat in
                        choiceButton(.chat(id: chat.id), icon: "message-square")
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(
                    model.choice.map(model.name(of:))
                        ?? (model.loaded ? String(localized: "Pick a chat") : String(localized: "Looking for agents"))
                )
                .lineLimit(1)
                Image(lucide: "chevron-down", size: 12)
            }
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(MobileStyle.fill, in: .capsule)
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
                    Text("The chat changes the diagram for you.")
                }
                if case .new(let provider) = model.choice {
                    NewChatAccountPicker(
                        model: model.catalog, provider: provider, project: model.target.workspace.document)
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
        .disabled(model.sending)
        .task {
            await RemotePageLifecycle.run(
                client: model.target.workspace.client, events: [.accountsChanged], load: model.load)
        }
    }
}

/// An empty diagram asks what it should show and which chat draws it, as `view_diagram` would.
struct DiagramEmptyState: View {
    @Bindable var model: DiagramAgentModel
    let sent: (String) -> Void
    @State private var choosingAccount = false

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
                    if case .new = model.choice {
                        Button("Account") { choosingAccount = true }.font(.footnote)
                    }
                    Spacer()
                    Button {
                        Task { if let chat = await model.send(empty: true) { sent(chat) } }
                    } label: {
                        if model.sending {
                            ProgressView().frame(minWidth: 60)
                        } else {
                            Label(String(localized: "Draw"), lucideIcon: "sparkles")
                        }
                    }
                    .buttonStyle(.mobileGlassProminent)
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
        .disabled(model.sending)
        .mobileSheet(isPresented: $choosingAccount) {
            if case .new(let provider) = model.choice {
                NavigationStack {
                    MobileForm {
                        NewChatAccountPicker(
                            model: model.catalog, provider: provider, project: model.target.workspace.document)
                    }
                    .navigationTitle("Account").navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { choosingAccount = false }
                        }
                    }
                }
            }
        }
        .task {
            await RemotePageLifecycle.run(
                client: model.target.workspace.client, events: [.accountsChanged], load: model.load)
        }
    }
}
