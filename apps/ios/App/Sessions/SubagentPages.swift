import RuimtePulsar
import RuimteTransport
import SwiftUI

/// A question asked before a stop that ends agents, with how many.
struct EndingAgents: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let run: () async -> Void
}

extension View {
    func endingAgentsConfirmation(_ pending: Binding<EndingAgents?>) -> some View {
        alert(
            pending.wrappedValue?.title ?? "",
            isPresented: Binding(
                get: { pending.wrappedValue != nil }, set: { if !$0 { pending.wrappedValue = nil } }),
            presenting: pending.wrappedValue
        ) { question in
            Button("Cancel", role: .cancel) {}
            Button("Stop", role: .destructive) { Task { await question.run() } }
        } message: { question in
            Text(question.message)
        }
    }
}

/// The sub-agents of a chat on a page of their own: the ones still at work on top and the ones that settled under
/// Done, each with the latest thing it did. Picking one opens its conversation.
struct SubagentListPage: View {
    let model: ChatModel
    let tasks: TaskStore?
    @State private var opened: SubagentCrumb?
    @State private var ending: EndingAgents?
    @State private var failure: String?

    private var subagents: [JSONValue] {
        ChatSubagents.openable(model.items, machineRefused: model.presentation.subagentsRefused)
    }

    var body: some View {
        let work = ChatSubagents.threadWork(model.items)
        let sections = ChatSubagents.sections(subagents, work: work)
        List {
            section("Active", items: sections.active, work: work)
            section("Done", items: sections.done, work: work)
        }
        .modifier(MobileSidebarList(minimumRowHeight: 56))
        .overlay {
            if subagents.isEmpty {
                ContentUnavailableView(
                    "No sub-agents", lucideIcon: "bot", description: Text("This chat has no sub-agents to open."))
            }
        }
        .modifier(MobilePageSurface())
        .navigationTitle("Sub-agents")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $opened) { crumb in
            SubagentConversationPage(
                client: model.client, chatID: model.chatID, crumb: crumb, cwd: model.info.text("cwd"),
                parent: model.presentation)
        }
        .endingAgentsConfirmation($ending)
        .alert(
            "The sub-agent could not be stopped",
            isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
        ) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    @ViewBuilder private func section(_ label: String, items: [JSONValue], work: [String: [JSONValue]]) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items, id: \.stableID) { item in
                    let taskID = ChatSubagents.taskID(item)
                    let task = taskID.flatMap { tasks?.task($0) }
                    SubagentEntryRow(
                        item: item, task: task, work: work[item.text("toolUseId")] ?? [], client: model.client,
                        chatID: model.chatID, machineRefused: model.presentation.subagentsRefused
                    ) {
                        opened = SubagentCrumb(item)
                    }
                    .modifier(MobileSidebarRow())
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) { stopButton(item) }
                    .contextMenu {
                        Button("Open conversation", lucideIcon: "messages-square") { opened = SubagentCrumb(item) }
                        stopButton(item)
                    }
                }
            } header: {
                HStack {
                    Text(label)
                    Spacer()
                    Text("\(items.count)").monospacedDigit()
                }
                .font(.footnote.weight(.semibold)).foregroundStyle(MobileStyle.muted)
            }
        }
    }

    @ViewBuilder private func stopButton(_ item: JSONValue) -> some View {
        let turnRunning = model.info["activeTurnId"]?.stringValue != nil
        switch ChatSubagents.stop(item, turnRunning: turnRunning) {
        case .task:
            Button("Stop task", lucideIcon: "square", role: .destructive) { askBeforeStoppingTask(item) }
        case .mark:
            // No CLI stops one sub-agent on its own, so it may keep working until the chat's process ends.
            Button("Mark as stopped", lucideIcon: "square", role: .destructive) { Task { await stop(item) } }
        case nil:
            EmptyView()
        }
    }

    private func askBeforeStoppingTask(_ item: JSONValue) {
        guard let childID = item["childId"]?.stringValue else { return }
        Task {
            let agents = await ChatSubagents.agentsEnded(with: [childID], client: model.client)
            ending = EndingAgents(
                title: "Stop \(ChatSubagents.title(item))?", message: ChatSubagents.stopsTaskWarning(agents)
            ) { await stop(item) }
        }
    }

    private func stop(_ item: JSONValue) async {
        do {
            _ = try await model.client.request(
                "chat.stopSubagent",
                payload: .object(["chatId": .string(model.chatID), "toolUseId": .string(item.text("toolUseId"))]))
        } catch {
            failure = error.localizedDescription
        }
    }
}

private struct SubagentEntryRow: View {
    let item: JSONValue
    let task: JSONValue?
    let work: [JSONValue]
    let client: any MachineRequesting
    let chatID: String
    let machineRefused: Bool
    let open: () -> Void
    @State private var tail: SubagentConversation?

    // The newest end is all an entry shows, so a few items are enough to find the last call or reply in.
    private static let tailPage = 10

    private var needsTail: Bool { ChatSubagents.needsTail(item, work: work, machineRefused: machineRefused) }

