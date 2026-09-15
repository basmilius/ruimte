import CryptoKit
import Foundation
import Security

public enum Base64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ value: String) -> Data? {
        guard value.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }) else {
            return nil
        }
        let padding = String(repeating: "=", count: (4 - value.count % 4) % 4)
        return Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + padding)
    }

    public static func randomToken(bytes: Int = 32) throws -> String {
        var data = Data(count: bytes)
        let status = data.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, bytes, buffer.baseAddress!)
        }
        guard status == errSecSuccess else {
            throw KeychainError(status: status)
        }
        return encode(data)
    }
}

public protocol SessionSigner: Sendable {
    var publicKey: String { get }
    func sign(_ message: String) throws -> String
}

public struct DeviceKey: SessionSigner {
    private let key: Curve25519.Signing.PrivateKey

    public init(rawRepresentation: Data) throws {
        key = try Curve25519.Signing.PrivateKey(rawRepresentation: rawRepresentation)
    }

    public init() {
        key = Curve25519.Signing.PrivateKey()
    }

    public var publicKey: String {
        Base64URL.encode(key.publicKey.rawRepresentation)
    }

    public func sign(_ message: String) throws -> String {
        Base64URL.encode(try key.signature(for: Data(message.utf8)))
    }

    public static func verify(signature: String, message: String, publicKey: String) -> Bool {
        guard let signatureBytes = Base64URL.decode(signature), let keyBytes = Base64URL.decode(publicKey),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyBytes) else {
            return false
        }
        return key.isValidSignature(signatureBytes, for: Data(message.utf8))
    }

    public static func loadOrCreate(in store: KeychainStore) throws -> DeviceKey {
        if let bytes = try store.readData(account: "device-key") {
            return try DeviceKey(rawRepresentation: bytes)
        }
        let key = DeviceKey()
        // SecItemAdd lets simultaneous scenes converge on the first stored key.
        if try store.insertData(key.key.rawRepresentation, account: "device-key") {
            return key
        }
        guard let bytes = try store.readData(account: "device-key") else {
            throw KeychainError(status: errSecItemNotFound)
        }
        return try DeviceKey(rawRepresentation: bytes)
    }
}

public enum SigningField: Sendable {
    case string(String)
    case integer(Int64)
    case null
}

public enum SigningBytes {
    public static func message(_ purpose: String, fields: [SigningField]) throws -> String {
        let values: [Any] = fields.map { field in
            switch field {
            case .string(let value): return value
            case .integer(let value): return value
            case .null: return NSNull()
            }
        }
        let bytes = try JSONSerialization.data(withJSONObject: values, options: [.withoutEscapingSlashes])
        return purpose + "\n" + String(decoding: bytes, as: UTF8.self)
    }

    public static func sessionKey(code: String, publicKey: String) throws -> String {
        try message("pulsar-session-key-v1", fields: [.string(code), .string(publicKey)])
    }

    public static func sessionRefresh(token: String, issuedAt: Int64) throws -> String {
        try message("pulsar-session-refresh-v1", fields: [.string(token), .integer(issuedAt)])
    }

    public static func accessRequest(machineID: String, publicKey: String, nonce: String) throws -> String {
        try message("pulsar-access-request-v1", fields: [.string(machineID), .string(publicKey), .string(nonce)])
    }
}
