import Foundation

/// What every kind of chat item carries, the `base` of `ChatItemSchema` in the contracts.
public protocol ChatItemFields: Sendable {
    var id: String { get }
    var createdAt: Double { get }
    var turnId: String? { get }
    var kind: String { get }
}

extension ChatUserItem: ChatItemFields {}
extension ChatAssistantItem: ChatItemFields {}
extension ChatThinkingItem: ChatItemFields {}
extension ChatToolItem: ChatItemFields {}
extension ChatSubagentItem: ChatItemFields {}
extension ChatApprovalItem: ChatItemFields {}
extension ChatQuestionItem: ChatItemFields {}
extension ChatTurnItem: ChatItemFields {}
extension ChatNoteItem: ChatItemFields {}
extension ChatCompactionItem: ChatItemFields {}
extension ChatItemUnknown: ChatItemFields {}

extension ChatItem {
    public var fields: any ChatItemFields {
        switch self {
        case .user(let item): item
        case .assistant(let item): item
        case .thinking(let item): item
        case .tool(let item): item
        case .subagent(let item): item
        case .approval(let item): item
        case .question(let item): item
        case .turn(let item): item
        case .note(let item): item
        case .compaction(let item): item
        case .unknown(let item): item
        }
    }

    public var id: String { fields.id }
    public var createdAt: Double { fields.createdAt }
    public var turnId: String? { fields.turnId }
    public var kind: String { fields.kind }

    public var userItem: ChatUserItem? { if case .user(let item) = self { item } else { nil } }
    public var assistantItem: ChatAssistantItem? { if case .assistant(let item) = self { item } else { nil } }
    public var toolItem: ChatToolItem? { if case .tool(let item) = self { item } else { nil } }
    public var subagentItem: ChatSubagentItem? { if case .subagent(let item) = self { item } else { nil } }
    public var turnItem: ChatTurnItem? { if case .turn(let item) = self { item } else { nil } }
    public var noteItem: ChatNoteItem? { if case .note(let item) = self { item } else { nil } }

    /// The call of a subagent this item belongs to; only an assistant message, a tool call and an agent another agent
    /// opened have one.
    public var parentToolUseID: String? {
        switch self {
        case .assistant(let item): item.parentToolUseId.present
        case .tool(let item): item.parentToolUseId
        case .subagent(let item): item.parentToolUseId
        default: nil
        }
    }

    public var requestId: String? {
        switch self {
        case .approval(let item): item.requestId
        case .question(let item): item.requestId
        default: nil
        }
    }

    public var isPending: Bool {
        switch self {
        case .approval(let item): item.decision == .pending
        case .question(let item): item.state == .pending
        default: false
        }
    }
}
