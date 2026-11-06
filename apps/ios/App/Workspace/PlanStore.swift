import Observation
import RuimtePulsar
import RuimteTransport

/// The plans a machine keeps beside its chats. The machine tells every connection about every change, so one
/// `plan.list` per connection is enough.
@MainActor @Observable
final class PlanStore {
    private(set) var plans: [String: [PlanDocument]] = [:]
    /// Chats whose agent made a plan that no one here has opened yet. The phone never opens it on its own.
    private(set) var unseen: Set<String> = []
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private lazy var live = LiveResource(
        client: client,
        events: [
            .apply(.planChanged, as: PlanChangedEvent.self) { [weak self] in
                self?.put(chatID: $0.chatId, PlanDocument($0.plan))
            },
            .apply(.planRemoved, as: PlanRemovedEvent.self) { [weak self] in
                self?.remove(chatID: $0.chatId, planID: $0.planId)
            },
            .apply(.planCreated, as: PlanCreatedEvent.self) { [weak self] in self?.unseen.insert($0.chatId) },
        ],
        read: { [weak self] in await self?.list() })

    init(client: any MachineRequesting) { self.client = client }

    func start() { live.start() }

    func stop() {
        live.stop()
        plans.removeAll()
        unseen.removeAll()
    }

    /// Newest first.
    func plans(for chatID: String) -> [PlanDocument] { PlanDocument.newestFirst(plans[chatID] ?? []) }

    func markSeen(_ chatID: String) { unseen.remove(chatID) }

    /// What the machine answered replaces what was known, except a plan an event already brought at a later rev.
    func setListed(_ entries: [PlanOfChat]) {
        var next: [String: [PlanDocument]] = [:]
        for entry in entries {
            let plan = PlanDocument(entry.plan)
            let chatID = entry.chatId
            let known = plans[chatID]?.first { $0.id == plan.id }
            next[chatID, default: []].append(known.map { $0.rev > plan.rev ? $0 : plan } ?? plan)
        }
        if next != plans { plans = next }
    }

    func put(chatID: String, _ plan: PlanDocument) {
        guard !chatID.isEmpty else { return }
        var list = plans[chatID] ?? []
        if let index = list.firstIndex(where: { $0.id == plan.id }) {
            guard list[index].rev <= plan.rev, list[index] != plan else { return }
            list[index] = plan
        } else {
            list.append(plan)
        }
        plans[chatID] = list
    }

    func remove(chatID: String, planID: String) {
        guard var list = plans[chatID], let index = list.firstIndex(where: { $0.id == planID }) else { return }
        list.remove(at: index)
        plans[chatID] = list.isEmpty ? nil : list
        if list.isEmpty { unseen.remove(chatID) }
    }

    /// Sends a person's operations; a refusal is thrown with the machine's message.
    func apply(chatID: String, planID: String, ops: [JSONValue]) async throws {
        let result = try await client.request(
            .planApply,
            payload: .object(["chatId": .string(chatID), "planId": .string(planID), "ops": .array(ops)])
        ).decoded(as: PlanApplyResult.self)
        put(chatID: chatID, PlanDocument(result.plan))
    }

    private func list() async {
        guard
            let result = try? await client.request(.planList, payload: .object([:])).decoded(as: PlanListResult.self),
            live.isStarted
        else { return }
        setListed(result.plans)
    }
}
