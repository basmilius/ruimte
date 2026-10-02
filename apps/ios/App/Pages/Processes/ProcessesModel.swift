import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// One process as a sample lists it. With the pid, the start time names one process, since a pid is reused.
struct ProcessRow: Equatable, Identifiable {
    var pid: Int
    var startTime: Double
    var name: String
    var readable: Bool
    var cpu: Double?
    var memory: Double?
    var diskRead: Double?
    var diskWrite: Double?
    var family: String?
    var depth: Int

    var id: String { "\(pid):\(startTime)" }

    init(json: JSONValue) {
        pid = Int(json.number("pid"))
        startTime = json.number("startTime")
        name = json.text("name")
        readable = json["readable"]?.boolValue ?? false
        cpu = json["cpu"]?.numberValue
        memory = json["memory"]?.numberValue
        diskRead = json["diskRead"]?.numberValue
        diskWrite = json["diskWrite"]?.numberValue
        family = json["family"]?.stringValue
        depth = Int(json.number("depth"))
    }

    /// A process of another user has no start time here, and without one nothing can prove it is still the same one.
    var signalable: Bool { readable && startTime != 0 }
}

/// A terminal or chat node, the desktop app, the daemon with its own tasks, or everything else, with its processes.
struct ProcessGroup: Equatable, Identifiable {
    var id: String
    var kind: String
    var nodeID: String?
    var label: String?
    var projectID: String?
    var cpu: Double?
    var memory: Double?
    var diskRead: Double?
    var diskWrite: Double?
    var processes: [ProcessRow]
    var hidden: Int

    init(json: JSONValue) {
        id = json.text("id")
        kind = json.text("kind", fallback: "other")
        nodeID = json["nodeId"]?.stringValue
        label = json["label"]?.stringValue
        projectID = json["projectId"]?.stringValue
        cpu = json["cpu"]?.numberValue
        memory = json["memory"]?.numberValue
        diskRead = json["diskRead"]?.numberValue
        diskWrite = json["diskWrite"]?.numberValue
        processes = json.list("processes").map(ProcessRow.init(json:))
        hidden = Int(json.number("hidden"))
    }

    /// The root of a node's group can be signaled as the desktop offers it; the app, the daemon and the rest cannot.
    var signalableRoot: ProcessRow? {
        guard kind == "terminal" || kind == "chat", let root = processes.first, root.signalable else { return nil }
        return root
    }
}

/// One point of the three charts: the machine as a line, the share of Ruimte as the area under it.
struct ProcessPoint: Equatable {
    var at: Double
    var cpu: Double?
    var cpuRuimte: Double?
    var memory: Double?
    var memoryRuimte: Double?
    var disk: Double?
    var diskRuimte: Double?

    init(json: JSONValue) {
        at = json.number("at")
        cpu = json["cpu"]?.numberValue
        cpuRuimte = json["cpuRuimte"]?.numberValue
        memory = json["memory"]?.numberValue
        memoryRuimte = json["memoryRuimte"]?.numberValue
        disk = json["disk"]?.numberValue
        diskRuimte = json["diskRuimte"]?.numberValue
    }
}

struct ProcessMachine: Equatable {
    var cpu: Double?
    var memoryUsed: Double?
    var memoryTotal: Double
    var diskRead: Double?
    var diskWrite: Double?
    var diskFree: Double?

    init(json: JSONValue) {
        cpu = json["cpu"]?.numberValue
        memoryUsed = json["memoryUsed"]?.numberValue
        memoryTotal = json.number("memoryTotal")
        diskRead = json["diskRead"]?.numberValue
        diskWrite = json["diskWrite"]?.numberValue
        diskFree = json["diskFree"]?.numberValue
    }
}

struct ProcessSample: Equatable {
    var at: Double
    var scope: String
    var machine: ProcessMachine
    var groups: [ProcessGroup]
    var fine: ProcessPoint?
    var coarse: ProcessPoint?
    var reset: Bool

    init(json: JSONValue) {
        at = json.number("at")
        scope = json.text("scope")
        machine = ProcessMachine(json: json["machine"] ?? .object([:]))
        groups = json.list("groups").map(ProcessGroup.init(json:))
        fine = json["fine"].flatMap { $0 == .null ? nil : ProcessPoint(json: $0) }
        coarse = json["coarse"].flatMap { $0 == .null ? nil : ProcessPoint(json: $0) }
        reset = json["reset"]?.boolValue ?? false
    }
}

