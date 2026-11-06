import Foundation
import RuimtePulsar

/// Whether the machine behind a link names a request in `endpoint.info`. A request newer than 0.18.0 is checked here
/// before it is sent; its refusal is never read.
@MainActor public protocol MachineFeatures: AnyObject {
    func answers(_ type: WireRequest) -> Bool
}

extension MachineClient: MachineFeatures {}

/// The `<area>.watch` and `<area>.unwatch` of something a machine pushes events about while a client holds it.
public struct LiveWatch: Sendable {
    public let start: WireRequest
    public let stop: WireRequest
    public let payload: JSONValue
    public let stopPayload: JSONValue
    /// A request the machine must name before the watch is asked. Nil asks every machine.
    public let needs: WireRequest?

    public init(
        start: WireRequest, stop: WireRequest, payload: JSONValue = .object([:]), stopPayload: JSONValue? = nil,
        needs: WireRequest? = nil
    ) {
        self.start = start
        self.stop = stop
        self.payload = payload
        self.stopPayload = stopPayload ?? payload
        self.needs = needs
    }

    /// A watch whose stop is the `unwatch` beside its `watch`, as every area names the pair.
    public static func area(_ watch: WireRequest, payload: JSONValue = .object([:]), gated: Bool = false) -> LiveWatch {
        let name = watch.rawValue
        guard name.hasSuffix(".watch"), let stop = WireRequest(rawValue: String(name.dropLast("watch".count)) + "unwatch")
        else { preconditionFailure("\(name) has no unwatch beside it") }
        return LiveWatch(start: watch, stop: stop, payload: payload, needs: gated ? watch : nil)
    }
}

/// An event a live resource listens to, and what it does with it.
public struct LiveEvent {
    fileprivate let install: @MainActor (LiveResource) -> [() -> Void]

    /// Applies the payload as the event says it is. A payload that does not decode is dropped.
    public static func apply<Payload: Decodable>(
        _ event: WireEvent, as type: Payload.Type = Payload.self,
        _ handler: @escaping @MainActor @Sendable (Payload) -> Void
    ) -> LiveEvent {
        LiveEvent { resource in
            [
                resource.client.subscribe(event) { payload in
                    guard let value = try? payload.decoded(as: type) else { return }
                    handler(value)
                }
            ]
        }
    }

    /// Hands the validated payload over as it is.
    public static func apply(_ event: WireEvent, raw handler: @escaping @MainActor @Sendable (JSONValue) -> Void)
        -> LiveEvent
    {
        LiveEvent { resource in [resource.client.subscribe(event, handler: handler)] }
    }

    /// Reads again. With `rejected`, so does an event that failed validation, which a newer machine may send and
    /// which would otherwise leave the resource waiting on a change it never hears of.
    public static func reread(
        _ event: WireEvent, rejected: Bool = true, where matches: (@MainActor @Sendable (JSONValue) -> Bool)? = nil
    ) -> LiveEvent {
        LiveEvent { resource in
            let wake: @MainActor @Sendable (JSONValue) -> Void = { [weak resource] payload in
                if matches?(payload) ?? true { resource?.wake() }
            }
            var stops = [resource.client.subscribe(event, handler: wake)]
            if rejected { stops.append(resource.client.subscribeRejected(event, handler: wake)) }
            return stops
        }
    }

    /// Hands over the raw payload of an event that failed validation.
    public static func rejected(_ event: WireEvent, _ handler: @escaping @MainActor @Sendable (JSONValue) -> Void)
        -> LiveEvent
    {
        LiveEvent { resource in [resource.client.subscribeRejected(event, handler: handler)] }
    }
}

/// One live view of something on a machine: events it listens to, a watch the machine pushes them under, and the
/// read that brings it up to date.
///
/// The read runs on every link that opens, since what changed while the link was down was pushed to nobody, and
/// again when an event says the state changed. The watch is asked again on every link for the same reason; the
/// client counts the holders of a watch, so resources that hold the same one share it. A read never overlaps
/// another, and a change that arrives while one runs makes one more.
@MainActor public final class LiveResource {
    fileprivate let client: any MachineRequesting
    private let events: [LiveEvent]
    private let watch: LiveWatch?
    private let connection: (@MainActor (Bool) -> Void)?
    private let read: (@MainActor () async -> Void)?
    private let scheduler: any TransportScheduling
    private let settleMilliseconds: Double
    private let pollMilliseconds: (@MainActor () -> Double)?

    private var stops: [() -> Void] = []
    private var lease: MachineSubscription?
    private var running: Task<Void, Never>?
    private var cancelSettle: (() -> Void)?
    private var cancelPoll: (() -> Void)?
    private var readPending = false
    private var renewPending = false
    // Counts links and stops, so a read from one cannot end or restart the bookkeeping of the next.
    private var epoch = 0

    public private(set) var isStarted = false
    public private(set) var isConnected = false
    /// Whether the machine took the watch on this link. Without it nothing tells of a change, and `poll` takes over.
    public private(set) var isWatching = false

