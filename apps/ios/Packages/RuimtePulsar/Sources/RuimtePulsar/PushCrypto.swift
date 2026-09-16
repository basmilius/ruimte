import CryptoKit
import Foundation

public enum PushCryptoError: Error, LocalizedError, Sendable {
    case invalid, expired, unknownMachine, wrongDevice, replay
    public var errorDescription: String? {
        switch self {
        case .invalid: "The notification could not be verified."
        case .expired: "This notification has expired. Open the session to see its current state."
        case .unknownMachine: "This notification is from a machine that is no longer trusted."
        case .wrongDevice: "This notification belongs to another device."
        case .replay: "This notification was already delivered."
        }
    }
}

public struct PushDecryptionKey: Sendable {
    private let key: Curve25519.KeyAgreement.PrivateKey
    public init() { key = Curve25519.KeyAgreement.PrivateKey() }
    public init(rawRepresentation: Data) throws {
        key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: rawRepresentation)
    }
    public var rawRepresentation: Data { key.rawRepresentation }
    public var publicKey: String { Base64URL.encode(key.publicKey.rawRepresentation) }

    public func decrypt(
        _ input: JSONValue, handle: String, machinePublicKeys: [String: String],
        now: Double = Date().timeIntervalSince1970 * 1000, allowExpiredRouting: Bool = false
    ) throws -> PushAlertContent {
        let bytes = try decryptBytes(
            input, type: "alert", handle: handle, machinePublicKeys: machinePublicKeys,
            now: now, allowExpiredRouting: allowExpiredRouting)
        let content = try JSONDecoder().decode(PushAlertContent.self, from: bytes)
        guard allowExpiredRouting || Double(content.expiresAt) > now,
            Double(content.expiresAt) <= (input["expiresAt"]?.numberValue ?? 0)
        else { throw PushCryptoError.expired }
        return content
    }

    public func decryptRead(
        _ input: JSONValue, handle: String, machinePublicKeys: [String: String],
        now: Double = Date().timeIntervalSince1970 * 1000
    ) throws -> PushReadContent {
        let bytes = try decryptBytes(
            input, type: "background", handle: handle, machinePublicKeys: machinePublicKeys,
            now: now, allowExpiredRouting: false)
        let content = try JSONDecoder().decode(PushReadContent.self, from: bytes)
        guard Double(content.expiresAt) > now,
            Double(content.expiresAt) <= (input["expiresAt"]?.numberValue ?? 0),
            Double(content.through) <= (input["issuedAt"]?.numberValue ?? 0)
        else { throw PushCryptoError.invalid }
        return content
    }

    private func decryptBytes(
        _ input: JSONValue, type: String, handle: String, machinePublicKeys: [String: String],
        now: Double, allowExpiredRouting: Bool
    ) throws -> Data {
        let push = try WireSchema.validate("PushEnvelopeSchema", input)
        guard push["pushType"] == .string(type), let machineID = push["machineId"]?.stringValue,
            let receivedHandle = push["handle"]?.stringValue
        else { throw PushCryptoError.invalid }
        guard receivedHandle == handle else { throw PushCryptoError.wrongDevice }
        guard let machineKey = machinePublicKeys[machineID] else { throw PushCryptoError.unknownMachine }
        let issuedAt = push["issuedAt"]?.numberValue ?? 0
        let expiresAt = push["expiresAt"]?.numberValue ?? 0
        guard now.isFinite, issuedAt <= now + WireConstants.pushMaxClockSkewMs,
            allowExpiredRouting || issuedAt >= now - WireConstants.pushMaxAgeMs, allowExpiredRouting || expiresAt > now,
            expiresAt > issuedAt,
            expiresAt - issuedAt <= WireConstants.pushMaxAgeMs
        else { throw PushCryptoError.expired }
        guard let signature = push["signature"]?.stringValue,
            DeviceKey.verify(signature: signature, message: try PushSigning.message(push), publicKey: machineKey),
            let ephemeral = push["ephemeralKey"]?.stringValue.flatMap(Base64URL.decode),
            let nonce = push["nonce"]?.stringValue.flatMap(Base64URL.decode),
            let encrypted = push["ciphertext"]?.stringValue.flatMap(Base64URL.decode), encrypted.count >= 16
        else { throw PushCryptoError.invalid }
        let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: ephemeral)
        let shared = try key.sharedSecretFromKeyAgreement(with: peer)
        let info = try JSONValue.array([.string(machineID), .string(handle)]).encoded()
        let symmetric = shared.hkdfDerivedSymmetricKey(
            using: SHA256.self, salt: Data(WireConstants.pushHKDFSalt.utf8), sharedInfo: info, outputByteCount: 32)
        let box = try AES.GCM.SealedBox(
            nonce: .init(data: nonce), ciphertext: encrypted.dropLast(16), tag: encrypted.suffix(16))
        let bytes = try AES.GCM.open(box, using: symmetric, authenticating: Data(try PushSigning.routing(push).utf8))
        return bytes
    }
}

