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

@MainActor @Observable
final class ChatPromptState {
    private var live: [JSONValue] = []
    private var completed: Set<String> = []
    private var drafts: [String: ChatPromptDraft] = [:]
    var activeID: String?
    var sendingID: String?
    var error: String?
    var pending: [JSONValue] {
        live.filter { !completed.contains($0.text("requestId")) }
    }
    var active: JSONValue? { pending.first { $0.text("requestId") == activeID } }
    var draft: ChatPromptDraft {
        get { activeID.flatMap { drafts[$0] } ?? ChatPromptDraft() }
        set { if let activeID { drafts[activeID] = newValue } }
    }

    func update(_ requests: [JSONValue]) {
        live = requests
        let ids = Set(requests.map { $0.text("requestId") })
        completed.formIntersection(ids)
        drafts = drafts.filter { ids.contains($0.key) }
        reconcile()
    }

    private func reconcile() {
        guard active == nil else { return }
        let candidates = pending.sorted {
            let first = $0.text("kind") == "question" && $0["async"]?.boolValue == true
            let second = $1.text("kind") == "question" && $1["async"]?.boolValue == true
            if first != second { return !first }
            return ($0["createdAt"]?.numberValue ?? 0) < ($1["createdAt"]?.numberValue ?? 0)
        }
        activeID = candidates.first?.text("requestId")
        error = nil
    }

    func submit(
        _ item: JSONValue, connected: Bool, perform: @MainActor () async throws -> Void
    ) async {
        let id = item.text("requestId")
        guard sendingID == nil, activeID == id, pending.contains(where: { $0.text("requestId") == id }), connected
        else { return }
        sendingID = id
        error = nil
        defer { sendingID = nil }
        do {
            try await perform()
            completed.insert(id)
            drafts.removeValue(forKey: id)
            reconcile()
        } catch {
            guard activeID == id else { return }
            self.error = error.localizedDescription
        }
    }
}
