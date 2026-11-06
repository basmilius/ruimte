import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// One process as a sample lists it. With the pid, the start time names one process, since a pid is reused.
extension ProcessRow: Identifiable {
    public var id: String { "\(pid):\(startTime)" }

    /// A process of another user has no start time here, and without one nothing can prove it is still the same one.
    var signalable: Bool { readable && startTime != 0 }
}

/// A terminal or chat node, the desktop app, the daemon with its own tasks, or everything else, with its processes.
extension ProcessGroup: Identifiable {
    /// The root of a node's group can be signaled as the desktop offers it; the app, the daemon and the rest cannot.
    var signalableRoot: ProcessRow? {
        guard kind == .terminal || kind == .chat, let root = processes.first, root.signalable else { return nil }
        return root
    }
}

extension ProcessAlert: Identifiable {}

/// The groups of one project, or of none.
struct ProcessSection: Equatable, Identifiable {
    /// The project's id; empty for the groups of no project.
    let id: String
    let title: String
    var groups: [ProcessGroup]
}

/// One process as a row of the iPad's table, with the node or task it belongs to and where that stands. Unreadable
/// numbers sort below every reading.
struct ProcessTableRow: Equatable, Identifiable {
    let process: ProcessRow
    /// The node, launch or task the process runs under.
    let owner: String
    /// The project of that owner, or Machine tasks.
    let place: String
    let kind: ProcessGroupKind

    var id: String { process.id }
    var name: String { process.name }
    var pid: Int { Int(process.pid) }
    var cpu: Double { process.cpu ?? -1 }
    var memory: Double { process.memory ?? -1 }
    var disk: Double { (process.diskRead ?? 0) + (process.diskWrite ?? 0) }

    /// Every process of every group, each named after its group and that group's project, in the sample's order.
    static func rows(_ groups: [ProcessGroup], titles: [String: String], projectNames: [String: String])
        -> [ProcessTableRow]
    {
        ProcessesText.sections(groups, projectNames: projectNames).flatMap { section in
            section.groups.flatMap { group in
                let owner = ProcessesText.groupTitle(group, titles: titles).title
                return group.processes.map {
                    ProcessTableRow(process: $0, owner: owner, place: section.title, kind: group.kind)
                }
            }
        }
    }
}

/// The process a signal goes to, by the pid and start time the row showed.
struct ProcessTarget: Equatable, Identifiable {
    var pid: Int
    var startTime: Double
    var name: String

    var id: String { "\(pid):\(startTime)" }
}

extension ProcessTarget {
    init(_ row: ProcessRow) {
        self.init(pid: Int(row.pid), startTime: row.startTime, name: row.name)
    }
}

enum ProcessAlertAction: String, Equatable {
    case interrupt, terminate, show, resume

