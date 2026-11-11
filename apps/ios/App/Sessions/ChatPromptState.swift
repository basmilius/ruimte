import Foundation
import Observation
import RuimtePulsar

struct ChatPromptAnswer {
    var choices: [String] = []
    var text = ""
    var custom = false

    var value: String {
        custom ? text.trimmingCharacters(in: .whitespacesAndNewlines) : choices.joined(separator: ", ")
    }
}

struct ChatPromptDraft {
    var index = 0
    var answers: [String: ChatPromptAnswer] = [:]
    var denialReason = ""
    var showingReason = false
    var expanded = false
}

/// The agent a request of a child or delegated chat comes from, which its card names.
struct ChatPromptSource: Equatable {
    let label: String
    let provider: String?
}

/// A request that waits on a person: the chat's own, or one of a chat it opened, which is answered in that chat.
struct ChatPromptSubject: Equatable {
    /// Nil for the chat's own request.
    let chatID: String?
    let item: ChatItem
    var source: ChatPromptSource?

    /// The request id alone for the chat's own, since the request ids of two chats can be the same.
    var key: String {
        let request = item.requestId ?? ""
        return chatID.map { "\($0)/\(request)" } ?? request
    }

    /// The one item an answer went to, so an answer never hides another item that carries the same request id.
    var answerKey: String { "\(key)#\(item.id)" }
}

extension ChatItem {
    /// An approval or a question the agent cannot go on without, which shows the chat as waiting on a person.
    var holdsTurn: Bool {
        switch self {
        case .approval(let approval): approval.decision == .pending
        case .question(let question): question.state == .pending && question.async != true
        default: false
        }
    }
}

@MainActor @Observable
final class ChatPromptState {
    private var live: [ChatPromptSubject] = []
    private var completed: Set<String> = []
    private var drafts: [String: ChatPromptDraft] = [:]
    var activeID: String?
    var sendingID: String?
    var error: String?
    var subjects: [ChatPromptSubject] {
        live.filter { !completed.contains($0.answerKey) }
    }
    var pending: [ChatItem] { subjects.map(\.item) }
    var answeredCount: Int { completed.count }
    var activeSubject: ChatPromptSubject? { subjects.first { $0.key == activeID } }
    var active: ChatItem? { activeSubject?.item }
    var draft: ChatPromptDraft {
        get { activeID.flatMap { drafts[$0] } ?? ChatPromptDraft() }
        set { if let activeID { drafts[activeID] = newValue } }
    }

    /// The chat's own requests first, then those of the chats it opened that still wait.
    func update(_ requests: [ChatItem], others: [ChatPromptSubject] = []) {
        live = requests.map { ChatPromptSubject(chatID: nil, item: $0) } + others
        let keys = Set(live.map(\.key))
        completed.formIntersection(live.map(\.answerKey))
        drafts = drafts.filter { keys.contains($0.key) }
        reconcile()
    }

    /// Brings the oldest request of a chat this one opened to the front, for a note that leads there.
    func show(chatID: String) {
        guard
            let subject = subjects.filter({ $0.chatID == chatID }).min(by: { $0.item.createdAt < $1.item.createdAt })
        else { return }
        activeID = subject.key
        error = nil
    }

    private func reconcile() {
        guard active == nil else { return }
        let candidates = subjects.sorted {
            let first = Self.waitsLater($0.item)
            let second = Self.waitsLater($1.item)
            if first != second { return !first }
            return $0.item.createdAt < $1.item.createdAt
        }
        activeID = candidates.first?.key
        error = nil
    }

    /// A question the agent goes on without, which waits behind every request that holds it up.
    private static func waitsLater(_ item: ChatItem) -> Bool {
        if case .question(let question) = item { question.async == true } else { false }
    }

