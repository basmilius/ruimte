import Foundation
import Security

public struct KeychainError: Error, Sendable {
    public let status: OSStatus
}

public struct KeychainStore: SessionStore {
    public let service: String

    public init(service: String = "app.ruimte.mobile") {
        self.service = service
    }

    public func read() throws -> StoredSession? {
        guard let data = try readData(account: "session") else {
            return nil
        }
        return try JSONDecoder().decode(StoredSession.self, from: data)
    }

    public func write(_ session: StoredSession?) throws {
        guard let session else {
            let status = SecItemDelete(query(account: "session") as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw KeychainError(status: status)
            }
            return
        }
        let data = try JSONEncoder().encode(session)
        if try insertData(data, account: "session") {
            return
        }
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query(account: "session") as CFDictionary, attributes as CFDictionary)
        guard status == errSecSuccess else {
            throw KeychainError(status: status)
        }
    }

    public func readData(account: String) throws -> Data? {
        var attributes = query(account: account)
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(attributes as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError(status: status)
        }
        return data
    }

    @discardableResult
    public func insertData(_ data: Data, account: String) throws -> Bool {
        var attributes = query(account: account)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem {
            return false
        }
        guard status == errSecSuccess else {
            throw KeychainError(status: status)
        }
        return true
    }

    private func query(account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: false]
    }
}
