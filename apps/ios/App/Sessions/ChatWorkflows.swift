import RuimtePulsar

/// A Workflow call that reported what it runs, which is every one `ChatWorkflows.activity` keeps.
struct WorkflowCall: Identifiable, Equatable {
    let item: ChatToolItem
    let workflow: ChatToolItemWorkflow
    var id: String { item.id }
}

/// `stalled` still runs, but reported nothing for a while.
enum WorkflowWord: Equatable {
    case running, stalled, done, failed
}

/// The workflows the chip over the composer speaks for, as `activeWorkflows` and `workflow-list.ts` on the desktop.
enum ChatWorkflows {
    /// Every call that runs, and the ones that ended since the last message, so a finished workflow stays until the
    /// next message is sent. `items` is in thread order.
    static func activity(_ items: [ChatItem]) -> [WorkflowCall] {
        let lastMessage = items.lastIndex { $0.userItem != nil } ?? -1
        let lastMessageAt = lastMessage < 0 ? nil : items[lastMessage].createdAt
        return items.enumerated().compactMap { index, item in
            guard let tool = item.toolItem, tool.name == "Workflow", let workflow = tool.workflow else { return nil }
            if tool.state == .running || index > lastMessage { return WorkflowCall(item: tool, workflow: workflow) }
            guard let lastMessageAt, let endedAt = endedAt(workflow), endedAt > lastMessageAt else { return nil }
            return WorkflowCall(item: tool, workflow: workflow)
        }
    }

    /// When a workflow last did something: the end the host noted, else the last end of an agent, else its last
    /// report. Nil for one that never reported, which counts as long ago.
    static func endedAt(_ workflow: ChatToolItemWorkflow) -> Double? {
        if let finishedAt = workflow.finishedAt { return finishedAt }
        let ends = workflow.agents.compactMap { agent in
            agent.startedAt.flatMap { startedAt in agent.durationMs.map { startedAt + Double($0) } }
        }
        return ends.max() ?? workflow.lastProgressAt
    }

    static func word(_ call: WorkflowCall) -> WorkflowWord {
        switch call.item.state {
        case .running: call.workflow.stalledAt == nil ? .running : .stalled
        case .error: .failed
        default: .done
        }
    }

    /// One workflow names itself with how many of its agents are done, or that it stalled. Several are counted like
    /// the sub-agents chip: the ones still at work, and all of them once none is.
    static func pill(_ calls: [WorkflowCall]) -> (word: WorkflowWord, label: String) {
        let words = calls.map(word)
        let word = [WorkflowWord.stalled, .running, .failed].first { words.contains($0) } ?? .done
        guard calls.count == 1, let call = calls.first else {
            let active = words.count { $0 == .running || $0 == .stalled }
            return (word, String(localized: "\(active > 0 ? active : calls.count) workflows"))
        }
        let name = title(call)
        if word == .stalled { return (word, String(localized: "\(name) · no progress")) }
        let counts = ChatWorkflowLayout.counts(ChatWorkflowLayout.phases(call.workflow, running: word == .running))
        return (word, counts.total == 0 ? name : "\(name) · \(counts.done)/\(counts.total)")
    }

    static func title(_ call: WorkflowCall) -> String {
        call.workflow.name ?? String(localized: "Workflow")
    }
}

/// Keeps the chip's workflows until a Workflow call or the thread's length moves, so the composer does not derive
/// them again on every word the thread streams.
@MainActor final class ChatWorkflowDerivation {
    private var key: (revision: Int, count: Int)?
    private var cached: [WorkflowCall] = []

    func workflows(revision: Int, count: Int, items: () -> [ChatItem]) -> [WorkflowCall] {
        if let key, key.revision == revision, key.count == count { return cached }
        key = (revision, count)
        cached = ChatWorkflows.activity(items())
        return cached
    }
}
