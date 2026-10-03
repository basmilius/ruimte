import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// An approval or a question a chat waits on, as `ChatInfo.requests` summarizes it, so a card on Now shows and answers
/// it without attaching the chat.
struct NowRequest: Hashable, Identifiable {
    struct Approval: Hashable {
        let toolName: String
        let subject: String
        let description: String?
        let path: String?
        let files: Int
        /// Only the lines the change takes out and puts in, each with its `-` or `+`.
        let diff: String?
        let command: String?
        /// The diff or the command was cut short; the whole call is in the chat.
        let truncated: Bool
        let allowAlways: AllowAlways?
    }

    struct AllowAlways: Hashable {
        let label: String
        let description: String
    }

    struct Question: Hashable {
        let id: String
        let header: String
        let text: String
        let choices: [Choice]
        let multiSelect: Bool
    }

    struct Choice: Hashable {
        let label: String
        let description: String
    }

    enum Kind: Hashable {
        case approval(Approval)
        case questions([Question])
    }

    let requestID: String
    let itemID: String
    let createdAt: Double
    let kind: Kind
    var id: String { requestID }

    /// Nil for a kind this app does not know, or a summary without the part its kind needs.
    init?(_ value: JSONValue) {
        guard let requestID = value["requestId"]?.stringValue, !requestID.isEmpty else { return nil }
        self.requestID = requestID
        itemID = value.text("itemId")
        createdAt = value.number("createdAt")
        switch value.text("kind") {
        case "approval":
            guard let approval = value["approval"], approval.objectValue != nil else { return nil }
            let rule = approval["allowAlways"]
            kind = .approval(
                Approval(
                    toolName: approval.text("toolName"), subject: approval.text("subject"),
                    description: approval["description"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 },
                    path: approval["path"]?.stringValue, files: Int(approval["files"]?.numberValue ?? 1),
                    diff: approval["diff"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 },
                    command: approval["command"]?.stringValue,
                    truncated: approval["truncated"]?.boolValue == true,
                    allowAlways: approval["canAllowAlways"]?.boolValue == true
                        ? AllowAlways(
                            label: rule?["label"]?.stringValue ?? "Always allow",
                            description: rule?.text("description") ?? "") : nil))
        case "question":
            let questions = (value["question"]?.list("questions") ?? []).map { question in
                Question(
                    id: question.text("id"), header: question.text("header"), text: question.text("question"),
                    choices: question.list("choices").map {
                        Choice(label: $0.text("label"), description: $0.text("description"))
                    }, multiSelect: question["multiSelect"]?.boolValue == true)
            }
            guard !questions.isEmpty else { return nil }
            kind = .questions(questions)
        default:
            return nil
        }
    }

    var approval: Approval? {
        if case .approval(let approval) = kind { return approval }
        return nil
    }

    /// The question a card answers itself. A request with several questions is answered in the chat, one at a time.
    var inlineQuestion: Question? {
        if case .questions(let questions) = kind, questions.count == 1 { return questions[0] }
        return nil
    }

    /// The first line of a card: what the agent wants to do, or what it asks.
    var headline: String {
        switch kind {
        case .approval(let approval):
            if let path = approval.path {
                return approval.files > 1 ? "Edit \(approval.files) files" : "Edit \(path)"
            }
            if approval.command != nil { return "Run a command" }
            return approval.subject.isEmpty ? approval.toolName : "\(approval.toolName) \(approval.subject)"
        case .questions(let questions):
            return questions.count == 1 ? questions[0].text : "\(questions.count) questions"
        }
    }

    /// What a row says of the request where only one line fits, such as a widget.
    var summary: String {
        switch kind {
        case .approval(let approval):
            if let path = approval.path, approval.files <= 1 { "Edit \((path as NSString).lastPathComponent)" } else { headline }
        case .questions: "Asks a question"
        }
    }

    func approvePayload(chatID: String, decision: ApprovalDecision, message: String? = nil) -> JSONValue {
        var values: [String: JSONValue] = [
            "chatId": .string(chatID), "requestId": .string(requestID), "decision": .string(decision.rawValue),
        ]
        let message = message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if decision == .deny, !message.isEmpty { values["message"] = .string(message) }
        return .object(values)
    }

    func answerPayload(chatID: String, answers: [String: String]) -> JSONValue {
        .object([
            "chatId": .string(chatID), "requestId": .string(requestID),
            "answers": .object(answers.mapValues(JSONValue.string)),
        ])
    }
}

enum ApprovalDecision: String {
    case allow
    case allowAlways = "allow-always"
    case deny
}

/// What a person has started on a card and not sent yet.
struct NowRequestDraft: Equatable {
    /// The choices picked so far of a question that takes several.
    var selected: [String] = []
    var reply = ""
    var replying = false

    mutating func toggle(_ label: String) {
        if let index = selected.firstIndex(of: label) {
            selected.remove(at: index)
        } else {
            selected.append(label)
        }
    }

    /// The answer the card sends for `question`: a choice tapped on a question that takes one goes at once, the typed
    /// reply when the field is open, and the picked choices of a question that takes several. Nil while nothing would
    /// be an answer.
    func answer(_ question: NowRequest.Question, choice: String? = nil) -> [String: String]? {
        let value: String
        if let choice, !question.multiSelect {
            value = choice
        } else if replying || question.choices.isEmpty {
            value = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            value = question.choices.map(\.label).filter(selected.contains).joined(separator: ", ")
        }
        return value.isEmpty ? nil : [question.id: value]
    }
}

/// Answers sent from cards on Now. A card goes once the machine drops its request, whoever answered it; one answered
/// here goes at once, so it does not wait for the `chat.status` that settles it.
@MainActor @Observable
final class NowAnswers {
    var drafts: [String: NowRequestDraft] = [:]
    private(set) var sending: Set<String> = []
    private(set) var problems: [String: String] = [:]
    private(set) var answered: Set<String> = []

    static func key(machineID: String, requestID: String) -> String { "\(machineID):\(requestID)" }

    func send(_ type: WireRequest, payload: JSONValue, key: String, client: any MachineRequesting) async {
        guard !sending.contains(key) else { return }
        sending.insert(key)
        problems[key] = nil
        defer { sending.remove(key) }
        do {
            _ = try await client.request(type.rawValue, payload: payload)
            settle(key)
        } catch MachineClientError.server(let code, _) where code == "request-not-found" {
            // Someone else answered first, on the desktop or as the parent agent.
            settle(key)
        } catch {
            problems[key] = error.localizedDescription
        }
    }

    /// Forgets what belongs to requests the machines no longer hold.
    func keep(_ live: Set<String>) {
        answered.formIntersection(live)
        drafts = drafts.filter { live.contains($0.key) }
        problems = problems.filter { live.contains($0.key) }
    }

    private func settle(_ key: String) {
        answered.insert(key)
        drafts[key] = nil
    }
}
