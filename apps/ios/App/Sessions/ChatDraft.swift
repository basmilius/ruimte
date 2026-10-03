import CryptoKit
import Foundation
import Observation

struct ChatDraftReference: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String
}

struct ChatUploadDescriptor: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let name: String
    let mime: String
    let size: Int
}

struct ChatUpload: Identifiable, Equatable, Sendable {
    let descriptor: ChatUploadDescriptor
    let url: URL
    var id: UUID { descriptor.id }
    var name: String { descriptor.name }
    var mime: String { descriptor.mime }
    var size: Int { descriptor.size }
}

struct ChatDraftRecord: Codable, Equatable, Sendable {
    var version = 1
    var text = ""
    var mentions: [String] = []
    var skills: [String] = []
    var chats: [ChatDraftReference] = []
    var uploads: [ChatUploadDescriptor] = []
    var caret = 0
    var selectedLength = 0
    var deliveryUncertain = false
}

enum ChatDraftLimits {
    static let files = 8
    static let bytes = 10 * 1024 * 1024
    static let characters = 120_000
    static let pasteBytes = 32 * 1024

    static func attachmentProblem(count: Int, bytes: Int) -> String? {
        if count > files { return String(localized: "Choose up to 8 files per message.") }
        if bytes > Self.bytes { return String(localized: "Attachments can total at most 10 MiB per message.") }
        return nil
    }
}

actor ChatDraftFiles {
    nonisolated let directory: URL
    private var savedRevision = -1
    private var staged: Set<UUID> = []
    private var held: Set<UUID> = []

    init(machineID: String, chatID: String, root: URL? = nil) {
        let base =
            root
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ChatDrafts", isDirectory: true)
        let key = SHA256.hash(data: Data("\(machineID)\u{0}\(chatID)".utf8))
            .map { String(format: "%02x", $0) }.joined()
        directory = base.appendingPathComponent(key, isDirectory: true)
    }

    nonisolated func read() throws -> ChatDraftRecord? {
        let file = directory.appendingPathComponent("draft.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let record = try JSONDecoder().decode(ChatDraftRecord.self, from: Data(contentsOf: file))
        guard record.version == 1 else {
            throw DraftFailure(String(localized: "This draft was saved by a newer version of Ruimte."))
        }
        return record
    }

    nonisolated func upload(_ descriptor: ChatUploadDescriptor) -> ChatUpload {
        let name = Self.safeName(descriptor.name)
        let url = directory.appendingPathComponent(descriptor.id.uuidString, isDirectory: true)
            .appendingPathComponent(name)
        return ChatUpload(descriptor: descriptor, url: url)
    }

    func stage(data: Data, name: String, mime: String) throws -> ChatUpload {
        guard !data.isEmpty else { throw DraftFailure(String(localized: "This file is empty.")) }
        guard data.count <= ChatDraftLimits.bytes else {
            throw DraftFailure(String(localized: "Files must be at most 10 MiB."))
        }
        let descriptor = ChatUploadDescriptor(id: UUID(), name: Self.safeName(name), mime: mime, size: data.count)
        let file = upload(descriptor)
        try FileManager.default.createDirectory(
            at: file.url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: file.url, options: .atomic)
        staged.insert(file.id)
        return file
    }

    func save(_ record: ChatDraftRecord, revision: Int) throws {
        guard revision >= savedRevision else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(record).write(to: directory.appendingPathComponent("draft.json"), options: .atomic)
        savedRevision = revision
        held = Set(record.uploads.map(\.id))
        staged.subtract(held)
        for entry in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil))
            ?? []
        {
            guard let id = UUID(uuidString: entry.lastPathComponent), !held.contains(id), !staged.contains(id) else {
                continue
            }
            try? FileManager.default.removeItem(at: entry)
        }
    }

    func discard(_ upload: ChatUpload) {
        staged.remove(upload.id)
        if !held.contains(upload.id) { try? FileManager.default.removeItem(at: upload.url.deletingLastPathComponent()) }
    }

    func preserveUnreadableDraft() throws {
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        let backup = directory.deletingLastPathComponent().appendingPathComponent(
            directory.lastPathComponent + "-recovered-" + UUID().uuidString)
        try FileManager.default.moveItem(at: directory, to: backup)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for id in staged {
            let source = backup.appendingPathComponent(id.uuidString, isDirectory: true)
            if FileManager.default.fileExists(atPath: source.path) {
                try FileManager.default.moveItem(
                    at: source, to: directory.appendingPathComponent(id.uuidString, isDirectory: true))
            }
        }
    }

    private nonisolated static func safeName(_ raw: String) -> String {
        let name = String((raw as NSString).lastPathComponent.prefix(200))
        return name.isEmpty || name == "." || name == ".." ? String(localized: "Attachment") : name
    }
}

