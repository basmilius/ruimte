import Foundation
import Observation
import RuimtePulsar
import RuimteShared
import RuimteTransport

/// One conversation below a chat: the call that opened it and what that call called it.
struct SubagentCrumb: Hashable, Identifiable {
    let toolUseID: String
    let description: String
    var id: String { toolUseID }

    init(_ agent: ChatSubagentItem) {
        toolUseID = agent.toolUseId
        description = ChatSubagents.title(agent)
    }

    init(toolUseID: String, description: String) {
        self.toolUseID = toolUseID
        self.description = description
    }
}

/// The list of a chat's sub-agents as its toolbar opens it.
struct SubagentListRoute: Hashable, Identifiable {
    let chatID: String
    var id: String { chatID }
}

/// The state a sub-agent's entry shows in front of its title: the words of the wire, plus the cancelled and the paused
/// that only a task's own record still tells apart from a failure and a run.
enum SubagentStatusWord: String, CaseIterable {
    case running, paused, done, failed, cancelled

    /// Every word the wire has, so a status added to `ChatSubagentStatusSchema` stops compiling here.
    init(_ status: ChatSubagentStatus) {
        switch status {
        case .running: self = .running
        case .done: self = .done
        case .failed: self = .failed
        }
    }

    var title: String {
        switch self {
        case .running: String(localized: "Running")
        case .paused: String(localized: "Paused")
        case .done: String(localized: "Done")
        case .failed: String(localized: "Failed")
        case .cancelled: String(localized: "Canceled")
        }
    }

    var look: AgentWorkLook {
        switch self {
        case .running: .running
        case .done: .done
        case .failed: .failed
        case .paused, .cancelled: .stopped
        }
    }
}

/// What a task's row says its agent is doing: the task's own state, or that the agent waits on a person while the
/// task runs.
enum TaskRowState: String, Equatable {
    case running, waiting, paused, done, failed, cancelled

    var settled: Bool { self == .done || self == .failed || self == .cancelled }

    var look: AgentWorkLook {
        switch self {
        case .running, .waiting: .running
        case .done: .done
        case .failed: .failed
        case .paused, .cancelled: .stopped
        }
    }
}

/// The latest thing a sub-agent did, as its entry says it: a tool call, or text it wrote.
enum SubagentPreview: Equatable {
    case tool(name: String, detail: String)
    case text(String)
}

/// What the Stop of an active entry does: a task stops the node working on it, and a subagent of the CLI's own is
/// only marked stopped, since no CLI stops one on its own.
enum SubagentStop {
    case task, mark
}

enum ChatSubagents {
    // An entry shows two lines at most, so a report of many kilobytes is never flattened whole.
    private static let previewCharacters = 400

    static func title(_ agent: ChatSubagentItem) -> String {
        [agent.description, agent.summary ?? "", agent.subagentType ?? ""].first { !$0.isEmpty }
            ?? String(localized: "Sub-agent")
    }

    static func canOpen(_ agent: ChatSubagentItem) -> Bool {
        !agent.toolUseId.isEmpty
    }

    static func openable(_ items: [ChatItem]) -> [ChatSubagentItem] {
        items.compactMap(\.subagentItem).filter(canOpen)
    }

    /// The sub-agents the composer's chip speaks for, as `activeSubagents` in `@adecore/agent-contracts` picks them:
    /// every running one, the ones since the person last wrote, and the rest of a turn that still has one running.
    static func activity(_ items: [ChatItem]) -> [ChatSubagentItem] {
        let lastMessage = items.lastIndex { $0.userItem != nil } ?? -1
        let lastMessageAt = lastMessage < 0 ? nil : items[lastMessage].createdAt
        let rows = items.enumerated().compactMap { index, item in item.subagentItem.map { (index, $0) } }
        let turns = Set(rows.compactMap { $0.1.status == .running ? $0.1.turnId : nil })
        return rows.filter { index, agent in
            if agent.status == .running || index > lastMessage { return true }
            if let lastMessageAt, let finishedAt = agent.finishedAt, finishedAt > lastMessageAt { return true }
            return agent.turnId.map(turns.contains) ?? false
        }.map(\.1)
    }

