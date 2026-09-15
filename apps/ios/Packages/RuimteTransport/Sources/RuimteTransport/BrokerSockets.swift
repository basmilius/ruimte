import Foundation
import RuimtePulsar

@MainActor public protocol BrokerSocket: AnyObject {
    var received: ((String) -> Void)? { get set }
    var failed: ((Error) -> Void)? { get set }
    func start()
    func send(_ text: String)
    func close()
}

@MainActor public final class URLSessionBrokerSocket: BrokerSocket {
    public var received: ((String) -> Void)?
    public var failed: ((Error) -> Void)?
    private let socket: URLSessionWebSocketTask
    private var reader: Task<Void, Never>?
    private var writer: Task<Void, Never>?

    public init(url: URL, session: URLSession = .shared) {
        socket = session.webSocketTask(with: url)
        socket.maximumMessageSize = 65_536
    }

    public func start() {
        socket.resume()
        reader = Task { [weak self] in
            guard let self else { return }
            do {
                while !Task.isCancelled {
                    let message = try await socket.receive()
                    switch message {
                    case .string(let text): received?(text)
                    case .data(let data):
                        guard let text = String(data: data, encoding: .utf8) else {
                            throw TransportFailure.invalid("The broker sent invalid UTF-8.")
                        }
                        received?(text)
                    @unknown default: throw TransportFailure.invalid("Unknown broker message")
                    }
                }
            } catch {
                if !Task.isCancelled { failed?(error) }
            }
        }
    }

    public func send(_ text: String) {
        let previous = writer
        writer = Task { [weak self] in
            await previous?.value
            guard let self, !Task.isCancelled else { return }
            do { try await socket.send(.string(text)) }
            catch { if !Task.isCancelled { failed?(error) } }
        }
    }

    public func close() {
        received = nil
        failed = nil
        reader?.cancel()
        writer?.cancel()
        reader = nil
        writer = nil
        socket.cancel(with: .normalClosure, reason: nil)
    }
}

@MainActor public final class BrokerMembership {
    private var leaveAction: (() -> Void)?
    private let relayAction: (String, JSONValue) throws -> String?

    init(leave: @escaping () -> Void, relay: @escaping (String, JSONValue) throws -> String?) {
        leaveAction = leave
        relayAction = relay
    }
    public func relay(to: String, envelope: JSONValue) throws -> String? {
        guard leaveAction != nil else { return nil }
        return try relayAction(to, envelope)
    }
    public func leave() {
        let action = leaveAction
        leaveAction = nil
        action?()
    }
}

@MainActor public final class BrokerSockets {
    public struct Member {
        public var ready: ([JSONValue]) -> Void
        public var relayed: (JSONValue) -> Void
        public var refused: (JSONValue) -> Void
        public var lost: (Error) -> Void
        public init(ready: @escaping ([JSONValue]) -> Void, relayed: @escaping (JSONValue) -> Void, refused: @escaping (JSONValue) -> Void, lost: @escaping (Error) -> Void) {
            self.ready = ready
            self.relayed = relayed
            self.refused = refused
            self.lost = lost
        }
    }
    private final class Shared {
        var peer: BrokerPeer
        let socket: any BrokerSocket
        var members: [UUID: Member] = [:]
        var waiting = Set<UUID>()
        var ice: JSONValue?
        var iceID: String?
        init(peer: BrokerPeer, socket: any BrokerSocket) {
            self.peer = peer
            self.socket = socket
        }
    }
    private var open: [String: Shared] = [:]
    private let createSocket: @MainActor (URL) -> any BrokerSocket
    private let now: () -> Double

