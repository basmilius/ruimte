import Foundation
import RuimtePulsar

/// How an attempt's offer and answer traveled. The channel they open runs the same handshake either way.
public enum SignalingRoute: Equatable, Sendable {
    case localNetwork
    case broker
}

/// One way to signal a machine for one attempt. It hands over only signals the machine signed for this attempt.
@MainActor public protocol SignalingPath: AnyObject {
    func start() throws
    /// Signs one envelope for the machine and sends it.
    func send(_ envelope: JSONValue) throws
    func close()
}

@MainActor public struct SignalingEvents {
    /// The path can carry signals; with the ICE servers it hands out, which only a broker does.
    public var ready: ([JSONValue]) -> Void
    public var signal: (JSONValue) -> Void
    public var failed: (Error) -> Void
    public init(
        ready: @escaping ([JSONValue]) -> Void, signal: @escaping (JSONValue) -> Void, failed: @escaping (Error) -> Void
    ) {
        self.ready = ready
        self.signal = signal
        self.failed = failed
    }
}

/// The doors of a machine on the local network, all at once, with the broker behind them. The first path that is
/// ready carries the attempt and the others close. The broker joins once no door was ready within
/// `brokerDelayMilliseconds`, or at once when every door failed sooner, which is also how an app refused the local
/// network goes on through the broker without a word.
@MainActor public final class SignalingRace {
    public typealias Opener = @MainActor (SignalingEvents) throws -> any SignalingPath
    public struct Events {
        public var ready: (SignalingRoute, [JSONValue]) -> Void
        public var signal: (JSONValue) -> Void
        public var failed: (Error) -> Void
        public init(
            ready: @escaping (SignalingRoute, [JSONValue]) -> Void, signal: @escaping (JSONValue) -> Void,
            failed: @escaping (Error) -> Void
        ) {
            self.ready = ready
            self.signal = signal
            self.failed = failed
        }
    }
    private enum Candidate: Hashable {
        case door(Int)
        case broker
    }

    public static let brokerDelayMilliseconds: Double = 1_000
    private let doorOpeners: [Opener]
    private var brokerOpener: Opener?
    private let scheduler: any TransportScheduling
    private var events: Events?
    private var paths: [Candidate: any SignalingPath] = [:]
    private var winner: Candidate?
    private var cancelBrokerDelay: (() -> Void)?
    private var doorError: Error?
    private var brokerError: Error?

    public init(doors: [Opener], broker: Opener?, scheduler: any TransportScheduling, events: Events) {
        doorOpeners = doors
        brokerOpener = broker
        self.scheduler = scheduler
        self.events = events
    }

    public func start() {
        for (index, open) in doorOpeners.enumerated() {
            do { paths[.door(index)] = try open(events(for: .door(index))) } catch { doorError = error }
        }
        for index in doorOpeners.indices {
            // A door may already have won, or failed, while an earlier one started.
            guard winner == nil, let path = paths[.door(index)] else { continue }
            do { try path.start() } catch { lose(.door(index), error) }
        }
        guard events != nil, winner == nil else { return }
        guard hasDoors else {
            continueWithoutDoors()
            return
        }
        if brokerOpener != nil {
            cancelBrokerDelay = scheduler.after(milliseconds: Self.brokerDelayMilliseconds) { [weak self] in
                self?.startBroker()
            }
        }
    }

    public func send(_ envelope: JSONValue) throws {
        guard let winner, let path = paths[winner] else { throw TransportFailure.invalid("Signaling is not ready") }
        try path.send(envelope)
    }

    public func close() {
        events = nil
        brokerOpener = nil
        cancelBrokerDelay?()
        cancelBrokerDelay = nil
        let open = paths.values
        paths.removeAll()
        for path in open { path.close() }
    }

    private var hasDoors: Bool { paths.keys.contains { $0 != .broker } }

    private func events(for candidate: Candidate) -> SignalingEvents {
        SignalingEvents(
            ready: { [weak self] servers in self?.ready(candidate, servers) },
            signal: { [weak self] envelope in
                guard let self, self.winner == candidate else { return }
                self.events?.signal(envelope)
            },
            failed: { [weak self] error in self?.lose(candidate, error) })
    }

    private func startBroker() {
        cancelBrokerDelay?()
        cancelBrokerDelay = nil
        guard let open = brokerOpener, winner == nil, events != nil else { return }
        brokerOpener = nil
        do {
            let path = try open(events(for: .broker))
            paths[.broker] = path
            try path.start()
        } catch { lose(.broker, error) }
    }

    private func ready(_ candidate: Candidate, _ servers: [JSONValue]) {
        guard winner == nil, paths[candidate] != nil, let events else { return }
        winner = candidate
        brokerOpener = nil
        cancelBrokerDelay?()
        cancelBrokerDelay = nil
        for (other, path) in paths where other != candidate {
            paths.removeValue(forKey: other)
            path.close()
        }
        events.ready(candidate == .broker ? .broker : .localNetwork, servers)
    }