struct ProcessAlert: Equatable, Identifiable {
    var id: String
    var kind: String
    var nodeID: String?
    var pid: Int?
    var startTime: Double?
    var name: String?
    var since: Double
    var value: Double?

    init(json: JSONValue) {
        id = json.text("id")
        kind = json.text("kind")
        nodeID = json["nodeId"]?.stringValue
        pid = json["pid"]?.numberValue.map { Int($0) }
        startTime = json["startTime"]?.numberValue
        name = json["name"]?.stringValue
        since = json.number("since")
        value = json["value"]?.numberValue
    }
}

/// The process a signal goes to, by the pid and start time the row showed.
struct ProcessTarget: Equatable, Identifiable {
    var pid: Int
    var startTime: Double
    var name: String

    var id: String { "\(pid):\(startTime)" }

    init(pid: Int, startTime: Double, name: String) {
        self.pid = pid
        self.startTime = startTime
        self.name = name
    }

    init(_ row: ProcessRow) {
        self.init(pid: row.pid, startTime: row.startTime, name: row.name)
    }
}

enum ProcessAlertAction: String, Equatable {
    case interrupt, terminate, show, resume

    var label: String {
        switch self {
        case .interrupt: "Interrupt"
        case .terminate: "Terminate"
        case .show: "Show process"
        case .resume: "Resume"
        }
    }
}

enum ProcessSignal: String {
    case interrupt = "SIGINT"
    case terminate = "SIGTERM"
    case kill = "SIGKILL"
}

/// The words and numbers of the processes page, as the desktop panel writes them.
enum ProcessesText {
    /// A number that could not be read is shown as nothing rather than as zero, which is what it is not.
    static let unreadable = "-"

    static func percent(_ value: Double?) -> String {
        guard let value else { return unreadable }
        let digits = value < 10 ? 1 : 0
        return value.formatted(.number.precision(.fractionLength(0...digits)).locale(Locale(identifier: "en_US"))) + "%"
    }

    static func bytes(_ value: Double?) -> String {
        guard let value else { return unreadable }
        return mobileByteCount(value)
    }

    static func rate(_ value: Double?) -> String {
        guard let value else { return unreadable }
        return "\(mobileByteCount(value))/s"
    }

    /// Read and written together, which is what the disk column and its sort mean.
    static func disk(read: Double?, write: Double?) -> Double? {
        read == nil && write == nil ? nil : (read ?? 0) + (write ?? 0)
    }

