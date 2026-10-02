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
    public static func limitsEntry(_ limits: JSONValue?, account id: String) -> JSONValue? {
        (limits?["providers"]?.arrayValue ?? []).first {
            ($0["account"]?["id"]?.stringValue ?? $0["kind"]?.stringValue) == id
        }
    }

    public static func sessionWindow(_ limits: JSONValue?, account id: String) -> AccountSessionWindow? {
        let windows = limitsEntry(limits, account: id)?["windows"]?.arrayValue ?? []
        guard let session = windows.first(where: { $0["kind"]?.stringValue == "session" }),
            let used = session["used"]?.numberValue
        else { return nil }
        return AccountSessionWindow(used: used, resetsAt: session["resetsAt"]?.numberValue)
    }

    /// The account a chat that stopped on a usage limit could go on under: another one of its CLI that is on, signed
    /// in and has room, the one with the least of its session spent. Nil when none has room or none was read yet; the
    /// choice is only ever offered, never made.
    public func continueTarget(_ kind: String, current: String?, limits: JSONValue?) -> ProviderAccountEntry? {
        let roomy = others(kind, current: current).compactMap { account -> (ProviderAccountEntry, Double)? in
            guard let entry = Self.limitsEntry(limits, account: account.id), Self.hasRoom(entry) else { return nil }
            return (account, Self.pressure(entry))
        }
        return roomy.min { $0.1 < $1.1 }?.0
    }

    /// Whether another account a chat could go on under has no numbers yet: a machine reads an account other than a
    /// CLI's default one only while it is in use.
    public func hasUnreadAccount(_ kind: String, current: String?, limits: JSONValue?) -> Bool {
        others(kind, current: current).contains {
            (Self.limitsEntry(limits, account: $0.id)?["checkedAt"]?.numberValue ?? 0) == 0
        }
    }

    private func others(_ kind: String, current: String?) -> [ProviderAccountEntry] {
        accounts(of: kind).filter { $0.id != (current ?? kind) && $0.enabled && $0.state == "ready" }
    }

    /// The numbers were read and no window of the plan is spent. An account never read has no known room.
    private static func hasRoom(_ entry: JSONValue) -> Bool {
        let windows = entry["windows"]?.arrayValue ?? []
        let unavailable = entry["unavailable"].map { $0 != .null } ?? false
        return (entry["checkedAt"]?.numberValue ?? 0) > 0 && !unavailable && !windows.isEmpty
            && windows.allSatisfy { ($0["used"]?.numberValue ?? 1) < 1 }
    }

    /// What a turn of this account would run into first: its session window, else its fullest one.
    private static func pressure(_ entry: JSONValue) -> Double {
        let windows = entry["windows"]?.arrayValue ?? []
        if let session = windows.first(where: { $0["kind"]?.stringValue == "session" }) {
            return session["used"]?.numberValue ?? 0
        }
        return windows.compactMap { $0["used"]?.numberValue }.max() ?? 0
    }
}
