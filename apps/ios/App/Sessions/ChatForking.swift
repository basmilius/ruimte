import Foundation
import RuimtePulsar
import RuimteTransport

/// What a fork becomes: a chat node on a canvas, or a chat view of its own.
enum ChatForkShape: String, CaseIterable, Identifiable {
    case node, view
    var id: Self { self }
    var label: String { self == .node ? String(localized: "A node beside it") : String(localized: "A new view") }
}

/// Where a fork goes on after, as the sheet words it.
struct ChatForkPoint: Equatable {
    let turnID: String
    let number: Int
    let total: Int
    let last: Bool
    /// False while older history is not loaded, so the numbers would count only part of the conversation.
    let counted: Bool
    let prompt: String?

    var label: String {
        let place =
            last
            ? String(localized: "After the last turn")
            : counted ? String(localized: "After turn \(number) of \(total)") : String(localized: "After this turn")
        guard let prompt else { return place }
        let short = prompt.count > 60 ? String(prompt.prefix(57)) + "..." : prompt
        return String(
            localized: "\(place): \"\(short)\"", comment: "Where a fork goes on, then the prompt of that turn")
    }
}

/// A message the person sent, or a turn the machine opened with the results of tasks: the places the message
/// index jumps to.
struct ChatMessageMark: Identifiable, Equatable {
    enum Kind: Equatable { case person, wake }
    /// The timeline entry the index scrolls to.
    let id: String
    let kind: Kind
    let text: String
    let createdAt: Double
    let turnID: String?
}

/// The fork rules of the desktop client, kept apart from the views so they can be tested.
///
/// The desktop client reads the same English sentences as the refusals below from `fork.refusal.*`, `fork.point.*` and
/// `fork.branch.*` in `apps/client/src/i18n/locales/en/chat.json`, and nothing holds the two together: a change to one
/// of those keys has to be made here by hand.
enum ChatForking {
    /// Whether a machine can fork this CLI's conversation and go on with it in a fork. Every kind the daemon knows is
    /// answered here, so a CLI added to `AgentKindSchema` is decided on before it is offered a fork.
    static func forkable(_ kind: AgentKind) -> Bool {
        switch kind {
        case .claude, .codex: true
        case .gemini, .copilot, .apple: false
        }
    }

    /// A CLI this app does not know is not forkable; only a machine that knows it can say what it can do.
    static func forkable(provider: String) -> Bool { AgentKind(rawValue: provider).map(forkable) ?? false }
    static let titleMax = 120

    /// Why a chat cannot be forked after this turn right now, or nil when it can.
    static func refusal(info: JSONValue, turn: JSONValue?) -> String? {
        guard info != .null, let turn, turn.text("kind") == "turn" else {
            return String(localized: "This turn is not in the conversation")
        }
        guard forkable(provider: info.text("provider")) else {
            return String(localized: "This CLI has no conversation that can be forked")
        }
        guard info["agentSessionId"]?.stringValue != nil else {
            return String(localized: "The CLI never started a conversation here")
        }
        if turn.text("state") == "running" || info["activeTurnId"]?.stringValue != nil {
            return String(localized: "Wait for the turn to end")
        }
        return nil
    }

    /// Why a fork cannot write a summary for its original right now, or nil when it can.
    static func summaryRefusal(info: JSONValue, originalPresent: Bool) -> String? {
        if !originalPresent { return String(localized: "The original is no longer in this project") }
        if info["activeTurnId"]?.stringValue != nil { return String(localized: "Wait for the turn to end") }
        return nil
    }

    static func turns(_ items: [JSONValue]) -> [JSONValue] { items.filter { $0.text("kind") == "turn" } }