struct DraftFailure: LocalizedError, Sendable {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// The drafts of the chats open now, so a file mentioned from the files lands in the composer on screen instead of
/// under it on disk, where that composer would write over it.
@MainActor enum ChatDraftInbox {
    private final class Entry {
        weak var composition: ChatComposition?

        init(_ composition: ChatComposition) {
            self.composition = composition
        }
    }

    private static var open: [String: Entry] = [:]

    private static func key(machineID: String, chatID: String) -> String { machineID + "\u{0}" + chatID }

    static func register(_ composition: ChatComposition, machineID: String, chatID: String) {
        open = open.filter { $0.value.composition != nil }
        open[key(machineID: machineID, chatID: chatID)] = Entry(composition)
    }

    /// Adds `@path` to the chat's draft: the one on screen, or the saved one when the chat is not open.
    static func mention(_ path: String, machineID: String, chatID: String, root: URL? = nil) async {
        if let composition = open[key(machineID: machineID, chatID: chatID)]?.composition {
            composition.addMention(path)
            await composition.flush()
            return
        }
        let composition = ChatComposition(machineID: machineID, chatID: chatID, root: root)
        composition.addMention(path)
        await composition.flush()
    }
}

struct ChatDraftImport: Identifiable {
    let id: UUID
    let name: String
    var error: String?
}

@MainActor @Observable
final class ChatComposition {
    var text: String { didSet { changed() } }
    var mentions: [String] { didSet { changed() } }
    var skills: [String] { didSet { changed() } }
    var chats: [ChatDraftReference] { didSet { changed() } }
    var uploads: [ChatUpload] { didSet { changed() } }
    var selection: NSRange { didSet { if selection != oldValue { changed() } } }
    var deliveryUncertain: Bool { didSet { changed() } }
    var imports: [ChatDraftImport] = []
    var problem: String?
    private(set) var storageProblem: String?
    @ObservationIgnored let files: ChatDraftFiles
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private let legacyKey: String
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var canSave = true

    init(machineID: String, chatID: String, root: URL? = nil, defaults: UserDefaults = .standard) {
        files = ChatDraftFiles(machineID: machineID, chatID: chatID, root: root)
        self.defaults = defaults
        legacyKey = "ruimte.chat.draft.\(chatID)"
        var record = ChatDraftRecord()
        do {
            record = try files.read() ?? ChatDraftRecord(text: defaults.string(forKey: legacyKey) ?? "")
        } catch {
            storageProblem = String(localized: "Could not restore the draft. \(error.localizedDescription)")
            canSave = false
        }
        text = record.text
        mentions = record.mentions
        skills = record.skills
        chats = record.chats
        deliveryUncertain = record.deliveryUncertain
        uploads = record.uploads.map(files.upload)
        let location = min(max(0, record.caret), (record.text as NSString).length)
        selection = NSRange(
            location: location, length: min(max(0, record.selectedLength), (record.text as NSString).length - location))
        if uploads.contains(where: { !FileManager.default.fileExists(atPath: $0.url.path) }) {
            problem = String(localized: "A saved attachment is missing. Remove it and attach it again before sending.")
        }
        ChatDraftInbox.register(self, machineID: machineID, chatID: chatID)
    }

