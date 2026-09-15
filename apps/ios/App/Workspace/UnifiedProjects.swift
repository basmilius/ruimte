import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

struct UnifiedProjectRow: Identifiable {
    struct ID: Hashable {
        let machineID: String
        let projectID: String
    }
    let machine: Machine
    let summary: JSONValue
    let connected: Bool
    var id: ID { ID(machineID: machine.id, projectID: summary.text("projectId")) }
    var recent: Bool { summary["closedAt"] != nil && summary["closedAt"] != .null }

    func matches(_ search: String) -> Bool {
        search.isEmpty || summary.text("name").localizedCaseInsensitiveContains(search)
            || machine.name.localizedCaseInsensitiveContains(search)
    }
}

@MainActor
struct UnifiedProjectConnection {
    let client: any MachineRequesting
    let retain: () -> Void
    let release: () -> Void
    let isCurrent: () -> Bool
}

@MainActor @Observable
final class UnifiedProjects {
    private var entries: [String: UnifiedProjectMachine] = [:]
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var contextID = ""

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    var open: [UnifiedProjectRow] { ordered(rows.filter { !$0.recent }, by: "lastOpenedAt") }
    var recent: [UnifiedProjectRow] { ordered(rows.filter(\.recent), by: "closedAt") }
    var unavailable: [UnifiedProjectRow] { rows.filter { $0.summary["available"] == .bool(false) } }
    var loading: Bool { entries.values.contains { $0.loading } }
    var hasConnectedMachine: Bool { entries.values.contains { $0.connected } }
    var problems: [String: String] {
        Dictionary(
            uniqueKeysWithValues: entries.values.compactMap { entry in
                entry.problem.map { (entry.machine.id, $0) }
            })
    }
    var machinesWithoutProjects: [Machine] {
        entries.values.filter { $0.summaries.isEmpty }.map(\.machine).sorted { $0.name < $1.name }
    }

    func start(runtime: AppRuntime) { reconcile(runtime: runtime) }

    func reconcile(runtime: AppRuntime) {
        let deviceKey = runtime.key?.publicKey
        let connectionRevision = runtime.connectionRevision
        let context = "\(deviceKey ?? ""):\(connectionRevision)"
        reconcile(
            machines: runtime.machines, contextID: context,
            connect: deviceKey == nil
                ? nil
                : { [runtime] machine in
                    let session = runtime.session(for: machine)
                    return UnifiedProjectConnection(
                        client: session.rpc, retain: { session.retain() },
                        release: { session.release() },
                        isCurrent: { [weak runtime] in
                            guard let runtime, runtime.key?.publicKey == deviceKey,
                                runtime.connectionRevision == connectionRevision
                            else { return false }
                            return runtime.machines.contains {
                                $0.id == machine.id && $0.publicKey == machine.publicKey
                                    && $0.brokerUrl == machine.brokerUrl
                            }
                        })
                })
    }

