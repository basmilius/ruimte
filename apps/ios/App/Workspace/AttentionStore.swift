import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What one session's status is made of. The word follows `sessionStatus` in the desktop client's
/// `state/sessions.ts` one for one, so a machine that restarted reads the same on both.
struct SessionReading: Equatable {
    /// The agent record the CLI's hooks wrote, which outlives the CLI itself.
    var agent: SessionAgent?
    var shellExited = false
    /// Whether this client holds an attachment. Only a terminal page attaches, never this store, so it stays false
    /// here; counting the attachments of other clients would call a shell someone opened on the desktop running.
    var attached = false

    var status: AgentStatus? {
        let recorded = AgentStatus(rawValue: agent?.status ?? "") ?? .idle
        // A live agent knows better than the shell what is going on.
        if agent?.live == true {
            return recorded
        }
        // The daemon marks the record when the CLI went down with the shell, and it outlives the shell.
        if recorded == .exited {
            return .exited
        }
        if shellExited {
            return .error
        }
        return attached ? .running : nil
    }
}

extension AgentStatus {
    /// The status of an agent record, or idle: a record without one, and a word a newer machine knows and this app
    /// does not, both mean nothing is waiting here.
    static func of(_ status: String) -> AgentStatus { AgentStatus(rawValue: status) ?? .idle }
}

/// The CLI a chat runs and the model it runs on, as its info last said.
struct ChatAgentIdentity: Equatable {
    let provider: String
    let model: String
}

/// The requests a chat waits on, with the CLI it runs, which decides whether a denial can carry a message.
struct ChatWait: Equatable {
    let provider: String
    let requests: [ChatInfoRequestsItem]
}

/// What a chat has going beside its turn, as its info last said: the messages queued for its next turn and the
/// commands its CLI runs in the background.
struct ChatActivity: Hashable {
    struct Background: Hashable {
        let description: String
        /// Epoch milliseconds.
        let startedAt: Double
    }

    var queued = 0
    var background: [Background] = []

    var isEmpty: Bool { queued == 0 && background.isEmpty }
}

extension ChatActivity {
    init(info: ChatInfo) {
        self.init(
            queued: info.queue?.count ?? 0,
            background: (info.background ?? []).map { Background(description: $0.description, startedAt: $0.startedAt) })
    }
}

@MainActor @Observable
final class AttentionStore {
    private(set) var statuses: [String: AgentStatus] = [:]
    private(set) var unseen = Set<String>()
    /// What each chat waits on a person for, from `ChatInfo.requests`, by chat id; absent while nothing waits.
    private(set) var waits: [String: ChatWait] = [:]
    /// Chats between turns whose CLI still runs sub-agents or a workflow in the background (`ChatInfo.delegating`).
    private(set) var delegating = Set<String>()
    /// What each chat runs, by chat id, so a task's row can name the agent working on it.
    private(set) var agents: [String: ChatAgentIdentity] = [:]
    /// What each chat has going beside its turn, by chat id; absent while it has nothing.
    private(set) var activity: [String: ChatActivity] = [:]
    /// When a session last stopped running, in epoch milliseconds: the moment this client saw it stop, or when the
    /// machine says its turn ended while nobody looked.
    private(set) var finishedAt: [String: Double] = [:]
    private var pushEntries: [String: PushAttentionEntry] = [:]
    private var readings: [String: SessionReading] = [:]
    /// When the machine began keeping entries a client may mark nodes from; nil for a machine that never says, whose
    /// entries only ever concerned notifications and would otherwise all turn into marks after an update.
    private var marksFrom: Double?
    private var pendingReads = Set<String>()
    var onRead: ((String, Double) async -> Void)?
    /// Told the nodes the machine holds unread each time a fresh link asked for them.
    var onUnread: ((Set<String>) async -> Void)?
    private var focused: [String: Int] = [:]
    private let client: any MachineRequesting
    @ObservationIgnored private lazy var live = LiveResource(
        client: client,
        events: [
            .apply(.pushAttention, as: PushAttentionEntry.self) { [weak self] in self?.receivePush($0) },
            .apply(.sessionStatus, as: SessionStatusEvent.self) { [weak self] event in
                self?.read(event.sessionId) { $0.agent = event.agent }
            },
            .apply(.sessionExit, as: SessionExitEvent.self) { [weak self] event in
                self?.read(event.sessionId) { $0.shellExited = true }
            },
            .apply(.chatStatus, as: ChatStatusEvent.self) { [weak self] event in
                self?.receive(chat: event.chatId, info: event.info)
            },
            .apply(.chatEvent, as: ChatEventEnvelope.self) { [weak self] envelope in
                guard case .info(let event) = envelope.event else { return }
                self?.receive(chat: envelope.chatId, info: event.info)
            },
        ],
        connection: { [weak self] connected in
            guard connected else { return }
            self?.pushEntries.removeAll()
            self?.marksFrom = nil
        }, read: { [weak self] in await self?.refresh() })

    init(client: any MachineRequesting) { self.client = client }
    isolated deinit { stop() }

    func start() { live.start() }

    func stop() { live.stop() }

    func focus(_ id: String) {
        focused[id, default: 0] += 1
        unseen.remove(id)
        markSeen(id)
    }
    func blur(_ id: String) { focused[id] = max(0, focused[id, default: 0] - 1) }
    func needsYou(_ id: String) -> Bool { statuses[id] == .needsYou }

