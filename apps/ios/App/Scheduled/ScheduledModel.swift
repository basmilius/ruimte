import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// The routines of every machine, read with `routine.list` and again on `routine.changed` while a page of Scheduled
/// shows. Routines are newer than the oldest machine the app talks to, so a machine is asked only once it names them.
@MainActor @Observable
final class ScheduledModel {
    private(set) var feeds: [String: ScheduledFeed] = [:]
    @ObservationIgnored private var contextID = ""
    @ObservationIgnored private var viewers = 0
    @ObservationIgnored private var stopping: Task<Void, Never>?

    /// A page of Scheduled came on screen. The feeds run until the last one went.
    func appear(runtime: AppRuntime) {
        viewers += 1
        stopping?.cancel()
        stopping = nil
        reconcile(runtime: runtime)
    }

    func disappear() {
        viewers = max(0, viewers - 1)
        guard viewers == 0 else { return }
        // A push from the list to a routine leaves one page before the next appears; the watch stays through it.
        stopping = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self, !Task.isCancelled, viewers == 0 else { return }
            for feed in feeds.values { feed.stop() }
            feeds.removeAll()
            contextID = ""
        }
    }

    func reconcile(runtime: AppRuntime) {
        guard viewers > 0 else { return }
        runtime.reconcile(&feeds, context: &contextID)
    }

    func refresh() async {
        await withTaskGroup(of: Void.self) { group in
            for feed in feeds.values { group.addTask { await feed.refresh() } }
        }
    }

    func board(now: Date) -> ScheduledBoard {
        ScheduledBoard.build(
            feeds.values.map { feed in
                ScheduledMachineInput(
                    machineID: feed.session.machine.id, machineName: feed.session.machine.name,
                    answers: feed.answers, entries: feed.entries)
            }, now: now)
    }

    /// Whether any machine still connects, which tells a Scheduled page that waits from one that has nothing.
    var connecting: Bool { feeds.values.contains { $0.answers == nil && $0.session.failedAttempts < 3 } }

    func entry(_ target: RoutineTarget) -> RoutineEntry? {
        feeds[target.machineID]?.entries.first { $0.projectID == target.projectID && $0.id == target.routineID }
    }

    func feed(_ machineID: String) -> ScheduledFeed? { feeds[machineID] }
}

/// One machine's routines.
@MainActor @Observable
final class ScheduledFeed: MachineFeed {
    let session: SharedMachineSession
    private(set) var entries: [RoutineEntry] = []
    /// The machine's time zone, which every schedule is read in.
    private(set) var timeZone: TimeZone?
    /// Nil until the link opened once, false on a machine that does not answer `routine.list`.
    private(set) var answers: Bool?
    private(set) var problem: String?
    @ObservationIgnored private var stops: [() -> Void] = []
    @ObservationIgnored private var lease: MachineSubscription?
    @ObservationIgnored private lazy var reads = FeedReads { [weak self] in await self?.load() }

    init(session: SharedMachineSession) { self.session = session }

    func start() {
        guard stops.isEmpty else { return }
        session.retain()
        let client = session.rpc
        stops.append(client.subscribe(.routineChanged) { [weak self] _ in self?.reads.schedule() })
        stops.append(
            client.observeConnection { [weak self] connected in
                guard let self else { return }
                if connected {
                    Task { await self.linked() }
                } else {
                    reads.cancelScheduled()
                }
            })
    }

    func stop() {
        guard !stops.isEmpty else { return }
        stops.forEach { $0() }
        stops.removeAll()
        reads.cancel()
        let lease = lease
        self.lease = nil
        Task { await lease?.release() }
        session.release()
    }

    func refresh() async { await reads.refresh() }

    func pause(_ entry: RoutineEntry) async throws {
        try await send(.routinePause, entry)
    }

    func resume(_ entry: RoutineEntry) async throws {
        try await send(.routineResume, entry)
    }

    /// `started`, `held` or `busy`, as the machine answers it.
    func runNow(_ entry: RoutineEntry) async throws -> String {
        let answer = try await session.rpc.request(.routineRunNow, payload: payload(entry))
        await refresh()
        return answer.text("outcome")
    }

    private func send(_ request: WireRequest, _ entry: RoutineEntry) async throws {
        _ = try await session.rpc.request(request, payload: payload(entry))
        await refresh()
    }

    private func payload(_ entry: RoutineEntry) -> JSONValue {
        .object(["projectId": .string(entry.projectID), "routineId": .string(entry.id)])
    }

    private func linked() async {
        let client = session.rpc
        answers = client.answers(.routineList)
        guard answers == true else {
            entries = []
            return
        }
        // What changed while the link was down was pushed to nobody, so the watch is asked again on every link.
        if client.answers(.routineWatch) {
            if lease == nil {
                lease = client.acquireSubscription(
                    start: .routineWatch, stop: .routineUnwatch,
                    payload: .object([:]), stopPayload: .object([:]))
            }
            _ = try? await lease?.refresh()
        }
        await refresh()
    }

    private func load() async {
        guard session.connected, answers == true else { return }
        let generation = session.generation
        do {
            let result = try await session.rpc.request(.routineList, payload: .object([:]))
            guard !Task.isCancelled, generation == session.generation, !stops.isEmpty else { return }
            entries = result.list("routines").map(RoutineEntry.init(json:))
            timeZone = TimeZone(identifier: result.text("timeZone"))
            problem = nil
        } catch {
            guard !Task.isCancelled, generation == session.generation else { return }
            problem = error.localizedDescription
        }
    }
}
