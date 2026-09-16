import Darwin
import Foundation
import Security

public struct PushDeviceContext: Codable, Sendable {
    public var handle: String
    public var machinePublicKeys: [String: String]
    public init(handle: String, machinePublicKeys: [String: String]) {
        self.handle = handle
        self.machinePublicKeys = machinePublicKeys
    }
}

public struct SharedPushStore: Sendable {
    public static let group = "group.app.ruimte.mobile"
    private let accessGroup: String
    public init(accessGroup: String? = Bundle.main.object(forInfoDictionaryKey: "RuimtePushKeychainGroup") as? String)
        throws
    {
        guard let accessGroup, !accessGroup.isEmpty, !accessGroup.contains("$(") else { throw PushCryptoError.invalid }
        self.accessGroup = accessGroup
    }
    private var keyQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.ruimte.mobile.push",
            kSecAttrAccount as String: "decryption-key", kSecAttrAccessGroup as String: accessGroup,
        ]
    }
    public func key(create: Bool = false) throws -> PushDecryptionKey {
        var query = keyQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data { return try PushDecryptionKey(rawRepresentation: data) }
        guard status == errSecItemNotFound, create else { throw KeychainError(status: status) }
        let key = PushDecryptionKey()
        var insert = keyQuery
        insert[kSecValueData as String] = key.rawRepresentation
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let inserted = SecItemAdd(insert as CFDictionary, nil)
        if inserted == errSecDuplicateItem { return try self.key() }
        guard inserted == errSecSuccess else { throw KeychainError(status: inserted) }
        return key
    }
    public func context() throws -> PushDeviceContext? {
        guard let data = UserDefaults(suiteName: Self.group)?.data(forKey: "push-context") else { return nil }
        return try JSONDecoder().decode(PushDeviceContext.self, from: data)
    }
    public func save(_ context: PushDeviceContext?) throws {
        let defaults = UserDefaults(suiteName: Self.group)
        if let context {
            defaults?.set(try JSONEncoder().encode(context), forKey: "push-context")
        } else {
            defaults?.removeObject(forKey: "push-context")
        }
    }
    public func clear() throws {
        try save(nil)
        _ = try? clearAttention()
        let status = SecItemDelete(keyQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
    @discardableResult public func claim(
        id: String, expiresAt: Double, now: Double, unseenNode: String? = nil, issuedAt: Double? = nil
    ) throws
        -> Int
    {
        try ledger().claim(id: id, expiresAt: expiresAt, now: now, unseenNode: unseenNode, issuedAt: issuedAt)
    }
    @discardableResult public func clearAttention(node: String? = nil) throws -> Int {
        try ledger().clearAttention(node: node)
    }
    @discardableResult public func markRead(node: String, through: Double) throws -> Int {
        try ledger().markRead(node: node, through: through)
    }
    public func readThrough(node: String) throws -> Double { try ledger().readThrough(node: node) }
    public func attentionKeys() throws -> Set<String> { try ledger().attentionKeys() }
    private func ledger() throws -> PushReplayLedger {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.group) else {
            throw PushCryptoError.invalid
        }
        return PushReplayLedger(directory: container)
    }
}

public struct PushReplayLedger: Sendable {
    private let directory: URL
    public init(directory: URL) { self.directory = directory }
    public static func nodeKey(machineID: String, nodeID: String) throws -> String {
        String(decoding: try JSONValue.array([.string(machineID), .string(nodeID)]).encoded(), as: UTF8.self)
    }
    @discardableResult public func claim(
        id: String, expiresAt: Double, now: Double, unseenNode: String? = nil, issuedAt: Double? = nil
    ) throws
        -> Int
    {
        try locked {
            var receipts = try read("push-receipts").filter { $0.value > now }
            guard receipts[id] == nil else { throw PushCryptoError.replay }
            receipts[id] = expiresAt
            var nodes = try read("push-attention").filter { $0.value > now - 30 * 24 * 60 * 60 * 1000 }
            let timestamp = issuedAt ?? now
            let readThrough = try read("push-read")
            if let unseenNode, timestamp > (readThrough[unseenNode] ?? 0) {
                nodes[unseenNode] = max(nodes[unseenNode] ?? 0, timestamp)
            }
            try write(receipts, name: "push-receipts")
            try write(nodes, name: "push-attention")
            return nodes.count
        }
    }
    @discardableResult public func clearAttention(node: String? = nil) throws -> Int {
        try locked {
            var nodes = try read("push-attention")
            if let node { nodes.removeValue(forKey: node) } else { nodes.removeAll() }
            try write(nodes, name: "push-attention")
            return nodes.count
        }
    }
    @discardableResult public func markRead(node: String, through: Double) throws -> Int {
        try locked {
            var reads = try read("push-read")
            reads[node] = max(reads[node] ?? 0, through)
            var nodes = try read("push-attention")
            if let timestamp = nodes[node], timestamp <= through { nodes.removeValue(forKey: node) }
            try write(reads, name: "push-read")
            try write(nodes, name: "push-attention")
            return nodes.count
        }
    }
    public func readThrough(node: String) throws -> Double { try locked { try read("push-read")[node] ?? 0 } }
    public func attentionKeys() throws -> Set<String> { try locked { Set(try read("push-attention").keys) } }
    private func read(_ name: String) throws -> [String: Double] {
        let url = directory.appendingPathComponent(name + ".json")
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        return try JSONDecoder().decode([String: Double].self, from: Data(contentsOf: url))
    }
    private func write(_ entries: [String: Double], name: String) throws {
        try JSONEncoder().encode(entries).write(
            to: directory.appendingPathComponent(name + ".json"),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    private func locked<T>(_ action: () throws -> T) throws -> T {
        let lock = directory.appendingPathComponent("push-receipts.lock")
        let descriptor = open(lock.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw PushCryptoError.invalid }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw PushCryptoError.invalid }
        defer { flock(descriptor, LOCK_UN) }
        return try action()
    }
}
