import Foundation
import Observation
import RuimtePulsar
import RuimteIntelligentUI

@MainActor @Observable
final class ChatItemState: Identifiable {
    let id: String
    var value: JSONValue

    init(_ value: JSONValue) {
        id = value.text("id")
        self.value = value
    }
}

struct ChatTimelineEntry: Identifiable, Equatable {
    enum Kind: Equatable { case message, tools, activity, turnFold, turnStart, changedFiles, subagent, forks, visual }
    let id: String
    let kind: Kind
    var items: [ChatItemState] = []
    var visual: ChatVisual?

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.kind == rhs.kind
            && lhs.items.map(ObjectIdentifier.init) == rhs.items.map(ObjectIdentifier.init) && lhs.visual == rhs.visual
    }
}

@MainActor @Observable
final class ChatPresentation {
    private(set) var entries: [ChatTimelineEntry] = []
    private(set) var revision = 0
    private(set) var info: JSONValue = .null
    private(set) var connected = false
    private(set) var startedAt: Double?
    private(set) var activityLabel = String(localized: "Working for", comment: "Followed by a running clock")
    private(set) var isAnimating = false
    @ObservationIgnored private var order: [String] = []
    @ObservationIgnored private var records: [String: ChatItemState] = [:]
    private(set) var expandedTurns: Set<String> = []
    private(set) var expandedSubagents: Set<String> = []
    private(set) var requestedItemID: String?
    /// A subagent row asked to open its conversation; the screen that shows this timeline pushes it.
    var conversationRequest: SubagentCrumb?
    /// The machine answered that it cannot read a subagent's conversation, so only rows with a pointer open.
    var subagentsRefused = false
    /// Whether this is a chat's own thread, which can fork; a sub-agent's thread in its place cannot.
    @ObservationIgnored var forkable = false
    /// A row asked to fork after this turn; the screen shows the fork sheet.
    var forkRequest: ChatForkRequest?
    /// A row asked to open another chat of the project (a summary's fork); the screen pushes it.
    var openRequest: String?
    /// The forks this device knows of per turn, for the line under the turn.
    private(set) var forks: [String: [String]] = [:]
    var places: ChatPlaces?
    /// The messages a person marked, by item id, as the machine last said.
    private(set) var bookmarks: [String: ChatBookmark] = [:]
    /// A row asked to place, name or take away a bookmark; the screen carries it out.
    var bookmarkRequest: ChatBookmarkRequest?
    /// The pages agents published in the chat, as the machine last said.
    private(set) var visuals: [ChatVisual] = []
    /// A card asked to open its visual large or to remove it; the screen carries it out.
    var visualRequest: ChatVisualRequest?
    @ObservationIgnored let visualPages = ChatVisualPages()
    /// Whether the machine holds a page of the thread before the first item here, which a visual from before that
    /// item waits for.
    @ObservationIgnored var earlierPageWaits = false
    /// The timeline entries on screen, answered by the timeline while it is there.
    @ObservationIgnored var visibleEntryIDs: () -> [String] = { [] }
    private(set) var scrollRequest = 0
    @ObservationIgnored private var activeID: String?
    @ObservationIgnored private var historyBoundaries = Set<String>()

    func replace(_ values: [JSONValue], info: JSONValue) {
        records = [:]
        order = []
        historyBoundaries = []
        expandedTurns = []
        expandedSubagents = []
        for value in values where !value.stableID.isEmpty {
            if records[value.stableID] == nil { order.append(value.stableID) }
            records[value.stableID] = ChatItemState(value)
        }
        self.info = info
        refreshActivity()
        rebuild()
    }

    func prepend(_ values: [JSONValue]) {
        if let first = order.first { historyBoundaries.insert(first) }
        let visibleTurns = Set(records.values.compactMap { $0.value["turnId"]?.stringValue })
        for value in values where value.text("kind") == "turn" {
            if let turn = value["turnId"]?.stringValue, visibleTurns.contains(turn) {
                expandedTurns.insert(turn)
            }
        }
        var older: [String] = []
        for value in values where !value.stableID.isEmpty && records[value.stableID] == nil {
            records[value.stableID] = ChatItemState(value)
            older.append(value.stableID)
        }
        order = older + order
        rebuild()
    }