    var body: some View {
        let word = ChatSubagents.statusWord(item, task: task)
        let title = ChatSubagents.title(item)
        Button(action: open) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                SubagentStatusIcon(word: word)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(title).font(.body.weight(.medium)).foregroundStyle(MobileStyle.text).lineLimit(1)
                        Spacer(minLength: 0)
                        SubagentEntryTime(item: item, task: task)
                    }
                    if let preview = ChatSubagents.preview(item, work: work, tail: tail?.items) {
                        previewText(preview).font(.footnote).lineLimit(2)
                    }
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(word.rawValue)")
        .task(id: needsTail) {
            guard needsTail else {
                tail?.stop()
                tail = nil
                return
            }
            let conversation = SubagentConversation(
                client: client, chatID: chatID, toolUseID: item.text("toolUseId"), limit: Self.tailPage)
            tail = conversation
            conversation.start()
        }
        .onDisappear {
            tail?.stop()
            tail = nil
        }
    }

    private func previewText(_ preview: SubagentPreview) -> Text {
        switch preview {
        case .text(let text):
            return Text(text).foregroundStyle(MobileStyle.muted)
        case .tool(let name, let detail):
            let tool = Text(name).foregroundStyle(MobileStyle.text)
            return Text("\(tool)\(detail.isEmpty ? "" : " \(detail)")").foregroundStyle(MobileStyle.muted)
        }
    }
}

struct SubagentStatusIcon: View {
    let word: SubagentStatusWord

    var body: some View {
        Group {
            switch word {
            case .running: ProgressView().controlSize(.mini).tint(word.look.color)
            case .done: Image(lucide: "circle-check", size: 16)
            case .failed: Image(lucide: "circle-x", size: 16)
            case .cancelled: Image(lucide: "circle-slash", size: 16)
            }
        }
        .foregroundStyle(word.look.color)
        .frame(width: 18, height: 18)
        .accessibilityHidden(true)
    }
}

/// How long a running entry has run, ticking each second while it is on screen, or when a settled one ended.
private struct SubagentEntryTime: View {
    let item: JSONValue
    let task: JSONValue?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if item.text("status") == "running" {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    label(ChatSubagents.entryTime(item, task: task, now: context.date))
                }
            } else {
                label(ChatSubagents.entryTime(item, task: task, now: .now))
            }
        }
    }

    @ViewBuilder private func label(_ text: String?) -> some View {
        if let text {
            Text(text).font(.footnote).monospacedDigit().foregroundStyle(MobileStyle.muted).fixedSize()
        }
    }
}

/// A sub-agent's conversation read back in place of the chat: there is nobody to write to, so there is no composer.
struct SubagentConversationPage: View {
    let client: any MachineRequesting
    let chatID: String
    let crumb: SubagentCrumb
    let parent: ChatPresentation
    @State private var conversation: SubagentConversation
    @State private var presentation = ChatPresentation()
    @State private var atConversationTop = false
    private let cwd: String

    init(client: any MachineRequesting, chatID: String, crumb: SubagentCrumb, cwd: String, parent: ChatPresentation) {
        self.client = client
        self.chatID = chatID
        self.crumb = crumb
        self.cwd = cwd
        self.parent = parent
        _conversation = State(
            initialValue: SubagentConversation(client: client, chatID: chatID, toolUseID: crumb.toolUseID))
    }

    var body: some View {
        MobileScrollViewport(edges: .vertical) { insets in
            ChatTimeline(
                presentation: presentation, client: client, chatID: chatID, topInset: insets.top,
                bottomInset: insets.bottom, onAtTopChanged: { atConversationTop = $0 })
        }
        .overlay {
            switch conversation.status {
            case .loading:
                ProgressView().accessibilityLabel("Loading conversation…").allowsHitTesting(false)
            case .failed where conversation.items.isEmpty:
                ContentUnavailableView {
                    Label("Could not open", lucideIcon: "triangle-alert", iconSize: 48)
                } description: {
                    Text(conversation.error ?? "The machine did not answer.")
                } actions: {
                    if !conversation.unsupported { Button("Retry") { conversation.refresh() } }
                }
            case .ready where conversation.items.isEmpty:
                ContentUnavailableView(
                    "Nothing to show yet", lucideIcon: "bot",
                    description: Text("What this agent does appears here.")
                ).allowsHitTesting(false)
            default:
                EmptyView()
            }
        }
        .overlay(alignment: .top) {
            if conversation.cursor != nil && conversation.status == .ready && atConversationTop {
                ChatOlderMessagesButton(
                    loading: conversation.loadingEarlier, disabled: conversation.loadingEarlier
                ) {
                    conversation.loadEarlier()
                }
                .padding(.top, 8)
            }
        }
        .background(MobileStyle.surface.ignoresSafeArea())
        .tint(MobileStyle.accent)
        .navigationTitle(crumb.description)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $presentation.conversationRequest) { nested in
            SubagentConversationPage(client: client, chatID: chatID, crumb: nested, cwd: cwd, parent: parent)
        }
        .onChange(of: conversation.unsupported) { _, unsupported in
            if unsupported { parent.subagentsRefused = true }
        }
        .onAppear {
            presentation.subagentsRefused = parent.subagentsRefused
            presentation.setInfo(.object(["cwd": .string(cwd)]))
            conversation.onChange = { [presentation] change in
                switch change {
                case .replaced(let items): presentation.replace(items, info: .object(["cwd": .string(cwd)]))
                case .updated(let items): for item in items { presentation.upsert(item) }
                case .prepended(let items): presentation.prepend(items)
                }
            }
            conversation.start()
        }
        .onDisappear { conversation.stop() }
    }
}
