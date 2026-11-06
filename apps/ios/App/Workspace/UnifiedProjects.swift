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

    /// The project on its machine's shared session, ready to open.
    @MainActor func workspace(_ runtime: AppRuntime) -> MobileWorkspace {
        MobileWorkspace(session: runtime.session(for: machine), projectID: id.projectID, summary: summary)
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

    var open: [UnifiedProjectRow] { ordered(projectRows.filter { !$0.recent }, by: "lastOpenedAt") }
    var recent: [UnifiedProjectRow] { ordered(projectRows.filter(\.recent), by: "closedAt") }
    /// The Chats project of every machine that has one, by machine name; it has a place of its own and never stands
    /// among the projects.
    var chats: [UnifiedProjectRow] {
        rows.filter { NewChat.isChats($0.summary) }.sorted {
            $0.machine.name == $1.machine.name ? $0.machine.id < $1.machine.id : $0.machine.name < $1.machine.name
        }
    }
    private var projectRows: [UnifiedProjectRow] { rows.filter { !NewChat.isChats($0.summary) } }
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
            forgetCache(id)
        }
        for machine in known.values {
            if let previous = entries[machine.id], previous.machine.publicKey != machine.publicKey {
                previous.dispose()
                entries.removeValue(forKey: machine.id)
                forgetCache(machine.id)
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
            // A machine that takes `project.watch` also says when a project nobody holds changed on disk.
            let live = LiveResource(
                client: connection.client,
                events: [
                    .apply(
                        .projectSummary,
                        raw: { [weak self, weak entry] event in
                            guard let self, let entry, entry.binding == binding, current(entry), entry.connected
                            else { return }
                            if let valid = try? WireEvent.projectSummary.validatePayload(event)["summary"] {
                                entry.summaries.removeAll { $0.text("projectId") == valid.text("projectId") }
                                entry.summaries.append(valid)
                                if entry.task != nil { entry.changedSummaries[valid.text("projectId")] = valid }
                                writeCache(entry)
                                return
                            }
                            _ = beginLoad(entry)
                        }),
                    .reread(.projectListChanged),
                ],
                watch: .area(.projectWatch, gated: true),
                connection: { [weak self, weak entry] connected in
                    guard let self, let entry, entry.binding == binding, current(entry) else { return }
                    entry.operation += 1
                    entry.task?.cancel()
                    entry.task = nil
                    entry.loading = false
                    entry.connected = connected
                },
                read: { [weak self, weak entry] in
                    guard let self, let entry, entry.binding == binding, current(entry), entry.connected else { return }
                    await beginLoad(entry).value
                })
            entry.live = live
            live.start()
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
            // A project whose folder its machine no longer finds cannot be opened, so it is left out, as on the desktop.
            return entry.summaries.filter { $0["available"] != .bool(false) }.map {
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
        if let task = entry.task { return task }
        entry.changedSummaries.removeAll()
        entry.operation += 1
        let operation = entry.operation
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
                let response = try await connection.client.request(.projectList)
                guard !Task.isCancelled, entry.operation == operation, current(entry), entry.connected else { return }
                let validated = try WireRequest.projectList.validateResult(response)
                // Events received during this request are newer than its snapshot.
                entry.summaries = unique(
                    validated.list("projects").map {
                        entry.changedSummaries[$0.text("projectId")] ?? $0
                    } + Array(entry.changedSummaries.values))
                entry.changedSummaries.removeAll()
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

    private func forgetCache(_ id: String) {
        defaults.removeObject(forKey: cacheKey(id))
        defaults.removeObject(forKey: cacheKey(id) + ".publicKey")
    }

    private func readCache(_ machine: Machine) -> [JSONValue] {
        let key = cacheKey(machine.id)
        if let publicKey = defaults.string(forKey: key + ".publicKey"), publicKey != machine.publicKey {
            forgetCache(machine.id)
            return []
        }
        guard let data = defaults.data(forKey: key), let value = try? JSONValue.decode(data),
            let array = value.arrayValue
        else {
            return []
        }
        defaults.set(machine.publicKey, forKey: key + ".publicKey")
        CrashRedactions.remember(array.flatMap { [$0.text("name"), $0.text("folder")] })
        return unique(
            array.compactMap { summary in
                try? WireEvent.projectSummary.validatePayload(.object(["summary": summary]))[
                    "summary"]
            })
    }

    private func writeCache(_ entry: UnifiedProjectMachine) {
        CrashRedactions.remember(entry.summaries.flatMap { [$0.text("name"), $0.text("folder")] })
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
    @ObservationIgnored var changedSummaries: [String: JSONValue] = [:]
    @ObservationIgnored var operation = 0
    @ObservationIgnored var task: Task<Void, Never>?
    @ObservationIgnored var live: LiveResource?

    init(machine: Machine, summaries: [JSONValue]) {
        self.machine = machine
        self.summaries = summaries
    }

    func dispose() {
        binding = UUID()
        operation += 1
        task?.cancel()
        task = nil
        live?.stop()
        live = nil
        connection?.release()
        connection = nil
        connected = false
        loading = false
        problem = nil
    }
}