    /// - Parameters:
    ///   - connection: Told each change of the link before anything is read.
    ///   - read: Brings the state up to date. Cancelled when the link drops or the resource stops.
    ///   - settleMilliseconds: How long a burst of events is gathered into one read. A new link reads at once.
    ///   - poll: The clock of a machine that does not take the watch: its interval, read again after every read. A
    ///     resource without a watch never polls.
    public init(
        client: any MachineRequesting, events: [LiveEvent] = [], watch: LiveWatch? = nil,
        scheduler: any TransportScheduling = TaskTransportScheduler(), settleMilliseconds: Double = 0,
        poll: (@MainActor () -> Double)? = nil, connection: (@MainActor (Bool) -> Void)? = nil,
        read: (@MainActor () async -> Void)? = nil
    ) {
        self.client = client
        self.events = events
        self.watch = watch
        self.scheduler = scheduler
        self.settleMilliseconds = settleMilliseconds
        pollMilliseconds = poll
        self.connection = connection
        self.read = read
    }

    public func start() {
        guard !isStarted else { return }
        isStarted = true
        for event in events { stops.append(contentsOf: event.install(self)) }
        stops.append(client.observeConnection { [weak self] connected in self?.link(connected) })
    }

    /// Ends the resource at once and lets the watch go in the background.
    public func stop() {
        let lease = end()
        if let lease { Task { await lease.release() } }
    }

    /// Ends the resource and waits for the machine to be told the watch is let go.
    public func stopAndRelease() async {
        await end()?.release()
    }

    /// Reads now: the read in flight when there is one, or a new one. Does nothing while the link is down.
    public func refresh() async {
        guard isStarted, isConnected else { return }
        if running == nil {
            readPending = true
            drain()
        }
        await running?.value
    }

    fileprivate func wake() {
        guard isStarted, isConnected else { return }
        guard settleMilliseconds > 0 else {
            readPending = true
            drain()
            return
        }
        guard cancelSettle == nil else { return }
        cancelSettle = scheduler.after(milliseconds: settleMilliseconds) { [weak self] in
            guard let self else { return }
            cancelSettle = nil
            readPending = true
            drain()
        }
    }

    private func end() -> MachineSubscription? {
        guard isStarted else { return nil }
        isStarted = false
        reset()
        isConnected = false
        isWatching = false
        for stop in stops { stop() }
        stops.removeAll()
        let held = lease
        lease = nil
        return held
    }

    private func reset() {
        epoch += 1
        running?.cancel()
        running = nil
        cancelSettle?()
        cancelSettle = nil
        cancelPoll?()
        cancelPoll = nil
        readPending = false
        renewPending = false
    }

    private func link(_ connected: Bool) {
        reset()
        isConnected = connected
        isWatching = false
        connection?(connected)
        guard connected else { return }
        renewPending = true
        readPending = true
        drain()
    }

    private func drain() {
        guard running == nil else { return }
        let current = epoch
        running = Task { [weak self] in
            while let self, epoch == current, !Task.isCancelled, readPending || renewPending {
                let renew = renewPending
                renewPending = false
                readPending = false
                if renew { await renewWatch() }
                guard !Task.isCancelled, epoch == current else { break }
                await read?()
                guard !Task.isCancelled, epoch == current else { break }
                armPoll()
            }
            if let self, epoch == current { running = nil }
        }
    }

    private func renewWatch() async {
        guard let watch else { return }
        if let needs = watch.needs, (client as? MachineFeatures)?.answers(needs) != true { return }
        let held =
            lease
            ?? client.acquireSubscription(
                start: watch.start, stop: watch.stop, payload: watch.payload, stopPayload: watch.stopPayload)
        lease = held
        let current = epoch
        let taken = (try? await held.refresh()) != nil
        if epoch == current { isWatching = taken }
    }

    private func armPoll() {
        guard watch != nil, !isWatching, cancelPoll == nil, let pollMilliseconds else { return }
        cancelPoll = scheduler.after(milliseconds: pollMilliseconds()) { [weak self] in
            guard let self else { return }
            cancelPoll = nil
            readPending = true
            drain()
        }
    }
}

/// How many holders a page or a feed has, with a grace after the last one lets go. A push from one page to the next
/// leaves the first before the second appears, and what the holders keep running would otherwise start over between
/// them.
@MainActor public final class LiveHolds {
    private let graceMilliseconds: Double
    private let scheduler: any TransportScheduling
    private let began: @MainActor () -> Void
    private let ended: @MainActor () -> Void
    private var count = 0
    private var cancelGrace: (() -> Void)?

    public var isHeld: Bool { count > 0 }

    public init(
        graceMilliseconds: Double, scheduler: any TransportScheduling = TaskTransportScheduler(),
        began: @escaping @MainActor () -> Void, ended: @escaping @MainActor () -> Void
    ) {
        self.graceMilliseconds = graceMilliseconds
        self.scheduler = scheduler
        self.began = began
        self.ended = ended
    }

    public func retain() {
        count += 1
        if let cancelGrace {
            cancelGrace()
            self.cancelGrace = nil
        } else if count == 1 {
            began()
        }
    }

    public func release() {
        count = max(0, count - 1)
        guard count == 0, cancelGrace == nil else { return }
        cancelGrace = scheduler.after(milliseconds: graceMilliseconds) { [weak self] in
            guard let self, count == 0 else { return }
            cancelGrace = nil
            ended()
        }
    }
}
