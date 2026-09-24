import Foundation
import RuimtePulsar

@MainActor public protocol MachineRequesting: AnyObject {
    func request(_ type: String, payload: JSONValue) async throws -> JSONValue
    func request(_ type: String, payload: JSONValue, onResult: @escaping @MainActor @Sendable (JSONValue) -> Void)
        async throws -> JSONValue
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void
    func acquireSubscription(start: String, stop: String, payload: JSONValue, stopPayload: JSONValue)
        -> MachineSubscription
    func acquireAttachment(_ type: String, id: String) -> MachineAttachment
    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void
}

@MainActor public final class MachineSubscription {
    private var startAction: (() async throws -> JSONValue)?
    private var releaseAction: (() async -> Void)?
    init(start: @escaping () async throws -> JSONValue, release: @escaping () async -> Void) {
        startAction = start
        releaseAction = release
    }
    @discardableResult public func refresh() async throws -> JSONValue {
        guard let startAction else { throw MachineClientError.disconnected }
        return try await startAction()
    }
    public func release() async {
        let action = releaseAction
        releaseAction = nil
        startAction = nil
        await action?()
    }
}

@MainActor public final class MachineAttachment {
    private var snapshotAction:
        ((JSONValue, @escaping @MainActor @Sendable (JSONValue) -> Void) async throws -> JSONValue)?
    private var releaseAction: (() async -> Void)?
    init(
        snapshot: @escaping (JSONValue, @escaping @MainActor @Sendable (JSONValue) -> Void) async throws -> JSONValue,
        release: @escaping () async -> Void
    ) {
        snapshotAction = snapshot
        releaseAction = release
    }
    public func snapshot(payload: JSONValue, onSnapshot: @escaping @MainActor @Sendable (JSONValue) -> Void = { _ in })
        async throws -> JSONValue
    {
        guard let snapshotAction else { throw MachineClientError.disconnected }
        return try await snapshotAction(payload, onSnapshot)
    }
    public func release() async {
        let release = releaseAction
        releaseAction = nil
        snapshotAction = nil
        await release?()
    }
}

@MainActor extension MachineRequesting {
    public func request(
        _ type: String, payload: JSONValue, onResult: @escaping @MainActor @Sendable (JSONValue) -> Void
    ) async throws -> JSONValue {
        let result = try await request(type, payload: payload)
        onResult(result)
        return result
    }

    public func acquireSubscription(start: String, stop: String, payload: JSONValue, stopPayload: JSONValue)
        -> MachineSubscription
    {
        MachineSubscription(
            start: { [weak self] in
                guard let self else { throw MachineClientError.disconnected }
                return try await self.request(start, payload: payload)
            }, release: { [weak self] in _ = try? await self?.request(stop, payload: stopPayload) })
    }
    public func acquireAttachment(_ type: String, id: String) -> MachineAttachment {
        MachineAttachment(
            snapshot: { [weak self] payload, onSnapshot in
                guard let self else { throw MachineClientError.disconnected }
                let result = try await self.request("\(type).attach", payload: payload)
                onSnapshot(result)
                return result
            },
            release: { [weak self] in
                _ = try? await self?.request("\(type).detach", payload: .object(["\(type)Id": .string(id)]))
            })
    }
    public func request(_ type: String) async throws -> JSONValue { try await request(type, payload: .object([:])) }
    public func request(_ type: WireRequest, payload: JSONValue = .object([:])) async throws -> JSONValue {
        try await request(type.rawValue, payload: payload)
    }
    public func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void
    {
        subscribe(event.rawValue, handler: handler)
    }
    public func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        handler(true)
        return {}
    }
}

public enum MachineClientError: Error, LocalizedError, Sendable, Equatable {
    case disconnected
    case timeout(String)
    case server(code: String, message: String)
    case invalid(String)

    public var errorDescription: String? {
        switch self {
        case .disconnected: "The machine is reconnecting. Try again when it is connected."
        case .timeout(let request): "The machine did not answer \(request) in time."
        case .server(_, let message), .invalid(let message): message
        }
    }
}

