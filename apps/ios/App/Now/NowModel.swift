import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// The open projects of every machine, read with `project.sidebar` the way the desktop's sidebar watch reads them, so
/// Now and Search know where each session stands. What a session is doing comes from each machine's attention store.
@MainActor @Observable
final class NowModel {
    private(set) var feeds: [String: NowFeed] = [:]
    let answers = NowAnswers()
    @ObservationIgnored private var contextID = ""

    func reconcile(runtime: AppRuntime) {
        let context = "\(runtime.key?.publicKey ?? ""):\(runtime.connectionRevision)"
        let restart = context != contextID
        contextID = context
        let machines = runtime.machines
        for (id, feed) in feeds {
            let current = machines.first { $0.id == id }.map { runtime.session(for: $0) }
            if restart || current !== feed.session {
                feed.stop()
                feeds.removeValue(forKey: id)
            }
        }
        guard runtime.key != nil else { return }
        for machine in machines where feeds[machine.id] == nil {
            let feed = NowFeed(session: runtime.session(for: machine))
            feeds[machine.id] = feed
            feed.start()
        }
    }

    func stop() {
        for feed in feeds.values { feed.stop() }
        feeds.removeAll()
    }

    func refresh() async {
        await withTaskGroup(of: Void.self) { group in
            for feed in feeds.values { group.addTask { await feed.refresh() } }
        }
    }

    var inputs: [NowMachineInput] {
        feeds.values.map { feed in
            let attention = feed.session.attention
            let machineID = feed.session.machine.id
            let requests = attention.waits.mapValues { wait in
                wait.requests.compactMap(NowRequest.init).filter {
                    !answers.answered.contains(NowAnswers.key(machineID: machineID, requestID: $0.requestID))
                }
            }
            return NowMachineInput(
                machineID: machineID, machineName: feed.session.machine.name, projects: feed.projects,
                attention: NowAttention(
                    statuses: attention.statuses, unseen: attention.unseen, requests: requests,
                    providers: attention.waits.mapValues(\.provider),
                    delegating: attention.delegating.union(feed.session.tasks.parentsWithOpenTasks)),
                snoozes: feed.session.snoozes.standing, denyReason: feed.denyReason)
        }
    }

    /// Every request a card could show, keyed as `NowAnswers` keys them.
    var liveRequests: Set<String> {
        Set(
            feeds.values.flatMap { feed in
                feed.session.attention.waits.values.flatMap(\.requests).compactMap { request in
                    request["requestId"]?.stringValue.map {
                        NowAnswers.key(machineID: feed.session.machine.id, requestID: $0)
                    }
                }
            })
    }

    func approve(_ entry: ProjectViewEntry, _ request: NowRequest, decision: ApprovalDecision, message: String? = nil)
        async
    {
        guard let session = feeds[entry.target.machineID]?.session else { return }
        await answers.send(
            .chatApprove,
            payload: request.approvePayload(chatID: entry.target.itemID, decision: decision, message: message),
            key: NowAnswers.key(machineID: entry.target.machineID, requestID: request.requestID), client: session.rpc)
    }

    func answer(_ entry: ProjectViewEntry, _ request: NowRequest, with answers: [String: String]) async {
        guard let session = feeds[entry.target.machineID]?.session else { return }
        await self.answers.send(
            .chatAnswer, payload: request.answerPayload(chatID: entry.target.itemID, answers: answers),
            key: NowAnswers.key(machineID: entry.target.machineID, requestID: request.requestID), client: session.rpc)
    }

    func snoozes(for machineID: String) -> MachineSnoozes? { feeds[machineID]?.session.snoozes }

    func connected(_ machineID: String) -> Bool { feeds[machineID]?.session.connected == true }

    var board: NowBoard { NowBoard.build(inputs) }

    /// What each open project holds and how much of it waits on a person, from the same answers Now reads.
    var activity: [UnifiedProjectRow.ID: ProjectActivity] {
        var result: [UnifiedProjectRow.ID: ProjectActivity] = [:]
        for input in inputs {
            let snoozed = Set(input.snoozes.keys)
            for project in input.projects {
                guard let summary = project["summary"], let views = project["views"]?.arrayValue else { continue }
                result[UnifiedProjectRow.ID(machineID: input.machineID, projectID: summary.text("projectId"))] =
                    ProjectOverview.activity(views: views, attention: input.attention, snoozed: snoozed)
            }
        }
        return result
    }

