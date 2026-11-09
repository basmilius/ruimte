import Foundation
import Observation
import RuimteIntelligentUI
import RuimtePulsar
import RuimteTransport

@MainActor @Observable
final class ChatModel {
    let client: any MachineRequesting
    let chatID: String
    let uiModels: ChatUiModels
    /// The machine the chat runs on, which is what a remembered account is kept for.
    let machineID: String
    let presentation = ChatPresentation()
    /// Nil until the machine answered the attach.
    var info: ChatInfo?
    var items: [ChatItem] = []
    private(set) var messageCount = 0
    private(set) var pending: [ChatItem] = []
    /// Whether the thread holds a subagent row; kept apart from `items` so the screen does not observe every
    /// streamed delta.
    private(set) var hasSubagentRows = false
    /// Moves only when a subagent row or the work under one changes, unlike `revision`, which moves on every streamed
    /// word.
    private(set) var subagentRevision = 0
    /// Moves only when a Workflow call changes, for the same reason.
    private(set) var workflowRevision = 0
    let composition: ChatComposition
    var draft: String {
        get { composition.text }
        set { composition.text = newValue }
    }
    var attachments: [ChatUpload] {
        get { composition.uploads }
        set { composition.uploads = newValue }
    }
    var mentions: [String] {
        get { composition.mentions }
        set { composition.mentions = newValue }
    }
    var skills: [String] {
        get { composition.skills }
        set { composition.skills = newValue }
    }
    var providers: [ProviderInfo] = []
    /// Nil from a machine before accounts.
    var accounts: ProviderAccountList?
    /// The machine's plan windows per account, `usage.limits`; nil until something on screen asked for them.
    var limits: UsageLimits?
    var continuing = false
    /// When the chat's snooze runs out, epoch ms; nil while it has none.
    var snoozedUntil: Double?
    @ObservationIgnored private let activity = ChatActivityDerivation()
    /// The sub-agents the composer's chip speaks for, derived again only when a subagent row or the thread's length
    /// moves, so a reader does not observe every streamed word.
    var activitySubagents: [ChatSubagentItem] {
        activity.subagents(revision: subagentRevision, count: messageCount) { history.subagents + items }
    }
    @ObservationIgnored private let workflowActivity = ChatWorkflowDerivation()
    /// The workflows the composer's chip speaks for, derived again only when a Workflow call or the thread's length
    /// moves.
    var activityWorkflows: [WorkflowCall] {
        workflowActivity.workflows(revision: workflowRevision, count: messageCount) { history.workflows + items }
    }
    var suggestions: [ChatSuggestion] = []
    var suggestionKind = ""
    var searching = false
    var searchProblem: String?
    @ObservationIgnored var referenceSource = ChatReferenceSource()
    /// The other open projects a `#` may point at, while the machine lets agents reach them.
    var reachedProjects: [JSONValue] = []
    /// What `#` offers in this chat now.
    var referables: [ChatReferable] { referenceSource.items() }
    /// A machine from before `viewReferences` drops `references`, so its `#` reaches chats only.
    var chatsOnly: Bool { !referenceSource.viewReferences() }
    var sendProblem: String?
    var sendUncertain: Bool {
        get { composition.deliveryUncertain }
        set { composition.deliveryUncertain = newValue }
    }
    var queueBusy = false
    var queueProblem: String?
    var settingsProblem: String?
    var configuring = false
    @ObservationIgnored private var searchGeneration = 0
    var error: String?
    var connected = false
    var loading = false
    private(set) var loadingHistory = false
    /// A page that failed is not asked for again until the conversation is read again; a scroll asks on every frame.
    @ObservationIgnored private var failedHistoryCursor: String?
    private(set) var history = ChatHistory()
    @ObservationIgnored private var historyRevision = 0
    var sending = false
    var revision = 0
    // Only the events and the link: the attach below resumes from `since` and rebuilds the thread, which no re-read
    // of a resource does.
    @ObservationIgnored private lazy var live = LiveResource(
        client: client,
        events: [
            .apply(.chatEvent, raw: { [weak self] payload in
                guard let self, !self.loading, let envelope = try? payload.decoded(as: ChatEventEnvelope.self),
                    envelope.chatId == self.chatID
                else { return }
                self.apply(envelope.event)
                if let seq = envelope.seq { self.lastSeq = Int(seq) }
            }),
            .apply(.accountsChanged, as: AccountsSnapshot.self) { [weak self] snapshot in
                self?.accounts = ProviderAccountList(snapshot)
            },
            .apply(.chatBookmarks, raw: { [weak self] payload in
                guard let self, payload["chatId"]?.stringValue == self.chatID else { return }
                self.presentation.setBookmarks(ChatBookmarks.parse(payload["bookmarks"]?.arrayValue ?? []))
            }),
            .apply(.chatVisuals, raw: { [weak self] payload in
                guard let self, payload["chatId"]?.stringValue == self.chatID else { return }
                self.presentation.setVisuals(ChatVisuals.parse(payload.list("visuals")))
            }),
            .apply(.snoozeChanged, raw: { [weak self] payload in
                guard let self else { return }
                self.snoozedUntil = ChatSnooze.until(of: self.chatID, in: payload)
            }),
            .apply(.usageLimitsChanged, as: UsageLimits.self) { [weak self] limits in
                guard let self, self.limits != nil else { return }
                self.limits = limits
            },
            .rejected(.chatEvent) { [weak self] payload in
                guard let self, payload["chatId"]?.stringValue == self.chatID, !self.loading,
                    !self.reattachedOverRejectedEvent
                else { return }
                self.reattachedOverRejectedEvent = true
                // With `since` the machine would answer with the very event this app could not read.
                self.lastSeq = nil
                self.attach()
            },
        ],
        connection: { [weak self] available in
            guard let self else { return }
            self.connected = available
            self.presentation.setConnected(available)
            if available {
                self.attach()
            } else {
                self.reattachedOverRejectedEvent = false
                self.generation += 1
                self.attachTask?.cancel()
                self.loading = false
                error = nil
            }
        })
    @ObservationIgnored private var attachTask: Task<Void, Never>?
    @ObservationIgnored private var attachment: MachineAttachment?
    @ObservationIgnored private lazy var output = ChatOutputWatch(client: client, chatID: chatID) {
        [weak self] saved in
        self?.presentation.setSaved(saved)
    }
    @ObservationIgnored private var positions: [String: Int] = [:]
    /// The place of the last event applied here in the chat's stream, offered as `since` on the next attach so the
    /// machine answers only what came after it.
    @ObservationIgnored private(set) var lastSeq: Int?
    @ObservationIgnored private var generation = 0
    /// One reattach per connection is enough, since the snapshot brings the thread up to date. A machine that keeps
    /// sending unreadable events would otherwise cause a reattach on every one.
    @ObservationIgnored private var reattachedOverRejectedEvent = false