@MainActor public final class MachineClient: MachineRequesting {
    /// The requests that only read, the only ones a timer may give up on. A mutation may still be running on the
    /// machine (a push behind a slow hook, a large send), so it ends only when the link closes, the way the desktop
    /// client has no timer at all, and a person pressing again never starts it twice.
    public static let timedRequests: Set<WireRequest> = [
        .serverHello, .serverPing, .pushAttention, .sessionAttach, .sessionList, .browserDevServers, .deviceList,
        .deviceDetail, .chatHistory, .chatAttach, .chatTurnDiff, .chatForkInfo, .chatSubagent, .chatList, .skillsList,
        .providerList, .projectSidebar, .projectList, .projectOpen, .projectSettings, .drawingPaths, .drawingOpen,
        .diagramLayout, .diagramOpen, .fsBrowse, .fsSearch, .fsGrep, .fsList, .fsRead, .bytesRead, .gitWorktreeList,
        .gitStatus, .gitDiff, .gitRefs, .gitRepos, .gitLog, .gitConflicts, .gitConflict, .gitCapabilities,
        .usageSummary, .usageLimits, .processesListAlerts, .endpointInfo, .authSessions, .taskList, .agentChildren,
        .planList,
    ]

    private struct Pending {
        let type: WireRequest
        let continuation: CheckedContinuation<JSONValue, Error>
        let onResult: (@MainActor @Sendable (JSONValue) -> Void)?
        var cancelTimeout: () -> Void = {}
    }
    private struct Subscription {
        var owners: Set<UUID>
        let start: String
        let stop: String
        let payload: JSONValue
        let stopPayload: JSONValue
    }
    private var remoteSubscriptions: [String: Subscription] = [:]
    private let send: (String) throws -> Void
    private let scheduler: any TransportScheduling
    private let timeoutMilliseconds: Double
    private var pending: [String: Pending] = [:]
    private var attachments: [String: Set<UUID>] = [:]
    private var subscribers: [String: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]
    private var observers: [UUID: @MainActor @Sendable (Bool) -> Void] = [:]
    private var incoming: Task<Void, Never>?
    private var connectionGeneration = 0
    public private(set) var isConnected: Bool
    public var pendingRequestCount: Int { pending.count }

    public init(
        send: @escaping (String) throws -> Void, scheduler: any TransportScheduling = TaskTransportScheduler(),
        timeoutMilliseconds: Double = 15_000, connected: Bool = false
    ) {
        self.send = send
        self.scheduler = scheduler
        self.timeoutMilliseconds = timeoutMilliseconds
        isConnected = connected
    }

    public func connected() {
        guard !isConnected else { return }
        isConnected = true
        for observer in Array(observers.values) { observer(true) }
    }

    public func disconnected(error: Error? = nil) {
        connectionGeneration += 1
        incoming?.cancel()
        incoming = nil
        let wasConnected = isConnected
        isConnected = false
        // Mutations may already have reached the daemon; never replay them on a new connection.
        for id in Array(pending.keys) { finish(id, result: .failure(error ?? MachineClientError.disconnected)) }
        if wasConnected { for observer in Array(observers.values) { observer(false) } }
    }

    public func shutdown() {
        disconnected()
        subscribers.removeAll()
        attachments.removeAll()
        remoteSubscriptions.removeAll()
        observers.removeAll()
    }

