import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// One conversation below a chat: the call that opened it and what that call called it.
struct SubagentCrumb: Hashable, Identifiable {
    let toolUseID: String
    let description: String
    var id: String { toolUseID }

    init(_ item: JSONValue) {
        toolUseID = item.text("toolUseId")
        description = ChatSubagents.title(item)
    }
}

/// The list of a chat's sub-agents as its toolbar opens it.
struct SubagentListRoute: Hashable, Identifiable {
    let chatID: String
    var id: String { chatID }
}

/// The state a sub-agent's entry shows in front of its title.
enum SubagentStatusWord: String {
    case running, done, failed, cancelled

    var look: AgentWorkLook {
        switch self {
        case .running: .running
        case .done: .done
        case .failed: .failed
        case .cancelled: .stopped
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

    static func title(_ item: JSONValue) -> String {
        [item.text("description"), item.text("summary"), item.text("subagentType")].first { !$0.isEmpty }
            ?? "Sub-agent"
    }

    /// A row without a pointer of its own can only be opened by a machine that answers `chat.subagent` for it.
    static func canOpen(_ item: JSONValue, machineRefused: Bool) -> Bool {
        item.text("kind") == "subagent" && !item.text("toolUseId").isEmpty
            && (item["native"]?.objectValue != nil || !machineRefused)
    }

    static func openable(_ items: [JSONValue], machineRefused: Bool) -> [JSONValue] {
        items.filter { canOpen($0, machineRefused: machineRefused) }
    }

    /// The task a row stands for, whose id the daemon wrote into the row's own.
    static func taskID(_ item: JSONValue) -> String? {
        let id = item.text("id")
        return item.text("origin") == "ruimte" && id.hasPrefix("task-") ? String(id.dropFirst(5)) : nil
    }

    /// A cancelled task is a failed row on the wire, and only the task itself still says which it was.
    static func statusWord(_ item: JSONValue, task: JSONValue?) -> SubagentStatusWord {
        switch item.text("status") {
        case "running": .running
        case "done": .done
        default: task?.text("status") == "cancelled" ? .cancelled : .failed
        }
    }

    /// What of every sub-agent's own work the parent's thread kept, by the call that opened it, in thread order.
    static func threadWork(_ items: [JSONValue]) -> [String: [JSONValue]] {
        var work: [String: [JSONValue]] = [:]
        for item in items where ["tool", "assistant"].contains(item.text("kind")) {
            if let parent = item["parentToolUseId"]?.stringValue, !parent.isEmpty {
                work[parent, default: []].append(item)
            }
        }
        return work
    }

    /// Running on top and everything that settled below it, the most recently updated first in each.
    static func sections(_ items: [JSONValue], work: [String: [JSONValue]]) -> (active: [JSONValue], done: [JSONValue])
    {
        (
            newestFirst(items.filter { $0.text("status") == "running" }, work: work),
            newestFirst(items.filter { $0.text("status") != "running" }, work: work)
        )
    }

    /// When an entry last moved: the latest step the thread kept of a running one, else its start; the end of a
    /// settled one.
    private static func updatedAt(_ item: JSONValue, work: [JSONValue]) -> Double? {
        guard item.text("status") == "running" else {
            return item["finishedAt"]?.numberValue.flatMap { $0 > 0 ? $0 : nil }
        }
        let at = max(work.map { $0.number("createdAt") }.max() ?? 0, item.number("startedAt"))
        return at > 0 ? at : nil
    }

    /// Newest first; an entry that knows no time goes below the rest, in the order the thread has them.
    private static func newestFirst(_ items: [JSONValue], work: [String: [JSONValue]]) -> [JSONValue] {
        items.enumerated()
            .map {
                (
                    item: $0.element, index: $0.offset,
                    at: updatedAt($0.element, work: work[$0.element.text("toolUseId")] ?? [])
                )
            }
            .sorted { left, right in
                switch (left.at, right.at) {
                case (let l?, let r?): l == r ? left.index < right.index : l > r
                case (nil, nil): left.index < right.index
                case (nil, _): false
                case (_, nil): true
                }
            }
            .map(\.item)
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
    static func handbackReport(_ item: JSONValue) -> String? {
        guard item.text("kind") == "tool", item.text("name") == "SubagentHandback",
            let message = item["input"]?["message"]?.stringValue,
            !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return message
    }

    static func lastHandbackReport(_ items: [JSONValue]) -> String? {
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

    static func previewOfItem(_ item: JSONValue) -> SubagentPreview? {
        switch item.text("kind") {
        case "tool":
            let summary = ChatToolPresentation.summary(item)
            return .tool(name: item.text("name", fallback: "Tool"), detail: oneLine(summary))
        case "assistant":
            let text = prose(item.text("text"))
            return text.isEmpty ? nil : .text(text)
        case "subagent":
            return .tool(
                name: item.text("origin") == "ruimte" ? "Task" : "Agent", detail: oneLine(item.text("description")))
        default: return nil
        }
    }

    static func latestPreview(_ items: [JSONValue]) -> SubagentPreview? {
        items.reversed().lazy.compactMap(previewOfItem).first
    }

    /// The thread kept the beginning of a sub-agent that did too much, so only a thread that kept all of it has the
    /// latest step.
    private static func threadHasLatest(_ item: JSONValue, work: [JSONValue]) -> Bool {
        item["itemsTruncated"]?.boolValue != true && !work.isEmpty
    }

    private static func reportIsNotice(_ item: JSONValue, work: [JSONValue]) -> Bool {
        lastHandbackReport(work) == nil && isHandbackNotice(item["result"]?.stringValue ?? item["summary"]?.stringValue)
    }

    /// Whether the entry reads the newest end of the conversation from the machine: only when the parent's thread
    /// does not hold its latest step, which is a task, a Codex agent and a Claude agent past what the thread keeps.
    static func needsTail(_ item: JSONValue, work: [JSONValue], machineRefused: Bool) -> Bool {
        (item.text("status") == "running" || reportIsNotice(item, work: work))
            && !threadHasLatest(item, work: work) && canOpen(item, machineRefused: machineRefused)
    }

    static func preview(_ item: JSONValue, work: [JSONValue], tail: [JSONValue]?) -> SubagentPreview? {
        let fromThread = threadHasLatest(item, work: work) ? latestPreview(work) : nil
        let summary = item["summary"]?.stringValue ?? ""
        if item.text("status") == "running" {
            if let latest = fromThread ?? tail.flatMap(latestPreview) { return latest }
            let lastTool = item.text("lastTool")
            if !lastTool.isEmpty { return .tool(name: lastTool, detail: oneLine(summary)) }
            return summary.isEmpty ? nil : .text(oneLine(summary))
        }
        // A report handed back with `SubagentHandback` is the real one; the result then only says where it went.
        if let handedBack = lastHandbackReport(work) ?? tail.flatMap(lastHandbackReport) {
            return .text(prose(handedBack))
        }
        let result = item["result"]?.stringValue
        let notice = isHandbackNotice(result ?? item["summary"]?.stringValue)
        let report = notice ? "" : prose(result ?? "")
        if !report.isEmpty { return .text(report) }
        if let latest = fromThread ?? (notice ? tail.flatMap(latestPreview) : nil) { return latest }
        return !summary.isEmpty && !isHandbackNotice(summary) ? .text(oneLine(summary)) : nil
    }

    /// While the chat's turn runs that turn may still wait on a subagent of the CLI's own, so stopping the turn is the
    /// only offer then.
    static func stop(_ item: JSONValue, turnRunning: Bool) -> SubagentStop? {
        guard item.text("status") == "running" else { return nil }
        if item.text("origin") == "ruimte" { return item["childId"]?.stringValue == nil ? nil : .task }
        return turnRunning ? nil : .mark
    }

    /// How long an entry has run: the seconds and minutes a running tool call shows, and hours past one.
    static func runningFor(_ milliseconds: Double) -> String {
        let hour = 3_600_000.0
        guard milliseconds >= hour else { return ChatToolPresentation.elapsed(milliseconds) }
        let hours = Int(milliseconds / hour)
        let minutes = Int(milliseconds.truncatingRemainder(dividingBy: hour) / 60_000)
        return minutes == 0 ? "\(hours)h" : "\(hours)h \(minutes)m"
    }

    /// The time on the right of an entry: how long it has run so far, or when it ended, with the date once that was
    /// not today.
    static func entryTime(
        _ item: JSONValue, task: JSONValue?, now: Date, calendar: Calendar = .current, locale: Locale = .current
    ) -> String? {
        // A task's own record says when it was given and settled; the row copies those, but may lag behind it.
        let startedAt = task?["createdAt"]?.numberValue ?? item.number("startedAt")
        let finishedAt = task?["settledAt"]?.numberValue ?? item["finishedAt"]?.numberValue
        if item.text("status") == "running" {
            return startedAt > 0 ? runningFor(now.timeIntervalSince1970 * 1000 - startedAt) : nil
        }
        guard let finishedAt, finishedAt > 0 else { return nil }
        let end = Date(timeIntervalSince1970: finishedAt / 1000)
        var clock = Date.FormatStyle(date: .omitted, time: .shortened, locale: locale)
        clock.calendar = calendar
        clock.timeZone = calendar.timeZone
        if calendar.isDate(end, inSameDayAs: now) { return end.formatted(clock) }
        var day = Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale)
        day.calendar = calendar
        day.timeZone = calendar.timeZone
        return "\(end.formatted(day)) \(end.formatted(clock))"
    }

    static func stopsTaskWarning(_ agents: Int) -> String {
        "Ends the agent working on this task and cancels the task without waking the chat that gave it. Its node "
            + "stays on the canvas." + (agents == 0 ? "" : " " + endsAgentsWarning(agents))
    }

    static func stopsSubagentsWarning(_ agents: Int) -> String {
        "Stops the turn and marks the chat's own sub-agents as stopped. " + endsAgentsWarning(agents)
    }

    static func endsAgentsWarning(_ agents: Int) -> String {
        agents == 1
            ? "Also ends the agent it opened. Its node stays on the canvas with what it did so far."
            : "Also ends the \(agents) agents it opened. Their nodes stay on the canvas with what they did so far."
    }

    /// The live agents these nodes opened, counted once. A machine that does not know the question counts none.
    @MainActor static func agentsEnded(with nodeIDs: [String], client: any MachineRequesting) async -> Int {
        var ended = Set<String>()
        for nodeID in nodeIDs {
            let result = try? await client.request("agent.children", payload: .object(["nodeId": .string(nodeID)]))
            for id in result?.list("nodeIds").compactMap(\.stringValue) ?? [] { ended.insert(id) }
        }
        return ended.subtracting(nodeIDs).count
    }

    /// The newest page laid over what is held. A page that shares nothing with it means more happened than one page
    /// holds, so what is held is dropped for it rather than shown with a hole.
    static func mergeNewest(current: [JSONValue], cursor: String?, page: [JSONValue], pageCursor: String?)
        -> (items: [JSONValue], cursor: String?, replaced: Bool)
    {
        let known = Dictionary(
            current.enumerated().map { ($0.element.text("id"), $0.offset) }, uniquingKeysWith: { $1 })
        if !current.isEmpty, !page.isEmpty, !page.contains(where: { known[$0.text("id")] != nil }) {
            return (page, pageCursor, true)
        }
        var items = current
        for item in page {
            if let index = known[item.text("id")] { items[index] = item } else { items.append(item) }
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

/// One sub-agent's conversation as a page follows it: opening asks for the newest page and holds the conversation on
/// the machine, which then says whenever it grew, and each time the newest page is asked again and laid over what is
/// held. A connection that comes back holds it again.
@MainActor @Observable
final class SubagentConversation {
    enum Status { case loading, ready, failed }
    enum Change {
        case replaced([JSONValue])
        case updated([JSONValue])
        case prepended([JSONValue])
    }

    static let pageSize = 60

    private(set) var status = Status.loading
    private(set) var items: [JSONValue] = []
    private(set) var cursor: String?
    private(set) var live = false
    private(set) var loadingEarlier = false
    private(set) var error: String?
    /// The machine answered that it knows no such request, which is a machine from before sub-agent conversations.
    private(set) var unsupported = false
    @ObservationIgnored var onChange: (Change) -> Void = { _ in }
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private let chatID: String
    @ObservationIgnored private let toolUseID: String
    @ObservationIgnored private let limit: Int
    @ObservationIgnored private var subscriptions: [() -> Void] = []
    @ObservationIgnored private var queue: Task<Void, Never>?
    @ObservationIgnored private var refreshWaiting = false
    @ObservationIgnored private var holding = false

    init(client: any MachineRequesting, chatID: String, toolUseID: String, limit: Int = SubagentConversation.pageSize) {
        self.client = client
        self.chatID = chatID
        self.toolUseID = toolUseID
        self.limit = limit
    }

    private var watchKey: String { SubagentWatches.key(client, chatID: chatID, toolUseID: toolUseID) }

    func start() {
        guard subscriptions.isEmpty else { return }
        holding = true
        SubagentWatches.acquire(watchKey)
        subscriptions = [
            client.subscribe("chat.subagentChanged") { [weak self] event in
                guard let self, event.text("chatId") == chatID, event.text("toolUseId") == toolUseID else { return }
                refresh()
            },
            client.observeConnection { [weak self] connected in
                guard let self, connected else { return }
                enqueue { await self.readNewest(watch: true) }
            },
        ]
    }

    func stop() {
        subscriptions.forEach { $0() }
        subscriptions.removeAll()
        queue?.cancel()
        guard holding else { return }
        holding = false
        guard SubagentWatches.release(watchKey) else { return }
        let payload = JSONValue.object([
            "chatId": .string(chatID), "toolUseId": .string(toolUseID), "limit": .number(1), "watch": .bool(false),
        ])
        Task { [client] in _ = try? await client.request("chat.subagent", payload: payload) }
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

    func loadEarlier() {
        enqueue {
            guard let cursor = self.cursor else { return }
            self.loadingEarlier = true
            defer { self.loadingEarlier = false }
            do {
                let page = try await self.ask(cursor: cursor, limit: Self.pageSize, watch: nil)
                guard !Task.isCancelled else { return }
                let older = page.list("items")
                self.items = older + self.items
                self.cursor = page["history"]?["cursor"]?.stringValue
                self.live = page["live"]?.boolValue == true
                self.onChange(.prepended(older))
            } catch MachineClientError.server(code: "history-expired", message: _) {
                // The record was written again under this page; what it holds now is the only truth.
                self.items = []
                self.cursor = nil
                await self.readNewest(watch: false)
            } catch is CancellationError {
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func readNewest(watch: Bool) async {
        do {
            let page = try await ask(cursor: nil, limit: limit, watch: watch ? true : nil)
            guard !Task.isCancelled, holding else { return }
            let incoming = page.list("items")
            let previous = Dictionary(items.map { ($0.text("id"), $0) }, uniquingKeysWith: { $1 })
            let merged = ChatSubagents.mergeNewest(
                current: items, cursor: cursor, page: incoming, pageCursor: page["history"]?["cursor"]?.stringValue)
            items = merged.items
            cursor = merged.cursor
            live = page["live"]?.boolValue == true
            status = .ready
            error = nil
            if merged.replaced {
                onChange(.replaced(items))
            } else {
                onChange(.updated(incoming.filter { previous[$0.text("id")] != $0 }))
            }
        } catch is CancellationError {
        } catch {
            if status == .ready, error as? MachineClientError == .disconnected { return }
            if case MachineClientError.server(code: "unknown-request", message: _) = error { unsupported = true }
            status = .failed
            self.error = error.localizedDescription
        }
    }

    private func ask(cursor: String?, limit: Int, watch: Bool?) async throws -> JSONValue {
        var payload: [String: JSONValue] = [
            "chatId": .string(chatID), "toolUseId": .string(toolUseID), "limit": .number(Double(limit)),
        ]
        if let cursor { payload["cursor"] = .string(cursor) }
        if let watch { payload["watch"] = .bool(watch) }
        return try await client.request("chat.subagent", payload: .object(payload))
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
