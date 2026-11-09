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
    // A push from the list to a routine leaves one page before the next appears; the watch stays through it.
    @ObservationIgnored private lazy var viewers = LiveHolds(
        graceMilliseconds: 2_000,
        ended: { [weak self] in
            guard let self else { return }
            for feed in feeds.values { feed.stop() }
            feeds.removeAll()
            contextID = ""
        })

    /// A page of Scheduled came on screen. The feeds run until the last one went.
    func appear(runtime: AppRuntime) {
        viewers.retain()
        reconcile(runtime: runtime)
    }

    func disappear() { viewers.release() }

    func reconcile(runtime: AppRuntime) {
        guard viewers.isHeld else { return }
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
        feeds[target.machineID]?.entries.first { $0.projectId == target.projectID && $0.id == target.routineID }
    }

    func feed(_ machineID: String) -> ScheduledFeed? { feeds[machineID] }
}

@MainActor @Observable
final class ScheduledFeed: MachineFeed {
    let session: SharedMachineSession
    private(set) var entries: [RoutineEntry] = []
    /// The machine's time zone, which every schedule is read in.
    private(set) var timeZone: TimeZone?
    /// Nil until the link opened once, false on a machine that does not answer `routine.list`.
    private(set) var answers: Bool?
    private(set) var problem: String?
    // What changed while the link was down was pushed to nobody, so the watch is asked again on every link.
    @ObservationIgnored private lazy var live = LiveResource(
        client: session.rpc, events: [.reread(.routineChanged)], watch: .area(.routineWatch, gated: true),
        settleMilliseconds: feedSettleMilliseconds,
        connection: { [weak self] connected in
            guard let self, connected else { return }
            answers = session.rpc.answers(.routineList)
        }, read: { [weak self] in await self?.load() })

    init(session: SharedMachineSession) { self.session = session }

    func start() {
        guard !live.isStarted else { return }
        session.retain()
        live.start()
    }

    func stop() {
        guard live.isStarted else { return }
        live.stop()
        session.release()
    }

    func refresh() async { await live.refresh() }

    func pause(_ entry: RoutineEntry) async throws {
        try await send(.routinePause, entry)
    }

    func resume(_ entry: RoutineEntry) async throws {
        try await send(.routineResume, entry)
    }

    func runNow(_ entry: RoutineEntry) async throws -> RoutineRunNowResultOutcome {
        let answer = try await session.rpc.request(.routineRunNow, payload: payload(entry))
            .decoded(as: RoutineRunNowResult.self)
        await refresh()
        return answer.outcome
    }

    private func send(_ request: WireRequest, _ entry: RoutineEntry) async throws {
        _ = try await session.rpc.request(request, payload: payload(entry))
        await refresh()
    }

    private func payload(_ entry: RoutineEntry) -> JSONValue {
        .object(["projectId": .string(entry.projectId), "routineId": .string(entry.id)])
    }

    private func load() async {
        guard session.connected else { return }
        guard answers == true else {
            entries = []
            return
        }
        let generation = session.generation
        do {
            let result = try await session.rpc.request(.routineList, payload: .object([:]))
                .decoded(as: RoutineListResult.self)
            guard !Task.isCancelled, generation == session.generation, live.isStarted else { return }
            entries = result.routines
            timeZone = TimeZone(identifier: result.timeZone)
            problem = nil
        } catch {
            guard !Task.isCancelled, generation == session.generation else { return }
            problem = error.localizedDescription
        }
    }
}
