import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

@MainActor @Observable
final class ChatModel {
    let client: any MachineRequesting
    let chatID: String
    /// The machine the chat runs on, which is what a remembered account is kept for.
    let machineID: String
    let presentation = ChatPresentation()
    var info: JSONValue = .null
    var items: [JSONValue] = []
    private(set) var messageCount = 0
    private(set) var pending: [JSONValue] = []
    /// Whether the thread holds a subagent row, and one with a pointer of its own; kept apart from `items` so the
    /// screen does not observe every streamed delta.
    private(set) var subagentRows = (any: false, native: false)
    /// Moves only when a subagent row or the work under one changes, unlike `revision`, which moves on every streamed
    /// word.
    private(set) var subagentRevision = 0
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
    var providers: [JSONValue] = []
    /// Nil from a machine before accounts.
    var accounts: ProviderAccountList?
    /// The machine's plan windows per account, `usage.limits`; nil until something on screen asked for them.
    var limits: JSONValue?
    var continuing = false
    /// When the chat's snooze runs out, epoch ms; nil while it has none.
    var snoozedUntil: Double?
    /// False for a machine from before snoozes, which then offers none.
    var snoozeAvailable = false
    @ObservationIgnored private let activity = ChatActivityDerivation()
    /// The sub-agents the composer's chip speaks for, derived again only when a subagent row or the thread's length
    /// moves, so a reader does not observe every streamed word.
    var activitySubagents: [JSONValue] {
        activity.subagents(revision: subagentRevision, count: messageCount) { items }
    }
    var suggestions: [ChatSuggestion] = []
    var suggestionKind = ""
    var searching = false
    var searchProblem: String?
    var projectChats: [ChatDraftReference] = []
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
    private var historyRevision = 0
    var sending = false
    var revision = 0
    private var unsubscribe: [() -> Void] = []
    private var attachTask: Task<Void, Never>?
    @ObservationIgnored private var attachment: MachineAttachment?
    private var positions: [String: Int] = [:]
    private var generation = 0
    /// One reattach per connection is enough, since the snapshot brings the thread up to date. A machine that keeps
    /// sending unreadable events would otherwise cause a reattach on every one.
    private var reattachedOverRejectedEvent = false

    init(client: any MachineRequesting, chatID: String, machineID: String = "local", draftRoot: URL? = nil) {
        self.client = client
        self.chatID = chatID
        self.machineID = machineID
        composition = ChatComposition(machineID: machineID, chatID: chatID, root: draftRoot)
        if composition.deliveryUncertain { sendProblem = Self.uncertainSendMessage }
        presentation.forkable = true
    }

    private func refreshPending() {
        messageCount = items.count
        let rows = items.filter { $0.text("kind") == "subagent" && !$0.text("toolUseId").isEmpty }
        let next = (any: !rows.isEmpty, native: rows.contains { $0["native"]?.objectValue != nil })
        if next != subagentRows { subagentRows = next }
        let visibleIDs = Set(items.compactMap { $0["id"]?.stringValue })
        let requests =
            history.pending.values.filter { !visibleIDs.contains($0.text("id")) }.sorted {
                $0.text("id") < $1.text("id")
            }
            + items.filter(ChatHistory.isPending)
        if requests != pending { pending = requests }
    }

    var models: [JSONValue] {
        providers.first { $0["kind"] == info["provider"] }?["models"]?.arrayValue ?? []
    }

