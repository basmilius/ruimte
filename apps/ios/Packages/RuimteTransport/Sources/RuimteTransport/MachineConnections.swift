import Foundation
import Network
import RuimtePulsar

@MainActor public protocol MachineLink: AnyObject {
    func send(_ text: String) throws
    func close()
}

@MainActor public struct LinkEvents {
    public var opened: () -> Void
    public var message: (String) -> Void
    public var closed: (Error?) -> Void
    public var route: (Bool?) -> Void
    public init(opened: @escaping () -> Void, message: @escaping (String) -> Void, closed: @escaping (Error?) -> Void, route: @escaping (Bool?) -> Void = { _ in }) {
        self.opened = opened
        self.message = message
        self.closed = closed
        self.route = route
    }
}

@MainActor public protocol TransportScheduling {
    @discardableResult func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void
}

@MainActor public struct TaskTransportScheduler: TransportScheduling {
    nonisolated public init() {}
    public func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void {
        let task = Task { @MainActor in
            do { try await Task.sleep(for: .milliseconds(milliseconds)) }
            catch { return }
            if !Task.isCancelled { action() }
        }
        return { task.cancel() }
    }
}

@MainActor public final class MachineLease {
    private let sendAction: (String) throws -> Void
    private var releaseAction: (() -> Void)?
    init(send: @escaping (String) throws -> Void, release: @escaping () -> Void) {
        sendAction = send
        releaseAction = release
    }
    public func send(_ text: String) throws {
        guard releaseAction != nil else { throw TransportFailure.invalid("This machine connection was released.") }
        try sendAction(text)
    }
    public func release() {
        let release = releaseAction
        releaseAction = nil
        release?()
    }
}

@MainActor public final class MachineConnections {
    public typealias Opener = (LinkEvents) throws -> any MachineLink
    private final class Entry {
        let open: Opener
        var members: [UUID: LinkEvents] = [:]
        var link: (any MachineLink)?
        var generation = 0
        var retry: (() -> Void)?
        var idleCleanup: (() -> Void)?
        var attempt = 0
        var connected = false
        var relayed: Bool?
        init(open: @escaping Opener) { self.open = open }
    }
    private var machines: [String: Entry] = [:]
    private var foregroundScenes = Set<String>()
    private let scheduler: any TransportScheduling
    private var monitor: NWPathMonitor?
    private var pathFingerprint: String?
    private var pathRevision = 0

