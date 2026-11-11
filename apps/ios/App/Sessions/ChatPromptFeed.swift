import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The approvals and questions of the chats a chat opened, and the ones those opened in turn, collected for its
/// composer while it shows, as `ChatPromptFeed` in the desktop's chat does. A child is followed while it runs or waits
/// on a person, and each answer goes to the chat that asked.
@MainActor @Observable final class ChatPromptFeed {
    // As `CHAT_REQUEST_LIMITS.perChat` in the contracts: past this a chat's info no longer names every request.
    static let requestsPerChat = 8

    @ObservationIgnored private let session: SharedMachineSession?
    private(set) var children: [String: ChatModel] = [:]
    private var sources: [String: ChatPromptSource] = [:]

    init(session: SharedMachineSession?) {
        self.session = session
    }

    /// The children to follow under `parent`, by chat id, with what their card names them by; read where the view
    /// observes it, so a new or settled child changes it.
    func wanted(under parent: ChatModel, attention: AttentionStore?) -> [String: ChatPromptSource] {
        var found: [String: ChatPromptSource] = [:]
        var seen: Set<String> = [parent.chatID]
        func visit(_ model: ChatModel) {
            for agent in model.activitySubagents {
                guard let childID = agent.childId, !childID.isEmpty, !seen.contains(childID) else { continue }
                let waiting = attention?.needsYou(childID) == true
                guard agent.status == .running || waiting else { continue }
                seen.insert(childID)
                found[childID] = ChatPromptSource(
                    label: ChatSubagents.title(agent),
                    provider: children[childID]?.info?.provider ?? attention?.agents[childID]?.provider)
                if let child = children[childID] { visit(child) }
            }
        }
        visit(parent)
        return found
    }

    func follow(_ wanted: [String: ChatPromptSource], client: any MachineRequesting, machineID: String) {
        sources = wanted
        for (id, model) in children where wanted[id] == nil {
            release(model)
            children.removeValue(forKey: id)
        }
        for id in wanted.keys where children[id] == nil {
            let fallback = ChatModel(client: client, chatID: id, machineID: machineID)
            if let session {
                children[id] = session.retainChat(fallback)
            } else {
                fallback.start()
                children[id] = fallback
            }
        }
    }

    /// What of the children's requests still waits; the prompt state orders them by when they were asked.
    var subjects: [ChatPromptSubject] {
        children.keys.sorted().flatMap { id -> [ChatPromptSubject] in
            guard let model = children[id], let info = model.info else { return [] }
            return model.pending.filter { Self.stillWaiting($0, info: info) }.map {
                ChatPromptSubject(chatID: id, item: $0, source: sources[id])
            }
        }
    }

    func model(for chatID: String) -> ChatModel? { children[chatID] }

    func stop() {
        children.values.forEach(release)
        children.removeAll()
    }

    /// A request of another chat stands only while that chat still says it waits on it.
    static func stillWaiting(_ item: ChatItem, info: ChatInfo) -> Bool {
        guard info.status == "needs-you" else { return false }
        guard let requests = info.requests, requests.count < requestsPerChat else { return true }
        return requests.contains { $0.requestId == item.requestId }
    }

    private func release(_ model: ChatModel) {
        if let session {
            session.releaseChat(model)
        } else {
            model.stop()
        }
    }
}

/// Keeps a chat's prompts in step with its own requests and those of the chats it opened, and follows those chats
/// while the chat shows.
struct ChatPromptFeedTracking: ViewModifier {
    let feed: ChatPromptFeed
    let prompts: ChatPromptState
    let model: ChatModel
    let attention: AttentionStore?
    let visible: Bool

    func body(content: Content) -> some View {
        content
            .onChange(of: model.pending, initial: true) { _, requests in
                prompts.update(requests, others: feed.subjects)
            }
            .onChange(of: feed.subjects) { _, others in
                prompts.update(model.pending, others: others)
            }
            // A screen that comes back or takes over a shared model may meet requests equal to what it last saw, which
            // no value change reports.
            .onChange(of: ObjectIdentifier(model)) { _, _ in
                prompts.update(model.pending, others: feed.subjects)
            }
            .onAppear { prompts.update(model.pending, others: feed.subjects) }
            .onChange(of: feed.wanted(under: model, attention: attention)) { _, wanted in
                if visible { feed.follow(wanted, client: model.client, machineID: model.machineID) }
            }
    }
}