    static func point(items: [JSONValue], turnID: String, counted: Bool) -> ChatForkPoint? {
        let all = turns(items)
        guard let index = all.firstIndex(where: { $0.stableID == turnID }) else { return nil }
        let asked = items.first { $0.text("kind") == "user" && $0.text("turnId") == turnID }
        let text = asked?.text("text") ?? all[index].text("label")
        let prompt = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty }
        return ChatForkPoint(
            turnID: turnID, number: index + 1, total: all.count, last: index == all.count - 1, counted: counted,
            prompt: prompt)
    }

    /// The shapes the sheet offers, the default first: a view forks into a view, a node into a node or a view.
    static func shapes(origin: ChatForkShape?) -> [ChatForkShape] {
        switch origin {
        case .node: [.node, .view]
        case .view: [.view]
        case nil: []
        }
    }

    /// Where and when a fork began: "Forked after turn 3, 09:24". The turn is counted only over a thread read from its
    /// start, since a later page would count from wherever the reader is; `moment` writes the time.
    static func forkLine(forkOf: JSONValue?, turnIDs: [String], complete: Bool, moment: (Double) -> String) -> String? {
        guard let forkOf, let at = forkOf["at"]?.numberValue else { return nil }
        let time = moment(at)
        if complete, let index = turnIDs.firstIndex(of: forkOf.text("turnId")) {
            return String(localized: "Forked after turn \(index + 1), \(time)")
        }
        return String(localized: "Forked at \(time)")
    }

    /// Whether a chat is a view of its own or a node on a canvas, and the name it goes by; nil when it is not in
    /// the project.
    static func origin(in views: [JSONValue], chatID: String) -> (shape: ChatForkShape, title: String)? {
        for view in views {
            if view.text("kind") == "chat" && view.stableID == chatID {
                return (.view, view.text("name", fallback: String(localized: "Chat")))
            }
            if let node = view.list("nodes").first(where: { $0.stableID == chatID && $0.text("kind") == "chat" }) {
                return (.node, node.text("title", fallback: String(localized: "Chat")))
            }
        }
        return nil
    }

    /// Why a branch cannot be the fork's, or nil when it can.
    static func branchRefusal(_ branch: String, taken: [String]) -> String? {
        let name = branch.trimmingCharacters(in: .whitespaces)
        if name.isEmpty { return String(localized: "Name the branch") }
        if taken.contains(name) { return String(localized: "A branch with this name exists already") }
        return nil
    }

    /// The `chat.fork` payload. Only what differs from the original is sent, so an older field set stays valid.
    static func payload(
        chatID: String, turnID: String, title: String, shape: ChatForkShape?, origin: ChatForkShape?,
        worktree: (branch: String, filesAfterTurn: Bool)?, original: (provider: String, selection: JSONValue),
        chosen: (provider: String, selection: JSONValue)
    ) -> JSONValue {
        var values: [String: JSONValue] = [
            "chatId": .string(chatID), "turnId": .string(turnID),
            "title": .string(String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(titleMax))),
        ]
        if shape == .view && origin == .node { values["asView"] = .bool(true) }
        let switching = chosen.provider != original.provider
        if switching { values["provider"] = .string(chosen.provider) }
        if chosen.selection != .null && (switching || chosen.selection["model"] != original.selection["model"]) {
            values["selection"] = chosen.selection
        }
        if let worktree {
            values["worktree"] = .object([
                "branch": .string(worktree.branch.trimmingCharacters(in: .whitespaces))
            ])
            if worktree.filesAfterTurn { values["filesAfterTurn"] = .bool(true) }
        }
        return .object(values)
    }

    /// The forks that go on after each turn of this chat, among the chats a machine has loaded, in the order it
    /// lists them.
    static func forks(chats: [JSONValue], chatID: String) -> [String: [String]] {
        var forks: [String: [String]] = [:]
        for chat in chats where chat["forkOf"]?.text("chatId") == chatID {
            if let turn = chat["forkOf"]?["turnId"]?.stringValue {
                forks[turn, default: []].append(chat.text("chatId"))
            }
        }
        return forks
    }

    static func forksLabel(_ count: Int) -> String {
        String(localized: "\(count) forks go on after this turn")
    }

    /// The places the message index lists, in thread order.
    @MainActor static func marks(entries: [ChatTimelineEntry]) -> [ChatMessageMark] {
        entries.compactMap { entry in
            guard let value = entry.items.first?.value else { return nil }
            if entry.kind == .message && value.text("kind") == "user" {
                // A message of only attachments still has a place; its names stand in for the text.
                let text =
                    value.text("text").isEmpty
                    ? value.list("attachments").map { $0.text("name") }.joined(separator: ", ") : value.text("text")
                return ChatMessageMark(
                    id: entry.id, kind: .person, text: text, createdAt: value.number("createdAt"),
                    turnID: value["turnId"]?.stringValue)
            }
            if entry.kind == .turnStart && !value.list("taskIds").isEmpty {
                return ChatMessageMark(
                    id: entry.id, kind: .wake, text: ChatPresentation.agentTurnLabel(value),
                    createdAt: value.number("createdAt"), turnID: value.stableID)
            }
            return nil
        }
    }

    /// A note that came as a summary, or any note of more than one line, shows its first line and folds the rest.
    static func noteParts(_ text: String) -> (head: String, rest: String) {
        guard let range = text.range(of: "\n") else { return (text, "") }
        return (
            String(text[..<range.lowerBound]), text[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    /// What a failed request says, with the one refusal an older machine gives its own wording, `update`.
    static func message(for error: Error, update: String) -> String {
        if case MachineClientError.server(code: "unknown-request", message: _) = error {
            return update
        }
        return error.localizedDescription
    }

    static func isUnknownRequest(_ error: Error) -> Bool {
        if case MachineClientError.server(code: "unknown-request", message: _) = error { return true }
        return false
    }
}

/// Where the chats of a project stand and how to get there, for the rows of a timeline that lead to another chat.
@MainActor
struct ChatPlaces {
    /// The name a chat goes by in the project, or nil when it is not in it.
    let title: (String) -> String?
    let shape: (String) -> ChatForkShape?
    /// Waits until a chat a machine just made is in the project, and answers whether it arrived.
    let arrival: (String) async -> Bool
}

struct ChatForkRequest: Identifiable, Equatable {
    let turnID: String
    var id: String { turnID }
}