    init(client: any MachineRequesting, chatID: String, machineID: String = "local", draftRoot: URL? = nil) {
        self.client = client
        self.chatID = chatID
        uiModels = ChatUiModels(
            scopeID: machineID,
            chatID: chatID,
            cache: UiBlockModelCache { itemID, block in
                UiBlockModel(chatID: chatID, itemID: itemID, block: block) { type, payload in
                    try await client.request(type, payload: payload)
                }
            },
            imageSave: ImageSaveCoordinator(chatID: chatID) { type, payload in
                try await client.request(type, payload: payload)
            })
        self.machineID = machineID
        composition = ChatComposition(machineID: machineID, chatID: chatID, root: draftRoot)
        if composition.deliveryUncertain { sendProblem = Self.uncertainSendMessage }
        presentation.forkable = true
    }

    /// The turn a person stopped that Continue would pick up; kept apart from `items` like `hasSubagentRows`.
    private(set) var continuableTurn: String?
    /// The stopped turn Continue went out for, since the chat takes a moment to answer and Continue must not stand
    /// there meanwhile.
    private(set) var continuedFor: String?
    /// The turn and its end a compaction could be offered for, whatever the time; nil while none could be.
    private(set) var compactionTurn: (id: String, endedAt: Double)?
    /// The turn a person kept the full history for. In memory only: the offer comes at most once per silence, and
    /// a refusal is not a setting.
    private(set) var keptHistoryFor: String?

    private func refreshResume() {
        let continuable = info.flatMap { ChatResume.continuableTurn(info: $0, items: items) }
        if continuable != continuableTurn { continuableTurn = continuable }
        let turn = info.flatMap {
            ChatResume.offerableTurn(
                info: $0, compaction: capabilities?.compaction.rawValue, items: items, dismissed: keptHistoryFor)
        }
        if turn?.id != compactionTurn?.id || turn?.endedAt != compactionTurn?.endedAt { compactionTurn = turn }
    }

    func compactionOffer(now: Date) -> ChatCompactionOffer? {
        guard let info, let turn = compactionTurn,
            now.timeIntervalSince1970 * 1000 >= ChatResume.dueAt(info: info, endedAt: turn.endedAt)
        else { return nil }
        return ChatCompactionOffer(
            turnID: turn.id, tokens: info.usage.contextTokens,
            reason: info.usage.cacheExpiresAt == nil ? .idle : .cacheExpired)
    }

