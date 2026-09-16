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
    private var pushEntries: [String: JSONValue] = [:]
    /// When the machine began keeping entries a client may mark nodes from; nil for a machine that never says, whose
    /// entries only ever concerned notifications and would otherwise all turn into marks after an update.
    private var marksFrom: Double?
    private var pendingReads = Set<String>()
    var onRead: ((String, Double) async -> Void)?
    private var focused: [String: Int] = [:]
    private var subscriptions: [() -> Void] = []
    private var refreshTask: Task<Void, Never>?
    private let client: any MachineRequesting

    init(client: any MachineRequesting) { self.client = client }
    isolated deinit { stop() }

    func start() {
        guard subscriptions.isEmpty else { return }
        subscriptions.append(client.subscribe("push.attention") { [weak self] entry in self?.receivePush(entry) })
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
                pushEntries.removeAll()
                marksFrom = nil
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
        markSeen(id)
    }
    func blur(_ id: String) { focused[id] = max(0, focused[id, default: 0] - 1) }
    func needsYou(_ id: String) -> Bool { statuses[id] == "needs-you" || approvalCounts[id, default: 0] > 0 }

    func update(_ id: String, status: String) {
        guard !id.isEmpty else { return }
        let previous = statuses[id]
        statuses[id] = status
        if previous == "running", status != "running", focused[id, default: 0] == 0 { unseen.insert(id) }
    }

    func markSeen(_ id: String) {
        guard UIApplication.shared.applicationState == .active,
            let entry = pushEntries[id], let issuedAt = entry["issuedAt"]?.numberValue,
            issuedAt > (entry["readThrough"]?.numberValue ?? 0)
        else { return }
        let key = "\(id):\(issuedAt)"
        guard pendingReads.insert(key).inserted else { return }
        Task { [weak self] in
            guard let self else { return }
            defer { pendingReads.remove(key) }
            do {
                _ = try await client.request(
                    "push.read", payload: .object(["nodeId": .string(id), "issuedAt": .number(issuedAt)]))
                receivePush(
                    .object(["nodeId": .string(id), "issuedAt": .number(issuedAt), "readThrough": .number(issuedAt)]))
            } catch {}
        }
    }

    private func receivePush(_ entry: JSONValue) {
        let id = entry.text("nodeId")
        guard !id.isEmpty else { return }
        let previous = pushEntries[id]
        let issued = max(entry["issuedAt"]?.numberValue ?? 0, previous?["issuedAt"]?.numberValue ?? 0)
        let read = max(entry["readThrough"]?.numberValue ?? 0, previous?["readThrough"]?.numberValue ?? 0)
        pushEntries[id] = .object(["nodeId": .string(id), "issuedAt": .number(issued), "readThrough": .number(read)])
        if read > 0 {
            if read >= issued { unseen.remove(id) }
            if read > (previous?["readThrough"]?.numberValue ?? 0) {
                Task { await onRead?(id, read) }
            }
        }
        // A turn that ended, a task that failed or a wake the machine gave up on while nobody was connected.
        if let marksFrom, issued >= marksFrom, read < issued, focused[id, default: 0] == 0 { unseen.insert(id) }
        if focused[id, default: 0] > 0 { markSeen(id) }
    }

    private var unreadPushIDs: Set<String> {
        guard let marksFrom else { return [] }
        return Set(
            pushEntries.values.filter {
                let issued = $0.number("issuedAt")
                return issued >= marksFrom && $0.number("readThrough") < issued
            }.map { $0.text("nodeId") })
    }

    private func refresh() async {
        if let snapshot = try? await client.request("push.attention", payload: .object([:])) {
            guard !Task.isCancelled else { return }
            marksFrom = snapshot["marksFrom"]?.numberValue
            for entry in snapshot.list("entries") { receivePush(entry) }
        }
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
            unseen.formIntersection(ids.union(unreadPushIDs))
        } catch {}
    }
}

struct AttentionMark: View {
    let store: AttentionStore
    let id: String
    var body: some View {
        if store.needsYou(id) {
            Image(lucide: "hand").foregroundStyle(.orange).accessibilityLabel("Needs you")
        } else if store.statuses[id] == "running" {
            Circle().frame(width: 8, height: 8).foregroundStyle(.green).accessibilityLabel("Running")
        } else if store.unseen.contains(id) {
            Circle().frame(width: 8, height: 8).foregroundStyle(MobileStyle.accent).accessibilityLabel(
                "New activity")
        }
    }
}