    /// Folds one field of a session's reading in and writes the word that reading now derives. A session the client
    /// knows nothing about reads as idle, which is the mark the desktop draws for no status at all: none.
    func read(_ id: String, _ change: (inout SessionReading) -> Void) {
        guard !id.isEmpty else { return }
        var reading = readings[id] ?? SessionReading()
        change(&reading)
        readings[id] = reading
        update(id, status: reading.status ?? .idle)
    }

    func update(_ id: String, status: AgentStatus) {
        guard !id.isEmpty else { return }
        let previous = statuses[id]
        statuses[id] = status
        if previous == .running, status != .running {
            finishedAt[id] = Date.now.timeIntervalSince1970 * 1000
            if focused[id, default: 0] == 0 { unseen.insert(id) }
        }
    }

    /// A chat's info, from `chat.list`, `chat.status` or the chat's own events, which all carry what it waits on.
    func receive(chat id: String, info: ChatInfo) {
        guard !id.isEmpty else { return }
        update(id, status: AgentStatus.of(info.status))
        let requests = info.requests ?? []
        let wait = requests.isEmpty ? nil : ChatWait(provider: info.provider, requests: requests)
        if waits[id] != wait { waits[id] = wait }
        let delegates = info.status == AgentStatus.idle.rawValue && info.delegating == true
        if delegates != delegating.contains(id) {
            if delegates { delegating.insert(id) } else { delegating.remove(id) }
        }
        let going = ChatActivity(info: info)
        let kept = going.isEmpty ? nil : going
        if activity[id] != kept { activity[id] = kept }
        let provider = info.provider
        if !provider.isEmpty {
            let model = info.model ?? ""
            let identity = ChatAgentIdentity(provider: provider, model: model.isEmpty ? info.selection.model : model)
            if agents[id] != identity { agents[id] = identity }
        }
    }

    func markSeen(_ id: String) {
        guard UIApplication.shared.applicationState == .active,
            let entry = pushEntries[id], entry.issuedAt > entry.readThrough
        else { return }
        let issuedAt = Double(entry.issuedAt)
        let key = "\(id):\(issuedAt)"
        guard pendingReads.insert(key).inserted else { return }
        Task { [weak self] in
            guard let self else { return }
            defer { pendingReads.remove(key) }
            do {
                _ = try await client.request(
                    .pushRead, payload: .object(["nodeId": .string(id), "issuedAt": .number(issuedAt)]))
                receivePush(
                    PushAttentionEntry(nodeId: id, issuedAt: Int64(issuedAt), readThrough: Int64(issuedAt)))
            } catch {}
        }
    }

    private func receivePush(_ entry: PushAttentionEntry) {
        let id = entry.nodeId
        guard !id.isEmpty else { return }
        let previous = pushEntries[id]
        let issued = max(entry.issuedAt, previous?.issuedAt ?? 0)
        let read = max(entry.readThrough, previous?.readThrough ?? 0)
        pushEntries[id] = PushAttentionEntry(nodeId: id, issuedAt: issued, readThrough: read)
        if read > 0 {
            if read >= issued { unseen.remove(id) }
            if read > (previous?.readThrough ?? 0) {
                Task { await onRead?(id, Double(read)) }
            }
        }
        // A turn that ended, a task that failed or a wake the machine gave up on while nobody was connected.
        if let marksFrom, Double(issued) >= marksFrom, read < issued, focused[id, default: 0] == 0 {
            unseen.insert(id)
            finishedAt[id] = max(finishedAt[id] ?? 0, Double(issued))
        }
        if focused[id, default: 0] > 0 { markSeen(id) }
    }

    private var unreadPushIDs: Set<String> {
        guard let marksFrom else { return [] }
        return Set(
            pushEntries.values.filter { Double($0.issuedAt) >= marksFrom && $0.readThrough < $0.issuedAt }
                .map(\.nodeId))
    }

    private func refresh() async {
        if let snapshot = try? await client.request(.pushAttention, payload: .object([:]))
            .decoded(as: PushAttentionResult.self)
        {
            guard !Task.isCancelled else { return }
            marksFrom = snapshot.marksFrom.map(Double.init)
            for entry in snapshot.entries { receivePush(entry) }
            let unread = pushEntries.values.filter { $0.readThrough < $0.issuedAt }.map(\.nodeId)
            await onUnread?(Set(unread))
        }
        do {
            let sessions = try await client.request(.sessionList, payload: .object([:]))
                .decoded(as: SessionListResult.self)
            guard !Task.isCancelled else { return }
            for session in sessions.sessions {
                read(session.sessionId) {
                    $0.agent = session.agent.present
                    $0.shellExited = session.exited
                }
            }
            let chats = try await client.request(.chatList, payload: .object([:])).decoded(as: ChatListResult.self)
            guard !Task.isCancelled else { return }
            let ids = Set(sessions.sessions.map(\.sessionId) + chats.chats.map(\.chatId))
            for chat in chats.chats {
                receive(chat: chat.chatId, info: chat)
            }
            statuses = statuses.filter { ids.contains($0.key) }
            waits = waits.filter { ids.contains($0.key) }
            delegating.formIntersection(ids)
            agents = agents.filter { ids.contains($0.key) }
            activity = activity.filter { ids.contains($0.key) }
            finishedAt = finishedAt.filter { ids.contains($0.key) }
            readings = readings.filter { ids.contains($0.key) }
            unseen.formIntersection(ids.union(unreadPushIDs))
        } catch {}
    }
}
