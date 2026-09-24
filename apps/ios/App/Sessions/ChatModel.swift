import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

@MainActor @Observable
final class ChatModel {
    let client: any MachineRequesting
    let chatID: String
    let presentation = ChatPresentation()
    var info: JSONValue = .null
    var items: [JSONValue] = []
    private(set) var messageCount = 0
    private(set) var pending: [JSONValue] = []
    /// Whether the thread holds a subagent row, and one with a pointer of its own; kept apart from `items` so the
    /// screen does not observe every streamed delta.
    private(set) var subagentRows = (any: false, native: false)
    /// Moves when a subagent row or the work under one changes, so the sub-agent page derives its lists again then and
    /// not on every word the main thread streams.
    private(set) var subagentRevision = 0
    var draft: String { didSet { UserDefaults.standard.set(draft, forKey: draftKey) } }
    var attachments: [ChatUpload] = []
    var mentions: [String] = []
    var skills: [String] = []
    var providers: [JSONValue] = []
    var suggestions: [String] = []
    var suggestionKind = ""
    var error: String?
    var connected = false
    var loading = false
    private(set) var loadingHistory = false
    private(set) var history = ChatHistory()
    private var historyRevision = 0
    var sending = false
    var revision = 0
    private var unsubscribe: [() -> Void] = []
    private var attachTask: Task<Void, Never>?
    @ObservationIgnored private var attachment: MachineAttachment?
    private var positions: [String: Int] = [:]
    private var generation = 0
    /// Whether this connection already attached again over an event the app could not read. Once is enough: the
    /// snapshot brings the thread up to date, and a machine that keeps sending such events would otherwise attach
    /// again on every one.
    private var reattachedOverRejectedEvent = false
    private var draftKey: String { "ruimte.chat.draft.\(chatID)" }

    init(client: any MachineRequesting, chatID: String) {
        self.client = client
        self.chatID = chatID
        draft = UserDefaults.standard.string(forKey: "ruimte.chat.draft.\(chatID)") ?? ""
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
                await refreshForks()
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

    func replace(_ snapshot: JSONValue) {
        historyRevision += 1
        loadingHistory = false
        history.replace(snapshot)
        info = snapshot["info"] ?? .null
        items = snapshot["items"]?.arrayValue ?? []
        positions = Dictionary(
            items.enumerated().compactMap { index, item in
                item["id"]?.stringValue.map { ($0, index) }
            }, uniquingKeysWith: { _, newest in newest })
        refreshPending()
        presentation.replace(items, info: info)
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

    func loadOlder() async {
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
                self.presentation.prepend(page["items"]?.arrayValue ?? [])
                self.subagentRevision += 1
                self.revision += 1
            }
        } catch {
            guard generation == current, historyRevision == currentHistory else { return }
            if case MachineClientError.server(code: "history-expired", message: _) = error {
                attach()
            } else {
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

    func send() async {
        guard !sending, connected,
            !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
        else { return }
        sending = true
        defer { sending = false }
        let text = draft
        let uploads = attachments
        let tokens = ChatDraftSyntax.tokens(in: text, mentions: mentions, skills: skills)
        let activeMentions = mentions.filter { value in tokens.contains { $0.kind == "@" && $0.value == value } }
        let activeSkills = skills.filter { value in tokens.contains { $0.kind == "$" && $0.value == value } }
        let values: [String: JSONValue] = [
            "text": .string(text), "mentions": .array(activeMentions.map(JSONValue.string)),
            "skills": .array(activeSkills.map(JSONValue.string)), "attachments": .array(uploads.map(\.payload)),
        ]
        if await perform("chat.send", values) {
            if draft == text {
                draft = ""
                mentions.removeAll()
                skills.removeAll()
            }
            attachments.removeAll { upload in uploads.contains { $0.id == upload.id } }
        }
    }

    func addAttachment(data: Data, name: String, mime: String) {
        guard !data.isEmpty, attachments.count < 8,
            attachments.reduce(data.count, { $0 + $1.data.count }) <= 10 * 1024 * 1024
        else {
            error = "Choose up to 8 nonempty files, totaling at most 10 MiB per message."
            return
        }
        attachments.append(ChatUpload(name: String(name.prefix(255)), mime: mime, data: data))
    }

    func search(_ kind: String, query: String) async {
        suggestionKind = kind
        suggestions = []
        do {
            switch kind {
            case "@":
                let result = try await client.request(
                    "fs.search",
                    payload: .object([
                        "cwd": info["cwd"] ?? .string(""), "query": .string(String(query.prefix(256))),
                        "limit": .number(30),
                    ]))
                guard !Task.isCancelled else { return }
                suggestions = result["files"]?.arrayValue?.compactMap(\.stringValue) ?? []
            case "$":
                let result = try await client.request("skills.list", payload: target())
                guard !Task.isCancelled else { return }
                suggestions = (result["skills"]?.arrayValue ?? []).compactMap { $0["name"]?.stringValue }
                    .filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query) }
            default:
                suggestions =
                    ["clear", "compact", "stop"] + (info["slashCommands"]?.arrayValue?.compactMap(\.stringValue) ?? [])
                suggestions = Array(Set(suggestions)).sorted().filter {
                    query.isEmpty || $0.localizedCaseInsensitiveContains(query)
                }
            }
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    @discardableResult
    func chooseSuggestion(_ value: String, selection: NSRange? = nil) -> NSRange {
        if suggestionKind == "@" { mentions = Array(Set(mentions + [value])).sorted() }
        if suggestionKind == "$" { skills = Array(Set(skills + [value])).sorted() }
        let insertion = ChatDraftSyntax.insertion(
            text: draft, selection: selection ?? NSRange(location: (draft as NSString).length, length: 0),
            kind: suggestionKind, value: value)
        draft = insertion.text
        return insertion.selection
    }
}

struct ChatUpload: Identifiable {
    let id = UUID()
    let name: String
    let mime: String
    let data: Data
    var payload: JSONValue {
        .object(["name": .string(name), "mime": .string(mime), "data": .string(data.base64EncodedString())])
    }
}