    func setInfo(_ info: JSONValue) {
        self.info = info
        refreshActivity()
        rebuild()
    }

    func setConnected(_ connected: Bool) {
        self.connected = connected
        refreshActivity()
        rebuild()
    }

    func upsert(_ value: JSONValue, textOnly: Bool = false) {
        let id = value.stableID
        guard !id.isEmpty else { return }
        if let record = records[id] {
            record.value = value
            if textOnly { return }
        } else {
            records[id] = ChatItemState(value)
            order.append(id)
        }
        refreshActivity()
        rebuild()
    }

    private func refreshActivity() {
        let nextID = info["activeTurnId"]?.stringValue
        if activeID != nextID {
            activeID = nextID
            startedAt = nextID == nil ? nil : Date.now.timeIntervalSince1970 * 1000
        }
        if let nextID,
            let turn = order.compactMap({ records[$0]?.value }).first(where: {
                $0.text("kind") == "turn" && ($0.text("turnId") == nextID || $0.stableID == nextID)
            })
        {
            startedAt = turn["createdAt"]?.numberValue ?? startedAt
        }
        let blocked = records.values.contains {
            let value = $0.value
            return (value.text("kind") == "approval" && value.text("decision") == "pending")
                || (value.text("kind") == "question" && value.text("state") == "pending"
                    && value["async"]?.boolValue != true)
        }
        activityLabel =
            !connected
            ? String(localized: "Connection lost")
            : blocked
                ? String(localized: "Waiting for you")
                : String(localized: "Working for", comment: "Followed by a running clock")
        isAnimating = connected && !blocked && nextID != nil
    }

    func item(_ id: String) -> JSONValue? { records[id]?.value }

    var values: [JSONValue] { order.compactMap { records[$0]?.value } }

    /// The last turn that ended, which is where a fork from the conversation menu goes on after. Read from the end,
    /// since the screen asks on every render.
    var lastSettledTurnID: String? {
        for id in order.reversed() {
            if let value = records[id]?.value, value.text("kind") == "turn", value.text("state") != "running" {
                return value.stableID
            }
        }
        return nil
    }

    func setForks(_ forks: [String: [String]]) {
        guard forks != self.forks else { return }
        self.forks = forks
        rebuild()
    }

    func forkRefusal(turnID: String) -> String? {
        ChatForking.refusal(info: info, turn: records[turnID]?.value)
    }

    /// Scrolls the timeline to an entry, as the message index asks.
    func reveal(entryID: String) {
        requestedItemID = entryID
        scrollRequest += 1
    }

    /// Scrolls to a message, unfolding the turn that hides it. False while the message is not loaded.
    func revealItem(_ id: String) -> Bool {
        guard let record = records[id] else { return false }
        if !entries.contains(where: { $0.id == id }), let turnID = record.value["turnId"]?.stringValue {
            expandedTurns.insert(turnID)
            rebuild()
        }
        reveal(entryID: id)
        return true
    }

    func setVisuals(_ visuals: [ChatVisual]) {
        guard visuals != self.visuals else { return }
        self.visuals = visuals
        rebuild()
    }

    func setBookmarks(_ bookmarks: [ChatBookmark]) {
        let next = Dictionary(bookmarks.map { ($0.itemID, $0) }, uniquingKeysWith: { first, _ in first })
        if next != self.bookmarks { self.bookmarks = next }
    }

    /// The bookmarks in the order of the thread; one on a message this device has not loaded goes last.
    var orderedBookmarks: [ChatBookmark] {
        ChatBookmarks.inThreadOrder(Array(bookmarks.values), order: order)
    }

    func toggleTurn(_ id: String) {
        if !expandedTurns.insert(id).inserted { expandedTurns.remove(id) }
        rebuild()
    }

    func toggleSubagent(_ id: String) {
        if !expandedSubagents.insert(id).inserted { expandedSubagents.remove(id) }
    }

    /// The row of the sub-agent a call opened; a view that reads its value follows it as it changes.
    func subagent(toolUseID: String) -> ChatItemState? {
        records.values.first { $0.value.text("kind") == "subagent" && $0.value.text("toolUseId") == toolUseID }
    }