    func submit(
        _ item: ChatItem, connected: Bool, perform: @MainActor () async throws -> Void
    ) async {
        guard let subject = activeSubject, subject.item.requestId == item.requestId, sendingID == nil, connected
        else { return }
        let id = subject.key
        sendingID = id
        error = nil
        defer { sendingID = nil }
        do {
            try await perform()
            // Hidden only while the machine still lists it: once it left, an answer may not hide its return.
            if live.contains(where: { $0.answerKey == subject.answerKey }) { completed.insert(subject.answerKey) }
            drafts.removeValue(forKey: id)
            reconcile()
        } catch {
            guard activeID == id else { return }
            self.error = error.localizedDescription
        }
    }
}

/// A chat that shows it waits on a person while its composer has no card for that request. Only counts and kinds,
/// which tell apart where the request got lost, never an id or anything the chat says.
struct ChatPromptGap: Equatable {
    let pending: Int
    let subjects: Int
    let answered: Int
    let activeSet: Bool
    let approval: Bool
    let sharedModel: Bool
    let rejectedEvent: Bool
    /// Set when the request is a child's that a row of this chat says waits on the person.
    var child: Child?

    /// What the feed knows of a child whose row says it waits.
    struct Child: Equatable {
        enum Attach: String {
            case none
            case inFlight = "in flight"
            case finished, failed
        }

        let followed: Bool
        let attach: Attach
        /// The child's status as its model read it, or `unknown` for none or a word this app does not know.
        let status: String
        let pending: Int
    }

    var message: String {
        func word(_ value: Bool) -> String { value ? "yes" : "no" }
        guard let child else {
            return "A chat waited on a person without the card to answer it (pending \(pending), subjects \(subjects), "
                + "answered \(answered), active \(word(activeSet)), kind \(approval ? "approval" : "question"), "
                + "shared \(word(sharedModel)), rejected event \(word(rejectedEvent)))"
        }
        return "A child chat waited on a person without its card in the parent (subjects \(subjects), "
            + "answered \(answered), active \(word(activeSet)), shared \(word(sharedModel)), "
            + "followed \(word(child.followed)), attach \(child.attach.rawValue), child status \(child.status), "
            + "child pending \(child.pending))"
    }
}

/// Reports a chat whose waiting request has gone without its card for `delay`, once per chat while the app runs.
@MainActor final class ChatPromptGapReporter {
    static let shared = ChatPromptGapReporter { CrashReports.report($0) }
    static let delay: TimeInterval = 5

    private let send: (ChatPromptGap) -> Void
    private var since: [String: Date] = [:]
    private var reported: Set<String> = []

    init(send: @escaping (ChatPromptGap) -> Void) {
        self.send = send
    }

    /// `gap` is nil while every waiting request has its card, or while the chat is out of sight or offline.
    func observe(chatID: String, gap: ChatPromptGap?, now: Date) {
        guard let gap else {
            since[chatID] = nil
            return
        }
        guard !reported.contains(chatID) else { return }
        guard let start = since[chatID] else {
            since[chatID] = now
            return
        }
        guard now.timeIntervalSince(start) >= Self.delay else { return }
        reported.insert(chatID)
        send(gap)
    }
}

/// Takes the keyboard from the draft while a request holds the composer, and gives it back once the last request is
/// handled, only if the draft had it.
struct ChatDraftFocusHandoff {
    private var resumes = false

    /// The draft's focus after the active request changed, or nil to leave it as it is.
    mutating func focus(from previous: String?, to next: String?, focused: Bool, visible: Bool) -> Bool? {
        if next != nil && previous == nil {
            resumes = focused
            return false
        }
        if next == nil && resumes && visible {
            resumes = false
            return true
        }
        return nil
    }
}

extension ChatApprovalItem {
    /// What the request says about itself, left out where an agent describes a command by the command itself, which
    /// the card already shows.
    var shownDescription: String? {
        guard let description, !description.isEmpty else { return nil }
        let command = input["command"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        return description.trimmingCharacters(in: .whitespacesAndNewlines) == command ? nil : description
    }
}