    func keepFullHistory(_ turnID: String) {
        keptHistoryFor = turnID
        refreshResume()
    }

    /// Continue stands where the send button would while a person stopped the last turn and the box is empty.
    var offersContinue: Bool {
        guard let continuableTurn, continuableTurn != continuedFor else { return false }
        return connected && !loading && !sending && !composition.hasContent && pending.isEmpty
    }

    func continueTurn() async {
        guard offersContinue else { return }
        continuedFor = continuableTurn
        sending = true
        sendProblem = nil
        defer { sending = false }
        do {
            _ = try await client.request(
                .chatSend,
                payload: target([
                    "text": .string(ChatResume.continuePrompt), "mentions": .array([]), "skills": .array([]),
                    "chats": .array([]), "attachments": .array([]),
                ]))
            AppUsage.count(.messageSent)
        } catch {
            continuedFor = nil
            sendProblem = error.localizedDescription
        }
    }

    private func refreshPending() {
        refreshResume()
        messageCount = items.count
        let next = items.contains { $0.subagentItem.map { !$0.toolUseId.isEmpty } ?? false }
        if next != hasSubagentRows { hasSubagentRows = next }
        let visibleIDs = Set(items.map(\.id))
        let requests =
            history.pending.values.filter { !visibleIDs.contains($0.id) }.sorted { $0.id < $1.id }
            + items.filter(\.isPending)
        if requests != pending { pending = requests }
    }

    /// The machine's entry for the chat's CLI in `provider.list`.
    private var providerEntry: ProviderInfo? {
        guard let info else { return nil }
        return providers.first { $0.kind == info.provider }
    }

    var models: [ProviderModel] { providerEntry?.models ?? [] }

    func start() {
        guard !live.isStarted else { return }
        attachment = client.acquireAttachment(.chat, id: chatID)
        output.start()
        live.start()
    }

    func stop() {
        Task { await composition.flush() }
        generation += 1
        attachTask?.cancel()
        uiModels.imageSave.stop()
        output.stop()
        live.stop()
        loading = false
        let held = attachment
        attachment = nil
        Task { await held?.release() }
    }

    func attach() {
        generation += 1
        let current = generation
        attachTask?.cancel()
        loading = true
        attachTask = Task { [weak self] in
            guard let self else { return }
            do {
                guard let attachment else { throw CancellationError() }
                async let providerResult = loadProviders()
                async let accountResult = loadAccounts()
                let since = lastSeq
                var payload: [String: JSONValue] = ["historyLimit": .number(60)]
                if let since { payload["since"] = .number(Double(since)) }
                _ = try await attachment.snapshot(payload: target(payload)) { [weak self] result in
                    guard let self, self.generation == current else { return }
                    self.attached(result, since: since)
                    self.loading = false
                    self.error = nil
                }
                guard !Task.isCancelled, generation == current else { return }
                let result = try await providerResult
                guard !Task.isCancelled, generation == current else { return }
                providers = result.providers
                refreshResume()
                accounts = await accountResult.map(ProviderAccountList.init)
                await refreshForks()
                await readSnoozes()
            } catch is CancellationError {} catch {
                guard generation == current else { return }
                loading = false
                self.error = error.localizedDescription
            }
        }
    }

    private func loadProviders() async throws -> ProviderListResult {
        let result = try await client.request(.providerList, payload: .object([:])).decoded(as: ProviderListResult.self)
        AgentDirectory.shared.learn(result.providers)
        return result
    }

    /// Nil from a machine before accounts, which does not know the request.
    private func loadAccounts() async -> AccountsSnapshot? {
        try? await client.request(.accountsList).decoded(as: AccountsSnapshot.self)
    }

    /// Applies what came after `since` when the machine still held all of it, and its snapshot otherwise.
    func attached(_ result: JSONValue, since: Int?) {
        // A machine validates every frame it sends, so an answer that does not decode never comes.
        guard let snapshot = try? result.decoded(as: ChatAttachResult.self) else {
            lastSeq = nil
            return
        }
        let bookmarks = ChatBookmarks.parse(result["bookmarks"]?.arrayValue ?? [])
        let visuals = ChatVisuals.parse(result.list("visuals"))
        if since != nil, let events = snapshot.events {
            for event in events { apply(event) }
            if snapshot.info != info {
                info = snapshot.info
                presentation.setInfo(info)
            }
            presentation.setBookmarks(bookmarks)
            presentation.setVisuals(visuals)
        } else {
            replace(
                info: snapshot.info, items: snapshot.items, history: snapshot.history, pending: snapshot.pending ?? [],
                subagents: snapshot.subagents ?? [], workflows: snapshot.workflows ?? [], bookmarks: bookmarks,
                visuals: visuals)
        }
        lastSeq = snapshot.seq.map { Int($0) }
    }