    private func lose(_ candidate: Candidate, _ error: Error) {
        guard let events else { return }
        paths.removeValue(forKey: candidate)?.close()
        if candidate == winner {
            close()
            events.failed(error)
            return
        }
        guard winner == nil else { return }
        if candidate == .broker { brokerError = error } else { doorError = error }
        continueWithoutDoors()
    }

    /// Goes on through the broker once no door is left, and gives up once nothing is.
    private func continueWithoutDoors() {
        guard let events, winner == nil, !hasDoors else { return }
        if brokerOpener != nil {
            startBroker()
        } else if paths[.broker] == nil {
            close()
            // The broker's word reaches the person; a door that failed beside it stays silent.
            events.failed(brokerError ?? doorError ?? TransportFailure.invalid("No way to signal the machine"))
        }
    }
}

/// One attempt's membership of a shared broker socket, which lets through only what the machine signed for it.
@MainActor final class BrokerSignaling: SignalingPath {
    private let url: URL
    private let sockets: BrokerSockets
    private let signer: any SessionSigner
    private let machineKey: String
    private let connectionID: String
    private var events: SignalingEvents?
    private var membership: BrokerMembership?
    private var relayIDs = Set<String>()

    init(
        url: URL, sockets: BrokerSockets, signer: any SessionSigner, machineKey: String, connectionID: String,
        events: SignalingEvents
    ) {
        self.url = url
        self.sockets = sockets
        self.signer = signer
        self.machineKey = machineKey
        self.connectionID = connectionID
        self.events = events
    }

    func start() throws {
        membership = try sockets.join(
            url: url, signer: signer,
            member: .init(
                ready: { [weak self] servers in self?.events?.ready(servers) },
                relayed: { [weak self] frame in self?.receive(frame) },
                refused: { [weak self] frame in
                    guard let self, let id = frame["id"]?.stringValue, self.relayIDs.contains(id) else { return }
                    self.fail(
                        TransportFailure.invalid(
                            frame["message"]?.stringValue
                                ?? String(localized: "The broker refused this connection attempt.", bundle: .module)))
                }, lost: { [weak self] error in self?.fail(error) }))
    }

    func send(_ envelope: JSONValue) throws {
        if let id = try membership?.relay(to: machineKey, envelope: envelope) { relayIDs.insert(id) }
    }

    func close() {
        events = nil
        membership?.leave()
        membership = nil
    }

    private func receive(_ raw: JSONValue) {
        do {
            let frame = try WireSchema.validate("BrokerRelayedSchema", raw)
            let envelope = try field(frame, "envelope")
            guard frame["from"]?.stringValue == machineKey, envelope["connectionId"]?.stringValue == connectionID else {
                return
            }
            let message = try DirectIdentity.signalMessage(from: machineKey, to: signer.publicKey, envelope: envelope)
            guard
                DirectIdentity.verify(
                    publicKey: machineKey, message: message, signature: try string(frame, "signature"))
            else {
                throw TransportFailure.invalid(
                    String(localized: "A broker signal names the machine but is not signed by it.", bundle: .module))
            }
            events?.signal(envelope)
        } catch { fail(error) }
    }

    private func fail(_ error: Error) {
        let events = self.events
        close()
        events?.failed(error)
    }
}

/// The ways one machine is signaled: the door on its local network, when one is known and not skipped, and its broker.
@MainActor public struct MachineSignaling {
    public let machineID: String
    public let machineKey: String
    public let signer: any SessionSigner
    public let lan: LanDoorAddress?
    public let brokerURL: URL?
    public let sockets: BrokerSockets
    public let openDoor: @MainActor (URL) -> any SignalSocket

    public init(
        machineID: String, machineKey: String, signer: any SessionSigner, lan: LanDoorAddress?, brokerURL: URL?,
        sockets: BrokerSockets,
        openDoor: @escaping @MainActor (URL) -> any SignalSocket = { URLSessionSignalSocket(url: $0) }
    ) {
        self.machineID = machineID
        self.machineKey = machineKey
        self.signer = signer
        self.lan = lan
        self.brokerURL = brokerURL
        self.sockets = sockets
        self.openDoor = openDoor
    }

    /// The race for one attempt, not yet started.
    public func race(connectionID: String, scheduler: any TransportScheduling, events: SignalingRace.Events) throws
        -> SignalingRace
    {
        let doors = (lan?.urls ?? []).map { url -> SignalingRace.Opener in
            { [machineID, machineKey, signer, openDoor] events in
                try LanDoorSignaling(
                    machineID: machineID, machineKey: machineKey, signer: signer, connectionID: connectionID,
                    socket: openDoor(url), events: events)
            }
        }
        let broker = brokerURL.map { url -> SignalingRace.Opener in
            { [sockets, signer, machineKey] events in
                BrokerSignaling(
                    url: url, sockets: sockets, signer: signer, machineKey: machineKey, connectionID: connectionID,
                    events: events)
            }
        }
        guard !doors.isEmpty || broker != nil else {
            throw TransportFailure.invalid(
                String(localized: "The broker needs a secure WebSocket URL.", bundle: .module))
        }
        return SignalingRace(doors: doors, broker: broker, scheduler: scheduler, events: events)
    }
}
