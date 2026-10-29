import Foundation

/// One account of an agent CLI on a machine, as `accounts.list` describes it. The default account of a CLI has the
/// CLI's kind as its id.
public struct ProviderAccountEntry: Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: String
    public let label: String?
    /// A node accent id; any other value paints with the app's accent.
    public let color: String?
    public let enabled: Bool
    /// Its place among the accounts of its CLI, lowest first; nil for an account nobody placed.
    public let order: Int?
    /// `ProviderAccountState` as the machine last saw it; nil before the machine described the account.
    public let state: String?
    /// Where the account's conversations are written; nil when the machine does not say.
    public let transcripts: String?
    public let message: String?

    public init(
        id: String, kind: String, label: String? = nil, color: String? = nil, enabled: Bool = true,
        order: Int? = nil, state: String? = nil, transcripts: String? = nil, message: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.label = label
        self.color = color
        self.enabled = enabled
        self.order = order
        self.state = state
        self.transcripts = transcripts
        self.message = message
    }

    public var isDefault: Bool { id == kind }

    /// A default account nobody named goes by its CLI's name.
    public func name(provider: String) -> String { label ?? (isDefault ? provider : id) }
}

/// The accounts of every CLI on one machine.
public struct ProviderAccountList: Sendable, Equatable {
    public let entries: [ProviderAccountEntry]

    public init(entries: [ProviderAccountEntry]) {
        self.entries = entries
    }

    /// Reads a `accounts.list` result or a `accounts.changed` payload. The account map arrives as an object, which
    /// keeps no order, so the CLIs follow the machine's list of statuses and the accounts of each CLI `ordered`.
    public init(_ value: JSONValue) {
        let statuses = value["statuses"]?.arrayValue ?? []
        let order = Dictionary(
            statuses.enumerated().compactMap { index, status in status["id"]?.stringValue.map { ($0, index) } },
            uniquingKeysWith: { first, _ in first })
        let statusByID = Dictionary(
            statuses.compactMap { status in status["id"]?.stringValue.map { ($0, status) } },
            uniquingKeysWith: { first, _ in first })
        let accounts = (value["accounts"]?.objectValue ?? [:]).sorted { first, second in
            switch (order[first.key], order[second.key]) {
            case (let one?, let other?): return one < other
            case (.some, nil): return true
            case (nil, .some): return false
            case (nil, nil): return first.key < second.key
            }
        }
        let parsed = accounts.compactMap { id, account -> ProviderAccountEntry? in
            guard let kind = account["kind"]?.stringValue else { return nil }
            let status = statusByID[id]
            return ProviderAccountEntry(
                id: id, kind: kind, label: account["label"]?.stringValue, color: account["color"]?.stringValue,
                enabled: account["enabled"]?.boolValue ?? true, order: account["order"]?.numberValue.map { Int($0) },
                state: status?["state"]?.stringValue, transcripts: status?["transcripts"]?.stringValue,
                message: status?["message"]?.stringValue)
        }
        var kinds: [String] = []
        for entry in parsed where !kinds.contains(entry.kind) {
            kinds.append(entry.kind)
        }
        entries = kinds.flatMap { kind in Self.ordered(parsed.filter { $0.kind == kind }) }
    }

    /// The accounts of one CLI in the machine's order.
    public func accounts(of kind: String) -> [ProviderAccountEntry] {
        Self.ordered(entries.filter { $0.kind == kind })
    }

    /// The order the machine keeps the accounts of one CLI in, as `orderedAccountIds` does: the placed ones by their
    /// place, then the CLI's default account, then the rest by id. The first one that is on is where a new chat starts.
    public static func ordered(_ accounts: [ProviderAccountEntry]) -> [ProviderAccountEntry] {
        accounts.sorted { first, second in
            switch (first.order, second.order) {
            case (let one?, let other?) where one != other: return one < other
            case (.some, nil): return true
            case (nil, .some): return false
            default:
                if first.isDefault != second.isDefault { return first.isDefault }
                return first.id < second.id
            }
        }
    }

    /// The account a chat of this CLI that names none starts under on a machine that keeps an order.
    public func startingAccount(of kind: String) -> ProviderAccountEntry? {
        accounts(of: kind).first(where: \.enabled)
    }

    /// Whether a person has a choice of account for this CLI, which is when a chat names its account.
    public func hasChoice(_ kind: String) -> Bool { accounts(of: kind).filter(\.enabled).count >= 2 }

    /// The accounts a picker offers: every one that is on, and the one in use even while it is off.
    public func offered(_ kind: String, current: String?) -> [ProviderAccountEntry] {
        let current = current ?? kind
        return accounts(of: kind).filter { $0.enabled || $0.id == current }
    }

    /// Whether a chat of one account can go on under another, the way the machine decides it: the same account, or two
    /// of the chat's CLI that write their conversations to one folder. A machine that does not say where answers no,
    /// so the person forks instead of being refused.
    public func canContinue(_ kind: String, from: String?, to: String?) -> Bool {
        let fromID = from ?? kind
        let toID = to ?? kind
        if fromID == toID { return true }
        let folder = { (id: String) in entries.first { $0.id == id && $0.kind == kind }?.transcripts }
        guard let source = folder(fromID), !source.isEmpty else { return false }
        return source == folder(toID)
    }

    /// Whether a chat has spoken, after which only an account that reads its conversation can take it over.
    public static func chatStarted(_ info: ChatInfo) -> Bool {
        info.agentSessionId != nil || info.usage.turns > 0
    }
}