    /// A file mentioned from outside the composer, at the end of what is written so far.
    func addMention(_ path: String) {
        let token = "@\(path) "
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            text = token
        } else if text.hasSuffix(" ") || text.hasSuffix("\n") {
            text += token
        } else {
            text += " " + token
        }
        if !mentions.contains(path) { mentions = (mentions + [path]).sorted() }
        selection = NSRange(location: (text as NSString).length, length: 0)
    }

    var record: ChatDraftRecord {
        ChatDraftRecord(
            text: text, mentions: mentions, skills: skills, chats: chats,
            uploads: uploads.map(\.descriptor), caret: selection.location, selectedLength: selection.length,
            deliveryUncertain: deliveryUncertain)
    }

    var hasContent: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !uploads.isEmpty }
    var importing: Bool { imports.contains { $0.error == nil } }
    var restoreFailed: Bool { !canSave }
    var validation: String? {
        if text.utf16.count > ChatDraftLimits.characters {
            return String(localized: "Messages can contain at most 120,000 characters.")
        }
        let tokens = ChatDraftSyntax.tokens(in: text, mentions: mentions, skills: skills)
        if Set(tokens.filter { $0.kind == "@" }.map(\.value)).count > 64 {
            return String(localized: "Choose up to 64 file mentions.")
        }
        if Set(tokens.filter { $0.kind == "$" }.map(\.value)).count > 16 {
            return String(localized: "Choose up to 16 skills.")
        }
        if chats.count > 16 { return String(localized: "Choose up to 16 conversations.") }
        return ChatDraftLimits.attachmentProblem(count: uploads.count, bytes: uploads.reduce(0) { $0 + $1.size })
    }

    func reserve(_ name: String) -> UUID? {
        guard uploads.count + imports.count < ChatDraftLimits.files else {
            problem = String(localized: "Choose up to 8 files per message.")
            return nil
        }
        let id = UUID()
        imports.append(ChatDraftImport(id: id, name: name))
        return id
    }

    func finishImport(_ id: UUID, data: Data, name: String, mime: String) async {
        guard imports.contains(where: { $0.id == id }) else { return }
        do {
            let upload = try await files.stage(data: data, name: name, mime: mime)
            guard imports.contains(where: { $0.id == id }) else {
                await files.discard(upload)
                return
            }
            if let problem = ChatDraftLimits.attachmentProblem(
                count: uploads.count + 1, bytes: uploads.reduce(upload.size) { $0 + $1.size })
            {
                await files.discard(upload)
                throw DraftFailure(problem)
            }
            uploads.append(upload)
            imports.removeAll { $0.id == id }
            await flush()
        } catch { failImport(id, error: error) }
    }

    func failImport(_ id: UUID, error: Error) {
        guard let index = imports.firstIndex(where: { $0.id == id }) else { return }
        imports[index].error = error.localizedDescription
    }

    func flush() async {
        saveTask?.cancel()
        guard canSave else { return }
        let snapshot = record
        let current = revision
        do {
            try await files.save(snapshot, revision: current)
            storageProblem = nil
            defaults.removeObject(forKey: legacyKey)
        } catch { storageProblem = String(localized: "Could not save the draft. \(error.localizedDescription)") }
    }

    func recoverStorage() async {
        do {
            if !canSave {
                try await files.preserveUnreadableDraft()
                canSave = true
            }
            await flush()
        } catch { storageProblem = String(localized: "Could not save the draft. \(error.localizedDescription)") }
    }

    func takeBack(_ incoming: ChatDraftRecord, uploads added: [ChatUpload]) throws {
        if let problem = ChatDraftLimits.attachmentProblem(
            count: uploads.count + added.count, bytes: (uploads + added).reduce(0) { $0 + $1.size })
        {
            throw DraftFailure(problem)
        }
        text =
            text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? incoming.text : incoming.text + "\n\n" + text
        mentions = Array(Set(incoming.mentions + mentions)).sorted()
        skills = Array(Set(incoming.skills + skills)).sorted()
        chats = incoming.chats + chats.filter { existing in !incoming.chats.contains { $0.id == existing.id } }
        uploads = added + uploads
        selection = NSRange(location: (text as NSString).length, length: 0)
    }

    private func changed() {
        revision += 1
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            await self?.flush()
        }
    }
}
