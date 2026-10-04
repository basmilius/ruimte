import Foundation
import RuimtePulsar

/// Where a machine's door on the local network listens, as `endpoint.info` reports it (`LanDoorSchema`).
public struct LanDoorAddress: Codable, Equatable, Sendable {
    public let port: Int
    public let addresses: [String]

    public init(port: Int, addresses: [String]) {
        self.port = port
        self.addresses = addresses
    }

    /// Nil for a missing or null `lan`, which is a door that is closed or a machine from before the door.
    public init?(_ value: JSONValue?) {
        guard let port = value?["port"]?.numberValue, port == port.rounded(), (1...65_535).contains(port),
            let list = value?["addresses"]?.arrayValue
        else { return nil }
        let addresses = list.compactMap(\.stringValue).filter { !$0.isEmpty && $0.count <= 64 }
        guard !addresses.isEmpty else { return nil }
        self.init(port: Int(port), addresses: Array(addresses.prefix(16)))
    }

    /// One socket address per reported address, as `lanDoorUrl` in `packages/pulsar/src/lan-door.ts` builds them.
    public var urls: [URL] {
        addresses.compactMap { address in
            let host = address.contains(":") ? "[\(address.replacingOccurrences(of: "%", with: "%25"))]" : address
            return URL(string: "ws://\(host):\(port)/signal")
        }
    }
}

/// The client's side of a machine's door on the local network (`packages/pulsar/src/lan-door.ts`). It says nothing
/// about the client until the machine signed the client's nonce with the pinned key, so a stranger at a private
/// address that belongs to another device on this network learns nothing of who asked.
public struct LanDoorPeer {
    public enum Event: Equatable {
        case ready
        case signal(JSONValue)
        case refused(String)
    }
    private enum State { case idle, greeted, ready }
    private var state = State.idle
    private let machineID: String
    private let machineKey: String
    private let signer: any SessionSigner
    private let nonce: String

    public init(machineID: String, machineKey: String, signer: any SessionSigner, nonce: String) {
        self.machineID = machineID
        self.machineKey = machineKey
        self.signer = signer
        self.nonce = nonce
    }

    public var isReady: Bool { state == .ready }

    public mutating func hello() -> JSONValue {
        state = .greeted
        return .object(["type": .string("hello"), "nonce": .string(nonce)])
    }

    public mutating func receive(_ frame: JSONValue) throws -> [Event] {
        switch frame["type"]?.stringValue {
        case "door":
            guard state == .greeted, frame["machineId"]?.stringValue == machineID,
                frame["publicKey"]?.stringValue == machineKey, let signature = frame["signature"]?.stringValue,
                DirectIdentity.verify(
                    publicKey: machineKey,
                    message: try DirectIdentity.lanDoorMessage(
                        nonce: nonce, machineID: machineID, publicKey: machineKey),
                    signature: signature)
            else { throw Self.unproven }
            state = .ready
            return [.ready]
        case "signal":
            guard state == .ready else { throw Self.unproven }
            let envelope = try WireSchema.validate("SignalEnvelopeSchema", try field(frame, "envelope"))
            let message = try DirectIdentity.signalMessage(from: machineKey, to: signer.publicKey, envelope: envelope)
            guard let signature = frame["signature"]?.stringValue,
                DirectIdentity.verify(publicKey: machineKey, message: message, signature: signature)
            else {
                throw TransportFailure.invalid(
                    String(
                        localized: "A signal on the local network names the machine but is not signed by it.",
                        bundle: .module))
            }
            return [.signal(envelope)]
        case "error":
            return [.refused(frame["message"]?.stringValue ?? frame["code"]?.stringValue ?? "error")]
        default:
            // A newer machine may say more once it proved itself; before that, anything else is not the machine.
            guard state == .ready else { throw Self.unproven }
            return []
        }
    }