    func openSubagent(toolUseID: String) {
        guard let agent = subagent(toolUseID: toolUseID) else { return }
        expandedSubagents.insert(agent.id)
        requestedItemID = agent.id
        scrollRequest += 1
        if let turnID = agent.value["turnId"]?.stringValue { expandedTurns.insert(turnID) }
        rebuild()
    }

    private func rebuild() {
        let all = order.compactMap { records[$0] }
        let children = Dictionary(grouping: all.filter { Self.parent($0.value) != nil }) { Self.parent($0.value)! }
        var chunks: [(String?, [ChatItemState])] = []
        var positions: [String: Int] = [:]
        for item in all {
            if let turnID = item.value["turnId"]?.stringValue {
                if let index = positions[turnID] {
                    chunks[index].1.append(item)
                } else {
                    positions[turnID] = chunks.count
                    chunks.append((turnID, [item]))
                }
            } else if chunks.last?.0 == nil && !chunks.isEmpty {
                chunks[chunks.count - 1].1.append(item)
            } else {
                chunks.append((nil, [item]))
            }
        }
        var rows: [ChatTimelineEntry] = []
        for (turnID, items) in chunks {
            guard let turnID, let turn = items.first(where: { $0.value.text("kind") == "turn" }) else {
                rows += rowsFor(items, children: children)
                continue
            }
            if turn.value.text("origin") == "agent" {
                rows.append(ChatTimelineEntry(id: "start-\(turnID)", kind: .turnStart, items: [turn]))
            }
            rows += rowsFor(items.filter { $0.value.text("kind") == "user" }, children: children)
            let work = items.filter { !["user", "turn"].contains($0.value.text("kind")) }
            if turnID == activeID || turn.value.text("state") == "running" {
                rows += rowsFor(work, children: children)
                continue
            }
            let final = work.last { $0.value.text("kind") == "assistant" && Self.parent($0.value) == nil }
            let notices = work.filter { $0.value.text("kind") == "note" }
            let images = work.filter { UiGeneratedImage.isGeneration($0.value) && Self.parent($0.value) == nil }
            let imageIDs = Set(images.map(\.id))
            let folded = work.filter { $0 !== final && $0.value.text("kind") != "note" && !imageIDs.contains($0.id) }
            if !rowsFor(folded, children: children).isEmpty {
                let tools = work.filter {
                    $0.value.text("kind") == "tool" && Self.parent($0.value) == nil
                        && ChatSubagents.handbackReport($0.value) == nil
                }
                rows.append(ChatTimelineEntry(id: "fold-\(turnID)", kind: .turnFold, items: [turn] + notices + tools))
                if expandedTurns.contains(turnID) { rows += rowsFor(folded, children: children) }
            }
            let edits = work.filter {
                $0.value.text("kind") == "tool" && $0.value.text("state") == "done"
                    && ChatFileChanges.hasChanges($0.value)
            }
            let diff = turn.value["checkpointDiff"]
            if (diff?.list("files").isEmpty == false)
                || (diff == nil && (!edits.isEmpty || turn.value["checkpoint"]?.stringValue != nil))
            {
                rows.append(ChatTimelineEntry(id: "files-\(turnID)", kind: .changedFiles, items: [turn] + edits))
            }
            rows += rowsFor(images, children: children)
            if let final { rows.append(ChatTimelineEntry(id: final.id, kind: .message, items: [final])) }
            rows += rowsFor(notices, children: children)
            if forks[turnID]?.isEmpty == false {
                rows.append(ChatTimelineEntry(id: "forks-\(turnID)", kind: .forks, items: [turn]))
            }
        }
        if let activeID { rows.append(ChatTimelineEntry(id: "working-\(activeID)", kind: .activity)) }
        let heldFrom = earlierPageWaits ? order.first.flatMap { records[$0]?.value["createdAt"]?.numberValue } : nil
        rows = ChatVisuals.placed(rows, visuals: visuals, heldFrom: heldFrom)
        guard rows != entries else { return }
        entries = rows
        revision += 1
    }

    private static func parent(_ value: JSONValue) -> String? {
        ["assistant", "tool"].contains(value.text("kind")) ? value["parentToolUseId"]?.stringValue : nil
    }

