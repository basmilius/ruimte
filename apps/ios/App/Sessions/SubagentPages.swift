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
    let session: SharedMachineSession?
    @State private var opened: SubagentCrumb?
    @State private var ending: EndingAgents?
    @State private var failure: String?
    @State private var derived = SubagentListDerivation()

    var body: some View {
        let lists = derived.lists(
            revision: model.subagentRevision, machineRefused: model.presentation.subagentsRefused
        ) { model.items }
        let work = lists.work
        List {
            section("Active", items: lists.active, work: work)
            section("Done", items: lists.done, work: work)
        }
        .modifier(MobileSidebarList(minimumRowHeight: 56))
        .overlay {
            if lists.isEmpty {
                ContentUnavailableView(
                    "No sub-agents", lucideIcon: "bot", description: Text("This chat has no sub-agents to open."))
            }
        }
        .modifier(MobilePageSurface())
        .navigationTitle("Sub-agents")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $opened) { crumb in
            SubagentConversationPage(model: model, crumb: crumb, session: session)
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
        .modifier(HoldsChat(model: model, session: session))
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
        Task { ending = await model.stopTaskQuestion(item) { await stop(item) } }
    }

    private func stop(_ item: JSONValue) async {
        do {
            try await model.stopSubagent(item)
        } catch {
            failure = error.localizedDescription
        }
    }
}

extension ChatModel {
    func stopSubagent(_ item: JSONValue) async throws {
        _ = try await client.request(
            "chat.stopSubagent", payload: target(["toolUseId": .string(item.text("toolUseId"))]))
    }

    /// The question before a task stops, since that ends the agent working on it and every agent that one opened.
    func stopTaskQuestion(_ item: JSONValue, run: @escaping () async -> Void) async -> EndingAgents? {
        guard let childID = item["childId"]?.stringValue else { return nil }
        let agents = await ChatSubagents.agentsEnded(with: [childID], client: client)
        return EndingAgents(
            title: "Stop \(ChatSubagents.title(item))?", message: ChatSubagents.stopsTaskWarning(agents), run: run)
    }
}

/// Keeps the sub-agent page's lists until the chat's subagent revision moves. It reads `items` only to derive them
/// again, so the page does not observe every word the main thread streams.
@MainActor final class SubagentListDerivation {
    struct Lists {
        var active: [JSONValue] = []
        var done: [JSONValue] = []
        var work: [String: [JSONValue]] = [:]
        var isEmpty: Bool { active.isEmpty && done.isEmpty }
    }

    private var key: (revision: Int, machineRefused: Bool)?
    private var cached = Lists()
    private(set) var derivations = 0

    func lists(revision: Int, machineRefused: Bool, items: () -> [JSONValue]) -> Lists {
        if let key, key.revision == revision, key.machineRefused == machineRefused { return cached }
        key = (revision, machineRefused)
        derivations += 1
        let all = items()
        let work = ChatSubagents.threadWork(all)
        let sections = ChatSubagents.sections(ChatSubagents.openable(all, machineRefused: machineRefused), work: work)
        cached = Lists(active: sections.active, done: sections.done, work: work)
        return cached
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
                if let word { SubagentStatusIcon(word: word) }
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
        .accessibilityLabel(word.map { "\(title), \($0.rawValue)" } ?? title)
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
    var size: CGFloat = 16

    var body: some View {
        Group {
            switch word {
            case .running: ProgressView().controlSize(.mini).tint(word.look.color)
            case .done: Image(lucide: "circle-check", size: size)
            case .failed: Image(lucide: "circle-x", size: size)
            case .cancelled: Image(lucide: "circle-slash", size: size)
            }
        }
        .foregroundStyle(word.look.color)
        .frame(width: size + 2, height: size + 2)
        .accessibilityHidden(true)
    }
}

/// How long a running entry has run, ticking each second while it is on screen, or when a settled one ended.
struct SubagentEntryTime: View {
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

/// What a sub-agent is, over its conversation: its state and time, the model it runs on and what it spent, and the
/// task it was given behind a disclosure.
struct SubagentInfoBar: View {
    let record: ChatItemState
    @State private var showsTask = false