    func start() {
        guard unsubscribe.isEmpty else { return }
        attachment = client.acquireAttachment("chat", id: chatID)
        unsubscribe.append(
            client.subscribe("chat.event") { [weak self] payload in
                guard let self, payload["chatId"]?.stringValue == self.chatID, let event = payload["event"] else {
                    return
                }
                if !self.loading { self.receive(event) }
            })
        unsubscribe.append(
            client.subscribe(WireEvent.accountsChanged.rawValue) { [weak self] payload in
                self?.accounts = ProviderAccountList(payload)
            })
        unsubscribe.append(
            client.subscribe(WireEvent.chatBookmarks.rawValue) { [weak self] payload in
                guard let self, payload["chatId"]?.stringValue == self.chatID else { return }
                self.presentation.setBookmarks(ChatBookmarks.parse(payload["bookmarks"]?.arrayValue ?? []))
            })
        unsubscribe.append(
            client.subscribe(WireEvent.chatVisuals.rawValue) { [weak self] payload in
                guard let self, payload["chatId"]?.stringValue == self.chatID else { return }
                self.presentation.setVisuals(ChatVisuals.parse(payload.list("visuals")))
            })
        unsubscribe.append(
            client.subscribe(WireEvent.snoozeChanged.rawValue) { [weak self] payload in
                guard let self else { return }
                self.snoozedUntil = ChatSnooze.until(of: self.chatID, in: payload)
            })
        unsubscribe.append(
            client.subscribe(WireEvent.usageLimitsChanged.rawValue) { [weak self] payload in
                guard let self, self.limits != nil else { return }
                self.limits = payload
            })
        unsubscribe.append(
            client.subscribeRejected("chat.event") { [weak self] payload in
                guard let self, payload["chatId"]?.stringValue == self.chatID, !self.loading,
                    !self.reattachedOverRejectedEvent
                else { return }
                self.reattachedOverRejectedEvent = true
                self.attach()
            })
        unsubscribe.append(
            client.observeConnection { [weak self] available in
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
    }

    func stop() {
        Task { await composition.flush() }
        generation += 1
        attachTask?.cancel()
        for cancel in unsubscribe { cancel() }
        unsubscribe.removeAll()
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
                _ = try await attachment.snapshot(payload: target(["historyLimit": .number(60)])) {
                    [weak self] snapshot in
                    guard let self, self.generation == current else { return }
                    self.replace(snapshot)
                    self.loading = false
                    self.error = nil
                }
                guard !Task.isCancelled, generation == current else { return }
                let result = try await providerResult
                guard !Task.isCancelled, generation == current else { return }
                providers = result["providers"]?.arrayValue ?? []
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

    private func loadProviders() async throws -> JSONValue {
        try await client.request("provider.list", payload: .object([:]))
    }

    /// Nil from a machine before accounts, which does not know the request.
    private func loadAccounts() async -> JSONValue? {
        try? await client.request(WireRequest.accountsList.rawValue, payload: .object([:]))
    }

    func replace(_ snapshot: JSONValue) {
        historyRevision += 1
        loadingHistory = false
        failedHistoryCursor = nil
        history.replace(snapshot)
        info = snapshot["info"] ?? .null
        items = snapshot["items"]?.arrayValue ?? []
        positions = Dictionary(
            items.enumerated().compactMap { index, item in
                item["id"]?.stringValue.map { ($0, index) }
            }, uniquingKeysWith: { _, newest in newest })
        refreshPending()
        presentation.earlierPageWaits = history.cursor != nil
        presentation.replace(items, info: info)
        // A machine without bookmarks or visuals sends none, and then this chat has none.
        presentation.setBookmarks(ChatBookmarks.parse(snapshot["bookmarks"]?.arrayValue ?? []))
        presentation.setVisuals(ChatVisuals.parse(snapshot.list("visuals")))
        subagentRevision += 1
        revision += 1
    }

    func receive(_ event: JSONValue) {
        switch event["type"]?.stringValue {
        case "reset": replace(event)
        case "info":
            info = event["info"] ?? .null
            presentation.setInfo(info)
        case "item":
            guard let item = event["item"], let id = item["id"]?.stringValue else { return }
            guard history.includes(item, index: event["historyIndex"]) else {
                refreshPending()
                return
            }
            if let index = positions[id] {
                items[index] = item
            } else {
                positions[id] = items.count
                items.append(item)
            }
            refreshPending()
            presentation.upsert(item)
            if Self.concernsSubagent(item) { subagentRevision += 1 }
            revision += 1
        case "delta":
            guard let id = event["itemId"]?.stringValue, let index = positions[id],
                let delta = event["text"]?.stringValue, var item = items[index].objectValue
            else { return }
            if item["kind"]?.stringValue == "tool" {
                var progress = item["progress"]?.objectValue ?? [:]
                progress["output"] = .string((progress["output"]?.stringValue ?? "") + delta)
                item["progress"] = .object(progress)
            } else {
                item["text"] = .string((item["text"]?.stringValue ?? "") + delta)
            }
            items[index] = .object(item)
            presentation.upsert(.object(item), textOnly: true)
            if Self.concernsSubagent(.object(item)) { subagentRevision += 1 }
            revision += 1
        default: break
        }
    }

    /// Finds the forks after each turn among the chats the machine has loaded; a machine that cannot say leaves
    /// the turns unmarked.
    func refreshForks() async {
        guard let chats = try? await client.request("chat.list", payload: .object([:])) else { return }
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
                "chat.history", payload: target(["cursor": .string(cursor), "limit": .number(60)])
            ) { [weak self] page in
                guard let self, self.generation == current, self.historyRevision == currentHistory else { return }
                self.items = self.history.prepend(page, to: self.items)
                self.positions = Dictionary(
                    self.items.enumerated().map { ($0.element.text("id"), $0.offset) },
                    uniquingKeysWith: { _, newest in newest })
                self.refreshPending()
                self.presentation.earlierPageWaits = self.history.cursor != nil
                self.presentation.prepend(page["items"]?.arrayValue ?? [])
                self.subagentRevision += 1
                self.revision += 1
            }
        } catch {
            guard generation == current, historyRevision == currentHistory else { return }
            if case MachineClientError.server(code: "history-expired", message: _) = error {
                attach()
            } else {
                failedHistoryCursor = cursor
                self.error = error.localizedDescription
            }
        }
    }

    private static func concernsSubagent(_ item: JSONValue) -> Bool {
        item.text("kind") == "subagent" || !(item["parentToolUseId"]?.stringValue ?? "").isEmpty
    }

    func target(_ values: [String: JSONValue] = [:]) -> JSONValue {
        .object(values.merging(["chatId": .string(chatID)], uniquingKeysWith: { _, target in target }))
    }

    @discardableResult
    func perform(_ name: String, _ values: [String: JSONValue] = [:]) async -> Bool {
        do {
            _ = try await client.request(name, payload: target(values))
            error = nil
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    var capabilities: JSONValue { providers.first { $0["kind"] == info["provider"] }?["capabilities"] ?? .null }
    var canAttach: Bool { capabilities["attachments"]?.boolValue != false }
    var canMention: Bool { capabilities["mentions"]?.boolValue != false }
    var queue: [JSONValue] { info.list("queue") }
    var working: Bool { info["activeTurnId"]?.stringValue != nil }
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
        let tokens = ChatDraftSyntax.tokens(in: snapshot.text, mentions: snapshot.mentions, skills: snapshot.skills)
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
            _ = try await client.request(
                "chat.send",
                payload: target([
                    "text": .string(snapshot.text),
                    "mentions": .array(
                        snapshot.mentions.filter { value in tokens.contains { $0.kind == "@" && $0.value == value } }
                            .map(JSONValue.string)),
                    "skills": .array(
                        snapshot.skills.filter { value in tokens.contains { $0.kind == "$" && $0.value == value } }.map(
                            JSONValue.string)),
                    "chats": .array(snapshot.chats.map { .string($0.id) }),
                    "attachments": .array(payloads),
                ]))
            sendUncertain = false
            if draft == snapshot.text && mentions == snapshot.mentions && skills == snapshot.skills
                && composition.chats == snapshot.chats
            {
                draft = ""
                mentions = []
                skills = []
                composition.chats = []
                composition.selection = NSRange(location: 0, length: 0)
            }
            attachments.removeAll { upload in uploads.contains { $0.id == upload.id } }
            await composition.flush()
        } catch {
            if let failure = error as? MachineClientError {
                switch failure {
                case .disconnected, .timeout, .invalid:
                    sendUncertain = true
                    sendProblem = Self.uncertainSendMessage
                    if connected { attach() }
                default:
                    sendUncertain = false
                    sendProblem = error.localizedDescription
                }
            } else {
                sendProblem = error.localizedDescription
            }
            await composition.flush()
        }
    }

    private static let uncertainSendMessage =
        String(
            localized:
                "The send was interrupted. Check the conversation before sending again; the machine may already have received it."
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
            _ = try await client.request("chat.configure", payload: target(values))
            settingsProblem = nil
            return true
        } catch {
            settingsProblem = error.localizedDescription
            return false
        }
    }

