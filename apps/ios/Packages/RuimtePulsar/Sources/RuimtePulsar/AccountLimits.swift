import Foundation

/// How much of an account's session window is spent, as a chat's account choice shows it.
public struct AccountSessionWindow: Sendable, Equatable {
    /// A fraction, as `usage.limits` has it.
    public let used: Double
    /// Milliseconds since the epoch; nil when the CLI named no reset.
    public let resetsAt: Double?

    public init(used: Double, resetsAt: Double?) {
        self.used = used
        self.resetsAt = resetsAt
    }
}

extension ProviderAccountList {
    /// The `usage.limits` entry of an account. An entry from a machine before accounts is its CLI's default account.
    public static func limitsEntry(_ limits: UsageLimits?, account id: String) -> UsageLimitsProvider? {
        (limits?.providers ?? []).first { ($0.account?.id ?? $0.kind) == id }
    }

    public static func sessionWindow(_ limits: UsageLimits?, account id: String) -> AccountSessionWindow? {
        let windows = limitsEntry(limits, account: id)?.windows ?? []
        guard let session = windows.first(where: { $0.kind == .session }) else { return nil }
        return AccountSessionWindow(used: session.used, resetsAt: session.resetsAt.map(Double.init))
    }

    /// The account a chat that stopped on a usage limit could go on under: another one of its CLI that is on, signed
    /// in and has room, the one with the least of its session spent. Nil when none has room or none was read yet; the
    /// choice is only ever offered, never made.
    public func continueTarget(_ kind: String, current: String?, limits: UsageLimits?) -> ProviderAccountEntry? {
        continueTargets(kind, current: current, limits: limits).first
    }

    public func continueTargets(_ kind: String, current: String?, limits: UsageLimits?) -> [ProviderAccountEntry] {
        let roomy = others(kind, current: current).compactMap { account -> (ProviderAccountEntry, Double)? in
            guard let entry = Self.limitsEntry(limits, account: account.id), Self.hasRoom(entry) else { return nil }
            return (account, Self.pressure(entry))
        }
        return roomy.sorted { $0.1 < $1.1 }.map(\.0)
    }

    /// Whether another account a chat could go on under has no numbers yet: a machine reads an account other than a
    /// CLI's default one only while it is in use.
    public func hasUnreadAccount(_ kind: String, current: String?, limits: UsageLimits?) -> Bool {
        others(kind, current: current).contains {
            let reading = Self.limitsEntry(limits, account: $0.id)
            return (reading?.checkedAt ?? 0) == 0 || reading?.unavailable?.reason == .failed
        }
    }

    private func others(_ kind: String, current: String?) -> [ProviderAccountEntry] {
        accounts(of: kind).filter { $0.id != (current ?? kind) && $0.enabled && $0.state == "ready" }
    }

    /// The numbers were read and no window of the plan is spent. An account never read has no known room.
    private static func hasRoom(_ entry: UsageLimitsProvider) -> Bool {
        entry.checkedAt > 0 && !isUnavailable(entry) && !entry.windows.isEmpty
            && entry.windows.allSatisfy { $0.used < 1 }
    }

    public static func isUnavailable(_ entry: UsageLimitsProvider) -> Bool { entry.unavailable != nil }

    /// What a turn of this account would run into first: its session window, else its fullest one.
    private static func pressure(_ entry: UsageLimitsProvider) -> Double {
        if let session = entry.windows.first(where: { $0.kind == .session }) { return session.used }
        return entry.windows.map(\.used).max() ?? 0
    }
}