    /// The task another agent opened a node with, if any.
    func task(for target: ProjectViewTarget) -> JSONValue? {
        feeds[target.machineID]?.session.tasks.childTask(target.itemID)
    }
    var entries: [ProjectViewEntry] { NowBoard.entries(inputs) }
    /// Whether any machine answered yet, which tells an empty Now from one still connecting.
    var loaded: Bool { feeds.values.contains(where: \.loaded) }

    /// Where a node stands, reading the machine again when the last answer does not hold it yet: a notification can
    /// arrive before Now ever asked, or name a chat made a moment ago.
    func locate(machineID: String, itemID: String) async -> ProjectViewTarget? {
        guard let feed = feeds[machineID] else { return nil }
        if let target = NowBoard.locate(itemID, machineID: machineID, in: feed.projects) { return target }
        try? await feed.session.waitForConnection()
        await feed.refresh()
        return NowBoard.locate(itemID, machineID: machineID, in: feed.projects)
    }

    func preview(of target: ProjectViewTarget) -> ProjectViewPreview? {
        NowBoard.preview(target, in: feeds[target.machineID]?.projects ?? [])
    }
}

@MainActor @Observable
final class NowFeed {
    let session: SharedMachineSession
    private(set) var projects: [JSONValue] = []
    private(set) var loaded = false
    private(set) var problem: String?
    /// The CLIs on this machine whose denial carries a message, from `provider.list`.
    private(set) var denyReason: Set<String> = []
    @ObservationIgnored private var providersGeneration: Int?
    @ObservationIgnored private var stops: [() -> Void] = []
    @ObservationIgnored private var pending: Task<Void, Never>?
    @ObservationIgnored private var loading: Task<Void, Never>?
    @ObservationIgnored private var watched = Set<String>()

    init(session: SharedMachineSession) { self.session = session }

    func start() {
        guard stops.isEmpty else { return }
        session.retain()
        let client = session.rpc
        stops = ["project.changed", "project.summary", "session.list-changed"].map { event in
            client.subscribe(event) { [weak self] _ in self?.schedule() }
        }
        stops.append(
            client.observeConnection { [weak self] connected in
                guard let self else { return }
                if connected {
                    schedule()
                } else {
                    pending?.cancel()
                    pending = nil
                }
            })
        if session.connected { schedule() }
    }

    func stop() {
        guard !stops.isEmpty else { return }
        stops.forEach { $0() }
        stops.removeAll()
        pending?.cancel()
        pending = nil
        loading?.cancel()
        for id in watched { session.tasks.unwatch(id) }
        watched.removeAll()
        session.release()
    }

    func refresh() async {
        if let loading {
            await loading.value
            return
        }
        let task = Task { await load() }
        loading = task
        await task.value
        loading = nil
    }

    /// Folds a burst of events into one read, as the desktop's sidebar watch does.
    private func schedule() {
        guard pending == nil else { return }
        pending = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            guard let self, !Task.isCancelled else { return }
            pending = nil
            await refresh()
        }
    }

    private func load() async {
        guard session.connected else { return }
        let generation = session.generation
        do {
            let result = try await session.rpc.request("project.sidebar", payload: .object([:]))
            guard !Task.isCancelled, generation == session.generation, !stops.isEmpty else { return }
            projects = result.list("projects")
            loaded = true
            problem = nil
            watchTasks()
            await loadProviders(generation: generation)
        } catch {
            guard !Task.isCancelled, generation == session.generation else { return }
            problem = error.localizedDescription
        }
    }

    private func loadProviders(generation: Int) async {
        guard providersGeneration != generation, let providers = try? await AgentCatalog.load(session.rpc),
            generation == session.generation
        else { return }
        providersGeneration = generation
        denyReason = Set(
            providers.filter { $0["capabilities"]?["denyReason"]?.boolValue == true }.map { $0.text("kind") })
    }

    /// Asks for the tasks of every open project, so a row of a node another agent opened wears its task mark.
    private func watchTasks() {
        let open = Set(projects.compactMap { $0["summary"]?.text("projectId") }.filter { !$0.isEmpty })
        for id in open.subtracting(watched) { session.tasks.watch(id) }
        for id in watched.subtracting(open) { session.tasks.unwatch(id) }
        watched = open
    }
}
