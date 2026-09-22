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
    private(set) var failedAttempts = 0
    private(set) var problem: String?
    private(set) var relayed: Bool?
    private var lease: MachineLease?
    @ObservationIgnored private var preferenceSubscriptions: [() -> Void] = []
    private var references = 0
    private var invalidated = false
    private struct ChatEntry {
        let model: ChatModel
        var viewers: Int
        var expiry: Task<Void, Never>?
    }
    @ObservationIgnored private var chats: [String: ChatEntry] = [:]
    @ObservationIgnored private lazy var projectSubscriptions = ProjectSubscriptions { [weak self] type, payload in
        guard let self else { throw CancellationError() }
        return try await self.rpc.request(type, payload: payload)
    }
    private weak var runtime: AppRuntime?
    @ObservationIgnored lazy var attention = AttentionStore(client: rpc)
    @ObservationIgnored lazy var tasks = TaskStore(client: rpc)
    @ObservationIgnored lazy var plans = PlanStore(client: rpc)
    @ObservationIgnored lazy var icons = MachineIconState(client: rpc, fallback: machine.icon)
    @ObservationIgnored lazy var usageWidget = UsageWidgetRecorder(machineID: machine.id, client: rpc)
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
                    failedAttempts = 0
                    problem = nil
                    generation += 1
                    rpc.connected()
                }
            }, message: { [weak self] text in self?.rpc.receiveInOrder(text) },
            closed: { [weak self] error in
                guard let self else { return }
                if error != nil || !connected { failedAttempts += 1 }
                connected = false
                relayed = nil
                problem = error?.localizedDescription
                discardIdleChats()
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
        attention.onRead = { [weak self] nodeID, through in
            guard let self else { return }
            await self.runtime?.notifications.applyRead(machineID: self.machine.id, nodeID: nodeID, through: through)
        }
        attention.start()
        tasks.start()
        plans.start()
        icons.start()
        usageWidget.start()
        startPreferences()
    }

    private func startPreferences() {
        guard preferenceSubscriptions.isEmpty else { return }
        let preferences = ChatPreferences.shared
        preferenceSubscriptions = [
            rpc.observeConnection { [weak self] connected in
                guard let self, connected else { return }
                preferences.send(to: rpc)
            },
            preferences.observe { [weak self] in
                guard let self, rpc.isConnected else { return }
                preferences.send(to: rpc)
            },
        ]
    }

    private func stopPreferences() {
        preferenceSubscriptions.forEach { $0() }
        preferenceSubscriptions.removeAll()
    }

    func release() {
        references = max(0, references - 1)
        guard references == 0 else { return }
        clearChats()
        attention.stop()
        tasks.stop()
        plans.stop()
        icons.stop()
        usageWidget.stop()
        stopPreferences()
        lease?.release()
        lease = nil
        connected = false
        rpc.disconnected(error: nil)
    }

    func retainProject(_ id: String) { projectSubscriptions.retain(id) }

    func retainChat(_ fallback: ChatModel) -> ChatModel {
        let id = fallback.chatID
        var entry = chats[id] ?? ChatEntry(model: fallback, viewers: 0)
        entry.expiry?.cancel()
        entry.expiry = nil
        entry.viewers += 1
        chats[id] = entry
        entry.model.start()
        return entry.model
    }

    func releaseChat(_ model: ChatModel) {
        let id = model.chatID
        guard var entry = chats[id], entry.model === model else {
            model.stop()
            return
        }
        entry.viewers = max(0, entry.viewers - 1)
        chats[id] = entry
        guard entry.viewers == 0 else { return }
        // Keep just the last hidden chat live; its events prevent a stale snapshot on quick return.
        discardIdleChats(except: connected ? id : nil)
        guard connected else { return }
        entry.expiry = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(30)) } catch { return }
            self?.removeChat(id)
        }
        chats[id] = entry
    }

    func hasLiveChat(_ id: String) -> Bool {
        guard connected, let model = chats[id]?.model else { return false }
        return model.connected && !model.loading && model.info != .null && model.error == nil
    }

    private func discardIdleChats(except retainedID: String? = nil) {
        for (id, entry) in chats where entry.viewers == 0 && id != retainedID { removeChat(id) }
    }

    private func removeChat(_ id: String) {
        guard let entry = chats.removeValue(forKey: id) else { return }
        entry.expiry?.cancel()
        entry.model.stop()
    }

    private func clearChats() {
        for id in Array(chats.keys) { removeChat(id) }
    }

    func openProject(_ id: String) async throws -> JSONValue { try await projectSubscriptions.open(id) }

    func releaseProject(_ id: String) async { await projectSubscriptions.release(id, connected: connected).value }

    func invalidate() {
        invalidated = true
        clearChats()
        attention.stop()
        tasks.stop()
        plans.stop()
        icons.stop()
        usageWidget.stop()
        stopPreferences()
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
        attention.markSeen(nodeID)
        await runtime?.notifications.markSeen(machineID: machine.id, nodeID: nodeID)
    }

    func waitForConnection(timeout: Duration = .seconds(15)) async throws {
        if connected { return }
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { try await self.connectionBecameReady() }
            group.addTask {
                try await Task.sleep(for: timeout)
                throw MachineClientError.timeout("connect")
            }
            defer { group.cancelAll() }
            _ = try await group.next()
        }
    }

    private func connectionBecameReady() async throws {
        let (stream, continuation) = AsyncStream<Bool>.makeStream()
        let stop = rpc.observeConnection { continuation.yield($0) }
        defer {
            stop()
            continuation.finish()
        }
        for await connected in stream { if connected { return } }
        throw CancellationError()
    }

    func refreshUsageWidget() async {
        retain()
        defer { release() }
        guard (try? await waitForConnection(timeout: .seconds(20))) != nil else { return }
        await usageWidget.refresh()
    }

    func reconnect() {
        failedAttempts = 0
        problem = nil
        runtime?.connections.reconnect(machineID: machine.id)
    }
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
