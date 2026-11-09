import Foundation
import RuimtePulsar
import Testing

/// `Fixtures/parity.json`: blocks with what the desktop's interpreter makes of them.
func parityFixtures() throws -> [JSONValue] {
    let url = try #require(Bundle.module.url(forResource: "parity", withExtension: "json"))
    return try #require(JSONValue.decode(Data(contentsOf: url)).arrayValue)
}

func parityBlock(_ name: String) throws -> JSONValue {
    try #require(parityFixtures().first { $0["name"] == .string(name) }?["request"]?["block"])
}

/// Holds every `wait` until `release` hands them the value, and answers later waits with it at once.
actor Gate<Value: Sendable> {
    private var value: Value?
    private var waiting: [CheckedContinuation<Value, Never>] = []

    func wait() async -> Value {
        if let value { return value }
        return await withCheckedContinuation { waiting.append($0) }
    }

    func release(_ value: Value) {
        self.value = value
        for continuation in waiting { continuation.resume(returning: value) }
        waiting.removeAll()
    }
}