    public init(now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1_000 }, createSocket: @escaping @MainActor (URL) -> any BrokerSocket = { URLSessionBrokerSocket(url: $0) }) {
        self.now = now
        self.createSocket = createSocket
    }

    public var socketCount: Int { open.count }

    public func join(url: URL, signer: any SessionSigner, member: Member) throws -> BrokerMembership {
        guard url.scheme == "wss", let host = url.host, url.user == nil, url.password == nil else {
            throw TransportFailure.invalid("The broker needs a secure WebSocket URL.")
        }
        let hostPort = host + (url.port.flatMap { $0 == 443 ? nil : ":\($0)" } ?? "")
        let id = url.absoluteString + " " + signer.publicKey
        let memberID = UUID()
        let shared: Shared
        let isNew = open[id] == nil
        if let existing = open[id] {
            shared = existing
        } else {
            shared = Shared(peer: BrokerPeer(host: hostPort, signer: signer), socket: createSocket(url))
            open[id] = shared
            shared.socket.received = { [weak self, weak shared] text in
                guard let self, let shared, self.open[id] === shared else { return }
                do {
                    let events = try shared.peer.receive(JSONValue.decode(Data(text.utf8)))
                    for event in events { try self.handle(event, id: id, shared: shared) }
                } catch { self.lose(id, shared: shared, error: error) }
            }
            shared.socket.failed = { [weak self, weak shared] error in
                guard let shared else { return }
                self?.lose(id, shared: shared, error: error)
            }
        }
        shared.members[memberID] = member
        shared.waiting.insert(memberID)
        if isNew {
            shared.socket.start()
            for event in try shared.peer.start() { try handle(event, id: id, shared: shared) }
        } else if shared.peer.isReady {
            if let ice = shared.ice, ice["expiresAt"] == .null || (ice["expiresAt"]?.numberValue ?? 0) > now() {
                Task { [weak self, weak shared] in
                    guard let self, let shared, self.open[id] === shared,
                          shared.waiting.remove(memberID) != nil, let current = shared.members[memberID] else { return }
                    current.ready(ice["servers"]?.arrayValue ?? [])
                }
            } else if shared.iceID == nil {
                try requestIce(shared)
            }
        }
        return BrokerMembership(leave: { [weak self, weak shared] in
            guard let self, let shared else { return }
            shared.members.removeValue(forKey: memberID)
            shared.waiting.remove(memberID)
            if shared.members.isEmpty { self.drop(id, shared: shared) }
        }, relay: { [weak self, weak shared] to, envelope in
            guard let self, let shared, self.open[id] === shared,
                  let frame = try shared.peer.relay(to: to, envelope: envelope) else { return nil }
            shared.socket.send(try wireText(frame))
            return frame["id"]?.stringValue
        })
    }

    private func requestIce(_ shared: Shared) throws {
        if let frame = try shared.peer.ice() {
            shared.iceID = try string(frame, "id")
            shared.socket.send(try wireText(frame))
        }
    }

    private func handle(_ event: BrokerPeer.Event, id: String, shared: Shared) throws {
        switch event {
        case .send(let frame): shared.socket.send(try wireText(frame))
        case .ready: try requestIce(shared)
        case .ice(let frame):
            guard frame["id"]?.stringValue == shared.iceID else { return }
            if let expiry = frame["expiresAt"]?.numberValue, expiry <= now() {
                throw TransportFailure.invalid("The broker returned expired ICE credentials.")
            }
            settleIce(shared, frame: frame)
        case .relayed(let frame):
            for member in Array(shared.members.values) { member.relayed(frame) }
        case .refused(let frame):
            let frameID = frame["id"]?.stringValue
            if (frameID != nil && frameID == shared.iceID) || (frameID == nil && frame["code"]?.stringValue == "bad-frame" && shared.iceID != nil) {
                settleIce(shared, frame: .object(["servers": .array([]), "expiresAt": .null]))
            } else if frameID != nil {
                for member in Array(shared.members.values) { member.refused(frame) }
            } else {
                throw TransportFailure.invalid(frame["message"]?.stringValue ?? "The broker is limiting this client. Try again later.")
            }
        case .delivered: break
        }
    }

    private func settleIce(_ shared: Shared, frame: JSONValue) {
        shared.ice = frame
        shared.iceID = nil
        let waiting = shared.waiting
        shared.waiting.removeAll()
        for id in waiting { shared.members[id]?.ready(frame["servers"]?.arrayValue ?? []) }
    }

    private func lose(_ id: String, shared: Shared, error: Error) {
        guard open[id] === shared else { return }
        let members = Array(shared.members.values)
        drop(id, shared: shared)
        for member in members { member.lost(error) }
    }

    private func drop(_ id: String, shared: Shared) {
        if open[id] === shared { open.removeValue(forKey: id) }
        shared.socket.close()
    }
}
