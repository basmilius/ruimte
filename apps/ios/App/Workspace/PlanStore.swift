import Observation
import RuimtePulsar
import RuimteTransport

/// The plans a machine keeps beside its chats. The machine tells every connection about every change, so one
/// `plan.list` per connection is enough; a machine from before plans does not know the request and has none.
@MainActor @Observable
final class PlanStore {
    private(set) var plans: [String: [PlanDocument]] = [:]
    /// Chats whose agent made a plan that no one here has opened yet. The phone never opens it on its own.
    private(set) var unseen: Set<String> = []
    @ObservationIgnored private var subscriptions: [() -> Void] = []
    @ObservationIgnored private let client: any MachineRequesting

    init(client: any MachineRequesting) { self.client = client }

    func start() {
        guard subscriptions.isEmpty else { return }
        subscriptions = [
            client.subscribe("plan.changed") { [weak self] event in
                guard let plan = event["plan"].flatMap(PlanDocument.init) else { return }
                self?.put(chatID: event.text("chatId"), plan)
            },
            client.subscribe("plan.removed") { [weak self] event in
                self?.remove(chatID: event.text("chatId"), planID: event.text("planId"))
            },
            client.subscribe("plan.created") { [weak self] event in
                self?.unseen.insert(event.text("chatId"))
            },
            client.observeConnection { [weak self] connected in
                guard connected else { return }
                self?.list()
            },
        ]
    }

    func stop() {
        for unsubscribe in subscriptions { unsubscribe() }
        subscriptions.removeAll()
        plans.removeAll()
        unseen.removeAll()
    }

    /// Newest first.
    func plans(for chatID: String) -> [PlanDocument] { PlanDocument.newestFirst(plans[chatID] ?? []) }

    func markSeen(_ chatID: String) { unseen.remove(chatID) }

    /// What the machine answered replaces what was known, except a plan an event already brought at a later rev.
    func setListed(_ entries: [JSONValue]) {
        var next: [String: [PlanDocument]] = [:]
        for entry in entries {
            guard let plan = entry["plan"].flatMap(PlanDocument.init) else { continue }
            let chatID = entry.text("chatId")
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
            "plan.apply",
            payload: .object(["chatId": .string(chatID), "planId": .string(planID), "ops": .array(ops)]))
        if let plan = result["plan"].flatMap(PlanDocument.init) { put(chatID: chatID, plan) }
    }

    private func list() {
        Task { [weak self, client] in
            guard let result = try? await client.request("plan.list", payload: .object([:])) else { return }
            guard let self, !subscriptions.isEmpty else { return }
            setListed(result.list("plans"))
        }
    }
}