    static func duration(_ milliseconds: Double) -> String {
        let seconds = max(0, Int(milliseconds / 1000))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return seconds % 60 == 0 ? "\(minutes)m" : "\(minutes)m \(seconds % 60)s" }
        return minutes % 60 == 0 ? "\(minutes / 60)h" : "\(minutes / 60)h \(minutes % 60)m"
    }

    static func agentName(_ kind: String) -> String {
        switch kind {
        case "claude": "Claude Code"
        case "codex": "Codex"
        case "gemini": "Gemini"
        case "copilot": "Copilot"
        default: kind.prefix(1).uppercased() + kind.dropFirst()
        }
    }

    /// The warning in one sentence a person reads without knowing what a hook is.
    static func alert(_ alert: ProcessAlert, now: Double) -> String {
        let name = alert.name ?? "A process"
        switch alert.kind {
        case "silent": return "Working, but silent for \(duration(now - alert.since))"
        case "busy-after-turn": return "\(name) still uses \(percent(alert.value)) of a core after its turn ended"
        case "memory": return "\(name) uses \(bytes(alert.value))"
        case "agent-gone": return "\(agentName(alert.name ?? "The agent")) has exited, but still shows as running"
        case "orphan": return "\(name) is still running after its terminal closed"
        case "probe-hung": return "\(name), started by Ruimte, has run for \(duration(now - alert.since))"
        default: return name
        }
    }

    /// The button that fits the warning. None of them does anything until a person presses it.
    static func actions(_ alert: ProcessAlert) -> [ProcessAlertAction] {
        switch alert.kind {
        case "silent": [.interrupt]
        case "busy-after-turn": [.show, .terminate]
        case "memory": [.show]
        case "agent-gone": [.resume]
        case "orphan", "probe-hung": [.terminate]
        default: []
        }
    }

    static func kindName(_ kind: String) -> String {
        switch kind {
        case "terminal": "Terminal"
        case "chat": "Chat"
        case "app": "Ruimte app"
        case "daemon": "Machine tasks"
        default: "Other processes"
        }
    }

    /// The title of a group: the daemon's name for a session no node stands for, else the node's title. `known` is
    /// false for a node of a project this page does not know the nodes of.
    static func groupTitle(_ group: ProcessGroup, titles: [String: String]) -> (title: String, known: Bool) {
        if let label = group.label { return (label, true) }
        if let node = group.nodeID, let title = titles[node] { return (title, true) }
        return (kindName(group.kind), group.nodeID == nil)
    }

    /// Where a warning is drawn: under the group of its node, under the group that holds its process, or above the list.
    static func placement(_ alert: ProcessAlert, groups: [ProcessGroup]) -> String? {
        if let node = alert.nodeID, let group = groups.first(where: { $0.nodeID == node }) { return group.id }
        guard let pid = alert.pid else { return nil }
        return groups.first { group in
            group.processes.contains { $0.pid == pid && $0.startTime == alert.startTime }
        }?.id
    }

    /// The fine series once it has a line to draw, the coarse day until then. The window is what the x axis spans,
    /// so a fine series that only just started fills from the right.
    static func series(fine: [ProcessPoint], coarse: [ProcessPoint], fineInterval: Double, coarseInterval: Double)
        -> (points: [ProcessPoint], window: Double, fine: Bool)
    {
        fine.count >= 2
            ? (fine, Double(finePoints) * fineInterval, true) : (coarse, Double(coarsePoints) * coarseInterval, false)
    }

    /// How many points a subscriber holds, agreed with the daemon: ten minutes at two seconds, a day at five minutes.
    static let finePoints = 300
    static let coarsePoints = 288

    static func forceQuestion(_ target: ProcessTarget) -> (title: String, detail: String) {
        (
            "Force quit \(target.name)?",
            "SIGKILL ends process \(target.pid) immediately. It cannot save or clean up, so files it was writing may be left incomplete."
        )
    }
}

/// What one machine says about its processes while the page is open. The subscription is per connection on the
/// daemon, so a connection that comes back asks again, and a change of scope or sort is a fresh ask.
@MainActor @Observable final class ProcessesModel {
    static let scopeKey = "ruimte.ios.processes.scope"
    static let sortKey = "ruimte.ios.processes.sort"

    let client: any MachineRequesting
    private let defaults: UserDefaults
    var scope: String {
        didSet {
            guard scope != oldValue else { return }
            defaults.set(scope, forKey: Self.scopeKey)
            Task { await subscribe() }
        }
    }
    var sort: String {
        didSet {
            guard sort != oldValue else { return }
            defaults.set(sort, forKey: Self.sortKey)
            Task { await subscribe() }
        }
    }
    /// Nil until the machine answered; false on a platform without a sampler.
    private(set) var supported: Bool?
    private(set) var unsupportedMachine = false
    private(set) var fine: [ProcessPoint] = []
    private(set) var coarse: [ProcessPoint] = []
    private(set) var sample: ProcessSample?
    private(set) var alerts: [ProcessAlert] = []
    private(set) var connected = false
    private(set) var fineInterval: Double = 2000
    private(set) var coarseInterval: Double = 300_000
    var problem: String?
    var opened: Set<String> = []
    var highlight: ProcessTarget?
    private var subscriptions: [() -> Void] = []

    init(client: any MachineRequesting, defaults: UserDefaults = .standard) {
        self.client = client
        self.defaults = defaults
        scope = defaults.string(forKey: Self.scopeKey) == "all" ? "all" : "ruimte"
        let stored = defaults.string(forKey: Self.sortKey) ?? ""
        sort = ["memory", "disk"].contains(stored) ? stored : "cpu"
    }

    func start() {
        guard subscriptions.isEmpty else { return }
        subscriptions.append(
            client.subscribe("processes.sample") { [weak self] payload in self?.apply(ProcessSample(json: payload)) })
        subscriptions.append(
            client.subscribe("processes.alerts") { [weak self] payload in
                self?.alerts = payload.list("alerts").map(ProcessAlert.init(json:))
            })
        subscriptions.append(
            client.observeConnection { [weak self] available in
                guard let self else { return }
                connected = available
                if available { Task { await self.subscribe() } }
            })
    }

    func stop() {
        subscriptions.forEach { $0() }
        subscriptions.removeAll()
        let client = client
        Task { _ = try? await client.request(WireRequest.processesUnsubscribe.rawValue, payload: .object([:])) }
    }