    var label: String {
        switch self {
        case .interrupt: String(localized: "Interrupt", comment: "Button that interrupts a process")
        case .terminate: String(localized: "Terminate", comment: "Button that terminates a process")
        case .show: String(localized: "Show process")
        case .resume: String(localized: "Resume", comment: "Button that resumes an agent")
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
        return Format.percent(value)
    }

    static func bytes(_ value: Double?) -> String {
        guard let value else { return unreadable }
        return mobileByteCount(value)
    }

    static func rate(_ value: Double?) -> String {
        guard let value else { return unreadable }
        return String(localized: "\(mobileByteCount(value))/s", comment: "Data rate, %@ is a byte count, per second")
    }

    /// Read and written together, which is what the disk column and its sort mean.
    static func disk(read: Double?, write: Double?) -> Double? {
        read == nil && write == nil ? nil : (read ?? 0) + (write ?? 0)
    }

    /// The warning in one sentence a person reads without knowing what a hook is.
    @MainActor static func alert(_ alert: ProcessAlert, now: Double) -> String {
        let name = alert.name ?? String(localized: "A process")
        let duration = Format.elapsedShort(milliseconds: now - alert.since)
        switch alert.kind {
        case .silent:
            return String(localized: "Working, but silent for \(duration)", comment: "%@ is a duration")
        case .busyAfterTurn:
            return String(localized: "\(name) still uses \(percent(alert.value)) of a core after its turn")
        case .memory:
            return String(
                localized: "\(name) uses \(bytes(alert.value))",
                comment: "%@ is a process name, then an amount of memory")
        case .agentGone:
            let agent = AgentDirectory.shared.name(alert.name ?? String(localized: "The agent"))
            return String(localized: "\(agent) exited but shows as running")
        case .orphan: return String(localized: "\(name) is still running after its terminal closed")
        case .probeHung:
            return String(localized: "\(name), started by Ruimte, has run for \(duration)")
        }
    }

    /// The button that fits the warning. None of them does anything until a person presses it.
    static func actions(_ alert: ProcessAlert) -> [ProcessAlertAction] {
        switch alert.kind {
        case .silent: [.interrupt]
        case .busyAfterTurn: [.show, .terminate]
        case .memory: [.show]
        case .agentGone: [.resume]
        case .orphan, .probeHung: [.terminate]
        }
    }

    static func kindName(_ kind: ProcessGroupKind) -> String {
        switch kind {
        case .terminal: String(localized: "Terminal")
        case .chat: String(localized: "Chat")
        case .app: String(localized: "Ruimte app")
        case .daemon: String(localized: "Machine tasks")
        case .other: String(localized: "Other processes")
        }
    }

    /// The title of a group: the daemon's name for a session no node stands for, else the node's title. `known` is
    /// false for a node of a project this page does not know the nodes of.
    static func groupTitle(_ group: ProcessGroup, titles: [String: String]) -> (title: String, known: Bool) {
        if let label = group.label { return (label, true) }
        if let node = group.nodeId, let title = titles[node] { return (title, true) }
        return (kindName(group.kind), group.nodeId == nil)
    }

    /// Where a warning is drawn: under the group of its node, under the group that holds its process, or above the list.
    static func placement(_ alert: ProcessAlert, groups: [ProcessGroup]) -> String? {
        if let node = alert.nodeId, let group = groups.first(where: { $0.nodeId == node }) { return group.id }
        guard let pid = alert.pid else { return nil }
        return groups.first { group in
            group.processes.contains { $0.pid == pid && $0.startTime == alert.startTime }
        }?.id
    }

    /// The groups per project in the order they come, then whatever belongs to no project under Machine tasks. A
    /// project this phone has no name for reads as Another project.
    static func sections(_ groups: [ProcessGroup], projectNames: [String: String]) -> [ProcessSection] {
        var sections: [ProcessSection] = []
        for group in groups {
            let id = group.projectId ?? ""
            if let index = sections.firstIndex(where: { $0.id == id }) {
                sections[index].groups.append(group)
            } else {
                let title =
                    group.projectId.map { projectNames[$0] ?? String(localized: "Another project") }
                    ?? String(localized: "Machine tasks")
                sections.append(ProcessSection(id: id, title: title, groups: [group]))
            }
        }
        return sections.filter { !$0.id.isEmpty } + sections.filter { $0.id.isEmpty }
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
            String(localized: "Force quit \(target.name)?"),
            String(
                localized:
                    "Ends process \(target.pid) at once, without saving or cleaning up. Files it was writing may be incomplete."
            )
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
    // The read is also the ask for samples, so the machine's answer to it is applied, not a watch held beside it.
    @ObservationIgnored private lazy var live = LiveResource(
        client: client,
        events: [
            .apply(.processesSample, as: ProcessSample.self) { [weak self] in self?.apply($0) },
            .apply(.processesAlerts, as: ProcessesAlerts.self) { [weak self] in self?.alerts = $0.alerts },
        ],
        connection: { [weak self] available in self?.connected = available },
        read: { [weak self] in await self?.subscribe() })

    init(client: any MachineRequesting, defaults: UserDefaults = .standard) {
        self.client = client
        self.defaults = defaults
        scope = defaults.string(forKey: Self.scopeKey) == "all" ? "all" : "ruimte"
        let stored = defaults.string(forKey: Self.sortKey) ?? ""
        sort = ["memory", "disk"].contains(stored) ? stored : "cpu"
    }

    func start() { live.start() }

    func stop() {
        live.stop()
        let client = client
        Task { _ = try? await client.request(.processesUnsubscribe) }
    }

    func subscribe() async {
        do {
            let result = try await client.request(
                .processesSubscribe, payload: .object(["scope": .string(scope), "sort": .string(sort)])
            ).decoded(as: ProcessesSubscribeResult.self)
            receive(result)
            problem = nil
        } catch is CancellationError {
            return
        } catch {
            problem = error.localizedDescription
            return
        }
        if let list = try? await client.request(.processesListAlerts).decoded(as: ProcessesAlerts.self) {
            alerts = list.alerts
        }
    }

    func receive(_ result: ProcessesSubscribeResult) {
        supported = result.supported
        fineInterval = Double(result.fineIntervalMs)
        coarseInterval = Double(result.coarseIntervalMs)
        fine = result.fine
        coarse = result.coarse
        sample = result.sample
    }

    /// A sample of the scope before the one just asked for still adds its points, but not its rows.
    func apply(_ next: ProcessSample) {
        if next.scope.rawValue == scope { sample = next }
        fine = Self.capped(next.reset ? [] : fine, next.fine, ProcessesText.finePoints)
        coarse = Self.capped(next.reset ? [] : coarse, next.coarse, ProcessesText.coarsePoints)
    }

    private static func capped(_ points: [ProcessPoint], _ point: ProcessPoint?, _ cap: Int) -> [ProcessPoint] {
        guard let point else { return points }
        return Array((points + [point]).suffix(cap))
    }

    /// The `other` group starts open and every node's group closed, as on the desktop.
    func isOpen(_ group: ProcessGroup) -> Bool {
        group.kind == .other ? !opened.contains(group.id) : opened.contains(group.id)
    }

    func toggle(_ group: ProcessGroup) {
        if opened.contains(group.id) { opened.remove(group.id) } else { opened.insert(group.id) }
    }

    /// Every signal goes through the daemon, which checks that the pid still names the process the row showed.
    /// SIGKILL only comes here after the force question.
    func signal(_ target: ProcessTarget, _ signal: ProcessSignal) async {
        do {
            _ = try await client.request(
                .processesSignal,
                payload: .object([
                    "pid": .number(Double(target.pid)), "startTime": .number(target.startTime),
                    "signal": .string(signal.rawValue),
                ]))
            problem = nil
        } catch {
            problem = String(localized: "Could not stop \(target.name): \(error.localizedDescription)")
        }
    }

    func dismiss(_ alert: ProcessAlert) async {
        _ = try? await client.request(.processesDismiss, payload: .object(["id": .string(alert.id)]))
    }

    func act(_ alert: ProcessAlert, _ action: ProcessAlertAction) async {
        let groups = sample?.groups ?? []
        let target = alert.pid.flatMap { pid in
            alert.startTime.map {
                ProcessTarget(pid: Int(pid), startTime: $0, name: alert.name ?? String(localized: "The process"))
            }
        }
        switch action {
        case .show:
            if let place = ProcessesText.placement(alert, groups: groups),
                let group = groups.first(where: { $0.id == place }),
                !isOpen(group)
            {
                toggle(group)
            }
            highlight = target
        case .resume:
            guard let node = alert.nodeId else { return }
            do {
                _ = try await client.request(.agentResume, payload: .object(["sessionId": .string(node)]))
                problem = nil
            } catch {
                problem = String(localized: "Could not resume the agent: \(error.localizedDescription)")
            }
        case .interrupt, .terminate:
            // A chat has a turn to cancel, which is the interrupt its CLI understands.
            if action == .interrupt, let node = alert.nodeId,
                groups.contains(where: { $0.kind == .chat && $0.nodeId == node })
            {
                do {
                    _ = try await client.request(.chatCancel, payload: .object(["chatId": .string(node)]))
                    problem = nil
                } catch {
                    problem = String(localized: "Could not interrupt the turn: \(error.localizedDescription)")
                }
                return
            }
            if let target { await signal(target, action == .interrupt ? .interrupt : .terminate) }
        }
    }
}