    func reconcile(
        machines: [Machine], contextID: String = "test",
        connect: ((Machine) -> UnifiedProjectConnection)?
    ) {
        let known = Dictionary(
            machines.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
        for id in Array(entries.keys) where known[id] == nil {
            entries.removeValue(forKey: id)?.dispose()
            defaults.removeObject(forKey: cacheKey(id))
            defaults.removeObject(forKey: cacheKey(id) + ".publicKey")
        }
        for machine in known.values {
            if let previous = entries[machine.id], previous.machine.publicKey != machine.publicKey {
                previous.dispose()
                entries.removeValue(forKey: machine.id)
                defaults.removeObject(forKey: cacheKey(machine.id))
                defaults.removeObject(forKey: cacheKey(machine.id) + ".publicKey")
            }
            let entry =
                entries[machine.id]
                ?? UnifiedProjectMachine(machine: machine, summaries: readCache(machine))
            if entry.machine.brokerUrl != machine.brokerUrl || self.contextID != contextID {
                entry.dispose()
            }
            entry.machine = machine
            entries[machine.id] = entry
            guard entry.connection == nil, let connect else { continue }
            let connection = connect(machine)
            entry.connection = connection
            let binding = entry.binding
            entry.unsubscribe = connection.client.subscribe("project.summary") {
                [weak self, weak entry] event in
                guard let self, let entry, entry.binding == binding, current(entry), entry.connected
                else { return }
                if let valid = try? WireEvent.projectSummary.validatePayload(event)["summary"] {
                    entry.summaries.removeAll { $0.text("projectId") == valid.text("projectId") }
                    entry.summaries.append(valid)
                    writeCache(entry)
                }
                _ = beginLoad(entry)
            }
            entry.unobserve = connection.client.observeConnection {
                [weak self, weak entry] connected in
                guard let self, let entry, entry.binding == binding, current(entry) else { return }
                entry.operation += 1
                entry.task?.cancel()
                entry.task = nil
                entry.loading = false
                entry.connected = connected
                if connected { _ = beginLoad(entry) }
            }
            connection.retain()
        }
        self.contextID = contextID
    }

    func stop() {
        for entry in entries.values { entry.dispose() }
    }

    func refresh() async {
        let tasks = entries.values.filter { $0.connected && current($0) }.map { beginLoad($0) }
        for task in tasks { await task.value }
    }

    private var rows: [UnifiedProjectRow] {
        entries.values.flatMap { entry -> [UnifiedProjectRow] in
            guard entry.connection?.isCurrent() != false else { return [] }
            return entry.summaries.map {
                UnifiedProjectRow(machine: entry.machine, summary: $0, connected: entry.connected)
            }
        }
    }

    private func ordered(_ rows: [UnifiedProjectRow], by key: String) -> [UnifiedProjectRow] {
        rows.sorted {
            if $0.summary.number(key) != $1.summary.number(key) {
                return $0.summary.number(key) > $1.summary.number(key)
            }
            if $0.machine.id != $1.machine.id { return $0.machine.id < $1.machine.id }
            return $0.id.projectID < $1.id.projectID
        }
    }

    private func current(_ entry: UnifiedProjectMachine) -> Bool {
        entries[entry.machine.id] === entry && entry.connection?.isCurrent() == true
    }

    private func beginLoad(_ entry: UnifiedProjectMachine) -> Task<Void, Never> {
        entry.operation += 1
        let operation = entry.operation
        entry.task?.cancel()
        entry.loading = true
        let task = Task { [weak self, weak entry] in
            guard let self, let entry else { return }
            defer {
                if entry.operation == operation {
                    entry.loading = false
                    entry.task = nil
                }
            }
            guard !Task.isCancelled, entry.operation == operation, current(entry), entry.connected,
                let connection = entry.connection
            else { return }
            do {
                let response = try await connection.client.request(
                    "project.list", payload: .object([:]))
                guard !Task.isCancelled, entry.operation == operation, current(entry),
                    entry.connected
                else { return }
                let validated = try WireRequest.projectList.validateResult(response)
                // A project id is local to one daemon; duplicate rows never replace another machine's project.
                entry.summaries = unique(validated.list("projects"))
                entry.problem = nil
                writeCache(entry)
            } catch {
                if !Task.isCancelled, entry.operation == operation, current(entry), entry.connected {
                    entry.problem = error.localizedDescription
                }
            }
        }
        entry.task = task
        return task
    }

    private func unique(_ summaries: [JSONValue]) -> [JSONValue] {
        Array(
            Dictionary(
                summaries.map { ($0.text("projectId"), $0) },
                uniquingKeysWith: { _, latest in latest }
            ).values)
    }

    private func cacheKey(_ id: String) -> String { "ruimte.ios.projects.\(id)" }

    private func readCache(_ machine: Machine) -> [JSONValue] {
        let key = cacheKey(machine.id)
        if let publicKey = defaults.string(forKey: key + ".publicKey"),
            publicKey != machine.publicKey
        {
            defaults.removeObject(forKey: key)
            defaults.removeObject(forKey: key + ".publicKey")
            return []
        }
        guard let data = defaults.data(forKey: key), let value = try? JSONValue.decode(data),
            let array = value.arrayValue
        else {
            return []
        }
        defaults.set(machine.publicKey, forKey: key + ".publicKey")
        return unique(
            array.compactMap { summary in
                try? WireEvent.projectSummary.validatePayload(.object(["summary": summary]))[
                    "summary"]
            })
    }

    private func writeCache(_ entry: UnifiedProjectMachine) {
        let kept = entry.summaries.sorted { $0.number("lastOpenedAt") > $1.number("lastOpenedAt") }
            .prefix(50)
        if let data = try? JSONValue.array(Array(kept)).encoded() {
            defaults.set(data, forKey: cacheKey(entry.machine.id))
            defaults.set(entry.machine.publicKey, forKey: cacheKey(entry.machine.id) + ".publicKey")
        }
    }

    isolated deinit {
        for entry in entries.values { entry.dispose() }
    }
}

@MainActor @Observable
private final class UnifiedProjectMachine {
    var machine: Machine
    var summaries: [JSONValue]
    var connected = false
    var loading = false
    var problem: String?
    @ObservationIgnored var connection: UnifiedProjectConnection?
    @ObservationIgnored var binding = UUID()
    @ObservationIgnored var operation = 0
    @ObservationIgnored var task: Task<Void, Never>?
    @ObservationIgnored var unsubscribe: (() -> Void)?
    @ObservationIgnored var unobserve: (() -> Void)?

    init(machine: Machine, summaries: [JSONValue]) {
        self.machine = machine
        self.summaries = summaries
    }

    func dispose() {
        binding = UUID()
        operation += 1
        task?.cancel()
        task = nil
        unsubscribe?()
        unobserve?()
        unsubscribe = nil
        unobserve = nil
        connection?.release()
        connection = nil
        connected = false
        loading = false
        problem = nil
    }
}