    /// A machine without bookmarks or visuals sends none, and then this chat has none.
    private func replace(
        info: ChatInfo, items: [ChatItem], history page: ChatHistoryPage?, pending: [ChatItem],
        subagents: [ChatSubagentItem] = [], workflows: [ChatToolItem] = [], bookmarks: [ChatBookmark],
        visuals: [ChatVisual]
    ) {
        historyRevision += 1
        loadingHistory = false
        failedHistoryCursor = nil
        history.replace(history: page, pending: pending, subagents: subagents, workflows: workflows)
        self.info = info
        self.items = items
        reindex()
        refreshPending()
        presentation.earlierPageWaits = history.cursor != nil
        presentation.replace(items, info: info)
        presentation.setBookmarks(bookmarks)
        presentation.setVisuals(visuals)
        subagentRevision += 1
        workflowRevision += 1
        revision += 1
    }

    /// An event that is not one the contracts know is dropped; a machine never sends one, since each is validated.
    func receive(_ event: JSONValue) {
        guard let typed = try? event.decoded(as: ChatEvent.self) else { return }
        apply(typed)
    }

    private func apply(_ event: ChatEvent) {
        switch event {
        case .reset(let reset):
            replace(info: reset.info, items: reset.items, history: nil, pending: [], bookmarks: [], visuals: [])
        case .info(let change):
            info = change.info
            presentation.setInfo(info)
            refreshResume()
        case .item(let change):
            let item = change.item
            guard history.includes(item, index: change.historyIndex) else {
                refreshPending()
                if item.subagentItem != nil { subagentRevision += 1 }
                if Self.isWorkflow(item) { workflowRevision += 1 }
                return
            }
            if let index = positions[item.id] {
                items[index] = item
            } else {
                positions[item.id] = items.count
                items.append(item)
            }
            refreshPending()
            presentation.upsert(item)
            if Self.concernsSubagent(item) { subagentRevision += 1 }
            if Self.isWorkflow(item) { workflowRevision += 1 }
            revision += 1
        case .delta(let delta):
            guard let index = positions[delta.itemId] else { return }
            let item = ChatUiDelta.apply(delta, to: items[index])
            items[index] = item
            presentation.upsert(item, textOnly: true)
            if Self.concernsSubagent(item) { subagentRevision += 1 }
            revision += 1
        }
    }

    /// Finds the forks after each turn among the chats the machine has loaded; a machine that cannot say leaves
    /// the turns unmarked.
    func refreshForks() async {
        guard let chats = try? await client.request(.chatList, payload: .object([:])) else { return }
        presentation.setForks(ChatForking.forks(chats: chats.list("chats"), chatID: chatID))
    }

    /// The page before, unless one is on its way or there is none; cheap enough to ask on every scroll.
    func loadOlderIfIdle() {
        guard connected, !loading, !loadingHistory, let cursor = history.cursor, cursor != failedHistoryCursor else {
            return
        }
        Task { await loadOlder() }
    }

    /// The page before, waited for; what a jump to a message that is not loaded yet reads through. False when no
    /// page came, because there is none, one is on its way already or it failed.
    func loadOlderNow() async -> Bool {
        let before = history.cursor
        await loadOlder()
        return history.cursor != before
    }

    private func loadOlder() async {
        guard connected, !loading, !loadingHistory, let cursor = history.cursor else { return }
        let current = generation
        let currentHistory = historyRevision
        loadingHistory = true
        defer { if currentHistory == historyRevision { loadingHistory = false } }
        do {
            _ = try await client.request(
                .chatHistory, payload: target(["cursor": .string(cursor), "limit": .number(60)])
            ) { [weak self] page in
                guard let self, self.generation == current, self.historyRevision == currentHistory,
                    let page = try? page.decoded(as: ChatHistoryResult.self)
                else { return }
                self.items = self.history.prepend(page, to: self.items)
                self.reindex()
                self.refreshPending()
                self.presentation.earlierPageWaits = self.history.cursor != nil
                self.presentation.prepend(page.items)
                self.subagentRevision += 1
                self.workflowRevision += 1
                self.revision += 1
            }
        } catch {
            guard generation == current, historyRevision == currentHistory else { return }
            if error.machineCode == .historyExpired {
                lastSeq = nil
                attach()
            } else {
                failedHistoryCursor = cursor
                self.error = error.localizedDescription
            }
        }
    }

