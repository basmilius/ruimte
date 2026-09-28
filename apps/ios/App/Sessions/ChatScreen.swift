import RuimtePulsar
import RuimteTransport
import SwiftUI

struct ChatScreen: View {
    @AppStorage("ruimte.chat.streaming") private var streamingMode: ChatStreamingMode = .words
    @State private var model: ChatModel
    @State private var visible = false
    @State private var holdingChat = false
    @State private var showingClear = false
    @State private var clearDraft: String?
    @State private var subagentList: SubagentListRoute?
    @State private var showingPlans = false
    @State private var endingAgents: EndingAgents?
    @State private var prompts = ChatPromptState()
    @State private var viewportHeight: CGFloat = 700
    @State private var composerFocused = false
    @State private var resumeDraftFocus = false
    @State private var composerSheets = ChatComposerSheets()
    @State private var messagesBelow = false
    @State private var scrollToLatest = 0
    @State private var viewportWidth: CGFloat = 0
    @State private var showingIndex = false
    @State private var indexOnScreen: Set<String> = []
    /// A fork asked for from the message index, shown once the index has gone.
    @State private var forkAfterIndex: String?
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let title: String
    let isPrepared: Bool
    /// The project the chat stands in, which is what a fork's way back and a summary's way to the fork need.
    let workspace: MobileWorkspace?
    /// Passed in rather than read from the environment: a pushed navigation destination does not inherit the
    /// environment of the view that declared it, so a chat opened from a project lost its plans and sub-agents.
    let machineSession: SharedMachineSession?

    init(
        client: any MachineRequesting, chatID: String, title: String, isPrepared: Bool = true,
        workspace: MobileWorkspace? = nil, session: SharedMachineSession? = nil
    ) {
        _model = State(
            initialValue: ChatModel(
                client: client, chatID: chatID, machineID: (session ?? workspace?.session)?.machine.id ?? "local"))
        self.title = title
        self.isPrepared = isPrepared
        self.workspace = workspace
        machineSession = session ?? workspace?.session
    }

