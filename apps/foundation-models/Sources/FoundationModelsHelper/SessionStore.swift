import Darwin
import Foundation
import FoundationModels

struct SessionStoreError: Error, CustomStringConvertible {
    let description: String
}

// The helper's actor owns all transcript reads/writes; the descriptor only holds the process lock.
final class SessionStore: @unchecked Sendable {
    let id: String
    let folder: URL
    private let file: URL
    private let lockDescriptor: Int32
    private(set) var history: Transcript?
    private(set) var interrupted = false

    private struct Record: Codable {
        let version: Int
        let id: String
        let transcript: Transcript
        let history: Transcript?
        let toolsetFingerprint: String?
        let interrupted: Bool?
    }

    convenience init(arguments: [String]) throws {
        func value(_ flag: String) -> String? {
            guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
            return arguments[index + 1]
        }
        guard let id = value("--session"), let home = value("--home") else {
            throw SessionStoreError(description: "Expected --session UUID and --home absolute-path.")
        }
        try self.init(id: id, home: home)
    }

    init(id: String, home: String) throws {
        guard let uuid = UUID(uuidString: id), uuid.uuidString.lowercased() == id.lowercased(), home.hasPrefix("/") else {
            throw SessionStoreError(description: "Invalid session UUID or home path.")
        }
        self.id = uuid.uuidString.lowercased()
        var directory = URL(fileURLWithPath: home).resolvingSymlinksInPath()
        for component in ["apple-foundation", "sessions"] {
            directory.appendPathComponent(component, isDirectory: true)
            if !FileManager.default.fileExists(atPath: directory.path) {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            }
            let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
            guard attributes[.type] as? FileAttributeType == .typeDirectory,
                  (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == geteuid(),
                  ((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0) & 0o077 == 0 else {
                throw SessionStoreError(description: "Conversation storage must be a private directory owned by this account.")
            }
        }
        self.folder = directory
        self.file = directory.appendingPathComponent("\(self.id).json")
        let lock = directory.appendingPathComponent("\(self.id).lock")
        let descriptor = Darwin.open(lock.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw SessionStoreError(description: "Could not open conversation lock.") }
        var attributes = stat()
        guard fstat(descriptor, &attributes) == 0, attributes.st_uid == geteuid(), attributes.st_mode & S_IFMT == S_IFREG,
              attributes.st_mode & 0o077 == 0, flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(descriptor)
            throw SessionStoreError(description: "Conversation is already open, or its lock is not private.")
        }
        self.lockDescriptor = descriptor
    }

    deinit { Darwin.close(lockDescriptor) }

    func load(required: Bool, toolsetFingerprint: String? = nil) throws -> Transcript? {
        let descriptor = Darwin.open(file.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        if descriptor < 0 {
            if errno == ENOENT && !required { return nil }
            throw SessionStoreError(description: "Saved conversation is missing or cannot be opened safely.")
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        var attributes = stat()
        guard fstat(descriptor, &attributes) == 0, attributes.st_mode & S_IFMT == S_IFREG,
              attributes.st_uid == geteuid(), attributes.st_mode & 0o077 == 0,
              attributes.st_size <= 2 * 1024 * 1024 else {
            throw SessionStoreError(description: "Saved conversation is not a private regular file, or exceeds 2 MiB.")
        }
        guard let data = try handle.readToEnd() else { throw SessionStoreError(description: "Saved conversation is empty.") }
        let record = try JSONDecoder().decode(Record.self, from: data)
        guard [1, 2].contains(record.version), record.id == id else { throw SessionStoreError(description: "Saved conversation version or id does not match.") }
        if record.version == 2, toolsetFingerprint != nil, record.toolsetFingerprint == nil || record.history == nil {
            throw SessionStoreError(description: "The saved conversation is missing its tool compatibility or original history metadata.")
        }
        if let saved = record.toolsetFingerprint, saved != toolsetFingerprint {
            throw SessionStoreError(description: "The saved conversation uses different tool definitions. Start a new Apple chat; its saved history has been kept.")
        }
        history = record.history ?? record.transcript
        interrupted = record.interrupted ?? false
        return record.transcript
    }

    func save(_ transcript: Transcript, history: Transcript? = nil, toolsetFingerprint: String? = nil, interrupted: Bool = false) throws {
        let data = try JSONEncoder().encode(Record(version: 2, id: id, transcript: transcript, history: history,
                                                  toolsetFingerprint: toolsetFingerprint, interrupted: interrupted))
        guard data.count <= 2 * 1024 * 1024 else { throw SessionStoreError(description: "Conversation exceeds the 2 MiB storage limit.") }
        let temporary = folder.appendingPathComponent(".\(id)-\(UUID().uuidString).tmp")
        let descriptor = Darwin.open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw SessionStoreError(description: "Could not create private conversation checkpoint.") }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try handle.write(contentsOf: data)
        try handle.synchronize()
        guard Darwin.rename(temporary.path, file.path) == 0 else { throw SessionStoreError(description: "Could not replace conversation checkpoint.") }
        let directory = Darwin.open(folder.path, O_RDONLY | O_CLOEXEC)
        if directory >= 0 {
            defer { Darwin.close(directory) }
            guard fsync(directory) == 0 else { throw SessionStoreError(description: "Could not synchronize the conversation directory.") }
        }
    }
}