    private func reindex() {
        positions = Dictionary(
            items.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { _, newest in newest })
    }

    private static func concernsSubagent(_ item: ChatItem) -> Bool {
        if case .subagent = item { return true }
        return !(item.parentToolUseID ?? "").isEmpty
    }

    private static func isWorkflow(_ item: ChatItem) -> Bool {
        item.toolItem?.name == "Workflow"
    }

    func target(_ values: [String: JSONValue] = [:]) -> JSONValue {
        .object(values.merging(["chatId": .string(chatID)], uniquingKeysWith: { _, target in target }))
    }

    @discardableResult
    func perform(_ name: WireRequest, _ values: [String: JSONValue] = [:]) async -> Bool {
        do {
            _ = try await client.request(name, payload: target(values))
            error = nil
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    var capabilities: ProviderCapabilities? { providerEntry?.capabilities }
    var canAttach: Bool { capabilities?.attachments != false }
    var canMention: Bool { capabilities?.mentions != false }

    /// The `@`, `$`, `/` or `#` word the caret is in, unless it is already a chip or `#` has nothing to offer.
    var draftQuery: ChatDraftQuery? {
        guard let query = ChatDraftSyntax.query(in: draft, selection: composition.selection),
            !composition.tokens.contains(where: { $0.range.location == query.range.location })
        else { return nil }
        if query.kind == "#" && !ChatReferables.offers(referables, chatsOnly: chatsOnly) { return nil }
        return query
    }
    var queue: [ChatInfoQueueItem] { info?.queue ?? [] }
    var working: Bool { info?.activeTurnId != nil }
    var canSend: Bool {
        connected && !loading && !sending && !queueBusy && !configuring && !sendUncertain && composition.hasContent
            && composition.imports.isEmpty && composition.validation == nil
    }

    func send() async {
        guard canSend else { return }
        sending = true
        sendProblem = nil
        defer { sending = false }
        let snapshot = composition.record
        let uploads = attachments
        let picks = snapshot.chats + (snapshot.references ?? [])
        let tokens = ChatDraftSyntax.tokens(
            in: snapshot.text, mentions: snapshot.mentions, skills: snapshot.skills, references: picks)
        let placed = ChatDraftSyntax.presentReferences(in: snapshot.text, references: picks)
        let chatIDs = Set(snapshot.chats.map(\.id))
        let chats = placed.filter { chatIDs.contains($0) }
        // A machine without `viewReferences` drops the field, so only the chats it does know reach it.
        let references = chatsOnly ? [] : placed.filter { !chatIDs.contains($0) }
        do {
            let payloads = try await Task.detached {
                try uploads.map { upload -> JSONValue in
                    let data = try Data(contentsOf: upload.url, options: .mappedIfSafe)
                    guard data.count == upload.size else {
                        throw DraftFailure(String(localized: "An attachment changed. Attach it again before sending."))
                    }
                    return .object([
                        "name": .string(upload.name), "mime": .string(upload.mime),
                        "data": .string(data.base64EncodedString()),
                    ])
                }
            }.value
            // An interrupted or killed client cannot know whether the machine accepted this request.
            sendUncertain = true
            await composition.flush()
            var values: [String: JSONValue] = [
                "text": .string(snapshot.text),
                "mentions": .array(
                    snapshot.mentions.filter { value in tokens.contains { $0.kind == "@" && $0.value == value } }
                        .map(JSONValue.string)),
                "skills": .array(
                    snapshot.skills.filter { value in tokens.contains { $0.kind == "$" && $0.value == value } }.map(
                        JSONValue.string)),
                "chats": .array(chats.map(JSONValue.string)),
                "attachments": .array(payloads),
            ]
            if !references.isEmpty { values["references"] = .array(references.map(JSONValue.string)) }
            _ = try await client.request(.chatSend, payload: target(values))
            AppUsage.count(.messageSent)
            sendUncertain = false
            if draft == snapshot.text && mentions == snapshot.mentions && skills == snapshot.skills
                && composition.chats == snapshot.chats && composition.references == (snapshot.references ?? [])
            {
                draft = ""
                mentions = []
                skills = []
                composition.chats = []
                composition.references = []
                composition.selection = NSRange(location: 0, length: 0)
            }
            attachments.removeAll { upload in uploads.contains { $0.id == upload.id } }
            await composition.flush()
        } catch {
            if Self.mayHaveArrived(error) {
                sendUncertain = true
                sendProblem = Self.uncertainSendMessage
                if connected { attach() }
            } else {
                if error is MachineClientError { sendUncertain = false }
                sendProblem = error.localizedDescription
            }
            await composition.flush()
        }
    }

    /// Whether a request that failed this way may still have reached the machine.
    private static func mayHaveArrived(_ error: Error) -> Bool {
        switch error as? MachineClientError {
        case .disconnected?, .timeout?, .invalid?: true
        default: false
        }
    }

    private static let uncertainSendMessage =
        String(
            localized:
                "Sending was interrupted. The machine may already have it, so check the chat before you send again."
        )

    func addAttachment(data: Data, name: String, mime: String) async {
        guard let id = composition.reserve(name) else { return }
        await composition.finishImport(id, data: data, name: name, mime: mime)
    }

    func configure(_ values: [String: JSONValue]) async -> Bool {
        guard connected, !configuring, !sending else { return false }
        configuring = true
        defer { configuring = false }
        do {
            _ = try await client.request(.chatConfigure, payload: target(values))
            settingsProblem = nil
            return true
        } catch {
            settingsProblem = error.localizedDescription
            return false
        }
    }

    func queueAction(_ message: ChatInfoQueueItem, edit: Bool = false, sendNow: Bool = false) async {
        guard connected, !queueBusy, !sending, !composition.importing else { return }
        queueBusy = true
        queueProblem = nil
        defer { queueBusy = false }
        var recovered: [ChatUpload] = []
        var requestedRemoval = false
        let known = referables
        let picked = { (ids: [String]?) in
            (ids ?? []).compactMap { id in
                known.first { $0.id == id }.map { ChatDraftReference(id: id, title: $0.name) }
            }
        }
        let incoming = ChatDraftRecord(
            text: message.text, mentions: message.mentions ?? [], skills: message.skills ?? [],
            chats: picked(message.chats), references: picked(message.references))
        do {
            if edit {
                for stored in message.attachments ?? [] {
                    let resource = try await client.readResource(
                        .chatAttachment(chatID: chatID, id: stored.id), maxBytes: ChatDraftLimits.bytes)
                    recovered.append(
                        try await composition.files.stage(data: resource.data, name: stored.name, mime: stored.mime))
                }
                if let problem = ChatDraftLimits.attachmentProblem(
                    count: attachments.count + recovered.count,
                    bytes: (attachments + recovered).reduce(0) { $0 + $1.size })
                {
                    throw DraftFailure(problem)
                }
            }
            requestedRemoval = !sendNow
            _ = try await client.request(
                sendNow ? .chatSendNow : .chatUnqueue, payload: target(["messageId": .string(message.id)]))
            if !sendNow, let info {
                self.info = info.with(queue: queue.filter { $0.id != message.id })
            }
            if edit {
                try composition.takeBack(incoming, uploads: recovered)
                await composition.flush()
            }
        } catch {
            if edit, requestedRemoval, Self.mayHaveArrived(error) {
                do {
                    try composition.takeBack(incoming, uploads: recovered)
                    sendUncertain = true
                    sendProblem = String(
                        localized: "Could not take the message out of the queue. A copy is in your draft.")
                    queueProblem = sendProblem
                    await composition.flush()
                    if connected { attach() }
                    return
                } catch { queueProblem = error.localizedDescription }
            }
            for upload in recovered { await composition.files.discard(upload) }
            queueProblem = error.localizedDescription
        }
    }

    /// What the machine offers of its other open projects; none when it cannot tell or does not answer.
    func refreshReachedProjects() async {
        guard (client as? MachineFeatures)?.answers(.projectReferables) == true else { return }
        reachedProjects = (try? await client.request(.projectReferables))?.list("projects") ?? []
    }

    func search(_ kind: String, query: String) async {
        searchGeneration += 1
        let current = searchGeneration
        suggestionKind = kind
        // Models and accounts come from the catalog in hand, so they show at once, as on the desktop, and stay when the file search fails.
        suggestions = kind == "@" ? namedMentions(query) : []
        searchProblem = nil
        searching = true
        defer { if current == searchGeneration { searching = false } }
        do {
            try await Task.sleep(for: .milliseconds(180))
            var found: [ChatSuggestion] = []
            switch kind {
            case "#":
                await refreshReachedProjects()
                // Only what is still in the text: a pick a person deleted would stay out of the list for good.
                let exclude =
                    [chatID] + ChatDraftSyntax.presentReferences(in: composition.text, references: composition.picked)
                found = ChatReferables.suggestions(referables, chatsOnly: chatsOnly, query: query, exclude: exclude)
                    .map {
                        ChatSuggestion(
                            kind: "#", value: $0.id, title: $0.name, detail: "",
                            referable: $0)
                    }
            case "@":
                found = namedMentions(query)
                if canMention {
                    do {
                        let result = try await client.request(
                            .fsSearch,
                            payload: .object([
                                "cwd": .string(info?.cwd ?? ""), "query": .string(String(query.prefix(256))),
                                "limit": .number(20),
                            ])
                        ).decoded(as: FsSearchResult.self)
                        found += result.files.map {
                            ChatSuggestion(kind: "@", value: $0, title: ($0 as NSString).lastPathComponent, detail: $0)
                        }
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        // A failed search leaves out only the files; the models and accounts stay.
                        if current == searchGeneration, !Task.isCancelled { searchProblem = error.localizedDescription }
                    }
                }
            case "$":
                let result = try await client.request(.skillsList, payload: target())
                    .decoded(as: SkillsListResult.self)
                found = result.skills.filter {
                    query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)
                }
                .map { ChatSuggestion(kind: "$", value: $0.name, title: $0.name, detail: $0.description) }
            default:
                var local = ["clear", "stop", "model"]
                if capabilities?.compaction != ProviderCompaction.none { local.append("compact") }
                found = Array(Set(local + (info?.slashCommands ?? [])))
                    .filter {
                        !ChatSuggestion.terminalOnly.contains($0)
                            && (query.isEmpty || $0.localizedCaseInsensitiveContains(query))
                    }
                    .sorted().map {
                        ChatSuggestion(
                            kind: "/", value: $0, title: "/" + $0,
                            detail: local.contains($0)
                                ? String(localized: "Conversation action") : String(localized: "Agent command"))
                    }
            }
            guard !Task.isCancelled, current == searchGeneration else { return }
            suggestions = found
        } catch is CancellationError {} catch {
            guard current == searchGeneration, !Task.isCancelled else { return }
            searchProblem = error.localizedDescription
        }
    }

    private func namedMentions(_ query: String) -> [ChatSuggestion] {
        ChatTagSuggestions.models(providers: providers, accounts: accounts, query: query)
            + ChatTagSuggestions.accounts(providers: providers, accounts: accounts, query: query)
    }

    /// A picked view, node or chat becomes a `#name` chip in the text; the draft keeps the name it was spelled with,
    /// since a rename would otherwise unmake the chip. A chat goes apart, as `chats`.
    func chooseSuggestion(_ suggestion: ChatSuggestion) {
        var spelled = suggestion.value
        if let item = suggestion.referable {
            spelled = item.name
            let pick = ChatDraftReference(id: item.id, title: item.name)
            if item.kind == "chat" {
                if !composition.chats.contains(where: { $0.id == item.id }) { composition.chats.append(pick) }
            } else if !composition.references.contains(where: { $0.id == item.id }) {
                composition.references.append(pick)
            }
        }
        // A model or an account is found again by its pattern, so it adds no mention.
        if suggestion.kind == "@" && suggestion.section == nil {
            mentions = Array(Set(mentions + [suggestion.value])).sorted()
        }
        if suggestion.kind == "$" { skills = Array(Set(skills + [suggestion.value])).sorted() }
        let insertion = ChatDraftSyntax.insertion(
            text: draft, selection: composition.selection, kind: suggestion.kind, value: spelled)
        draft = insertion.text
        composition.selection = insertion.selection
    }
}

struct ChatSuggestion: Identifiable {
    let kind: String
    let value: String
    let title: String
    let detail: String
    /// What a `#` suggestion points at.
    var referable: ChatReferable?
    /// The heading of an `@` row below the files, `Models` or `Accounts`; nil for a file.
    var section: String? = nil
    /// The CLI whose mark a model or account row wears.
    var provider: String? = nil