    public func signal(_ envelope: JSONValue) throws -> JSONValue {
        guard state == .ready else { throw Self.unproven }
        let signature = try signer.sign(
            DirectIdentity.signalMessage(from: signer.publicKey, to: machineKey, envelope: envelope))
        return .object([
            "type": .string("signal"), "from": .string(signer.publicKey), "envelope": envelope,
            "signature": .string(signature),
        ])
    }

    private static var unproven: TransportFailure {
        .invalid(String(localized: "The machine on the local network did not prove its identity.", bundle: .module))
    }
}

/// One attempt's socket at one address of a machine's door.
@MainActor final class LanDoorSignaling: SignalingPath {
    private var peer: LanDoorPeer
    private let socket: any SignalSocket
    private let connectionID: String
    private var events: SignalingEvents?

    init(
        machineID: String, machineKey: String, signer: any SessionSigner, connectionID: String,
        socket: any SignalSocket,
        events: SignalingEvents
    ) throws {
        peer = LanDoorPeer(
            machineID: machineID, machineKey: machineKey, signer: signer, nonce: try Base64URL.randomToken(bytes: 32))
        self.socket = socket
        self.connectionID = connectionID
        self.events = events
    }

    func start() throws {
        socket.received = { [weak self] text in self?.receive(text) }
        socket.failed = { [weak self] error in self?.fail(error) }
        socket.start()
        socket.send(try wireText(peer.hello()))
    }

    func send(_ envelope: JSONValue) throws {
        socket.send(try wireText(try peer.signal(envelope)))
    }

    func close() {
        events = nil
        socket.close()
    }

    private func receive(_ text: String) {
        do {
            for event in try peer.receive(JSONValue.decode(Data(text.utf8))) {
                switch event {
                case .ready: events?.ready([])
                case .signal(let envelope):
                    if envelope["connectionId"]?.stringValue == connectionID { events?.signal(envelope) }
                case .refused(let message): throw TransportFailure.invalid(message)
                }
            }
        } catch { fail(error) }
    }

    private func fail(_ error: Error) {
        let events = self.events
        close()
        events?.failed(error)
    }
}

/// The doors this phone learned per machine, kept across launches so an attempt knows them before it asks anything.
/// A door belongs to the key it was learned under, so a machine that changed its key starts without one.
@MainActor public final class LanDoors {
    /// How long the local network is passed over after an attempt through a door failed before its channel opened.
    public static let skipMilliseconds: Double = 5 * 60 * 1_000
    private struct Stored: Codable {
        let machineKey: String
        let door: LanDoorAddress
    }
    private let defaults: UserDefaults
    private let now: () -> Double
    private var skippedUntil: [String: Double] = [:]

    public init(
        defaults: UserDefaults = .standard,
        now: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime * 1_000 }
    ) {
        self.defaults = defaults
        self.now = now
    }

    /// The door an attempt tries, nil while a failure skips the local network. A machine without a broker has no other
    /// way, so its door is tried regardless.
    public func door(machineID: String, machineKey: String, hasBroker: Bool) -> LanDoorAddress? {
        guard let data = defaults.data(forKey: key(machineID)),
            let stored = try? JSONDecoder().decode(Stored.self, from: data), stored.machineKey == machineKey
        else { return nil }
        if hasBroker, let until = skippedUntil[machineID], until > now() { return nil }
        return stored.door
    }

    /// Nil forgets the door: the machine closed it, or predates it.
    public func remember(_ door: LanDoorAddress?, machineID: String, machineKey: String) {
        guard let door, let data = try? JSONEncoder().encode(Stored(machineKey: machineKey, door: door)) else {
            defaults.removeObject(forKey: key(machineID))
            return
        }
        defaults.set(data, forKey: key(machineID))
    }

    public func skip(machineID: String) {
        skippedUntil[machineID] = now() + Self.skipMilliseconds
    }

    public func forget(machineID: String) {
        skippedUntil.removeValue(forKey: machineID)
        defaults.removeObject(forKey: key(machineID))
    }

    private func key(_ machineID: String) -> String {
        "ruimte.lan-door.v1." + Base64URL.encode(Data(machineID.utf8))
    }
}
