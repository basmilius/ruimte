import Foundation
import RuimtePulsar

public struct BrokerPeer {
    public enum Event: Equatable {
        case send(JSONValue)
        case ready
        case relayed(JSONValue)
        case ice(JSONValue)
        case refused(JSONValue)
        case delivered(String)
    }
    private enum State { case idle, announced, ready }
    private var state = State.idle
    private var nextID = 1
    private let host: String
    private let signer: any SessionSigner

    public init(host: String, signer: any SessionSigner) {
        self.host = host
        self.signer = signer
    }

    public var isReady: Bool { state == .ready }

    public mutating func start() throws -> [Event] {
        guard state == .idle else { return [] }
        state = .announced
        return [.send(try outgoing(.object(["type": .string("hello"), "role": .string("client"), "publicKey": .string(signer.publicKey)])))]
    }

    public mutating func receive(_ raw: JSONValue) throws -> [Event] {
        let frame = try WireSchema.validate("BrokerServerFrameSchema", raw)
        switch try string(frame, "type") {
        case "challenge":
            guard state == .announced else { return [] }
            guard try string(frame, "broker") == host else {
                throw TransportFailure.invalid("The broker challenge names a different host.")
            }
            let message = "pulsar-broker-hello-v1\n" + (try wireText(.array([
                .string(host), .string("client"), .string(signer.publicKey), try field(frame, "nonce")
            ])))
            return [.send(try outgoing(.object(["type": .string("prove"), "signature": .string(try signer.sign(message))])))]
        case "ready":
            guard state == .announced else { return [] }
            state = .ready
            return [.ready]
        case "relayed": return isReady ? [.relayed(frame)] : []
        case "ice": return isReady ? [.ice(frame)] : []
        case "error", "rate-limited": return [.refused(frame)]
        case "delivered": return [.delivered(try string(frame, "id"))]
        default: return []
        }
    }

    public mutating func ice() throws -> JSONValue? {
        guard isReady else { return nil }
        return try outgoing(.object(["type": .string("ice"), "id": .string(id("ice"))]))
    }

    public mutating func relay(to: String, envelope: JSONValue) throws -> JSONValue? {
        guard isReady else { return nil }
        let signature = try signer.sign(DirectIdentity.signalMessage(from: signer.publicKey, to: to, envelope: envelope))
        return try outgoing(.object([
            "type": .string("relay"), "id": .string(id("relay")), "to": .string(to),
            "envelope": envelope, "signature": .string(signature)
        ]))
    }

    private func outgoing(_ frame: JSONValue) throws -> JSONValue {
        try WireSchema.validate("BrokerPeerFrameSchema", frame)
    }

    private mutating func id(_ prefix: String) -> String {
        defer { nextID += 1 }
        return "\(prefix)-\(nextID)"
    }
}

public enum IceServers {
    public static func merge(own: [JSONValue], route: [JSONValue]) throws -> [JSONValue] {
        var seen = Set<String>()
        var merged: [JSONValue] = []
        for raw in own + route {
            let server = try WireSchema.validate("IceServerSchema", raw)
            let urls = try server["urls"]?.arrayValue ?? [field(server, "urls")]
            let kept = try urls.filter { value in
                guard let url = value.stringValue else { throw TransportFailure.invalid("Invalid ICE URL") }
                let key = url.hasPrefix("stun:") || url.hasPrefix("stuns:") ? url : url + " " + (server["username"]?.stringValue ?? "")
                return seen.insert(key).inserted
            }
            if !kept.isEmpty {
                var value = server.objectValue!
                value["urls"] = .array(kept)
                merged.append(.object(value))
            }
        }
        return merged
    }
}