    private func rowsFor(_ items: [ChatItemState], children: [String: [ChatItemState]]) -> [ChatTimelineEntry] {
        var rows: [ChatTimelineEntry] = []
        for item in items {
            let value = item.value
            let kind = value.text("kind")
            if Self.parent(value) != nil || kind == "turn" { continue }
            if kind == "approval" && value.text("decision") == "pending" { continue }
            if kind == "question" && value.text("state") == "pending" { continue }
            // A subagent's `SubagentHandback` call reads as the report it carries rather than as a tool call.
            if kind == "tool" && value.text("state") != "running" && ChatSubagents.handbackReport(value) == nil && !UiGeneratedImage.isGeneration(value) {
                if rows.last?.kind == .tools && !historyBoundaries.contains(item.id) {
                    rows[rows.count - 1].items.append(item)
                } else {
                    rows.append(ChatTimelineEntry(id: "tools-\(item.id)", kind: .tools, items: [item]))
                }
            } else if kind == "subagent" {
                rows.append(
                    ChatTimelineEntry(
                        id: item.id, kind: .subagent, items: [item] + (children[value.text("toolUseId")] ?? [])))
            } else {
                rows.append(ChatTimelineEntry(id: item.id, kind: .message, items: [item]))
            }
        }
        return rows
    }

    /// The notes of the turn tell a turn a person stopped from one the machine ended after a restart.
    static func turnLabel(_ item: JSONValue, items: [JSONValue] = []) -> String {
        let duration = ChatToolPresentation.elapsed(
            item.number("endedAt", fallback: item.number("createdAt")) - item.number("createdAt"))
        switch item.text("state") {
        case "error": return String(localized: "Failed after \(duration)")
        case "aborted":
            return abortedByMachine(item, items: items)
                ? String(localized: "Stopped after \(duration)") : String(localized: "You stopped after \(duration)")
        default: return String(localized: "Worked for \(duration)")
        }
    }

    // The daemon's warning note in a turn it could not resume, `notResumedNote` in the contracts.
    private static let notResumedPrefix = "This turn could not be resumed after the machine restarted: "

    static func abortedByMachine(_ turn: JSONValue, items: [JSONValue]) -> Bool {
        let turnID = turn.text("turnId", fallback: turn.stableID)
        return turn.text("state") == "aborted"
            && items.contains {
                $0.text("kind") == "note" && $0.text("turnId") == turnID && $0.text("level") == "warning"
                    && $0.text("text").hasPrefix(notResumedPrefix)
            }
    }

    /// The header of a turn the chat did not start from a person's message.
    static func agentTurnLabel(_ turn: JSONValue) -> String {
        let label = turn.text("label")
        let tasks = turn.list("taskIds").count
        if tasks > 0 {
            // A turn the machine opened with the results of tasks this chat gave; the label is their titles.
            return label.isEmpty
                ? String(localized: "Woken by \(tasks) tasks") : String(localized: "Woken by \(tasks) tasks: \(label)")
        }
        return label.isEmpty
            ? String(localized: "Continued on its own") : String(localized: "Sub-agent finished: \(label)")
    }

}

enum ChatToolPresentation {
    static func summary(_ item: JSONValue) -> String {
        let input = item["input"] ?? .null
        let keys: [String]
        switch item.text("name") {
        case "Bash": keys = ["description", "command"]
        case "Read", "Edit", "Write", "MultiEdit", "NotebookEdit": keys = ["file_path", "notebook_path"]
        case "Grep", "Glob": keys = ["pattern"]
        case "WebFetch", "WebSearch": keys = ["url", "query"]
        case "Task", "Agent": keys = ["description"]
        case "Skill": keys = ["skill"]
        default:
            // A tool nobody named shows whatever string it was called with, as chat/logic/tools.ts does. That reads
            // the input in the order the CLI wrote it; a decoded object has no order, so the keys decide instead.
            keys = (input.objectValue ?? [:]).keys.sorted()
        }
        return keys.compactMap { input[$0]?.stringValue }.first ?? ""
    }