    var body: some View {
        let item = record.value
        let facts = ChatSubagents.facts(item)
        let prompt = item["prompt"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let word = ChatSubagents.statusWord(item, task: nil) {
                    SubagentStatusIcon(word: word, size: 14)
                    Text(word.rawValue.capitalized).font(.footnote).foregroundStyle(MobileStyle.text)
                }
                SubagentEntryTime(item: item, task: nil)
                Spacer(minLength: 0)
                if prompt != nil {
                    Button(showsTask ? "Hide task" : "Show task") { showsTask.toggle() }
                        .font(.footnote)
                }
            }
            if !facts.isEmpty {
                Text(facts.joined(separator: " · ")).font(.footnote).foregroundStyle(MobileStyle.muted).lineLimit(2)
            }
            if showsTask, let prompt {
                // A short task at its own height, a long one scrolling inside the bar.
                ViewThatFits(in: .vertical) {
                    taskText(prompt)
                    ScrollView { taskText(prompt) }
                }
                .frame(maxHeight: 200)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
    }

    private func taskText(_ prompt: String) -> some View {
        Text(verbatim: prompt).font(.footnote).foregroundStyle(MobileStyle.text).textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A sub-agent's conversation read back in place of the chat. There is nobody to write to, but the chat's composer
/// stays under it for the approvals and questions the chat asks meanwhile.
struct SubagentConversationPage: View {
    let model: ChatModel
    let crumb: SubagentCrumb
    let session: SharedMachineSession?
    @State private var conversation: SubagentConversation
    @State private var presentation = ChatPresentation()
    @State private var prompts = ChatPromptState()
    @State private var viewportHeight: CGFloat = 700

    private var client: any MachineRequesting { model.client }
    private var chatID: String { model.chatID }
    private var parent: ChatPresentation { model.presentation }

    init(model: ChatModel, crumb: SubagentCrumb, session: SharedMachineSession?) {
        self.model = model
        self.crumb = crumb
        self.session = session
        _conversation = State(
            initialValue: SubagentConversation(client: model.client, chatID: model.chatID, toolUseID: crumb.toolUseID))
    }

    var body: some View {
        MobileScrollViewport(edges: .vertical) { insets in
            ChatTimeline(
                presentation: presentation, client: client, chatID: chatID, topInset: insets.top,
                bottomInset: insets.bottom,
                onNearTop: { if conversation.status == .ready { conversation.loadEarlier() } })
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let record = parent.subagent(toolUseID: crumb.toolUseID) { SubagentInfoBar(record: record) }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            SubagentComposerDock(model: model, prompts: prompts, availableHeight: viewportHeight)
        }
        .onGeometryChange(for: CGFloat.self) {
            $0.size.height
        } action: {
            viewportHeight = $0
        }
        .onChange(of: model.pending, initial: true) { _, requests in
            prompts.update(requests)
        }
        .overlay {
            switch conversation.status {
            case .loading:
                MobileLoadingRow("Loading conversation…").allowsHitTesting(false)
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
            if conversation.loadingEarlier {
                MobileLoadingRow("Loading earlier messages")
                    .padding(.top, 8)
                    .allowsHitTesting(false)
            }
        }
        .background(MobileStyle.surface.ignoresSafeArea())
        .tint(MobileStyle.accent)
        .navigationTitle(crumb.description)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $presentation.conversationRequest) { nested in
            SubagentConversationPage(model: model, crumb: nested, session: session)
        }
        .onChange(of: conversation.unsupported) { _, unsupported in
            if unsupported { parent.subagentsRefused = true }
        }
        .onAppear {
            let cwd = model.info.text("cwd")
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
        .modifier(HoldsChat(model: model, session: session))
    }
}

/// A page pushed over a chat screen makes that screen let go of its chat, which the session then stops 30 seconds
/// later or at a reconnect, and with it the questions and approvals the page shows. The page holds the chat itself.
private struct HoldsChat: ViewModifier {
    let model: ChatModel
    let session: SharedMachineSession?
    @State private var held: ChatModel?

    func body(content: Content) -> some View {
        content
            .onAppear {
                guard let session, held == nil else { return }
                held = session.retainChat(model)
            }
            .onDisappear {
                guard let session, let held else { return }
                self.held = nil
                session.releaseChat(held)
            }
    }
}

/// The chat's composer under a sub-agent's conversation. Nothing is written to a sub-agent, so the field only says
/// where to go to write, while the chat's approvals and questions come up and are answered here as under the chat.
private struct SubagentComposerDock: View {
    let model: ChatModel
    let prompts: ChatPromptState
    let availableHeight: CGFloat

    var body: some View {
        VStack(spacing: 0) {
            ChatPromptSlot(prompts: prompts, model: model, availableHeight: availableHeight)
            HStack(alignment: .bottom, spacing: 6) {
                Text("Go back to the main agent to write")
                    .foregroundStyle(MobileStyle.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 15)
                ChatSendMark(icon: "arrow-up")
                    .padding(.vertical, 6)
                    .accessibilityHidden(true)
            }
            .padding(.leading, 20).padding(.trailing, 6)
            .modifier(ChatComposerGlass())
        }
        .frame(maxWidth: 760)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity)
    }
}
