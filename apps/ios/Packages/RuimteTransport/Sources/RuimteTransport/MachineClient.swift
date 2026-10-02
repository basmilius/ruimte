import Foundation
import RuimtePulsar
import os

@MainActor public protocol MachineRequesting: AnyObject {
    func request(_ type: String, payload: JSONValue) async throws -> JSONValue
    func request(_ type: String, payload: JSONValue, onResult: @escaping @MainActor @Sendable (JSONValue) -> Void)
        async throws -> JSONValue
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void
    /// Hands over the raw payload of an event that failed validation, which a newer machine may send. A subscriber
    /// can then read its state again instead of waiting on an event that never arrives.
    func subscribeRejected(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void
    func acquireSubscription(start: String, stop: String, payload: JSONValue, stopPayload: JSONValue)
        -> MachineSubscription
    func acquireAttachment(_ type: String, id: String) -> MachineAttachment
    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void
    /// One piece of `bytes.read`, as a binary reply where the machine sends those.
    func readBytes(_ payload: JSONValue) async throws -> BytesPiece
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
    public func subscribeRejected(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void)
        -> () -> Void
    { {} }
    public func readBytes(_ payload: JSONValue) async throws -> BytesPiece {
        try BytesPiece(json: try WireRequest.bytesRead.validateResult(try await request(.bytesRead, payload: payload)))
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
    /// Only requests that read may time out. A mutation may still be running on the machine, such as a push behind a
    /// slow hook, and a timeout would invite a second press that runs it twice. It ends when the link closes, as on
    /// the desktop, which has no request timer.
    public static let timedRequests: Set<WireRequest> = [
        .serverHello, .serverPing, .pushAttention, .sessionAttach, .sessionList, .browserDevServers, .deviceList,
        .deviceDetail, .chatHistory, .chatAttach, .chatTurnDiff, .chatForkInfo, .chatSubagent, .chatList, .skillsList,
        .providerList, .projectSidebar, .projectList, .projectOpen, .drawingPaths, .drawingOpen,
        .diagramLayout, .diagramOpen, .fsBrowse, .fsSearch, .fsGrep, .fsList, .fsRead, .bytesRead, .gitWorktreeList,
        .gitStatus, .gitDiff, .gitRefs, .gitRepos, .gitLog, .gitConflicts, .gitConflict, .gitCapabilities,
        .usageSummary, .usageLimits, .processesListAlerts, .endpointInfo, .authSessions, .taskList, .agentChildren,
        .planList,
    ]

    private static let log = Logger(subsystem: "app.ruimte.mobile", category: "wire")

    private struct Pending {
        let type: WireRequest
        let continuation: CheckedContinuation<JSONValue, Error>
        let onResult: (@MainActor @Sendable (JSONValue) -> Void)?
        // Asked by `readBytes`, which alone takes a binary reply.
        var binary = false
        var cancelTimeout: () -> Void = {}
        // What `heard` had counted when the timer was set.
        var heardAt = 0
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
    // The bytes of a binary reply, held from its arrival until `readBytes` resumes and takes them.
    private var binaryBodies: [String: Data] = [:]
    private var attachments: [String: Set<UUID>] = [:]
    private var subscribers: [String: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]
    private var rejectedSubscribers: [String: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]
    private var observers: [UUID: @MainActor @Sendable (Bool) -> Void] = [:]
    private var incoming: Task<Void, Never>?
    private var connectionGeneration = 0
    private var heardCount = 0
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
        rejectedSubscribers.removeAll()
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

    public func readBytes(_ payload: JSONValue) async throws -> BytesPiece {
        guard case .object(var fields) = payload else { throw MachineClientError.invalid("Invalid bytes request") }
        fields["binary"] = .bool(true)
        let id = UUID().uuidString
        let result = try await routedRequest(
            WireRequest.bytesRead.rawValue, payload: .object(fields), onResult: nil, id: id, binary: true)
        if let data = binaryBodies.removeValue(forKey: id) { return try BytesPiece(header: result, data: data) }
        return try BytesPiece(json: result)
    }

    private func routedRequest(
        _ type: String, payload: JSONValue, onResult: (@MainActor @Sendable (JSONValue) -> Void)?,
        id: String = UUID().uuidString, binary: Bool = false
    ) async throws -> JSONValue {
        try Task.checkCancellation()
        guard isConnected else { throw MachineClientError.disconnected }
        guard let requestType = WireRequest(rawValue: type) else {
            throw MachineClientError.invalid("Unknown request: \(type)")
        }
        let checked = try requestType.validatePayload(payload)
        let frame = JSONValue.object(["id": .string(id), "type": .string(type), "payload": checked])
        let text = String(decoding: try frame.encoded(), as: UTF8.self)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if Task.isCancelled {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                pending[id] = Pending(type: requestType, continuation: continuation, onResult: onResult, binary: binary)
                if Self.timedRequests.contains(requestType) {
                    armTimeout(id, type: type)
                    guard pending[id] != nil else { return }
                }
                do { try send(text) } catch { finish(id, result: .failure(error)) }
            }
        } onCancel: { [weak self] in
            Task { @MainActor in self?.finish(id, result: .failure(CancellationError())) }
        }
    }

    /// A piece of any frame arrived. A timed request times out on silence rather than on its whole reply, which over
    /// a slow link can take longer than the timeout to come in.
    public func heard() {
        heardCount += 1
    }

    private func armTimeout(_ id: String, type: String) {
        pending[id]?.cancelTimeout()
        let cancel = scheduler.after(milliseconds: timeoutMilliseconds) { [weak self] in
            guard let self, let request = pending[id] else { return }
            if request.heardAt == heardCount {
                finish(id, result: .failure(MachineClientError.timeout(type)))
            } else {
                armTimeout(id, type: type)
            }
        }
        if pending[id] != nil {
            pending[id]?.heardAt = heardCount
            pending[id]?.cancelTimeout = cancel
        } else {
            cancel()
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

    public func subscribeRejected(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void)
        -> () -> Void
    {
        let id = UUID()
        rejectedSubscribers[event, default: [:]][id] = handler
        return { [weak self] in
            guard let self else { return }
            rejectedSubscribers[event]?.removeValue(forKey: id)
            if rejectedSubscribers[event]?.isEmpty == true { rejectedSubscribers.removeValue(forKey: event) }
        }
    }

    public func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        let id = UUID()
        observers[id] = handler
        handler(isConnected)
        return { [weak self] in self?.observers.removeValue(forKey: id) }
    }

    public func receive(_ text: String) {
        guard isConnected else { return }
        guard let frame = try? JSONValue.decode(Data(text.utf8)) else {
            unreadable(text)
            return
        }
        receive(frame)
    }

    @discardableResult public func receiveInOrder(_ text: String) -> Task<Void, Never> {
        guard isConnected else { return Task {} }
        let previous = incoming
        let generation = connectionGeneration
        // Await delivery as well as decoding: a snapshot must precede its following deltas.
        let task = Task.detached(priority: .userInitiated) { [weak self] in
            await previous?.value
            guard !Task.isCancelled else { return }
            guard let frame = try? JSONValue.decode(Data(text.utf8)) else {
                await self?.unreadable(text, generation: generation)
                return
            }
            await self?.receive(frame, generation: generation)
        }
        incoming = task
        return task
    }

    private func unreadable(_ text: String, generation: Int) {
        guard generation == connectionGeneration else { return }
        unreadable(text)
    }

    /// A frame that does not decode has no `id` to read, but a reply still names its request, which would otherwise
    /// wait for a timer or, for a mutation, for the link to close.
    private func unreadable(_ text: String) {
        guard isConnected else { return }
        let replied = pending.keys.filter { text.contains(#""id":"\#($0)""#) }
        Self.log.error("Dropped a frame that does not decode, a reply to \(replied.count, privacy: .public) requests")
        for id in replied {
            finish(id, result: .failure(MachineClientError.invalid("The machine sent a reply this app cannot read.")))
        }
    }

    @discardableResult public func receiveBinaryInOrder(_ frame: Data) -> Task<Void, Never> {
        guard isConnected else { return Task {} }
        let previous = incoming
        let generation = connectionGeneration
        let task = Task.detached(priority: .userInitiated) { [weak self] in
            await previous?.value
            guard !Task.isCancelled, let reply = BytesReply(frame) else { return }
            await self?.receive(reply, generation: generation)
        }
        incoming = task
        return task
    }

    private func receive(_ reply: BytesReply, generation: Int) {
        guard generation == connectionGeneration, isConnected, pending[reply.id]?.binary == true else { return }
        do {
            _ = try BytesPiece(header: reply.header, data: reply.data)
            binaryBodies[reply.id] = reply.data
            finish(reply.id, result: .success(reply.header))
        } catch { finish(reply.id, result: .failure(error)) }
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
            let event = WireEvent(rawValue: name), let input = frame["payload"]
        else { return }
        let payload: JSONValue
        do {
            payload = try event.validatePayload(input)
        } catch {
            let reason = String(describing: error)
            Self.log.error("Dropped an invalid \(name, privacy: .public) event: \(reason, privacy: .public)")
            for handler in Array(rejectedSubscribers[name]?.values ?? [:].values) { handler(input) }
            return
        }
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
            var first: BytesPiece?
            var changed = false
            repeat {
                try Task.checkCancellation()
                let piece = try await readBytes(
                    .object([
                        "resource": resource, "offset": .number(Double(data.count)), "length": .number(Double(length)),
                    ]))
                guard piece.size <= limit else {
                    throw MachineClientError.invalid("This resource exceeds the direct connection size limit.")
                }
                if first == nil { first = piece }
                if piece.version != first?.version || piece.size != first?.size || piece.mime != first?.mime
                    || piece.offset != data.count
                {
                    changed = true
                    break
                }
                let bytes = piece.data
                guard bytes.count <= length, data.count + bytes.count <= piece.size else {
                    throw MachineClientError.invalid("The machine sent an invalid resource piece.")
                }
                data.append(bytes)
                if data.count == piece.size {
                    return MachineResource(data: data, mime: piece.mime)
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