    static func icon(_ name: String) -> String {
        switch name {
        case "Read": "file-text"
        case "Edit", "Write", "MultiEdit", "ApplyPatch": "file-pen"
        case "Grep", "Glob": "search"
        case "WebFetch", "WebSearch": "globe"
        case "Task", "Agent": "bot"
        case "Skill": "sparkles"
        default: "terminal"
        }
    }

    static func elapsed(_ milliseconds: Double) -> String {
        let seconds = max(0, Int(milliseconds / 1000))
        if seconds < 60 {
            return String(localized: "\(seconds)s", comment: "Duration in seconds, abbreviated")
        }
        let rest = seconds % 60
        return rest == 0
            ? String(localized: "\(seconds / 60)m", comment: "Duration in minutes, abbreviated")
            : String(localized: "\(seconds / 60)m \(rest)s", comment: "Duration in minutes and seconds, abbreviated")
    }

    static func tail(_ item: JSONValue) -> String {
        let output = item["progress"]?.text("output") ?? ""
        return String(output.suffix(4000)).split(separator: "\n", omittingEmptySubsequences: false).suffix(12).joined(
            separator: "\n")
    }

    /// What a folded turn did, a sentence per kind of call in the order it first came, as `summarizeTurn` in
    /// `chat/logic/timeline.ts` writes it: every file change is one sentence, calls without one are counted last.
    static func turnSummary(_ tools: [JSONValue]) -> [String] {
        var order: [String] = []
        var counts: [String: Int] = [:]
        var edited = Set<String>()
        var other = 0
        for tool in tools {
            let name = tool.text("name")
            let key: String
            if fileChanges.contains(name) {
                edited.insert(tool["input"]?["file_path"]?.stringValue ?? tool.stableID)
                key = "edited"
            } else if sentenceNames.contains(name) {
                key = name
            } else {
                other += 1
                continue
            }
            if counts[key] == nil { order.append(key) }
            counts[key, default: 0] += 1
        }
        var parts = order.map { key in
            key == "edited" ? String(localized: "Edited \(edited.count) files") : sentence(key, count: counts[key] ?? 0)
        }
        if other > 0 {
            parts.append(
                parts.isEmpty
                    ? String(localized: "\(other) tool calls") : String(localized: "\(other) other tool calls"))
        }
        return parts
    }

    private static let fileChanges: Set<String> = ["Edit", "Write", "MultiEdit", "ApplyPatch"]

    private static let sentenceNames: Set<String> = [
        "Read", "NotebookEdit", "Bash", "Grep", "Glob", "WebFetch", "WebSearch", "Task", "Agent", "Skill", "TodoWrite",
    ]

    // The sentences of `chat:group.tools` in the client's English locale.
    private static func sentence(_ name: String, count: Int) -> String {
        switch name {
        case "Read": String(localized: "Read \(count) files")
        case "NotebookEdit": String(localized: "Edited \(count) notebooks")
        case "Bash": String(localized: "Ran \(count) commands")
        case "Grep": String(localized: "Searched \(count) patterns")
        case "Glob": String(localized: "Listed \(count) patterns")
        case "WebFetch": String(localized: "Fetched \(count) pages")
        case "WebSearch": String(localized: "Searched the web \(count) queries")
        case "Task", "Agent": String(localized: "Delegated \(count) tasks")
        case "Skill": String(localized: "Used \(count) skills")
        case "TodoWrite": String(localized: "Updated \(count) plans")
        default: String(localized: "\(count) tool calls")
        }
    }

    static func groupLabel(_ items: [JSONValue]) -> String {
        let names = Set(items.map { $0.text("name") })
        let count = items.count
        guard names.count == 1, let name = names.first else { return String(localized: "\(count) tool calls") }
        switch name {
        case "Read": return String(localized: "Read \(count) files")
        case "Edit", "MultiEdit", "ApplyPatch": return String(localized: "Edited \(count) files")
        case "Write": return String(localized: "Wrote \(count) files")
        case "Bash": return String(localized: "Ran \(count) commands")
        case "Grep": return String(localized: "Searched \(count) patterns")
        case "Glob": return String(localized: "Listed \(count) patterns")
        default: return String(localized: "\(name) \(count) calls", comment: "%@ is the name of a tool")
        }
    }
}