    /// The heading over the suggestions a sigil opens.
    static func heading(_ kind: String) -> String {
        switch kind {
        case "@": String(localized: "Files")
        case "#": String(localized: "Views and nodes")
        case "$": String(localized: "Skills")
        default: String(localized: "Commands")
        }
    }
    var id: String { kind + value }
    var icon: String {
        if let referable { return referable.mark }
        return kind == "@" ? "file-text" : kind == "$" ? "zap" : "square-slash"
    }
    static let terminalOnly: Set<String> = [
        "bug", "color", "config", "doctor", "exit", "heapdump", "help", "hooks", "ide", "install-github-app",
        "keybindings", "login", "logout", "migrate-installer", "privacy-settings", "quit", "release-notes",
        "reload-plugins", "reload-skills", "rename", "resume", "status", "statusline", "terminal-setup", "theme",
        "upgrade", "vim",
    ]
}

/// The models and accounts `@` offers below the files, by the shared composer's rules (`tag-suggestions.ts`): only
/// once the query opens a word of a name or an id, never on a bare `@`.
enum ChatTagSuggestions {
    static let modelLimit = 5
    static let accountLimit = 3
    private static let unusable: Set<String> = ["signed-out", "not-found", "folder-missing", "failed"]

    static func startsAWord(_ text: String, _ query: String) -> Bool {
        guard !query.isEmpty else { return false }
        let haystack = text.lowercased()
        let needle = query.lowercased()
        var from = haystack.startIndex
        while let found = haystack.range(of: needle, range: from..<haystack.endIndex) {
            if found.lowerBound == haystack.startIndex
                || !haystack[haystack.index(before: found.lowerBound)].isLetter
                    && !haystack[haystack.index(before: found.lowerBound)].isNumber
            {
                return true
            }
            from = haystack.index(after: found.lowerBound)
        }
        return false
    }

