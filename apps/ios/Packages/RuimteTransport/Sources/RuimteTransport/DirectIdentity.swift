import CryptoKit
import Foundation
import RuimtePulsar

public enum TransportFailure: Error, LocalizedError, Equatable {
    case invalid(String)
    public var errorDescription: String? {
        switch self {
        case .invalid(let reason): return reason
        }
    }
}

func field(_ value: JSONValue, _ key: String) throws -> JSONValue {
    guard let result = value[key] else {
        throw TransportFailure.invalid("Missing \(key)")
    }
    return result
}

func string(_ value: JSONValue, _ key: String) throws -> String {
    guard let result = value[key]?.stringValue else {
        throw TransportFailure.invalid("Invalid \(key)")
    }
    return result
}

func wireText(_ value: JSONValue) throws -> String {
    String(decoding: try value.encoded(), as: UTF8.self)
}

public enum DirectIdentity {
    public static func fingerprints(_ sdp: String) -> [String] {
        let regex = try! NSRegularExpression(pattern: "^a=fingerprint:(\\S+)\\s+([0-9A-Fa-f:]+)\\s*$", options: .anchorsMatchLines)
        let text = sdp as NSString
        let matches = regex.matches(in: sdp, range: NSRange(location: 0, length: text.length))
        return Set(matches.map {
            text.substring(with: $0.range(at: 1)).lowercased() + " " + text.substring(with: $0.range(at: 2)).uppercased()
        }).sorted()
    }

    public static func channelBinding(offer: String, answer: String) throws -> String {
        try wireText(.array([.array(fingerprints(offer).map(JSONValue.string)), .array(fingerprints(answer).map(JSONValue.string))]))
    }

    public static func verify(publicKey: String, message: String, signature: String) -> Bool {
        guard let keyData = Base64URL.decode(publicKey),
              let signatureData = Base64URL.decode(signature),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData) else {
            return false
        }
        return key.isValidSignature(signatureData, for: Data(message.utf8))
    }

    public static func proof(challenge raw: JSONValue, binding: String, machineID: String, machineKey: String, signer: any SessionSigner) throws -> JSONValue {
        let challenge = try WireSchema.validate("DirectChallengeFrameSchema", raw)
        guard challenge["protocol"]?.numberValue == Double(WireConstants.protocolVersion) else {
            let olderMachine = (challenge["protocol"]?.numberValue ?? -1) < Double(WireConstants.protocolVersion)
            throw TransportFailure.invalid(olderMachine
                ? "This machine runs an older Ruimte. Update Ruimte there, or restart it to pick up the update."
                : "This machine runs a newer Ruimte than this app. Update this app.")
        }
        let daemon = try field(challenge, "daemon")
        let nonce = try string(challenge, "challenge")
        let message = "ruimte-daemon-channel-v1\n\(machineID)\n\(nonce)\n\(binding)"
        guard try string(daemon, "id") == machineID,
              try string(daemon, "publicKey") == machineKey,
              verify(publicKey: machineKey, message: message, signature: try string(daemon, "signature")) else {
            throw TransportFailure.invalid("The machine did not prove its identity over this connection.")
        }
        let signature = try signer.sign("ruimte-client-channel-v1\n\(machineID)\n\(nonce)\n\(signer.publicKey)\n\(binding)")
        return try WireSchema.validate("DirectProofFrameSchema", .object([
            "type": .string("direct.key"), "protocol": .number(Double(WireConstants.protocolVersion)),
            "challenge": .string(nonce), "publicKey": .string(signer.publicKey), "signature": .string(signature)
        ]))
    }

    public static func signalMessage(from: String, to: String, envelope raw: JSONValue) throws -> String {
        let envelope = try WireSchema.validate("SignalEnvelopeSchema", raw)
        let signal = try field(envelope, "signal")
        let kind = try string(signal, "kind")
        var fields: [JSONValue] = [.string(from), .string(to), try field(envelope, "connectionId"), .string(kind)]
        switch kind {
        case "offer":
            fields.append(try field(signal, "sdp"))
            if let access = signal["access"] {
                let statement = try field(access, "statement")
                for key in ["machineId", "clientPublicKey", "nonce", "issuedAt", "expiresAt", "signature"] {
                    fields.append(try field(statement, key))
                }
                fields.append(try field(access, "label"))
            }
        case "answer": fields.append(try field(signal, "sdp"))
        case "candidate":
            for key in ["candidate", "sdpMid", "sdpMLineIndex"] {
                fields.append(try field(signal, key))
            }
        case "close": fields.append(try field(signal, "reason"))
        default: throw TransportFailure.invalid("Unknown signal")
        }
        return "pulsar-signal-v1\n" + (try wireText(.array(fields)))
    }
}