    /// The one state the chip shows for all of them: work in progress first, then work held up, then whatever went wrong.
    static func summaryWord(_ words: [SubagentStatusWord]) -> SubagentStatusWord {
        [.running, .paused, .failed, .cancelled].first { words.contains($0) } ?? .done
    }

    /// The number on the chip: the ones still at work, a paused one included, and all of them once none is.
    static func badgeCount(_ words: [SubagentStatusWord]) -> Int {
        let active = words.count { $0 == .running || $0 == .paused }
        return active > 0 ? active : words.count
    }

    /// How far delegated work is, as `progressOf` in `subagent-list.ts` of ADE CORE counts it: what settled as done,
    /// what still runs or waits, and how many of those wait on a person.
    static func progress(_ states: [TaskRowState]) -> (done: Int, total: Int, waiting: Int, active: Int) {
        (
            states.count { $0 == .done }, states.count, states.count { $0 == .waiting },
            states.count { $0 == .running || $0 == .paused || $0 == .waiting }
        )
    }

    /// What the chip says: while more than one works and some still run, how far they got and how many need the person;
    /// otherwise how many there are.
    static func chipLabel(_ states: [TaskRowState], words: [SubagentStatusWord]) -> String {
        let counts = progress(states)
        guard counts.active > 0, counts.total > 1 else { return ChatBackground.subagents(badgeCount(words)) }
        let text = String(localized: "\(counts.done) of \(counts.total) sub-agents done")
        return counts.waiting > 0 ? "\(text), \(String(localized: "\(counts.waiting) need you"))" : text
    }

    /// The task a row stands for, whose id the daemon wrote into the row's own, as `taskIdOfRow` reads it.
    static func taskID(_ agent: ChatSubagentItem) -> String? {
        taskID(id: agent.id, origin: agent.origin?.rawValue)
    }

    static func taskID(id: String, origin: String?) -> String? {
        guard origin == "ruimte", id.hasPrefix("task-") else { return nil }
        let task = String(id.dropFirst(5))
        return task.isEmpty ? nil : task
    }

    /// Whether the chat a task's agent works in waits on a person, as the task's own row reads it.
    @MainActor static func childWaiting(_ agent: ChatSubagentItem, attention: AttentionStore?) -> Bool {
        guard let id = agent.childId, let attention else { return false }
        return attention.needsYou(id) || attention.waits[id] != nil
    }

    /// A cancelled task is a failed row on the wire and a paused one a running row, and only the task itself still says
    /// which it is.
    static func statusWord(_ agent: ChatSubagentItem, task: AgentTask?) -> SubagentStatusWord {
        if agent.status == .failed, task?.status == .cancelled { return .cancelled }
        if agent.status == .running, task?.status == .open, task?.paused != nil { return .paused }
        return SubagentStatusWord(agent.status)
    }

    static func taskRowState(_ agent: ChatSubagentItem, task: AgentTask?, childWaiting: Bool) -> TaskRowState {
        switch statusWord(agent, task: task) {
        case .running: return childWaiting ? .waiting : .running
        case .paused: return .paused
        case .done: return .done
        case .failed: return .failed
        case .cancelled: return .cancelled
        }
    }

    static func taskStateText(_ state: TaskRowState, task: AgentTask?, now: Date, locale: FormatLocale = .current)
        -> String
    {
        switch state {
        case .running: return String(localized: "Running")
        case .waiting: return String(localized: "Waiting for you")
        case .paused:
            guard let until = task?.paused?.until else { return String(localized: "Paused") }
            let time = Format.moment(Date(timeIntervalSince1970: until / 1000), now: now, in: locale)
            return String(localized: "Paused until \(time)", comment: "%@ is a time, or a day and a time")
        case .done: return String(localized: "Done")
        case .failed: return String(localized: "Failed")
        case .cancelled: return String(localized: "Canceled")
        }
    }

