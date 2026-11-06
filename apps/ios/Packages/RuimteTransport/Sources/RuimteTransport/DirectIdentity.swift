import Foundation
import RuimtePulsar

public enum TransportFailure: Error, LocalizedError, Equatable {
    case invalid(String)
    /// A machine that turned the connection away. `code` is the machine's own and nil for one this app does not
    /// know.
    case refused(code: MachineErrorCode?, reason: String)
    public var errorDescription: String? {
        switch self {
        case .invalid(let reason), .refused(_, let reason): return reason
        }
    }
}

/// What a person reads from more than one place in the transport.
enum TransportWords {
    static var unreadableReply: String {
        String(localized: "The machine sent a reply this app cannot read.", bundle: .module)
    }
    static var unreadablePiece: String {
        String(localized: "The machine sent part of the file this app cannot read.", bundle: .module)
    }
    static var tooLarge: String {
        String(localized: "The machine response is too large to load on this device.", bundle: .module)
    }
    static var setupFailed: String {
        String(localized: "Could not set up the direct connection. Try again.", bundle: .module)
    }
    /// A machine refused as older, at the protocol check and at the direct handshake.
    static var olderMachine: String {
        String(
            localized: "This machine runs an older Ruimte. Update Ruimte there, or restart it to pick up the update.",
            bundle: .module)
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
    /// What a `direct.refused` frame says. A machine older than its `code` sends none, and its words are then the
    /// only sign of a device it does not know.
    public static func refusal(_ frame: JSONValue) -> TransportFailure {
        let reason =
            frame["reason"]?.stringValue ?? String(localized: "The machine refused this connection.", bundle: .module)
        if let sent = frame["code"]?.stringValue {
            return .refused(code: MachineErrorCode(rawValue: sent), reason: reason)
        }
        let unpaired = reason.contains("does not know this device")
        return .refused(code: unpaired ? MachineErrorCode.notPaired : nil, reason: reason)
    }

    public static func fingerprints(_ sdp: String) -> [String] {
        let regex = try! NSRegularExpression(
            pattern: "^a=fingerprint:(\\S+)\\s+([0-9A-Fa-f:]+)\\s*$", options: .anchorsMatchLines)
        let text = sdp as NSString
        let matches = regex.matches(in: sdp, range: NSRange(location: 0, length: text.length))
        return Set(
            matches.map {
                text.substring(with: $0.range(at: 1)).lowercased() + " "
                    + text.substring(with: $0.range(at: 2)).uppercased()
            }
        ).sorted()
    }

    public static func channelBinding(offer: String, answer: String) throws -> String {
        try wireText(
            .array([
                .array(fingerprints(offer).map(JSONValue.string)), .array(fingerprints(answer).map(JSONValue.string)),
            ]))
    }

    public static func proof(
        challenge raw: JSONValue, binding: String, machineID: String, machineKey: String, signer: any SessionSigner
    ) throws -> JSONValue {
        let challenge = try WireSchema.validate("DirectChallengeFrameSchema", raw)
        guard challenge["protocol"]?.numberValue == Double(WireConstants.protocolVersion) else {
            let olderMachine = (challenge["protocol"]?.numberValue ?? -1) < Double(WireConstants.protocolVersion)
            LinkProblems.report(.refused(mismatch: olderMachine ? .daemonOlder : .daemonNewer))
            throw TransportFailure.invalid(
                olderMachine
                    ? TransportWords.olderMachine
                    : String(
                        localized: "This machine runs a newer Ruimte than this app. Update this app.", bundle: .module))
        }
        let daemon = try field(challenge, "daemon")
        let nonce = try string(challenge, "challenge")
        let message = "ruimte-daemon-channel-v1\n\(machineID)\n\(nonce)\n\(binding)"
        guard try string(daemon, "id") == machineID,
            try string(daemon, "publicKey") == machineKey,
            DeviceKey.verify(signature: try string(daemon, "signature"), message: message, publicKey: machineKey)
        else {
            throw TransportFailure.invalid(
                String(localized: "The machine did not prove its identity over this connection.", bundle: .module))
        }
        let signature = try signer.sign(
            "ruimte-client-channel-v1\n\(machineID)\n\(nonce)\n\(signer.publicKey)\n\(binding)")
        var fields: [String: JSONValue] = [
            "type": .string("direct.key"), "protocol": .number(Double(WireConstants.protocolVersion)),
            "challenge": .string(nonce), "publicKey": .string(signer.publicKey), "signature": .string(signature),
        ]
        if challenge["compression"]?.arrayValue?.contains(.string(WireConstants.directCompression)) == true {
            fields["compression"] = .string(WireConstants.directCompression)
        }
        return try WireSchema.validate("DirectProofFrameSchema", .object(fields))
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

    /// What a machine signs at its door on the local network: `lanDoorMessage` in `packages/pulsar/src/signing.ts`.
    public static func lanDoorMessage(nonce: String, machineID: String, publicKey: String) throws -> String {
        "pulsar-lan-door-v1\n" + (try wireText(.array([.string(nonce), .string(machineID), .string(publicKey)])))
    }
}