    func queueAction(_ message: JSONValue, edit: Bool = false, sendNow: Bool = false) async {
        guard connected, !queueBusy, !sending, !composition.importing else { return }
        queueBusy = true
        queueProblem = nil
        defer { queueBusy = false }
        var recovered: [ChatUpload] = []
        var requestedRemoval = false
        let incoming = ChatDraftRecord(
            text: message.text("text"),
            mentions: message.list("mentions").compactMap(\.stringValue),
            skills: message.list("skills").compactMap(\.stringValue),
            chats: message.list("chats").compactMap { value in
                guard let id = value.stringValue else { return nil }
                return projectChats.first { $0.id == id }
                    ?? ChatDraftReference(id: id, title: String(localized: "Conversation"))
            })
        do {
            if edit {
                for stored in message.list("attachments") {
                    let resource = try await client.readResource(
                        .object([
                            "kind": .string("attachment"), "chatId": .string(chatID),
                            "attachmentId": stored["id"] ?? .null,
                        ]), maxBytes: ChatDraftLimits.bytes)
                    recovered.append(
                        try await composition.files.stage(
                            data: resource.data, name: stored.text("name"), mime: stored.text("mime")))
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
                sendNow ? "chat.sendNow" : "chat.unqueue", payload: target(["messageId": message["id"] ?? .null]))
            if !sendNow, var values = info.objectValue {
                values["queue"] = .array(queue.filter { $0["id"] != message["id"] })
                info = .object(values)
            }
            if edit {
                try composition.takeBack(incoming, uploads: recovered)
                await composition.flush()
            }
        } catch {
            if edit, requestedRemoval, let failure = error as? MachineClientError {
                switch failure {
                case .disconnected, .timeout, .invalid:
                    do {
                        try composition.takeBack(incoming, uploads: recovered)
                        sendUncertain = true
                        sendProblem = String(
                            localized:
                                "Taking the message out of the queue was interrupted. A copy is saved in your draft. Check the conversation and queue before sending again."
                        )
                        queueProblem = sendProblem
                        await composition.flush()
                        if connected { attach() }
                        return
                    } catch { queueProblem = error.localizedDescription }
                default: break
                }
            }
            for upload in recovered { await composition.files.discard(upload) }
            queueProblem = error.localizedDescription
        }
    }

    func search(_ kind: String, query: String) async {
        searchGeneration += 1
        let current = searchGeneration
        suggestionKind = kind
        suggestions = []
        searchProblem = nil
        searching = true
        defer { if current == searchGeneration { searching = false } }
        do {
            try await Task.sleep(for: .milliseconds(180))
            var found: [ChatSuggestion] = []
            switch kind {
            case "@":
                found = projectChats.filter {
                    $0.id != chatID && !composition.chats.contains($0)
                        && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query))
                }
                .prefix(4).map {
                    ChatSuggestion(
                        kind: "chat", value: $0.id, title: $0.title, detail: String(localized: "Conversation"))
                }
                if canMention {
                    let result = try await client.request(
                        "fs.search",
                        payload: .object([
                            "cwd": info["cwd"] ?? .string(""), "query": .string(String(query.prefix(256))),
                            "limit": .number(20),
                        ]))
                    found += result.list("files").compactMap(\.stringValue).map {
                        ChatSuggestion(kind: "@", value: $0, title: ($0 as NSString).lastPathComponent, detail: $0)
                    }
                }
            case "$":
                let result = try await client.request("skills.list", payload: target())
                found = result.list("skills").filter {
                    query.isEmpty || $0.text("name").localizedCaseInsensitiveContains(query)
                }
                .map {
                    ChatSuggestion(
                        kind: "$", value: $0.text("name"), title: $0.text("name"), detail: $0.text("description"))
                }
            default:
                var local = ["clear", "stop", "model"]
                if capabilities.text("compaction") != "none" { local.append("compact") }
                found = Array(Set(local + info.list("slashCommands").compactMap(\.stringValue)))
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

    func chooseSuggestion(_ suggestion: ChatSuggestion) {
        if suggestion.kind == "chat" {
            if !composition.chats.contains(where: { $0.id == suggestion.value }) {
                composition.chats.append(ChatDraftReference(id: suggestion.value, title: suggestion.title))
            }
            if let query = ChatDraftSyntax.query(in: draft, selection: composition.selection), query.kind == "@" {
                draft = (draft as NSString).replacingCharacters(in: query.range, with: "")
                composition.selection = NSRange(location: query.range.location, length: 0)
            }
        } else {
            if suggestion.kind == "@" { mentions = Array(Set(mentions + [suggestion.value])).sorted() }
            if suggestion.kind == "$" { skills = Array(Set(skills + [suggestion.value])).sorted() }
            let insertion = ChatDraftSyntax.insertion(
                text: draft, selection: composition.selection, kind: suggestion.kind, value: suggestion.value)
            draft = insertion.text
            composition.selection = insertion.selection
        }
    }
}

struct ChatSuggestion: Identifiable {
    let kind: String
    let value: String
    let title: String
    let detail: String
    var id: String { kind + value }
    var icon: String {
        kind == "chat" ? "messages-square" : kind == "@" ? "file-text" : kind == "$" ? "sparkles" : "circle-slash"
    }
    static let terminalOnly: Set<String> = [
        "bug", "color", "config", "doctor", "exit", "heapdump", "help", "hooks", "ide", "install-github-app",
        "keybindings", "login", "logout", "migrate-installer", "privacy-settings", "quit", "release-notes",
        "reload-plugins", "reload-skills", "rename", "resume", "status", "statusline", "terminal-setup", "theme",
        "upgrade", "vim",
    ]
}
