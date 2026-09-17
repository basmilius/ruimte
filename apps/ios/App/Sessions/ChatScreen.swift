import PhotosUI
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UniformTypeIdentifiers

struct ChatScreen: View {
    @AppStorage("ruimte.chat.streaming") private var streamingMode: ChatStreamingMode = .words
    @State private var model: ChatModel
    @State private var visible = false
    @State private var holdingChat = false
    @State private var showingFiles = false
    @State private var showingClear = false
    @State private var subagentList: SubagentListRoute?
    @State private var showingPlans = false
    @State private var endingAgents: EndingAgents?
    @State private var pickerKind: String?
    @State private var photo: PhotosPickerItem?
    @State private var prompts = ChatPromptState()
    @State private var viewportHeight: CGFloat = 700
    @State private var composerFocused = false
    @GestureState private var composerPressed = false
    @State private var composerSelection = NSRange(location: 0, length: 0)
    @State private var composerHeight: CGFloat = 72
    @State private var messagesBelow = false
    @State private var scrollToLatest = 0
    @State private var viewportWidth: CGFloat = 0
    @State private var showingIndex = false
    @State private var indexOnScreen: Set<String> = []
    /// A fork asked for from the message index, shown once the index has gone.
    @State private var forkAfterIndex: String?
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme
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
        _model = State(initialValue: ChatModel(client: client, chatID: chatID))
        self.title = title
        self.isPrepared = isPrepared
        self.workspace = workspace
        machineSession = session ?? workspace?.session
    }

    var body: some View {
        VStack(spacing: 0) {
            if let error = model.error {
                SessionErrorBanner(message: error) { model.attach() }
            }
            MobileScrollViewport(edges: .top) { insets in
                ChatTimeline(
                    presentation: model.presentation, client: model.client, chatID: model.chatID,
                    topInset: insets.top, bottomInset: composerHeight, dismissKeyboard: { composerFocused = false },
                    scrollToLatest: scrollToLatest, onMessagesBelowChanged: { messagesBelow = $0 }
                )
            }
            .overlay {
                if !isPrepared || model.loading {
                    ProgressView().accessibilityLabel("Loading conversation…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .allowsHitTesting(false)
                } else if model.messageCount == 0 {
                    ContentUnavailableView(
                        "Start a conversation", lucideIcon: "messages-square",
                        description: Text("Messages and agent work appear here.")
                    )
                    .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .top) {
                if model.history.cursor != nil && !model.loading {
                    Button {
                        Task { await model.loadOlder() }
                    } label: {
                        if model.loadingHistory {
                            ProgressView()
                        } else {
                            Label("Load older messages", lucideIcon: "arrow-up", iconSize: 14)
                        }
                    }
                    .frame(minHeight: 44).buttonStyle(.bordered).glassEffect().padding(.top, 8)
                    .disabled(model.loadingHistory || !model.connected)
                    .accessibilityLabel(model.loadingHistory ? "Loading older messages" : "Load older messages")
                }
            }
            .overlay(alignment: .bottom) {
                HStack(alignment: .bottom, spacing: 16) {
                    GlassEffectContainer(spacing: 8) {
                        promptComposer
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
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    composerHeight = $0
                }
                .overlay(alignment: .top) {
                    if showScrollButton && !scrollButtonBesideComposer {
                        scrollToBottomButton.offset(y: -64)
                    }
                }
            }
        }
        .onGeometryChange(for: CGSize.self) {
            $0.size
        } action: {
            viewportWidth = $0.width
            viewportHeight = $0.height
        }
        .onChange(of: model.pending, initial: true) { _, requests in
            prompts.update(requests)
            if prompts.active != nil { composerFocused = false }
        }
        .ignoresSafeArea(.container, edges: .bottom)
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
                        marks: messageMarks, onScreen: indexOnScreen, olderAvailable: model.history.cursor != nil,
                        loadingOlder: model.loadingHistory, presentation: model.presentation,
                        loadOlder: { Task { await model.loadOlder() } },
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
            Button("Cancel", role: .cancel) {}
            Button("Clear conversation", role: .destructive) {
                Task { await model.perform("chat.clear", ["force": .bool(true)]) }
            }
        } message: {
            Text("This removes the conversation history and stops any active turn on every client.")
        }
        .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) {
            result in
            Task {
                do {
                    for url in try result.get() {
                        let accessed = url.startAccessingSecurityScopedResource()
                        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                        guard size <= 25 * 1024 * 1024 else {
                            model.error = "Files must be at most 25 MiB."
                            continue
                        }
                        let data = try Data(contentsOf: url, options: .mappedIfSafe)
                        model.addAttachment(
                            data: data, name: url.lastPathComponent,
                            mime: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                                ?? "application/octet-stream")
                    }
                } catch { model.error = error.localizedDescription }
            }
        }
        .onChange(of: photo) { _, item in
            Task {
                do {
                    if let data = try await item?.loadTransferable(type: Data.self) {
                        let type = item?.supportedContentTypes.first ?? .image
                        model.addAttachment(
                            data: data, name: "Photo.\(type.preferredFilenameExtension ?? "jpg")",
                            mime: type.preferredMIMEType ?? "image/jpeg")
                    }
                } catch { model.error = error.localizedDescription }
                photo = nil
            }
        }
        .mobileSheet(isPresented: Binding(get: { pickerKind != nil }, set: { if !$0 { pickerKind = nil } })) {
            ChatSuggestionPicker(
                model: model, kind: pickerKind ?? "@",
                choose: { value in
                    composerSelection = model.chooseSuggestion(value, selection: composerSelection)
                    pickerKind = nil
                    composerFocused = true
                }
            ) { pickerKind = nil }
        }
    }

    private func start() {
        guard !holdingChat else { return }
        holdingChat = true
        if let machineSession { model = machineSession.retainChat(model) } else { model.start() }
        if let workspace {
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

    private var isWorking: Bool { model.info["activeTurnId"]?.stringValue != nil }

    private var composerShape: ConcentricRectangle {
        ConcentricRectangle(corners: .concentric(minimum: 24))
    }

    private var promptComposer: some View {
        ChatComposerMorph(request: prompts.active) {
            composer
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

    private var composer: some View {
        let photoIcon = Image(lucide: "image")
        return VStack(alignment: .leading, spacing: 0) {
            if !model.attachments.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(model.attachments) { upload in
                            Button {
                                model.attachments.removeAll { $0.id == upload.id }
                            } label: {
                                Label(upload.name, lucideIcon: "circle-x", iconSize: 14)
                                    .font(.caption).lineLimit(1).padding(.horizontal, 10).frame(minHeight: 44)
                            }
                            .buttonStyle(.plain)
                            .background(MobileStyle.inset, in: Capsule())
                            .accessibilityLabel("Remove \(upload.name)")
                        }
                    }
                }.scrollIndicators(.hidden).padding(.horizontal, 12).padding(.top, 10)
            }
            RichChatComposer(
                text: $model.draft, selection: $composerSelection,
                mentions: model.mentions, skills: model.skills, focused: $composerFocused
            )
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 10)
            .frame(maxWidth: .infinity, minHeight: 52)
            .contentShape(Rectangle())
            .onTapGesture { composerFocused = true }
            .accessibilityIdentifier("chat.composer")
            if let queue = model.info["queue"]?.arrayValue, !queue.isEmpty {
                Text("\(queue.count) message\(queue.count == 1 ? "" : "s") queued")
                    .font(.caption).foregroundStyle(MobileStyle.muted).monospacedDigit()
                    .padding(.horizontal, 16).padding(.bottom, 6)
            }
            HStack(spacing: 0) {
                Menu {
                    Button("Attach files", lucideIcon: "file-text") { showingFiles = true }
                    Button("Mention a file", lucideIcon: "at-sign") { pickerKind = "@" }
                    Button("Use a skill", lucideIcon: "sparkles") { pickerKind = "$" }
                    Button("Command", lucideIcon: "circle-slash") { pickerKind = "/" }
                } label: {
                    Image(lucide: "plus").frame(width: 44, height: 44)
                }.accessibilityLabel("Add context")
                PhotosPicker(selection: $photo, matching: .images) {
                    photoIcon.frame(width: 44, height: 44)
                }.accessibilityLabel("Attach photo")
                modelMenu.frame(maxWidth: 200, alignment: .leading)
                Spacer(minLength: 0)
                if isWorking { stopAction }
                primaryAction
            }
            .font(.system(.subheadline, weight: .medium))
            .foregroundStyle(MobileStyle.muted)
            .padding(.horizontal, 14).padding(.bottom, 10)
        }
        .background {
            Color.clear
                .contentShape(composerShape)
                .onTapGesture { composerFocused = true }
        }
        .contentShape(composerShape)
        .overlay {
            composerShape.fill(.primary.opacity(composerPressed ? 0.07 : 0))
                .allowsHitTesting(false)
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0).updating($composerPressed) { _, pressed, _ in pressed = true }
        )
        .disabled(!model.connected || model.loading)
    }

    private var primaryAction: some View {
        Button {
            send()
        } label: {
            Group {
                if model.sending {
                    ProgressView()
                } else {
                    Image(lucide: "arrow-up", size: 15)
                }
            }
            .foregroundStyle(colorScheme == .dark ? Color.black : Color.white)
            .frame(width: 32, height: 32)
            .modifier(ChatComposerAction(prompt: false, loading: model.sending, opacity: hasDraft ? 1 : 0.25))
            .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .disabled(!model.connected || model.loading || model.sending || !hasDraft)
        .accessibilityLabel("Send message")
        .keyboardShortcut(.return, modifiers: .command)
    }

    private var stopAction: some View {
        Button {
            Task { await model.perform("chat.cancel") }
        } label: {
            Image(lucide: "square", size: 12)
                .foregroundStyle(MobileStyle.text).frame(width: 32, height: 32)
                .background(MobileStyle.inset, in: Circle()).frame(width: 44, height: 44)
        }.buttonStyle(.plain).accessibilityLabel("Stop turn")
            // A touch has no Shift-click, so stopping the sub-agents as well is the long press.
            .contextMenu {
                Button("Stop turn", lucideIcon: "square") { Task { await model.perform("chat.cancel") } }
                Button("Stop with sub-agents", lucideIcon: "square", role: .destructive) { stopWithSubagents() }
            }
            .accessibilityAction(named: "Stop with sub-agents") { stopWithSubagents() }
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

    private var modelMenu: some View {
        Menu {
            Section("Model") {
                ForEach(Array(model.models.enumerated()), id: \.offset) { _, option in
                    Button(option["name"]?.stringValue ?? "Model") {
                        configureSelection(.object(["model": option["slug"] ?? .null, "options": .object([:])]))
                    }
                }
            }
            if let selected = model.models.first(where: { $0["slug"] == model.info["selection"]?["model"] }) {
                ForEach(Array((selected["options"]?.arrayValue ?? []).enumerated()), id: \.offset) { _, option in
                    Menu(option["label"]?.stringValue ?? "Option") {
                        if option["type"]?.stringValue == "boolean" {
                            Button("On") { configureOption(option, value: .bool(true)) }
                            Button("Off") { configureOption(option, value: .bool(false)) }
                        } else {
                            ForEach(Array((option["choices"]?.arrayValue ?? []).enumerated()), id: \.offset) {
                                _, choice in
                                Button(choice["label"]?.stringValue ?? "Choice") {
                                    configureOption(option, value: choice["id"] ?? .null)
                                }
                            }
                        }
                    }
                }
            }
            Section("Permissions") {
                ForEach(["supervised", "auto-accept-edits", "auto", "full-access"], id: \.self) { mode in
                    Button(mode.replacingOccurrences(of: "-", with: " ").capitalized) {
                        Task {
                            if await model.perform("chat.configure", ["runtimeMode": .string(mode)]) {
                                ChatPreferences.shared.rememberRuntimeMode(mode)
                            }
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(model.info["selection"]?["model"]?.stringValue ?? "Model").lineLimit(1)
                Image(lucide: "chevron-down", size: 12)
            }.font(.caption.weight(.medium)).foregroundStyle(MobileStyle.muted).frame(minHeight: 44)
                .accessibilityValue(model.info["runtimeMode"]?.stringValue ?? "Permissions")
        }
    }

    private func configureOption(_ option: JSONValue, value: JSONValue) {
        guard let key = option["id"]?.stringValue, var selection = model.info["selection"]?.objectValue else { return }
        var options = selection["options"]?.objectValue ?? [:]
        options[key] = value
        selection["options"] = .object(options)
        configureSelection(.object(selection))
    }

    private func configureSelection(_ selection: JSONValue) {
        let provider = model.info.text("provider")
        Task {
            if await model.perform("chat.configure", ["selection": selection]) {
                ChatPreferences.shared.rememberSelection(selection, provider: provider)
            }
        }
    }

    private func send() {
        switch model.draft.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "/clear": showingClear = true
        case "/stop": Task { if await model.perform("chat.cancel") { model.draft = "" } }
        case "/compact": Task { if await model.perform("chat.compact") { model.draft = "" } }
        default: Task { await model.send() }
        }
    }

}

struct SessionErrorBanner: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        HStack(alignment: .top) {
            Image(lucide: "circle-alert")
            Text(message).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            Button("Retry", action: retry)
        }.padding().background(.regularMaterial).accessibilityElement(children: .contain)
    }
}

private struct ChatSuggestionPicker: View {
    @Bindable var model: ChatModel
    let kind: String
    let choose: (String) -> Void
    let close: () -> Void
    @State private var query = ""
    var body: some View {
        NavigationStack {
            List(model.suggestions, id: \.self) { value in
                Button(kind + value) {
                    choose(value)
                }
            }
            .overlay { if model.suggestions.isEmpty { ContentUnavailableView.search(text: query) } }
            .searchable(text: $query)
            .task(id: query) { await model.search(kind, query: query) }
            .navigationTitle(kind == "@" ? "Files" : kind == "$" ? "Skills" : "Commands")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done", action: close) } }
        }
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
