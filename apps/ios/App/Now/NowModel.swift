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
        runtime.reconcile(&feeds, context: &contextID)
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

    /// Reads again only the machines that cannot say when a project changed, which is what a clock is for.
    func refreshUnwatched() async {
        await withTaskGroup(of: Void.self) { group in
            for feed in feeds.values where !feed.watching { group.addTask { await feed.refresh() } }
        }
    }

    var inputs: [NowMachineInput] {
        feeds.values.map { feed in
            let attention = feed.session.attention
            let machineID = feed.session.machine.id
            let requests = attention.waits.mapValues { unanswered($0.requests, machineID: machineID) }
            return NowMachineInput(
                machineID: machineID, machineName: feed.session.machine.name, projects: feed.projects,
                attention: NowAttention(
                    statuses: attention.statuses, unseen: attention.unseen, requests: requests,
                    providers: attention.waits.mapValues(\.provider),
                    delegating: attention.delegating.union(feed.session.tasks.parentsWithOpenTasks),
                    activity: attention.activity, finishedAt: attention.finishedAt),
                snoozes: feed.session.snoozes.standing, denyReason: feed.denyReason)
        }
    }

    /// Every request a card could show, keyed as `NowAnswers` keys them.
    var liveRequests: Set<String> {
        Set(
            feeds.values.flatMap { feed in
                feed.session.attention.waits.values.flatMap(\.requests).map {
                    NowAnswers.key(machineID: feed.session.machine.id, requestID: $0.requestId)
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

    /// A routine run that waits on a person as an entry a card answers, from what its machine's attention store holds
    /// of the run's chat. The chat is on no canvas, so the entry names the routine's project and the chat alone.
    func entry(for wait: ScheduledWait) -> ProjectViewEntry? {
        guard let chatID = wait.run.chatId else { return nil }
        let machineID = wait.item.machineID
        let chat = feeds[machineID]?.session.attention.waits[chatID]
        let requests = unanswered(chat?.requests ?? [], machineID: machineID)
        return ProjectViewEntry(
            target: ProjectViewTarget(
                machineID: machineID, projectID: wait.item.entry.projectId, viewID: chatID, itemID: chatID),
            machineName: wait.item.machineName, projectName: wait.item.entry.projectName,
            title: wait.item.entry.title, kind: "chat", iconName: "workflow", status: .needsYou, requests: requests,
            repliesWithMessage: chat.map { feeds[machineID]?.denyReason.contains($0.provider) == true } ?? false)
    }

    /// A request answered from this device leaves its card before the machine says it settled.
    private func unanswered(_ requests: [ChatInfoRequestsItem], machineID: String) -> [NowRequest] {
        requests.compactMap(NowRequest.init).filter {
            !answers.answered.contains(NowAnswers.key(machineID: machineID, requestID: $0.requestID))
        }
    }

    func snoozes(for machineID: String) -> MachineSnoozes? { feeds[machineID]?.session.snoozes }

    func connected(_ machineID: String) -> Bool { feeds[machineID]?.session.connected == true }

    var board: NowBoard { NowBoard.build(inputs) }

    /// What waits on a person across Now and Scheduled, which the badge on Now counts.
    func waiting(with scheduled: ScheduledModel) -> Int {
        board.needsYou.count + scheduled.board(now: .now).needsYou.count
    }

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
    func task(for target: ProjectViewTarget) -> AgentTask? {
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

/// A feed of one machine that a model keeps per machine on the account.
@MainActor protocol MachineFeed: AnyObject {
    init(session: SharedMachineSession)
    var session: SharedMachineSession { get }
    func start()
    func stop()
}

extension AppRuntime {
    /// One running feed per machine on the account. A new device key or a new link to a machine starts them over.
    func reconcile<Feed: MachineFeed>(_ feeds: inout [String: Feed], context: inout String) {
        let current = "\(key?.publicKey ?? ""):\(connectionRevision)"
        let restart = current != context
        context = current
        for (id, feed) in feeds where restart || session(machineID: id) !== feed.session {
            feed.stop()
            feeds.removeValue(forKey: id)
        }
        guard key != nil else { return }
        for machine in machines where feeds[machine.id] == nil {
            let feed = Feed(session: session(for: machine))
            feeds[machine.id] = feed
            feed.start()
        }
    }
}

/// How long a burst of events is gathered into one read of a feed, as the desktop's sidebar watch does.
let feedSettleMilliseconds: Double = 150

@MainActor @Observable
final class NowFeed: MachineFeed {
    let session: SharedMachineSession
    private(set) var projects: [JSONValue] = []
    private(set) var loaded = false
    private(set) var problem: String?
    /// The CLIs on this machine whose denial carries a message, from `provider.list`.
    private(set) var denyReason: Set<String> = []
    @ObservationIgnored private var providersGeneration: Int?
    // A project no client holds has no watcher on the machine, so a new chat there shows on `project.listChanged`
    // from a machine that takes `project.watch`, and on a read every few seconds from one that does not.
    @ObservationIgnored private lazy var live = LiveResource(
        client: session.rpc,
        events: [
            .reread(.projectChanged), .reread(.projectSummary), .reread(.projectListChanged),
            .reread(.sessionListChanged),
        ], watch: .area(.projectWatch, gated: true), settleMilliseconds: feedSettleMilliseconds,
        read: { [weak self] in await self?.load() })
    @ObservationIgnored private var watched = Set<String>()

    init(session: SharedMachineSession) { self.session = session }

    func start() {
        guard !live.isStarted else { return }
        session.retain()
        live.start()
    }

    func stop() {
        guard live.isStarted else { return }
        live.stop()
        for id in watched { session.tasks.unwatch(id) }
        watched.removeAll()
        session.release()
    }

    func refresh() async { await live.refresh() }

    /// Whether the machine took `project.watch` on this link, so it says by itself when a project changed.
    var watching: Bool { live.isWatching }

    private func load() async {
        guard session.connected else { return }
        let generation = session.generation
        do {
            let result = try await session.rpc.request(.projectSidebar, payload: .object([:]))
            guard !Task.isCancelled, generation == session.generation, live.isStarted else { return }
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
            providers.filter { $0.capabilities.denyReason }.map(\.kind))
    }

    /// Asks for the tasks of every open project, so a row of a node another agent opened wears its task mark.
    private func watchTasks() {
        let open = Set(projects.compactMap { $0["summary"]?.text("projectId") }.filter { !$0.isEmpty })
        for id in open.subtracting(watched) { session.tasks.watch(id) }
        for id in watched.subtracting(open) { session.tasks.unwatch(id) }
        watched = open
    }
}
