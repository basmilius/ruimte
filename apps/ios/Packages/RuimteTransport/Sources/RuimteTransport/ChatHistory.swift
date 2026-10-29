import Foundation
import RuimtePulsar

public struct ChatHistory {
    public private(set) var cursor: String?
    public private(set) var start = 0
    public private(set) var pending: [String: ChatItem] = [:]
    /// The sub-agents from before the page, in thread order, so the chip knows of one a message woke again without a
    /// scroll reaching back to its row.
    public private(set) var subagents: [ChatItem] = []
    /// The Workflow calls from before the page, by the same rule, so the workflow chip does not wait on a scroll.
    public private(set) var workflows: [ChatItem] = []

    public init() {}

    /// A page from a machine before paging is the whole thread, so it has no history and nothing outside it.
    public mutating func replace(
        history page: ChatHistoryPage?, pending requests: [ChatItem], subagents before: [ChatSubagentItem] = [],
        workflows calls: [ChatToolItem] = []
    ) {
        start = Int(page?.start ?? 0)
        cursor = page?.cursor
        pending = Dictionary(requests.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
        subagents = page == nil ? [] : before.map { .subagent($0) }
        workflows = page == nil ? [] : calls.map { .tool($0) }
    }

    public mutating func includes(_ item: ChatItem, index: Int64?) -> Bool {
        if item.isPending { pending[item.id] = item } else { pending.removeValue(forKey: item.id) }
        let included = Int(index ?? Int64(start)) >= start
        if !included, item.subagentItem != nil {
            Self.hold(item, in: &subagents)
        }
        if !included, item.toolItem?.workflow != nil {
            Self.hold(item, in: &workflows)
        }
        return included
    }

    private static func hold(_ item: ChatItem, in held: inout [ChatItem]) {
        if let index = held.firstIndex(where: { $0.id == item.id }) {
            held[index] = item
        } else {
            held.append(item)
        }
    }

    public mutating func prepend(_ page: ChatHistoryResult, to items: [ChatItem]) -> [ChatItem] {
        let ids = Set(items.map(\.id))
        let older = Set(page.items.map(\.id))
        start = Int(page.history.start)
        cursor = page.history.cursor
        subagents.removeAll { older.contains($0.id) }
        workflows.removeAll { older.contains($0.id) }
        return page.items.filter { !ids.contains($0.id) } + items
    }
}
