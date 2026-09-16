import PhotosUI
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UniformTypeIdentifiers

struct ChatScreen: View {
    @AppStorage("ruimte.chat.streaming") private var streamingMode: ChatStreamingMode = .words
    @State private var model: ChatModel
    @Environment(\.mobileMachineSession) private var machineSession
    @State private var visible = false
    @State private var holdingChat = false
    @State private var showingFiles = false
    @State private var showingClear = false
    @State private var subagentList: SubagentListRoute?
    @State private var endingAgents: EndingAgents?
    @State private var pickerKind: String?
    @State private var photo: PhotosPickerItem?
    @State private var question: JSONValue?
    @State private var expandedRequest: String?
    @State private var denialReason = ""
    @State private var composerFocused = false
    @GestureState private var composerPressed = false
    @State private var composerSelection = NSRange(location: 0, length: 0)
    @State private var composerHeight: CGFloat = 72
    @State private var messagesBelow = false
    @State private var scrollToLatest = 0
    @State private var viewportWidth: CGFloat = 0
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme
    let title: String
    let isPrepared: Bool

    init(client: any MachineRequesting, chatID: String, title: String, isPrepared: Bool = true) {
        _model = State(initialValue: ChatModel(client: client, chatID: chatID))
        self.title = title
        self.isPrepared = isPrepared
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
                        VStack(spacing: 8) {
                            if let pending = model.pending.first { pendingDock(pending) }
                            composer
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
        .onGeometryChange(for: CGFloat.self) {
            $0.size.width
        } action: {
            viewportWidth = $0
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .background(MobileStyle.surface.ignoresSafeArea())
        .tint(MobileStyle.accent)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityAction(.escape) { composerFocused = false }
        .toolbar {
            if hasSubagents {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sub-agents", lucideIcon: "bot") { subagentList = SubagentListRoute(chatID: model.chatID) }
                        .accessibilityIdentifier("chat.subagents")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Streaming", selection: $streamingMode) {
                        ForEach(ChatStreamingMode.allCases, id: \.self) { mode in Text(mode.label).tag(mode) }
                    }
                    Button("Clear conversation", lucideIcon: "trash", role: .destructive) { showingClear = true }
                    Button("Reload", lucideIcon: "refresh-cw") { model.attach() }
                } label: {
                    Image(lucide: "ellipsis")
                }
                .accessibilityLabel("Conversation actions")
                .disabled(!isPrepared)
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
        .mobileSheet(isPresented: Binding(get: { question != nil }, set: { if !$0 { question = nil } })) {
            if let question { ChatQuestionSheet(model: model, item: question) }
        }
    }

    private func start() {
        guard !holdingChat else { return }
        holdingChat = true
        if let machineSession { model = machineSession.retainChat(model) } else { model.start() }
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
                if isWorking && hasDraft { stopAction }
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
        .glassEffect(.regular, in: composerShape)
        .overlay {
            composerShape.fill(.primary.opacity(composerPressed ? 0.07 : 0))
                .allowsHitTesting(false)
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0).updating($composerPressed) { _, pressed, _ in pressed = true }
        )
        .disabled(!model.connected || model.loading)
    }

    @ViewBuilder private var primaryAction: some View {
        if isWorking && !hasDraft {
            stopAction
        } else {
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
                .background(hasDraft ? MobileStyle.accent : MobileStyle.accent.opacity(0.25), in: Circle())
                .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .disabled(!model.connected || model.loading || model.sending || !hasDraft)
            .accessibilityLabel("Send message")
            .keyboardShortcut(.return, modifiers: .command)
        }
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

    private func pendingDock(_ item: JSONValue) -> some View {
        let requestID = item["requestId"]?.stringValue ?? ""
        let expanded = expandedRequest == requestID
        let isApproval = item["kind"]?.stringValue == "approval"
        let layout =
            dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 8))
        return VStack(alignment: .leading, spacing: 10) {
            layout {
                Button {
                    expandedRequest = expanded ? nil : requestID
                } label: {
                    HStack(spacing: 10) {
                        Image(lucide: isApproval ? "hand" : "message-circle-question-mark")
                            .foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item["toolName"]?.stringValue ?? "Answer needed")
                                .font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(
                                isApproval
                                    ? item["description"]?.stringValue ?? "The agent needs permission to continue."
                                    : "The agent has a question"
                            )
                            .font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(2)
                        }
                        Image(lucide: expanded ? "chevron-up" : "chevron-down", size: 12).foregroundStyle(
                            MobileStyle.muted)
                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel("Request details")
                    .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                HStack(spacing: 8) {
                    if isApproval {
                        approvalButton("Deny", decision: "deny", item: item)
                            .buttonStyle(.borderless).font(.subheadline)
                        approvalButton("Allow", decision: "allow", item: item)
                            .buttonStyle(.plain).font(.subheadline.weight(.semibold))
                            .foregroundStyle(colorScheme == .dark ? Color.black : Color.white)
                            .padding(.horizontal, 8)
                            .background(MobileStyle.accent, in: Capsule())
                    } else {
                        Button("Answer") { question = item }
                            .buttonStyle(.borderedProminent).controlSize(.small)
                            .foregroundStyle(colorScheme == .dark ? Color.black : Color.white)
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 44)
                    }
                }
            }
            if expanded {
                if isApproval {
                    Text(item["description"]?.stringValue ?? "The agent needs permission to continue.")
                        .font(.subheadline).foregroundStyle(MobileStyle.muted)
                    let changes = ChatFileChanges.grouped(
                        ChatFileChanges.fromTool(
                            .object([
                                "name": item["toolName"] ?? .null, "input": item["input"] ?? .null,
                                "changes": item["input"]?["changes"] ?? .array([]),
                            ])))
                    if !changes.isEmpty {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(changes) { change in ChatFileChangeView(change: change) }
                            }
                        }.frame(maxHeight: 240)
                    } else if let input = item["input"], let data = try? input.encoded(),
                        let text = String(data: data, encoding: .utf8)
                    {
                        ScrollView { CodeMessage(text: text, language: "json") }.frame(maxHeight: 180)
                    }
                    if model.providers.first(where: { $0["kind"] == model.info["provider"] })?["capabilities"]?[
                        "denyReason"]?.boolValue == true
                    {
                        TextField("Reason for declining, optional", text: $denialReason, axis: .vertical)
                            .font(.subheadline).textFieldStyle(.roundedBorder)
                            .onChange(of: requestID) { _, _ in denialReason = "" }
                    }
                    if item["canAllowAlways"]?.boolValue == true {
                        approvalButton("Always allow this tool", decision: "allow-always", item: item)
                            .font(.subheadline)
                    }
                }
                if model.pending.count > 1 {
                    Text("\(model.pending.count - 1) more requests waiting")
                        .font(.caption).foregroundStyle(MobileStyle.muted).monospacedDigit()
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 18))
        .disabled(!model.connected)
    }

    private func approvalValues(_ item: JSONValue, decision: String) -> [String: JSONValue] {
        var values: [String: JSONValue] = ["requestId": item["requestId"] ?? .null, "decision": .string(decision)]
        let reason = denialReason.trimmingCharacters(in: .whitespacesAndNewlines)
        if decision == "deny" && expandedRequest == item.text("requestId") && !reason.isEmpty {
            values["message"] = .string(reason)
        }
        return values
    }

    private func approvalButton(_ label: String, decision: String, item: JSONValue) -> some View {
        Button {
            Task {
                await model.perform(
                    "chat.approve", approvalValues(item, decision: decision))
            }
        } label: {
            Text(label).frame(minWidth: 44, minHeight: 44)
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

private struct ChatQuestionSheet: View {
    @Bindable var model: ChatModel
    let item: JSONValue
    @Environment(\.dismiss) private var dismiss
    @State private var answers: [String: String] = [:]
    @State private var selected: [String: Set<String>] = [:]
    @State private var submitting = false
    private var questions: [JSONValue] { item["questions"]?.arrayValue ?? [] }
    var body: some View {
        NavigationStack {
            MobileForm {
                ForEach(Array(questions.enumerated()), id: \.offset) { _, question in
                    let id = question["id"]?.stringValue ?? ""
                    Section(question["header"]?.stringValue ?? "Question") {
                        Text(question["question"]?.stringValue ?? "")
                        ForEach(Array((question["choices"]?.arrayValue ?? []).enumerated()), id: \.offset) {
                            _, choice in
                            let label = choice["label"]?.stringValue ?? ""
                            Button {
                                if question["multiSelect"]?.boolValue == true {
                                    var values = selected[id] ?? []
                                    if values.contains(label) { values.remove(label) } else { values.insert(label) }
                                    selected[id] = values
                                    answers[id] = values.sorted().joined(separator: ", ")
                                } else {
                                    answers[id] = label
                                }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(label)
                                        Text(choice["description"]?.stringValue ?? "").font(.caption).foregroundStyle(
                                            .secondary)
                                    }
                                    Spacer()
                                    if answers[id] == label || selected[id]?.contains(label) == true {
                                        Image(lucide: "check")
                                    }
                                }
                            }
                        }
                        TextField(
                            "Your answer",
                            text: Binding(
                                get: { answers[id] ?? "" },
                                set: {
                                    answers[id] = $0
                                    selected[id] = []
                                }), axis: .vertical)
                    }
                }
                if let error = model.error { Text(error).foregroundStyle(.red) }
                if item["async"]?.boolValue == true {
                    Button("Dismiss question") {
                        Task { if await model.perform("chat.dismiss", ["itemId": item["id"] ?? .null]) { dismiss() } }
                    }
                }
            }
            .navigationTitle("Answer questions")
            .onChange(of: model.pending) { _, _ in
                if !model.pending.contains(where: { $0["requestId"] == item["requestId"] }) { dismiss() }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") {
                        submitting = true
                        Task {
                            if await model.perform(
                                "chat.answer",
                                [
                                    "requestId": item["requestId"] ?? .null,
                                    "answers": .object(answers.mapValues(JSONValue.string)),
                                ])
                            {
                                dismiss()
                            }
                            submitting = false
                        }
                    }.disabled(
                        submitting
                            || questions.contains {
                                (answers[$0["id"]?.stringValue ?? ""] ?? "").trimmingCharacters(
                                    in: .whitespacesAndNewlines
                                ).isEmpty
                            })
                }
            }
        }
    }
}