    public func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        try await routedRequest(type, payload: payload, onResult: nil)
    }

    public func request(
        _ type: String, payload: JSONValue, onResult: @escaping @MainActor @Sendable (JSONValue) -> Void
    ) async throws -> JSONValue {
        try await routedRequest(type, payload: payload, onResult: onResult)
    }

    private func routedRequest(
        _ type: String, payload: JSONValue, onResult: (@MainActor @Sendable (JSONValue) -> Void)?
    ) async throws -> JSONValue {
        try Task.checkCancellation()
        guard isConnected else { throw MachineClientError.disconnected }
        guard let requestType = WireRequest(rawValue: type) else {
            throw MachineClientError.invalid("Unknown request: \(type)")
        }
        let checked = try requestType.validatePayload(payload)
        let id = UUID().uuidString
        let frame = JSONValue.object(["id": .string(id), "type": .string(type), "payload": checked])
        let text = String(decoding: try frame.encoded(), as: UTF8.self)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if Task.isCancelled {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                pending[id] = Pending(type: requestType, continuation: continuation, onResult: onResult)
                if Self.timedRequests.contains(requestType) {
                    let cancel = scheduler.after(milliseconds: timeoutMilliseconds) { [weak self] in
                        self?.finish(id, result: .failure(MachineClientError.timeout(type)))
                    }
                    if pending[id] != nil {
                        pending[id]?.cancelTimeout = cancel
                    } else {
                        cancel()
                        return
                    }
                }
                do { try send(text) } catch { finish(id, result: .failure(error)) }
            }
        } onCancel: { [weak self] in
            Task { @MainActor in self?.finish(id, result: .failure(CancellationError())) }
        }
    }

    public func acquireSubscription(start: String, stop: String, payload: JSONValue, stopPayload: JSONValue)
        -> MachineSubscription
    {
        let key = stop + ":" + String(decoding: (try? stopPayload.encoded()) ?? Data(), as: UTF8.self)
        let owner = UUID()
        if remoteSubscriptions[key] == nil {
            remoteSubscriptions[key] = Subscription(
                owners: [], start: start, stop: stop, payload: payload, stopPayload: stopPayload)
        }
        remoteSubscriptions[key]?.owners.insert(owner)
        return MachineSubscription(
            start: { [weak self] in
                guard let self, self.remoteSubscriptions[key]?.owners.contains(owner) == true else {
                    throw MachineClientError.disconnected
                }
                return try await self.request(start, payload: payload)
            },
            release: { [weak self] in
                guard let self, self.remoteSubscriptions[key]?.owners.remove(owner) != nil,
                    self.remoteSubscriptions[key]?.owners.isEmpty == true
                else { return }
                self.remoteSubscriptions.removeValue(forKey: key)
                _ = try? await self.request(stop, payload: stopPayload)
                // A recursive file watch may have replaced its children's watches on the daemon.
                for subscription in Array(self.remoteSubscriptions.values) where subscription.stop == stop {
                    _ = try? await self.request(subscription.start, payload: subscription.payload)
                }
            })
    }

    public func acquireAttachment(_ type: String, id: String) -> MachineAttachment {
        let key = "\(type):\(id)"
        let owner = UUID()
        attachments[key, default: []].insert(owner)
        return MachineAttachment(
            snapshot: { [weak self] payload, onSnapshot in
                guard let self, self.attachments[key]?.contains(owner) == true else {
                    throw MachineClientError.disconnected
                }
                return try await self.routedRequest("\(type).attach", payload: payload, onResult: onSnapshot)
            },
            release: { [weak self] in
                guard let self, self.attachments[key]?.remove(owner) != nil else { return }
                if self.attachments[key]?.isEmpty == true {
                    self.attachments.removeValue(forKey: key)
                    _ = try? await self.request("\(type).detach", payload: .object(["\(type)Id": .string(id)]))
                }
            })
    }

    public func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        let id = UUID()
        subscribers[event, default: [:]][id] = handler
        return { [weak self] in
            self?.subscribers[event]?.removeValue(forKey: id)
            if self?.subscribers[event]?.isEmpty == true { self?.subscribers.removeValue(forKey: event) }
        }
    }

    public func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        let id = UUID()
        observers[id] = handler
        handler(isConnected)
        return { [weak self] in self?.observers.removeValue(forKey: id) }
    }

    public func receive(_ text: String) {
        guard isConnected, let frame = try? JSONValue.decode(Data(text.utf8)) else { return }
        receive(frame)
    }

    @discardableResult public func receiveInOrder(_ text: String) -> Task<Void, Never> {
        guard isConnected else { return Task {} }
        let previous = incoming
        let generation = connectionGeneration
        // Await delivery as well as decoding: a snapshot must precede its following deltas.
        let task = Task.detached(priority: .userInitiated) { [weak self] in
            await previous?.value
            guard !Task.isCancelled, let frame = try? JSONValue.decode(Data(text.utf8)) else { return }
            await self?.receive(frame, generation: generation)
        }
        incoming = task
        return task
    }

    private func receive(_ frame: JSONValue, generation: Int) {
        guard generation == connectionGeneration else { return }
        receive(frame)
    }

    private func receive(_ frame: JSONValue) {
        guard isConnected else { return }
        if let id = frame["id"]?.stringValue {
            guard let request = pending[id] else { return }
            do {
                let reply = try WireSchema.validate("ReplySchema", frame)
                if reply["ok"] == .bool(true), let value = reply["result"] {
                    finish(id, result: .success(try request.type.validateResult(value)))
                } else if let code = reply["error"]?["code"]?.stringValue,
                    let message = reply["error"]?["message"]?.stringValue
                {
                    finish(id, result: .failure(MachineClientError.server(code: code, message: message)))
                } else {
                    throw MachineClientError.invalid("Invalid machine response")
                }
            } catch { finish(id, result: .failure(error)) }
            return
        }
        guard frame["type"] == .string("event"), let name = frame["event"]?.stringValue,
            let event = WireEvent(rawValue: name), let input = frame["payload"],
            let payload = try? event.validatePayload(input)
        else { return }
        for handler in Array(subscribers[name]?.values ?? [:].values) { handler(payload) }
    }

    private func finish(_ id: String, result: Result<JSONValue, Error>) {
        guard let request = pending.removeValue(forKey: id) else { return }
        request.cancelTimeout()
        if case .success(let value) = result { request.onResult?(value) }
        request.continuation.resume(with: result)
    }
}