    var body: some View {
        VStack(spacing: 0) {
            if let error = model.error {
                SessionErrorBanner(message: error, retryTitle: "Reload conversation") { model.attach() }
            }
            MobileScrollViewport(edges: .top) { insets in
                ChatTimeline(
                    presentation: model.presentation, client: model.client, chatID: model.chatID,
                    topInset: insets.top, composer: AnyView(composerDock),
                    latestButton: showScrollButton && !scrollButtonBesideComposer ? AnyView(scrollToBottomButton) : nil,
                    status: timelineStatus,
                    onViewportHeightChanged: { viewportHeight = $0 }, dismissKeyboard: { composerFocused = false },
                    scrollToLatest: scrollToLatest, onMessagesBelowChanged: { messagesBelow = $0 },
                    onNearTop: { model.loadOlderIfIdle() }
                )
            }
            .overlay(alignment: .top) {
                if model.loadingHistory {
                    MobileLoadingRow("Loading earlier messages")
                        .padding(.top, 8)
                        .allowsHitTesting(false)
                }
            }
        }
        .onGeometryChange(for: CGSize.self) {
            $0.size
        } action: {
            viewportWidth = $0.width
        }
        .onChange(of: model.pending, initial: true) { _, requests in
            prompts.update(requests)
        }
        .onChange(of: prompts.activeID) { previous, next in
            if next != nil && previous == nil {
                resumeDraftFocus = composerFocused
                composerFocused = false
            } else if next == nil && resumeDraftFocus && visible {
                composerFocused = true
                resumeDraftFocus = false
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .background(MobileStyle.surface.ignoresSafeArea())
        .tint(MobileStyle.accent)
        .navigationTitle(title)
        .modifier(ChatForkTitle(subtitle: forkSubtitle) { forkBackItems })
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityAction(.escape) { composerFocused = false }
        .toolbar {
            if let plans = machineSession?.plans, let plan = plans.plans(for: model.chatID).first {
                ToolbarItem(placement: .topBarTrailing) {
                    PlanButton(
                        plan: plan, unseen: plans.unseen.contains(model.chatID),
                        working: model.info["activeTurnId"]?.stringValue != nil
                    ) { showingPlans = true }
                }
                .sharedBackgroundVisibility(.hidden)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if messageMarks.count >= 3 || hasSubagents {
                        Section {
                            if messageMarks.count >= 3 {
                                Button("Messages", lucideIcon: "list") {
                                    indexOnScreen = Set(model.presentation.visibleEntryIDs())
                                    showingIndex = true
                                }
                                .accessibilityIdentifier("chat.messages")
                            }
                            if hasSubagents {
                                Button("Sub-agents", lucideIcon: "bot") {
                                    subagentList = SubagentListRoute(chatID: model.chatID)
                                }
                                .accessibilityIdentifier("chat.subagents")
                            }
                        }
                    }
                    Group {
                        Picker("Streaming", selection: $streamingMode) {
                            ForEach(ChatStreamingMode.allCases, id: \.self) { mode in Text(mode.label).tag(mode) }
                        }
                        Section { forkItems }
                        Button("Clear conversation", lucideIcon: "trash", role: .destructive) { showingClear = true }
                        Button("Reload", lucideIcon: "refresh-cw") { model.attach() }
                    }
                    .disabled(!isPrepared)
                } label: {
                    Image(lucide: "ellipsis")
                }
                .accessibilityLabel("Conversation actions")
                .disabled(!isPrepared && messageMarks.count < 3 && !hasSubagents)
                // Anchored on the menu now that Messages lives inside it; a popover on iPad, a sheet on iPhone.
                .popover(isPresented: $showingIndex) {
                    ChatMessageIndex(
                        marks: messageMarks, onScreen: indexOnScreen, olderCursor: model.history.cursor,
                        presentation: model.presentation,
                        loadOlder: { model.loadOlderIfIdle() },
                        jump: { model.presentation.reveal(entryID: $0) },
                        fork: { turnID in
                            forkAfterIndex = turnID
                            showingIndex = false
                        }
                    )
                    .modifier(MobileSheetSurface())
                }
            }
        }
        .onChange(of: showingIndex) { _, showing in
            guard !showing, let turnID = forkAfterIndex else { return }
            forkAfterIndex = nil
            model.presentation.forkRequest = ChatForkRequest(turnID: turnID)
        }
        .mobileSheet(
            item: Binding(
                get: { model.presentation.forkRequest }, set: { model.presentation.forkRequest = $0 })
        ) { request in
            ChatForkSheet(
                model: model, turnID: request.turnID,
                originalTitle: workspace.flatMap { ChatForking.origin(in: $0.views, chatID: model.chatID)?.title }
                    ?? title,
                origin: workspace.flatMap { ChatForking.origin(in: $0.views, chatID: model.chatID)?.shape },
                forked: openFork)
        }
        .navigationDestination(
            item: Binding(get: { model.presentation.openRequest }, set: { model.presentation.openRequest = $0 })
        ) { id in
            if let workspace, let item = workspace.item(id) {
                ProjectItemPage(workspace: workspace, item: item)
            } else {
                ContentUnavailableView("This chat is no longer in the project", lucideIcon: "square-x")
            }
        }
        .mobileSheet(isPresented: $composerSheets.settings) { ChatRunSettings(model: model) }
        .mobileSheet(isPresented: $showingPlans) {
            if let plans = machineSession?.plans {
                PlanSheet(store: plans, chatID: model.chatID, chatTitle: title, model: model)
            }
        }
        .navigationDestination(item: $subagentList) { _ in
            SubagentListPage(model: model, tasks: machineSession?.tasks)
        }
        .navigationDestination(
            item: Binding(
                get: { model.presentation.conversationRequest },
                set: { model.presentation.conversationRequest = $0 })
        ) { crumb in
            SubagentConversationPage(
                client: model.client, chatID: model.chatID, crumb: crumb, cwd: model.info.text("cwd"),
                parent: model.presentation)
        }
        .onAppear {
            visible = true
            if isPrepared { start() }
        }
        .onChange(of: isPrepared) { _, prepared in
            if prepared && visible { start() }
        }
        .onDisappear {
            visible = false
            if holdingChat {
                holdingChat = false
                if let machineSession { machineSession.releaseChat(model) } else { model.stop() }
            }
        }
        .endingAgentsConfirmation($endingAgents)
        .alert("Clear this conversation?", isPresented: $showingClear) {
            Button("Cancel", role: .cancel) { clearDraft = nil }
            Button("Clear conversation", role: .destructive) {
                let snapshot = clearDraft
                clearDraft = nil
                Task {
                    if await model.perform("chat.clear", ["force": .bool(true)]), let snapshot, model.draft == snapshot
                    {
                        model.draft = ""
                    }
                }
            }
        } message: {
            Text("This removes the conversation history and stops any active turn on every client.")
        }
    }

    private var timelineStatus: AnyView? {
        if !isPrepared || model.loading {
            return AnyView(MobileLoadingRow("Loading conversation…"))
        }
        if model.messageCount == 0 {
            return AnyView(
                ContentUnavailableView(
                    "Start a conversation", lucideIcon: "messages-square",
                    description: Text("Messages and agent work appear here.")))
        }
        return nil
    }

    private func start() {
        guard !holdingChat else { return }
        holdingChat = true
        if let machineSession { model = machineSession.retainChat(model) } else { model.start() }
        if let workspace {
            let items = workspace.views.flatMap { view in [view] + view.list("nodes") }
            model.projectChats = items.filter { $0.text("kind") == "chat" }.map {
                ChatDraftReference(
                    id: $0.stableID, title: $0.text("title", fallback: $0.text("name", fallback: "Conversation")))
            }
            model.presentation.places = ChatPlaces(
                title: { ChatForking.origin(in: workspace.views, chatID: $0)?.title },
                shape: { ChatForking.origin(in: workspace.views, chatID: $0)?.shape },
                arrival: { await workspace.arrival(of: $0) })
        }
    }

    private var messageMarks: [ChatMessageMark] { ChatForking.marks(entries: model.presentation.entries) }

    private var forkOf: String? { model.info["forkOf"]?["chatId"]?.stringValue }
    private var originalTitle: String? { forkOf.flatMap { model.presentation.places?.title($0) } }

    private var forkSubtitle: String? {
        guard forkOf != nil else { return nil }
        return originalTitle.map { "Fork of \($0)" } ?? "Fork"
    }

    /// "Fork conversation" after the last turn that ended, and for a fork the ways back to its original.
    @ViewBuilder private var forkItems: some View {
        if let turnID = model.presentation.lastSettledTurnID {
            let refusal = model.presentation.forkRefusal(turnID: turnID)
            Button {
                model.presentation.forkRequest = ChatForkRequest(turnID: turnID)
            } label: {
                Label("Fork conversation", lucideIcon: "git-fork")
                if let refusal { Text(refusal) }
            }
            .disabled(refusal != nil)
        }
        forkBackItems
    }

    @ViewBuilder private var forkBackItems: some View {
        if let forkOf {
            let refusal = ChatForking.summaryRefusal(
                info: model.info, originalPresent: workspace == nil || originalTitle != nil)
            Button {
                summarize()
            } label: {
                Label(
                    originalTitle.map { "Summarize for \($0)" } ?? "Summarize for the original",
                    lucideIcon: "message-square-share")
                if let refusal { Text(refusal) }
            }
            .disabled(refusal != nil)
            Button("Show original", lucideIcon: "undo-2") { model.presentation.openRequest = forkOf }
                .disabled(originalTitle == nil)
        }
    }

    private func summarize() {
        let model = model
        Task {
            do {
                _ = try await model.client.request("chat.summarize", payload: model.target())
                model.error = nil
            } catch {
                model.error = ChatForking.message(for: error, action: "ask a fork for a summary")
            }
        }
    }

    /// Opens the fork once the machine has written it into the project, as the desktop reveals it.
    private func openFork(_ id: String) {
        let model = model
        Task {
            await model.refreshForks()
            guard !id.isEmpty, let places = model.presentation.places, await places.arrival(id) else { return }
            model.presentation.openRequest = id
        }
    }

    /// The toolbar offers the list only once the chat has a sub-agent to open.
    private var hasSubagents: Bool {
        model.presentation.subagentsRefused ? model.subagentRows.native : model.subagentRows.any
    }

    private var hasDraft: Bool {
        !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !model.attachments.isEmpty
    }

    private var showScrollButton: Bool { messagesBelow && !model.loading }
    private var scrollButtonBesideComposer: Bool { sizeClass == .regular && viewportWidth >= 640 }

    private var scrollToBottomButton: some View {
        Button {
            scrollToLatest += 1
        } label: {
            Image(lucide: "arrow-down", size: 16)
                .frame(width: 36, height: 36)
                .glassEffect(.regular.interactive(), in: .circle)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("Scroll to latest message")
        .accessibilityIdentifier("chat.scroll-to-bottom")
    }

    private var composerDock: some View {
        HStack(alignment: .bottom, spacing: 16) {
            VStack(spacing: 0) {
                if prompts.active == nil {
                    ChatActivityChips(model: model, tasks: machineSession?.tasks)
                    ChatComposerAccessory(model: model, focused: $composerFocused, availableHeight: viewportHeight)
                }
                GlassEffectContainer(spacing: 8) {
                    HStack(alignment: .bottom, spacing: 8) {
                        promptComposer
                        if model.working && prompts.active == nil { stopButton }
                    }
                }
                if prompts.active == nil {
                    ChatComposerPills(model: model, sheets: composerSheets, focused: $composerFocused)
                        .padding(.top, 4)
                }
            }
            .frame(maxWidth: 760)
            if scrollButtonBesideComposer {
                scrollToBottomButton
                    .opacity(showScrollButton ? 1 : 0)
                    .allowsHitTesting(showScrollButton)
                    .accessibilityHidden(!showScrollButton)
                    .padding(.bottom, 8)
            }
        }
        .frame(maxWidth: scrollButtonBesideComposer ? 820 : 760)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var promptComposer: some View {
        ChatComposerMorph(request: prompts.active) {
            ChatComposerView(
                model: model, sheets: composerSheets, focused: $composerFocused, availableHeight: viewportHeight,
                send: send)
        } prompt: { pending in
            ChatPromptCard(
                prompts: prompts, item: pending, connected: model.connected && !model.loading,
                hasDraft: hasDraft,
                denyReason: model.providers.first(where: {
                    $0["kind"] == model.info["provider"]
                })?["capabilities"]?["denyReason"]?.boolValue == true,
                availableHeight: viewportHeight
            ) { action, values in
                _ = try await model.client.request(action, payload: model.target(values))
            }
        }
    }

    private var stopButton: some View {
        Menu {
            Button("Stop turn", lucideIcon: "square") { Task { await model.perform("chat.cancel") } }
            Button("Stop with sub-agents", lucideIcon: "square", role: .destructive, action: stopWithSubagents)
        } label: {
            RoundedRectangle(cornerRadius: 4).fill(MobileStyle.text).frame(width: 16, height: 16)
                .frame(width: 52, height: 52)
                .glassEffect(.regular.interactive(), in: .circle)
                .contentShape(Circle())
        }
        .disabled(!model.connected)
        .accessibilityLabel("Stop")
        .accessibilityIdentifier("chat.stop")
        .transition(.scale.combined(with: .opacity))
    }

    /// Stops the turn, ends every agent the chat opened and marks its CLI's own sub-agents stopped; asks first only
    /// when that ends agents. An older machine ignores the flag and stops the turn alone.
    private func stopWithSubagents() {
        let model = model
        Task {
            let agents = await ChatSubagents.agentsEnded(with: [model.chatID], client: model.client)
            let run = { _ = await model.perform("chat.cancel", ["subagents": .bool(true)]) }
            if agents == 0 {
                await run()
            } else {
                endingAgents = EndingAgents(
                    title: "Stop the turn and its sub-agents?", message: ChatSubagents.stopsSubagentsWarning(agents),
                    run: run)
            }
        }
    }

    private func send() {
        guard model.canSend else { return }
        let snapshot = model.draft
        switch snapshot.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "/model":
            composerFocused = false
            composerSheets.settings = true
            model.draft = ""
        case "/clear":
            clearDraft = snapshot
            showingClear = true
        case "/stop", "/compact":
            Task {
                model.sending = true
                defer { model.sending = false }
                let action =
                    snapshot.trimmingCharacters(in: .whitespacesAndNewlines) == "/stop" ? "chat.cancel" : "chat.compact"
                if await model.perform(action), model.draft == snapshot { model.draft = "" }
            }
        default: Task { await model.send() }
        }
    }

}

struct SessionErrorBanner: View {
    let message: String
    var retryTitle = "Retry"
    let retry: () -> Void
    var body: some View {
        HStack(alignment: .top) {
            Image(lucide: "circle-alert")
            Text(message).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            Button(retryTitle, action: retry)
        }.padding().background(.regularMaterial).accessibilityElement(children: .contain)
    }
}

/// "Fork of <original>" under a fork's title, and the title opens the ways back to the original.
private struct ChatForkTitle<Items: View>: ViewModifier {
    let subtitle: String?
    @ViewBuilder let items: () -> Items

    func body(content: Content) -> some View {
        if let subtitle {
            content
                .navigationSubtitle(subtitle)
                .toolbarTitleMenu { items() }
        } else {
            content
        }
    }
}
