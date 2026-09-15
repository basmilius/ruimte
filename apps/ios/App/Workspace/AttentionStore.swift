import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

@MainActor @Observable
final class AttentionStore {
    private(set) var statuses: [String: String] = [:]
    private(set) var unseen = Set<String>()
    private(set) var approvalCounts: [String: Int] = [:]
    private var focused: [String: Int] = [:]
    private var subscriptions: [() -> Void] = []
    private var refreshTask: Task<Void, Never>?
    private let client: any MachineRequesting

    init(client: any MachineRequesting) { self.client = client }
    isolated deinit { stop() }

    func start() {
        guard subscriptions.isEmpty else { return }
        subscriptions.append(
            client.subscribe("session.status") { [weak self] event in
                self?.update(
                    event.text("sessionId"), status: event["agent"]?.text("status", fallback: "idle") ?? "idle")
            })
        subscriptions.append(
            client.subscribe("session.approvals") { [weak self] event in
                self?.approvalCounts[event.text("sessionId")] = event.list("approvals").count
            })
        subscriptions.append(
            client.subscribe("session.exit") { [weak self] event in
                self?.update(event.text("sessionId"), status: "exited")
            })
        subscriptions.append(
            client.subscribe("chat.event") { [weak self] payload in
                guard let event = payload["event"], let info = event["info"] else { return }
                self?.update(payload.text("chatId"), status: info.text("status", fallback: "idle"))
            })
        subscriptions.append(
            client.observeConnection { [weak self] connected in
                guard let self else { return }
                refreshTask?.cancel()
                guard connected else { return }
                refreshTask = Task { [weak self] in
                    while !Task.isCancelled {
                        await self?.refresh()
                        // Chats outside an open page have no event subscription on the existing wire.
                        do { try await Task.sleep(for: .seconds(10)) } catch { return }
                    }
                }
            })
    }

    func stop() {
        subscriptions.forEach { $0() }
        subscriptions.removeAll()
        refreshTask?.cancel()
        refreshTask = nil
    }

    func focus(_ id: String) {
        focused[id, default: 0] += 1
        unseen.remove(id)
    }
    func blur(_ id: String) { focused[id] = max(0, focused[id, default: 0] - 1) }
    func needsYou(_ id: String) -> Bool { statuses[id] == "needs-you" || approvalCounts[id, default: 0] > 0 }

    func update(_ id: String, status: String) {
        guard !id.isEmpty else { return }
        let previous = statuses[id]
        statuses[id] = status
        if previous == "running", status != "running", focused[id, default: 0] == 0 { unseen.insert(id) }
    }

    private func refresh() async {
        do {
            let sessions = try await client.request("session.list", payload: .object([:]))
            guard !Task.isCancelled else { return }
            for session in sessions.list("sessions") {
                let id = session.text("sessionId")
                update(
                    id,
                    status: session["exited"] == .bool(true)
                        ? "exited" : session["agent"]?.text("status", fallback: "idle") ?? "idle")
                approvalCounts[id] = session.list("approvals").count
            }
            let chats = try await client.request("chat.list", payload: .object([:]))
            guard !Task.isCancelled else { return }
            let ids = Set(
                sessions.list("sessions").map { $0.text("sessionId") } + chats.list("chats").map { $0.text("chatId") })
            for chat in chats.list("chats") {
                update(chat.text("chatId"), status: chat.text("status", fallback: "idle"))
            }
            statuses = statuses.filter { ids.contains($0.key) }
            approvalCounts = approvalCounts.filter { ids.contains($0.key) }
            unseen.formIntersection(ids)
        } catch {}
    }
}

struct AttentionMark: View {
    let store: AttentionStore
    let id: String
    var body: some View {
        if store.needsYou(id) {
            Image(systemName: "hand.raised.fill").foregroundStyle(.orange).accessibilityLabel("Needs you")
        } else if store.statuses[id] == "running" {
            Image(systemName: "circle.fill").font(.caption2).foregroundStyle(.green).accessibilityLabel("Running")
        } else if store.unseen.contains(id) {
            Image(systemName: "circle.fill").font(.caption2).foregroundStyle(MobileStyle.accent).accessibilityLabel(
                "New activity")
        }
    }
}