    /// What the task is about, after the model of the agent working on it when that is known.
    static func taskTitle(_ agent: ChatSubagentItem, model: String?) -> String {
        let title = agent.description.isEmpty ? String(localized: "Task") : agent.description
        guard let model, !model.isEmpty else { return title }
        return String(localized: "\(model): \(title)")
    }

    /// When a task was given and settled. Its own record says so first; the row copies those, but may lag behind it.
    static func taskSpan(_ agent: ChatSubagentItem, task: AgentTask?) -> (startedAt: Double, finishedAt: Double?) {
        (task?.createdAt ?? agent.startedAt, task?.settledAt ?? agent.finishedAt)
    }

    /// How long a settled task took; nil while it runs and for one that knows no start or end.
    static func taskDuration(_ agent: ChatSubagentItem, task: AgentTask?, state: TaskRowState) -> String? {
        let span = taskSpan(agent, task: task)
        guard state.settled, span.startedAt > 0, let finishedAt = span.finishedAt, finishedAt >= span.startedAt
        else { return nil }
        return Format.elapsedShort(milliseconds: finishedAt - span.startedAt)
    }

    /// What a settled sub-agent's line says on its right: how it ended, and how long it took when that is known.
    static func outcome(_ agent: ChatSubagentItem) -> String? {
        guard agent.status != .running else { return nil }
        let duration = agent.finishedAt.map { Format.elapsedShort(milliseconds: $0 - agent.startedAt) }
        if agent.status == .failed {
            return duration.map { String(localized: "failed in \($0)") } ?? String(localized: "Failed")
        }
        return duration.map { String(localized: "done in \($0)") } ?? String(localized: "Done")
    }

    /// What of every sub-agent's own work the parent's thread kept, by the call that opened it, in thread order.
    static func threadWork(_ items: [ChatItem]) -> [String: [ChatItem]] {
        var work: [String: [ChatItem]] = [:]
        for item in items {
            switch item {
            case .tool, .assistant:
                if let parent = item.parentToolUseID, !parent.isEmpty { work[parent, default: []].append(item) }
            default: continue
            }
        }
        return work
    }

    /// Running on top and everything that settled below it, the most recently updated first in each.
    static func sections(_ agents: [ChatSubagentItem], work: [String: [ChatItem]])
        -> (active: [ChatSubagentItem], done: [ChatSubagentItem])
    {
        (
            newestFirst(agents.filter { $0.status == .running }, work: work),
            newestFirst(agents.filter { $0.status != .running }, work: work)
        )
    }

    /// When an entry last moved: the latest step the thread kept of a running one, else its start; the end of a
    /// settled one.
    private static func updatedAt(_ agent: ChatSubagentItem, work: [ChatItem]) -> Double? {
        guard agent.status == .running else { return agent.finishedAt.flatMap { $0 > 0 ? $0 : nil } }
        let at = max(work.map(\.createdAt).max() ?? 0, agent.startedAt)
        return at > 0 ? at : nil
    }

    /// Newest first; an entry that knows no time goes below the rest, in the order the thread has them.
    private static func newestFirst(_ agents: [ChatSubagentItem], work: [String: [ChatItem]]) -> [ChatSubagentItem] {
        agents.enumerated()
            .map {
                (agent: $0.element, index: $0.offset, at: updatedAt($0.element, work: work[$0.element.toolUseId] ?? []))
            }
            .sorted { left, right in
                switch (left.at, right.at) {
                case (let l?, let r?): l == r ? left.index < right.index : l > r
                case (nil, nil): left.index < right.index
                case (nil, _): false
                case (_, nil): true
                }
            }
            .map(\.agent)
    }