    public init(scheduler: any TransportScheduling = TaskTransportScheduler(), monitorPaths: Bool = true) {
        self.scheduler = scheduler
        if monitorPaths {
            let monitor = NWPathMonitor()
            self.monitor = monitor
            monitor.pathUpdateHandler = { [weak self] path in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.pathRevision += 1
                    self.pathChanged(fingerprint: String(self.pathRevision), reachable: path.status == .satisfied)
                }
            }
            monitor.start(queue: DispatchQueue(label: "app.ruimte.mobile.network-path"))
        }
    }

    public var machineCount: Int { machines.count }

    public func setScene(_ id: String, foreground: Bool) {
        let wasForeground = !foregroundScenes.isEmpty
        if foreground { foregroundScenes.insert(id) }
        else { foregroundScenes.remove(id) }
        let isForeground = !foregroundScenes.isEmpty
        guard wasForeground != isForeground else { return }
        for (id, entry) in Array(machines) {
            suspend(entry)
            if entry.members.isEmpty { machines.removeValue(forKey: id) }
            else if isForeground { connect(id, entry: entry) }
        }
    }

    public func pathChanged(fingerprint: String, reachable: Bool) {
        defer { pathFingerprint = fingerprint }
        guard pathFingerprint != fingerprint else { return }
        if pathFingerprint == nil { return }
        for (id, entry) in Array(machines) {
            suspend(entry)
            if entry.members.isEmpty { machines.removeValue(forKey: id) }
            else if reachable && !foregroundScenes.isEmpty { connect(id, entry: entry) }
        }
    }

    public func hold(machineID: String, open: @escaping Opener, events: LinkEvents) -> MachineLease {
        let memberID = UUID()
        let entry = machines[machineID] ?? Entry(open: open)
        machines[machineID] = entry
        entry.idleCleanup?()
        entry.idleCleanup = nil
        entry.members[memberID] = events
        if entry.connected {
            events.opened()
            events.route(entry.relayed)
        } else if entry.link == nil && entry.retry == nil && !foregroundScenes.isEmpty {
            connect(machineID, entry: entry)
        }
        return MachineLease(send: { [weak entry] text in
            guard let entry, entry.connected, let link = entry.link else {
                throw TransportFailure.invalid("The machine is reconnecting.")
            }
            try link.send(text)
        }, release: { [weak self, weak entry] in
            guard let self, let entry else { return }
            entry.members.removeValue(forKey: memberID)
            if entry.members.isEmpty {
                entry.retry?()
                entry.retry = nil
                if self.foregroundScenes.isEmpty {
                    self.suspend(entry)
                    self.machines.removeValue(forKey: machineID)
                } else {
                    entry.idleCleanup = self.scheduler.after(milliseconds: 30_000) { [weak self, weak entry] in
                        guard let self, let entry, self.machines[machineID] === entry, entry.members.isEmpty else { return }
                        self.suspend(entry)
                        self.machines.removeValue(forKey: machineID)
                    }
                }
            }
        })
    }

    public func reconnect(machineID: String) {
        guard let entry = machines[machineID] else { return }
        suspend(entry)
        if entry.members.isEmpty { machines.removeValue(forKey: machineID) }
        else if !foregroundScenes.isEmpty { connect(machineID, entry: entry) }
    }

    public func shutdown() {
        monitor?.cancel()
        monitor = nil
        for entry in machines.values { suspend(entry) }
        machines.removeAll()
    }

    private func suspend(_ entry: Entry) {
        entry.generation += 1
        entry.retry?()
        entry.retry = nil
        entry.idleCleanup?()
        entry.idleCleanup = nil
        let previous = entry.link
        entry.link = nil
        let wasConnected = entry.connected
        entry.connected = false
        entry.relayed = nil
        previous?.close()
        if wasConnected {
            for member in Array(entry.members.values) { member.closed(nil) }
        }
    }

    private func connect(_ id: String, entry: Entry) {
        entry.generation += 1
        let generation = entry.generation
        let valid = { [weak self, weak entry] () -> Bool in
            guard let self, let entry else { return false }
            return self.machines[id] === entry && entry.generation == generation
        }
        let events = LinkEvents(opened: { [weak entry] in
            guard valid(), let entry else { return }
            entry.connected = true
            entry.attempt = 0
            for member in Array(entry.members.values) { member.opened() }
        }, message: { [weak entry] text in
            guard valid(), let entry else { return }
            for member in Array(entry.members.values) { member.message(text) }
        }, closed: { [weak self, weak entry] error in
            guard valid(), let self, let entry else { return }
            entry.generation += 1
            entry.link = nil
            entry.connected = false
            entry.relayed = nil
            for member in Array(entry.members.values) { member.closed(error) }
            guard !self.foregroundScenes.isEmpty, !entry.members.isEmpty else { return }
            let delay = min(10_000, 500 * pow(2, Double(min(entry.attempt, 5))))
            entry.attempt += 1
            entry.retry = self.scheduler.after(milliseconds: delay) { [weak self, weak entry] in
                guard let self, let entry, self.machines[id] === entry else { return }
                entry.retry = nil
                self.connect(id, entry: entry)
            }
        }, route: { [weak entry] route in
            guard valid(), let entry else { return }
            entry.relayed = route
            for member in Array(entry.members.values) { member.route(route) }
        })
        do {
            let opened = try entry.open(events)
            if valid() { entry.link = opened }
            else { opened.close() }
        } catch { events.closed(error) }
    }
}