    /// Whether a CLI can run a model now: an enabled account of it may run, or it keeps no accounts at all.
    static func signedIn(_ accounts: ProviderAccountList?, kind: String) -> Bool {
        let entries = accounts?.accounts(of: kind) ?? []
        return entries.isEmpty || entries.contains { $0.enabled && !unusable.contains($0.state ?? "") }
    }

    /// Whether the CLI's version is older than `minimum`; an unreadable version blocks nothing.
    static func tooOld(_ version: String?, minimum: String?) -> Bool {
        let parts = { (text: String?) -> [Int]? in
            guard let text, let match = ChatDraftSyntax.matches(#"(\d+)\.(\d+)(?:\.(\d+))?"#, in: text).first else {
                return nil
            }
            return (1...3).map { index in
                let range = match.range(at: index)
                return range.location == NSNotFound ? 0 : Int((text as NSString).substring(with: range)) ?? 0
            }
        }
        guard let installed = parts(version), let needed = parts(minimum) else { return false }
        return installed.lexicographicallyPrecedes(needed)
    }

    static func models(providers: [ProviderInfo], accounts: ProviderAccountList?, query: String) -> [ChatSuggestion] {
        guard !query.isEmpty else { return [] }
        let found = AgentCatalog.installedChats(providers).filter { signedIn(accounts, kind: $0.kind) }.flatMap {
            provider -> [(legacy: Bool, row: ChatSuggestion)] in
            let kind = provider.kind
            return provider.models.compactMap { model in
                guard startsAWord(model.name, query) || startsAWord(model.slug, query),
                    !tooOld(provider.version, minimum: model.minCliVersion)
                else { return nil }
                return (
                    model.legacy,
                    ChatSuggestion(
                        kind: "@", value: "model:\(kind)/\(model.slug)", title: model.name, detail: model.slug,
                        section: String(localized: "Models"), provider: kind)
                )
            }
        }
        return Array((found.filter { !$0.legacy } + found.filter(\.legacy)).map(\.row).prefix(modelLimit))
    }

