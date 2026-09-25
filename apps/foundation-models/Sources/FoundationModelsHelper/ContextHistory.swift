import FoundationModels

enum ContextBudgetError: Error, CustomStringConvertible {
    case tooLarge

    var description: String {
        "The current message, tool definitions and response schema do not fit the local context budget. Shorten the message or start a new chat."
    }
}

enum ContextHistory {
    static func refreshInstructions(_ entries: [Transcript.Entry], from current: [Transcript.Entry]) -> [Transcript.Entry] {
        current.filter { if case .instructions = $0 { return true }; return false }
            + entries.filter { if case .instructions = $0 { return false }; return true }
    }

    static func turnCount(_ entries: [Transcript.Entry]) -> Int {
        entries.reduce(0) { count, entry in
            if case .prompt = entry { return count + 1 }
            return count
        }
    }

}
