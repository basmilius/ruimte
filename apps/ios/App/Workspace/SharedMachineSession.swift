import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit

@MainActor @Observable
final class SharedMachineSession {
    let machine: Machine
    private(set) var connected = false
    private(set) var generation = 0
    private(set) var problem: String?
    private(set) var relayed: Bool?
    private var lease: MachineLease?
    private var references = 0
    private var invalidated = false
    @ObservationIgnored private lazy var projectSubscriptions = ProjectSubscriptions { [weak self] type, payload in
        guard let self else { throw CancellationError() }
        return try await self.rpc.request(type, payload: payload)
    }
    private weak var runtime: AppRuntime?
    @ObservationIgnored lazy var attention = AttentionStore(client: rpc)
    @ObservationIgnored lazy var rpc = MachineClient(send: { [weak self] text in
        guard let lease = self?.lease else { throw TransportFailure.invalid("This machine is not connected.") }
        try lease.send(text)
    })

    init(machine: Machine, runtime: AppRuntime) {
        self.machine = machine
        self.runtime = runtime
    }

    func retain() {
        guard !invalidated else { return }
        references += 1
        guard lease == nil, let runtime, let key = runtime.key else { return }
        guard let url = machine.brokerUrl.flatMap(URL.init(string:)), url.scheme == "wss" else {
            problem = "This machine needs a secure broker address."
            return
        }
        let events = LinkEvents(
            opened: { [weak self] in
                Task { @MainActor [weak self] in
                    guard let self, lease != nil else { return }
                    connected = true
                    problem = nil
                    generation += 1
                    rpc.connected()
                }
            }, message: { [weak self] text in self?.rpc.receive(text) },
            closed: { [weak self] error in
                guard let self else { return }
                connected = false
                relayed = nil
                problem = error?.localizedDescription
                rpc.disconnected(error: error)
            }, route: { [weak self] in self?.relayed = $0 })
        lease = runtime.connections.hold(
            machineID: machine.id,
            open: { [weak runtime] events in
                guard let runtime else { throw CancellationError() }
                let identity = PairingIdentity(
                    machineID: self.machine.id, machineKey: self.machine.publicKey, clientKey: key.publicKey)
                return try runtime.pairings.open(
                    identity: identity,
                    requestAccess: {
                        guard let token = try await runtime.vault?.accessToken() else {
                            throw TransportFailure.invalid("Sign in to connect to this machine.")
                        }
                        let access = try await runtime.client.signalAccess(
                            accessToken: token, machineID: self.machine.id, key: key,
                            label: "Ruimte on \(UIDevice.current.model)")
                        return try JSONValue.decode(JSONEncoder().encode(access))
                    }, events: events,
                    makeLink: { access, authenticatedEvents in
                        try NativeWebRTCLink(
                            machineID: self.machine.id, machineKey: self.machine.publicKey, signer: key,
                            brokerURL: url, sockets: runtime.sockets,
                            iceServers: [.object(["urls": .string("stun:turn.ruimte.app:3478")])],
                            access: access, events: authenticatedEvents)
                    })
            }, events: events)
        attention.start()
    }

    func release() {
        references = max(0, references - 1)
        guard references == 0 else { return }
        attention.stop()
        lease?.release()
        lease = nil
        connected = false
        rpc.disconnected(error: nil)
    }

    func retainProject(_ id: String) { projectSubscriptions.retain(id) }

    func openProject(_ id: String) async throws -> JSONValue { try await projectSubscriptions.open(id) }

    func releaseProject(_ id: String) async { await projectSubscriptions.release(id, connected: connected).value }

    func invalidate() {
        invalidated = true
        attention.stop()
        projectSubscriptions.invalidate()
        lease?.release()
        lease = nil
        references = 0
        connected = false
        relayed = nil
        runtime = nil
        rpc.disconnected(error: MachineClientError.disconnected)
    }

    func markSeen(_ nodeID: String) async {
        await runtime?.notifications.markSeen(machineID: machine.id, nodeID: nodeID)
    }

    func reconnect() { runtime?.connections.reconnect(machineID: machine.id) }
}

@MainActor
final class MachineNavigationLease {
    private let session: SharedMachineSession
    init(_ session: SharedMachineSession) {
        self.session = session
        session.retain()
    }
    isolated deinit { session.release() }
}

@MainActor
final class ProjectSubscriptions {
    private let request: (String, JSONValue) async throws -> JSONValue
    private var references: [String: Int] = [:]
    private var operations: [String: Task<JSONValue, Error>] = [:]

    init(request: @escaping (String, JSONValue) async throws -> JSONValue) { self.request = request }

    func retain(_ id: String) { references[id, default: 0] += 1 }

    func invalidate() { references.removeAll() }

    func open(_ id: String) async throws -> JSONValue {
        let previous = operations[id]
        let task = Task {
            _ = try? await previous?.value
            guard references[id, default: 0] > 0 else { throw CancellationError() }
            return try await request("project.open", .object(["projectId": .string(id)]))
        }
        operations[id] = task
        return try await task.value
    }

    func release(_ id: String, connected: Bool) -> Task<Void, Never> {
        references[id] = max(0, references[id, default: 0] - 1)
        guard references[id] == 0 else { return Task {} }
        let previous = operations[id]
        let task = Task {
            // The daemon registers a viewer only after its asynchronous open completes.
            _ = try? await previous?.value
            guard connected, references[id, default: 0] == 0 else { return JSONValue.object([:]) }
            return try await request("project.release", .object(["projectId": .string(id)]))
        }
        operations[id] = task
        return Task { _ = try? await task.value }
    }
}