    // What Claude Code leaves as a background agent's result once the agent handed its report back with
    // `SubagentHandback`: a fixed notice with the agent's id. Only that opening is matched.
    private static var handbackNotice: Regex<Substring> {
        #/^This agent's report was delivered to you as a message from "[^"\s]+"/#
    }

    static func isHandbackNotice(_ text: String?) -> Bool {
        guard let text else { return false }
        return text.trimmingCharacters(in: .whitespacesAndNewlines).firstMatch(of: handbackNotice) != nil
    }

    /// The report a `SubagentHandback` call carries in `input.message`, or nil for any other item.
    static func handbackReport(_ item: ChatItem) -> String? {
        guard let tool = item.toolItem, tool.name == "SubagentHandback",
            let message = tool.input["message"]?.stringValue,
            !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return message
    }

    static func lastHandbackReport(_ items: [ChatItem]) -> String? {
        items.reversed().lazy.compactMap(handbackReport).first
    }

    private static func oneLine(_ text: String) -> String {
        String(text.prefix(previewCharacters)).split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// A reply is Markdown, and the entry draws it as the plain text the thread would render it to.
    private static func prose(_ text: String) -> String {
        var plain = String(text.prefix(previewCharacters))
        plain = plain.replacing(#/!?\[([^\]]*)\]\([^)]*\)/#) { String($0.output.1) }
        plain = plain.replacing(#/(?m)^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/#, with: "")
        plain = plain.replacing(#/[*_`~]+/#, with: "")
        return oneLine(plain)
    }

    static func previewOfItem(_ item: ChatItem) -> SubagentPreview? {
        switch item {
        case .tool(let tool):
            // A preview has one line for the whole entry, so a call with nothing to say falls back to what the CLI
            // reports about its progress. The tool row itself has no such fallback.
            let summary = ChatToolPresentation.summary(tool)
            let detail = summary.isEmpty ? tool.progress?.description ?? "" : summary
            return .tool(name: tool.name, detail: oneLine(detail))
        case .assistant(let reply):
            let text = prose(reply.text)
            return text.isEmpty ? nil : .text(text)
        case .subagent(let agent):
            return .tool(
                name: agent.origin == .ruimte ? String(localized: "Task") : String(localized: "Agent"),
                detail: oneLine(agent.description))
        default: return nil
        }
    }

    static func latestPreview(_ items: [ChatItem]) -> SubagentPreview? {
        items.reversed().lazy.compactMap(previewOfItem).first
    }

    /// The thread kept the beginning of a sub-agent that did too much, so only a thread that kept all of it has the
    /// latest step.
    private static func threadHasLatest(_ agent: ChatSubagentItem, work: [ChatItem]) -> Bool {
        !agent.itemsTruncated && !work.isEmpty
    }

    private static func reportIsNotice(_ agent: ChatSubagentItem, work: [ChatItem]) -> Bool {
        lastHandbackReport(work) == nil && isHandbackNotice(agent.result ?? agent.summary)
    }

    /// Whether the entry reads the newest end of the conversation from the machine: only when the parent's thread
    /// does not hold its latest step, which is a task, a Codex agent and a Claude agent past what the thread keeps.
    static func needsTail(_ agent: ChatSubagentItem, work: [ChatItem]) -> Bool {
        (agent.status == .running || reportIsNotice(agent, work: work))
            && !threadHasLatest(agent, work: work) && canOpen(agent)
    }

    static func preview(_ agent: ChatSubagentItem, work: [ChatItem], tail: [ChatItem]?) -> SubagentPreview? {
        let fromThread = threadHasLatest(agent, work: work) ? latestPreview(work) : nil
        let summary = agent.summary ?? ""
        if agent.status == .running {
            if let latest = fromThread ?? tail.flatMap(latestPreview) { return latest }
            let lastTool = agent.lastTool ?? ""
            if !lastTool.isEmpty { return .tool(name: lastTool, detail: oneLine(summary)) }
            return summary.isEmpty ? nil : .text(oneLine(summary))
        }
        // A report handed back with `SubagentHandback` is the real one; the result then only says where it went.
        if let handedBack = lastHandbackReport(work) ?? tail.flatMap(lastHandbackReport) {
            return .text(prose(handedBack))
        }
        let notice = isHandbackNotice(agent.result ?? agent.summary)
        let report = notice ? "" : prose(agent.result ?? "")
        if !report.isEmpty { return .text(report) }
        if let latest = fromThread ?? (notice ? tail.flatMap(latestPreview) : nil) { return latest }
        return !summary.isEmpty && !isHandbackNotice(summary) ? .text(oneLine(summary)) : nil
    }

    /// While the chat's turn runs that turn may still wait on a subagent of the CLI's own, so stopping the turn is the
    /// only offer then.
    static func stop(_ agent: ChatSubagentItem, turnRunning: Bool) -> SubagentStop? {
        guard agent.status == .running else { return nil }
        if agent.origin == .ruimte { return agent.childId == nil ? nil : .task }
        return turnRunning ? nil : .mark
    }

    /// The time on the right of an entry: how long it has run so far, or when it ended, with the date once that was
    /// not today.
    static func entryTime(_ agent: ChatSubagentItem, task: AgentTask?, now: Date, locale: FormatLocale = .current)
        -> String?
    {
        let (startedAt, finishedAt) = taskSpan(agent, task: task)
        if agent.status == .running {
            return startedAt > 0 ? Format.elapsedShort(milliseconds: now.timeIntervalSince1970 * 1000 - startedAt) : nil
        }
        guard let finishedAt, finishedAt > 0 else { return nil }
        return Format.moment(Date(timeIntervalSince1970: finishedAt / 1000), now: now, in: locale)
    }

    /// What the bar over a sub-agent's conversation says of it beside its state and its time.
    static func facts(_ agent: ChatSubagentItem, locale: FormatLocale = .current) -> [String] {
        var facts: [String] = []
        if let model = agent.model, !model.isEmpty { facts.append(ModelName.fromSlug(model)) }
        if let type = agent.subagentType, !type.isEmpty { facts.append(type) }
        if agent.background {
            facts.append(String(localized: "background", comment: "A sub-agent that runs in the background, lowercase"))
        }
        if let tokens = agent.usage?.totalTokens, tokens > 0 {
            let count = Format.tokens(Double(tokens), in: locale)
            facts.append(String(localized: "\(count) tokens", comment: "%@ is a compact number, like 12K"))
        }
        if let calls = agent.usage?.toolUses, calls > 0 {
            facts.append(String(localized: "\(Int(calls)) tool calls"))
        }
        return facts
    }

    static func stopsTaskWarning(_ agents: Int) -> String {
        let warning = String(
            localized:
                "Ends the agent and cancels the task. The chat that gave it is not told. Its node stays on the canvas."
        )
        return agents == 0 ? warning : "\(warning) \(endsAgentsWarning(agents))"
    }

    static func stopsSubagentsWarning(_ agents: Int) -> String {
        let warning = String(localized: "Stops the turn and marks the chat's own sub-agents as stopped.")
        return "\(warning) \(endsAgentsWarning(agents))"
    }

    static func endsAgentsWarning(_ agents: Int) -> String {
        String(
            localized:
                "Also ends the \(agents) agents it opened. Their nodes and work so far stay on the canvas.")
    }

    /// The live agents these nodes opened, counted once. A machine that does not know the question counts none.
    @MainActor static func agentsEnded(with nodeIDs: [String], client: any MachineRequesting) async -> Int {
        var ended = Set<String>()
        for nodeID in nodeIDs {
            let result = try? await client.request(.agentChildren, payload: .object(["nodeId": .string(nodeID)]))
            for id in result?.list("nodeIds").compactMap(\.stringValue) ?? [] { ended.insert(id) }
        }
        return ended.subtracting(nodeIDs).count
    }

    /// The newest page laid over what is held. A page that shares nothing with it means more happened than one page
    /// holds, so what is held is dropped for it rather than shown with a hole.
    static func mergeNewest(current: [ChatItem], cursor: String?, page: [ChatItem], pageCursor: String?)
        -> (items: [ChatItem], cursor: String?, replaced: Bool)
    {
        let known = Dictionary(current.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { $1 })
        if !current.isEmpty, !page.isEmpty, !page.contains(where: { known[$0.id] != nil }) {
            return (page, pageCursor, true)
        }
        var items = current
        for item in page {
            if let index = known[item.id] { items[index] = item } else { items.append(item) }
        }
        return (items, current.isEmpty ? pageCursor : cursor, current.isEmpty)
    }
}

/// Holds on a sub-agent's conversation per machine connection. The machine keeps one hold per connection, so the
/// last page on this device that lets go is the only one that tells it.
@MainActor
enum SubagentWatches {
    private static var counts: [String: Int] = [:]

    static func key(_ client: any MachineRequesting, chatID: String, toolUseID: String) -> String {
        "\(ObjectIdentifier(client).hashValue)\n\(chatID)\n\(toolUseID)"
    }

    static func acquire(_ key: String) { counts[key, default: 0] += 1 }

    /// Whether this was the last hold on the conversation.
    static func release(_ key: String) -> Bool {
        let next = (counts[key] ?? 1) - 1
        counts[key] = next > 0 ? next : nil
        return next <= 0
    }
}

/// Keeps a paged subagent conversation current across updates and reconnects.
@MainActor @Observable
final class SubagentConversation {
    enum Status { case loading, ready, failed }
    enum Change {
        case replaced([ChatItem])
        case updated([ChatItem])
        case prepended([ChatItem])
    }

    static let pageSize = 60

    private(set) var status = Status.loading
    private(set) var items: [ChatItem] = []
    private(set) var cursor: String?
    private(set) var live = false
    private(set) var loadingEarlier = false
    private(set) var error: String?
    /// The requests of a delegated chat that still wait, answered in that chat, which `delegatedChat` names.
    private(set) var pending: [ChatItem] = []
    private(set) var delegatedChat: (chatID: String, provider: String)?
    @ObservationIgnored var onChange: (Change) -> Void = { _ in }
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private let chatID: String
    @ObservationIgnored private let toolUseID: String
    @ObservationIgnored private let limit: Int
    // Only the event and the link: the watch is a flag of the read itself, counted by `SubagentWatches`, and the
    // reads wait in their own queue.
    @ObservationIgnored private lazy var feed = LiveResource(
        client: client,
        events: [
            .apply(.chatSubagentChanged, as: ChatSubagentChangedEvent.self) { [weak self] event in
                guard let self, event.chatId == chatID, event.toolUseId == toolUseID else { return }
                refresh()
            }
        ],
        connection: { [weak self] connected in
            guard let self, connected else { return }
            enqueue { await self.readNewest(watch: true) }
        })
    @ObservationIgnored private var queue: Task<Void, Never>?
    @ObservationIgnored private var refreshWaiting = false
    @ObservationIgnored private var earlierWaiting = false
    /// A page that failed is not asked for again on its own; a scroll would ask on every frame.
    @ObservationIgnored private var failedCursor: String?
    @ObservationIgnored private var holding = false

    init(client: any MachineRequesting, chatID: String, toolUseID: String, limit: Int = SubagentConversation.pageSize) {
        self.client = client
        self.chatID = chatID
        self.toolUseID = toolUseID
        self.limit = limit
    }

    private var watchKey: String { SubagentWatches.key(client, chatID: chatID, toolUseID: toolUseID) }

    func start() {
        guard !feed.isStarted else { return }
        holding = true
        SubagentWatches.acquire(watchKey)
        feed.start()
    }

    func stop() {
        feed.stop()
        queue?.cancel()
        earlierWaiting = false
        guard holding else { return }
        holding = false
        guard SubagentWatches.release(watchKey) else { return }
        let payload = JSONValue.object([
            "chatId": .string(chatID), "toolUseId": .string(toolUseID), "limit": .number(1), "watch": .bool(false),
        ])
        Task { [client] in _ = try? await client.request(.chatSubagent, payload: payload) }
    }

    /// The newest page again; calls that arrive while one waits become that one.
    func refresh() {
        guard !refreshWaiting else { return }
        refreshWaiting = true
        enqueue {
            self.refreshWaiting = false
            await self.readNewest(watch: false)
        }
    }

    /// The page before; calls that arrive while one waits or runs become that one, since a scroll asks on every frame.
    func loadEarlier() {
        guard cursor != nil, cursor != failedCursor, !earlierWaiting else { return }
        earlierWaiting = true
        enqueue {
            defer { self.earlierWaiting = false }
            guard let cursor = self.cursor else { return }
            self.loadingEarlier = true
            defer { self.loadingEarlier = false }
            do {
                let page = try await self.ask(cursor: cursor, limit: Self.pageSize, watch: nil)
                guard !Task.isCancelled else { return }
                let older = page.items
                self.items = older + self.items
                self.readPending(page)
                self.cursor = page.history.cursor
                self.live = page.live
                self.onChange(.prepended(older))
            } catch let error as MachineClientError where error.code == .historyExpired {
                // The record was written again under this page; what it holds now is the only truth.
                self.items = []
                self.cursor = nil
                await self.readNewest(watch: false)
            } catch is CancellationError {
            } catch {
                self.failedCursor = cursor
                self.error = error.localizedDescription
            }
        }
    }

    private func readNewest(watch: Bool) async {
        do {
            let page = try await ask(cursor: nil, limit: limit, watch: watch ? true : nil)
            guard !Task.isCancelled, holding else { return }
            let incoming = page.items
            let previous = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
            let merged = ChatSubagents.mergeNewest(
                current: items, cursor: cursor, page: incoming, pageCursor: page.history.cursor)
            items = merged.items
            cursor = merged.cursor
            readPending(page)
            live = page.live
            status = .ready
            error = nil
            failedCursor = nil
            if merged.replaced {
                onChange(.replaced(items))
            } else {
                onChange(.updated(incoming.filter { previous[$0.id] != $0 }))
            }
        } catch is CancellationError {
        } catch {
            if status == .ready, error as? MachineClientError == .disconnected { return }
            status = .failed
            self.error = error.localizedDescription
        }
    }

    private func ask(cursor: String?, limit: Int, watch: Bool?) async throws -> ChatSubagentPage {
        var payload: [String: JSONValue] = [
            "chatId": .string(chatID), "toolUseId": .string(toolUseID), "limit": .number(Double(limit)),
        ]
        if let cursor { payload["cursor"] = .string(cursor) }
        if let watch { payload["watch"] = .bool(watch) }
        return try await client.request(.chatSubagent, payload: .object(payload))
            .decoded(as: ChatSubagentPage.self)
    }

    /// Only a delegated chat answers its own requests; a request still waiting stays answerable after it left the
    /// newest page, which is why the machine names them apart.
    private func readPending(_ page: ChatSubagentPage) {
        let chatID = page.context?.chatId
        let next = chatID.map { (chatID: $0, provider: page.context?.provider ?? "") }
        if next?.chatID != delegatedChat?.chatID || next?.provider != delegatedChat?.provider { delegatedChat = next }
        let listed = page.pending?.arrayValue.map { $0.compactMap { try? $0.decoded(as: ChatItem.self) } }
        let waiting = chatID == nil ? [] : listed ?? items.filter(\.isPending)
        if waiting != pending { pending = waiting }
    }

    private func enqueue(_ work: @escaping @MainActor () async -> Void) {
        let previous = queue
        queue = Task { @MainActor in
            await previous?.value
            guard !Task.isCancelled else { return }
            await work()
        }
    }
}