public enum PushSigning {
    private static func fields(_ push: JSONValue) throws -> [SigningField] {
        guard let machine = push["machineId"]?.stringValue, let handle = push["handle"]?.stringValue,
            let id = push["id"]?.stringValue, let issued = push["issuedAt"]?.numberValue,
            let expires = push["expiresAt"]?.numberValue, let collapse = push["collapseId"]?.stringValue,
            issued >= 0, expires >= 0, issued < Double(Int64.max), expires < Double(Int64.max)
        else { throw PushCryptoError.invalid }
        return [
            .string(machine), .string(handle), .string(id), .integer(Int64(issued)), .integer(Int64(expires)),
            .string(collapse),
        ]
    }
    public static func routing(_ push: JSONValue) throws -> String {
        try SigningBytes.message("pulsar-push-routing-v1", fields: fields(push))
    }
    public static func message(_ push: JSONValue) throws -> String {
        var fields = try fields(push)
        guard let type = push["pushType"]?.stringValue else { throw PushCryptoError.invalid }
        fields.append(.string(type))
        if type == "alert" || type == "background" {
            for key in ["ephemeralKey", "nonce", "ciphertext"] {
                guard let value = push[key]?.stringValue else { throw PushCryptoError.invalid }
                fields.append(.string(value))
            }
        } else {
            guard let title = push["activity"]?["title"]?.stringValue,
                let phase = push["activity"]?["phase"]?.stringValue,
                let started = push["activity"]?["startedAt"]?.numberValue, started >= 0, started < Double(Int64.max)
            else { throw PushCryptoError.invalid }
            fields += [.string(title), .string(phase), .integer(Int64(started))]
            if push["activity"]?["runningCount"] != nil || push["activity"]?["attentionCount"] != nil {
                for name in ["runningCount", "attentionCount"] {
                    if let value = push["activity"]?[name]?.numberValue {
                        guard value >= 0, value < Double(Int64.max), value.rounded() == value else {
                            throw PushCryptoError.invalid
                        }
                        fields.append(.integer(Int64(value)))
                    } else {
                        fields.append(.null)
                    }
                }
            }
        }
        if type == "liveactivity", let agents = push["activity"]?["agents"]?.arrayValue {
            fields.append(.integer(Int64(agents.count)))
            for agent in agents {
                for key in ["nodeId", "target", "title", "phase"] {
                    guard let value = agent[key]?.stringValue else { throw PushCryptoError.invalid }
                    fields.append(.string(value))
                }
                if let started = agent["startedAt"]?.numberValue {
                    guard started >= 0, started < Double(Int64.max), started.rounded() == started else {
                        throw PushCryptoError.invalid
                    }
                    fields.append(.integer(Int64(started)))
                }
            }
        }
        return try SigningBytes.message("pulsar-push-v1", fields: fields)
    }
}
