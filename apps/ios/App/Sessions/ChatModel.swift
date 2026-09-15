import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

@MainActor @Observable
final class ChatModel {
    let client: any MachineRequesting
    let chatID: String
    var info: JSONValue = .null
    var items: [JSONValue] = []
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
    var sending = false
    var revision = 0
    private var unsubscribe: [() -> Void] = []
    private var attachTask: Task<Void, Never>?
    @ObservationIgnored private var attachment: MachineAttachment?
    private var positions: [String: Int] = [:]
    private var generation = 0
    private var draftKey: String { "ruimte.chat.draft.\(chatID)" }

    init(client: any MachineRequesting, chatID: String) {
        self.client = client
        self.chatID = chatID
        draft = UserDefaults.standard.string(forKey: "ruimte.chat.draft.\(chatID)") ?? ""
    }

    var pending: [JSONValue] {
        items.filter {
            ($0["kind"]?.stringValue == "approval" && $0["decision"]?.stringValue == "pending")
                || ($0["kind"]?.stringValue == "question" && $0["state"]?.stringValue == "pending")
        }
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
            client.observeConnection { [weak self] available in
                guard let self else { return }
                self.connected = available
                if available {
                    self.attach()
                } else {
                    self.generation += 1
                    self.attachTask?.cancel()
                    self.loading = false
                    self.error =
                        "Connection lost. Your draft is saved; the chat will reload when the machine reconnects."
                }
            })
    }

    func stop() {
        generation += 1
        attachTask?.cancel()
        unsubscribe.forEach { $0() }
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
                _ = try await attachment.snapshot(payload: target()) { [weak self] snapshot in
                    guard let self, self.generation == current else { return }
                    self.replace(snapshot)
                    self.loading = false
                    self.error = nil
                }
                guard !Task.isCancelled, generation == current else { return }
                let result = try await client.request("provider.list", payload: .object([:]))
                guard !Task.isCancelled, generation == current else { return }
                providers = result["providers"]?.arrayValue ?? []
            } catch is CancellationError {} catch {
                guard generation == current else { return }
                loading = false
                self.error = error.localizedDescription
            }
        }
    }

    func replace(_ snapshot: JSONValue) {
        info = snapshot["info"] ?? .null
        items = snapshot["items"]?.arrayValue ?? []
        positions = Dictionary(
            items.enumerated().compactMap { index, item in
                item["id"]?.stringValue.map { ($0, index) }
            }, uniquingKeysWith: { _, newest in newest })
        revision += 1
    }

    func receive(_ event: JSONValue) {
        switch event["type"]?.stringValue {
        case "reset": replace(event)
        case "info": info = event["info"] ?? .null
        case "item":
            guard let item = event["item"], let id = item["id"]?.stringValue else { return }
            if let index = positions[id] {
                items[index] = item
            } else {
                positions[id] = items.count
                items.append(item)
            }
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
            revision += 1
        default: break
        }
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
        let values: [String: JSONValue] = [
            "text": .string(text), "mentions": .array(mentions.map(JSONValue.string)),
            "skills": .array(skills.map(JSONValue.string)), "attachments": .array(uploads.map(\.payload)),
        ]
        if await perform("chat.send", values) {
            if draft == text { draft = "" }
            attachments.removeAll { upload in uploads.contains { $0.id == upload.id } }
            mentions.removeAll()
            skills.removeAll()
        }
    }

    func addAttachment(data: Data, name: String, mime: String) {
        guard !data.isEmpty, data.count <= 25 * 1024 * 1024, attachments.count < 8 else {
            error = "Choose up to 8 files, each between 1 byte and 25 MiB."
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

    func chooseSuggestion(_ value: String) {
        if suggestionKind == "@" { mentions = Array(Set(mentions + [value])).sorted() }
        if suggestionKind == "$" { skills = Array(Set(skills + [value])).sorted() }
        draft += (draft.isEmpty || draft.hasSuffix(" ") ? "" : " ") + suggestionKind + value + " "
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
