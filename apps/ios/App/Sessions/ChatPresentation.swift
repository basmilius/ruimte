import Foundation
import Observation
import RuimtePulsar

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
    enum Kind: Equatable { case message, tools, activity, turnFold, turnStart, changedFiles, subagent }
    let id: String
    let kind: Kind
    var items: [ChatItemState] = []

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.kind == rhs.kind
            && lhs.items.map(ObjectIdentifier.init) == rhs.items.map(ObjectIdentifier.init)
    }
}

@MainActor @Observable
final class ChatPresentation {
    private(set) var entries: [ChatTimelineEntry] = []
    private(set) var revision = 0
    private(set) var info: JSONValue = .null
    private(set) var connected = false
    private(set) var startedAt: Double?
    private(set) var activityLabel = "Working for"
    private(set) var isAnimating = false
    @ObservationIgnored private var order: [String] = []
    @ObservationIgnored private var records: [String: ChatItemState] = [:]
    private(set) var expandedTurns: Set<String> = []
    private(set) var expandedSubagents: Set<String> = []
    private(set) var requestedItemID: String?
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
        activityLabel = !connected ? "Connection lost" : blocked ? "Waiting for you" : "Working for"
        isAnimating = connected && !blocked && nextID != nil
    }

    func toggleTurn(_ id: String) {
        if !expandedTurns.insert(id).inserted { expandedTurns.remove(id) }
        rebuild()
    }

    func toggleSubagent(_ id: String) {
        if !expandedSubagents.insert(id).inserted { expandedSubagents.remove(id) }
    }

    func openSubagent(toolUseID: String) {
        guard
            let agent = records.values.first(where: {
                $0.value.text("kind") == "subagent" && $0.value.text("toolUseId") == toolUseID
            })
        else { return }
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
            let folded = work.filter { $0 !== final && $0.value.text("kind") != "note" }
            if !rowsFor(folded, children: children).isEmpty {
                rows.append(ChatTimelineEntry(id: "fold-\(turnID)", kind: .turnFold, items: [turn]))
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
            if let final { rows.append(ChatTimelineEntry(id: final.id, kind: .message, items: [final])) }
            rows += rowsFor(notices, children: children)
        }
        if let activeID { rows.append(ChatTimelineEntry(id: "working-\(activeID)", kind: .activity)) }
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
            if kind == "tool" && value.text("state") != "running" {
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

    static func turnLabel(_ item: JSONValue) -> String {
        let duration = ChatToolPresentation.elapsed(
            item.number("endedAt", fallback: item.number("createdAt")) - item.number("createdAt"))
        switch item.text("state") {
        case "error": return "Failed after \(duration)"
        case "aborted": return "You stopped after \(duration)"
        default: return "Worked for \(duration)"
        }
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
        default: keys = ["description", "command", "cmd", "path", "file_path", "query"]
        }
        return keys.compactMap { input[$0]?.stringValue }.first ?? item["progress"]?.text("description") ?? ""
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
        return seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(seconds % 60)s"
    }

    static func tail(_ item: JSONValue) -> String {
        let output = item["progress"]?.text("output") ?? ""
        return String(output.suffix(4000)).split(separator: "\n", omittingEmptySubsequences: false).suffix(12).joined(
            separator: "\n")
    }

    static func groupLabel(_ items: [JSONValue]) -> String {
        let names = Set(items.map { $0.text("name") })
        guard names.count == 1, let name = names.first else { return "\(items.count) tool calls" }
        let action: (String, String)
        switch name {
        case "Read": action = ("Read", "file")
        case "Edit", "MultiEdit", "ApplyPatch": action = ("Edited", "file")
        case "Write": action = ("Wrote", "file")
        case "Bash": action = ("Ran", "command")
        case "Grep": action = ("Searched", "pattern")
        case "Glob": action = ("Listed", "pattern")
        default: action = (name, "call")
        }
        return "\(action.0) \(items.count) \(action.1)\(items.count == 1 ? "" : "s")"
    }
}
