import Foundation
import RuimtePulsar

public struct ChatHistory {
    public private(set) var cursor: String?
    public private(set) var start = 0
    public private(set) var pending: [String: JSONValue] = [:]

    public init() {}

    public mutating func replace(_ snapshot: JSONValue) {
        start = Int(snapshot["history"]?["start"]?.numberValue ?? 0)
        cursor = snapshot["history"]?["cursor"]?.stringValue
        pending = Dictionary(
            (snapshot["pending"]?.arrayValue ?? []).compactMap { item in
                item["id"]?.stringValue.map { ($0, item) }
            }, uniquingKeysWith: { _, newest in newest })
    }

    public mutating func includes(_ item: JSONValue, index: JSONValue?) -> Bool {
        if let id = item["id"]?.stringValue {
            if Self.isPending(item) { pending[id] = item } else { pending.removeValue(forKey: id) }
        }
        return Int(index?.numberValue ?? Double(start)) >= start
    }

    public mutating func prepend(_ page: JSONValue, to items: [JSONValue]) -> [JSONValue] {
        let older = page["items"]?.arrayValue ?? []
        let ids = Set(items.compactMap { $0["id"]?.stringValue })
        start = Int(page["history"]?["start"]?.numberValue ?? Double(start))
        cursor = page["history"]?["cursor"]?.stringValue
        return older.filter { item in item["id"]?.stringValue.map { !ids.contains($0) } ?? false } + items
    }

    public static func isPending(_ item: JSONValue) -> Bool {
        (item["kind"]?.stringValue == "approval" && item["decision"]?.stringValue == "pending")
            || (item["kind"]?.stringValue == "question" && item["state"]?.stringValue == "pending")
    }
}