public struct MachineResource: Sendable, Equatable {
    public let data: Data
    public let mime: String
    public init(data: Data, mime: String) {
        self.data = data
        self.mime = mime
    }
}

@MainActor extension MachineRequesting {
    public func readResource(
        _ resource: JSONValue, chunkBytes: Int = Int(WireConstants.bytesChunkMax),
        maxBytes: Int = Int(WireConstants.bytesReadMaxBytes), restarts: Int = 1
    ) async throws -> MachineResource {
        guard chunkBytes > 0, maxBytes >= 0, restarts >= 0 else {
            throw MachineClientError.invalid("Invalid resource limits")
        }
        let length = min(chunkBytes, Int(WireConstants.bytesChunkMax))
        let limit = min(maxBytes, Int(WireConstants.bytesReadMaxBytes))
        for attempt in 0...min(restarts, 3) {
            var data = Data()
            var first: JSONValue?
            var changed = false
            repeat {
                try Task.checkCancellation()
                let reply = try await request(
                    .bytesRead,
                    payload: .object([
                        "resource": resource, "offset": .number(Double(data.count)), "length": .number(Double(length)),
                    ]))
                let piece = try WireRequest.bytesRead.validateResult(reply)
                guard let size = piece["size"]?.numberValue, size <= Double(limit) else {
                    throw MachineClientError.invalid("This resource exceeds the direct connection size limit.")
                }
                if first == nil { first = piece }
                if piece["version"] != first?["version"] || piece["size"] != first?["size"]
                    || piece["mime"] != first?["mime"] || piece["offset"] != .number(Double(data.count))
                {
                    changed = true
                    break
                }
                guard let encoded = piece["data"]?.stringValue,
                    encoded.utf8.count <= ((length + 2) / 3) * 4,
                    let bytes = Data(base64Encoded: encoded), bytes.count <= length,
                    Double(data.count + bytes.count) <= size
                else {
                    throw MachineClientError.invalid("The machine sent an invalid resource piece.")
                }
                data.append(bytes)
                if Double(data.count) == size {
                    return MachineResource(data: data, mime: piece["mime"]?.stringValue ?? "application/octet-stream")
                }
                if bytes.isEmpty {
                    throw MachineClientError.invalid("The machine sent an empty piece before the end of the resource.")
                }
            } while true
            if changed && attempt < min(restarts, 3) { continue }
            throw MachineClientError.invalid("The resource changed while it was loading.")
        }
        throw MachineClientError.invalid("The resource could not be loaded.")
    }
}