    func subscribe() async {
        do {
            let result = try await client.request(
                WireRequest.processesSubscribe.rawValue,
                payload: .object(["scope": .string(scope), "sort": .string(sort)]))
            receive(result)
            problem = nil
        } catch is CancellationError {
            return
        } catch {
            if case MachineClientError.server(code: "unknown-request", message: _) = error {
                unsupportedMachine = true
            } else {
                problem = error.localizedDescription
            }
            return
        }
        // A machine from before the warnings simply has none.
        if let result = try? await client.request(WireRequest.processesListAlerts.rawValue, payload: .object([:])) {
            alerts = result.list("alerts").map(ProcessAlert.init(json:))
        }
    }

    func receive(_ result: JSONValue) {
        supported = result["supported"]?.boolValue ?? false
        fineInterval = result.number("fineIntervalMs", fallback: 2000)
        coarseInterval = result.number("coarseIntervalMs", fallback: 300_000)
        fine = result.list("fine").map(ProcessPoint.init(json:))
        coarse = result.list("coarse").map(ProcessPoint.init(json:))
        sample = result["sample"].flatMap { $0 == .null ? nil : ProcessSample(json: $0) }
    }

    /// A sample of the scope before the one just asked for still adds its points, but not its rows.
    func apply(_ next: ProcessSample) {
        if next.scope == scope { sample = next }
        fine = Self.capped(next.reset ? [] : fine, next.fine, ProcessesText.finePoints)
        coarse = Self.capped(next.reset ? [] : coarse, next.coarse, ProcessesText.coarsePoints)
    }

    private static func capped(_ points: [ProcessPoint], _ point: ProcessPoint?, _ cap: Int) -> [ProcessPoint] {
        guard let point else { return points }
        return Array((points + [point]).suffix(cap))
    }

    /// The `other` group starts open and every node's group closed, as on the desktop.
    func isOpen(_ group: ProcessGroup) -> Bool { group.kind == "other" ? !opened.contains(group.id) : opened.contains(group.id) }

    func toggle(_ group: ProcessGroup) {
        if opened.contains(group.id) { opened.remove(group.id) } else { opened.insert(group.id) }
    }

    /// Every signal goes through the daemon, which checks that the pid still names the process the row showed.
    /// SIGKILL only comes here after the force question.
    func signal(_ target: ProcessTarget, _ signal: ProcessSignal) async {
        do {
            _ = try await client.request(
                WireRequest.processesSignal.rawValue,
                payload: .object([
                    "pid": .number(Double(target.pid)), "startTime": .number(target.startTime),
                    "signal": .string(signal.rawValue),
                ]))
            problem = nil
        } catch {
            problem = "Could not signal \(target.name): \(error.localizedDescription)"
        }
    }

    func dismiss(_ alert: ProcessAlert) async {
        _ = try? await client.request(WireRequest.processesDismiss.rawValue, payload: .object(["id": .string(alert.id)]))
    }

    func act(_ alert: ProcessAlert, _ action: ProcessAlertAction) async {
        let groups = sample?.groups ?? []
        let target = alert.pid.flatMap { pid in
            alert.startTime.map { ProcessTarget(pid: pid, startTime: $0, name: alert.name ?? "The process") }
        }
        switch action {
        case .show:
            if let place = ProcessesText.placement(alert, groups: groups), let group = groups.first(where: { $0.id == place }),
                !isOpen(group)
            {
                toggle(group)
            }
            highlight = target
        case .resume:
            guard let node = alert.nodeID else { return }
            do {
                _ = try await client.request(WireRequest.agentResume.rawValue, payload: .object(["sessionId": .string(node)]))
                problem = nil
            } catch {
                problem = "Could not resume the agent: \(error.localizedDescription)"
            }
        case .interrupt, .terminate:
            // A chat has a turn to cancel, which is the interrupt its CLI understands.
            if action == .interrupt, let node = alert.nodeID,
                groups.contains(where: { $0.kind == "chat" && $0.nodeID == node })
            {
                do {
                    _ = try await client.request(WireRequest.chatCancel.rawValue, payload: .object(["chatId": .string(node)]))
                    problem = nil
                } catch {
                    problem = "Could not interrupt the turn: \(error.localizedDescription)"
                }
                return
            }
            if let target { await signal(target, action == .interrupt ? .interrupt : .terminate) }
        }
    }
}