    /// The accounts that are ready, of a CLI with a choice of account. The machine refuses one the project turned off.
    static func accounts(providers: [ProviderInfo], accounts: ProviderAccountList?, query: String) -> [ChatSuggestion] {
        guard !query.isEmpty, let accounts else { return [] }
        let found = AgentCatalog.installedChats(providers).flatMap { provider -> [ChatSuggestion] in
            let kind = provider.kind
            guard accounts.hasChoice(kind) else { return [] }
            return accounts.accounts(of: kind).filter { $0.enabled && $0.state == "ready" }.compactMap { entry in
                let name = entry.name(provider: provider.name)
                guard startsAWord(name, query) else { return nil }
                return ChatSuggestion(
                    kind: "@", value: "account:\(kind)/\(entry.id)", title: name, detail: provider.name,
                    section: String(localized: "Accounts"), provider: kind)
            }
        }
        return Array(found.prefix(accountLimit))
    }
}

extension ChatInfo {
    /// The info with another queue, for a message this device took out before the machine says so.
    fileprivate func with(queue: [ChatInfoQueueItem]) -> ChatInfo {
        ChatInfo(
            chatId: chatId, provider: provider, account: account, cwd: cwd, agentSessionId: agentSessionId,
            model: model, selection: selection, runtimeMode: runtimeMode, effectiveRuntimeMode: effectiveRuntimeMode,
            permissionMode: permissionMode, status: status, running: running, activeTurnId: activeTurnId,
            slashCommands: slashCommands, skills: skills, queue: queue, queuePaused: queuePaused,
            background: background, delegating: delegating, usage: usage, suggestedTitle: suggestedTitle,
            hidden: hidden, forkOf: forkOf, resumeAtReset: resumeAtReset, limit: limit, resumeAt: resumeAt,
            requests: requests, goal: goal, createdAt: createdAt)
    }
}
