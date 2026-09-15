import RuimtePulsar

struct PendingIceCandidates {
    private var pending: [JSONValue] = []
    private var answered = false

    mutating func generated(_ candidate: JSONValue) -> JSONValue? {
        if answered { return candidate }
        pending.append(candidate)
        return nil
    }

    mutating func answerApplied() -> [JSONValue] {
        // The daemon may still be authorizing the offer before it replies. Earlier candidates can be dropped.
        answered = true
        defer { pending.removeAll() }
        return pending
    }
}
