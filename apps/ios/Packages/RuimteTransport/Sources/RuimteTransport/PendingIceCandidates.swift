import Foundation
import RuimtePulsar

struct PendingIceCandidates {
    private var pending: [JSONValue] = []
    private var answered = false
    private var sent = Set<String>()

    mutating func offered(_ sdp: String) {
        // Replaying routes already in the SDP can exhaust the broker limit before ICE connects.
        let included = Set(
            sdp.components(separatedBy: .newlines)
                .filter { $0.hasPrefix("a=candidate:") }.map { Self.identity(String($0.dropFirst(2))) })
        sent.formUnion(included)
        pending.removeAll { included.contains(Self.identity($0["candidate"]?.stringValue ?? "")) }
    }

    mutating func generated(_ candidate: JSONValue) -> JSONValue? {
        if let value = candidate["candidate"]?.stringValue, !sent.insert(Self.identity(value)).inserted { return nil }
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

    private static func identity(_ candidate: String) -> String {
        // SDP and delegate candidates can differ in optional generation, ufrag and network-cost extensions.
        let fields = candidate.split(whereSeparator: { $0.isWhitespace })
        var key = fields.prefix(8).joined(separator: " ")
        if let index = fields.firstIndex(of: "tcptype"), fields.indices.contains(index + 1) {
            key += " tcptype " + fields[index + 1]
        }
        return key
    }
}
