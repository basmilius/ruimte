import Foundation

/// One account's plan limits as the usage page draws them.
public struct UsageLimitSection: Sendable, Equatable, Identifiable {
    /// Why an account has no bars to show, said once instead of drawing empty ones.
    public enum Quiet: Sendable, Equatable {
        case signedOut
        /// Nothing read yet; `message` is what the machine said about the account, if anything.
        case notRead(message: String?)
    }

    public let id: String
    public let kind: String
    public let name: String
    public let color: String?
    /// The `usage.limits` entry; nil for an account the machine does not read, which is one that is not signed in.
    public let entry: JSONValue?
    public let quiet: Quiet?
    /// Whether the CLI has more than one account here, which is when a title names the account.
    public let named: Bool

    public var title: String {
        let provider = usageProviderName(kind)
        return named ? "\(provider) limits · \(name)" : "\(provider) limits"
    }

    /// Per CLI, in the order the machine lists them, one section per account it reads, then the accounts that are on
    /// but not read, which come from the account list since only it can say why they have no numbers.
    public static func sections(limits: JSONValue?, accounts: ProviderAccountList?) -> [UsageLimitSection] {
        let entries = limits?["providers"]?.arrayValue ?? []
        var kinds: [String] = []
        for entry in entries {
            if let kind = entry["kind"]?.stringValue, !kinds.contains(kind) { kinds.append(kind) }
        }
        return kinds.flatMap { kind in
            let provider = usageProviderName(kind)
            let known = accounts?.accounts(of: kind) ?? []
            let read = entries.filter { $0["kind"]?.stringValue == kind }
            let readIDs = read.map { $0["account"]?["id"]?.stringValue ?? kind }
            let unread = known.filter { $0.enabled && !readIDs.contains($0.id) }
            let named = read.count + unread.count > 1
            let shown = zip(readIDs, read).map { id, entry in
                let account = known.first { $0.id == id }
                return UsageLimitSection(
                    id: id, kind: kind,
                    name: account?.name(provider: provider) ?? entry["account"]?["label"]?.stringValue ?? provider,
                    color: account?.color ?? entry["account"]?["color"]?.stringValue, entry: entry,
                    quiet: quiet(entry: entry, account: account), named: named)
            }
            return shown
                + unread.map { account in
                    UsageLimitSection(
                        id: account.id, kind: kind, name: account.name(provider: provider), color: account.color,
                        entry: nil, quiet: quiet(entry: nil, account: account), named: named)
                }
        }
    }

    private static func quiet(entry: JSONValue?, account: ProviderAccountEntry?) -> Quiet? {
        let signedOut = account?.state == "signed-out"
        guard let entry else { return signedOut ? .signedOut : .notRead(message: account?.message) }
        if !(entry["windows"]?.arrayValue ?? []).isEmpty { return nil }
        if signedOut { return .signedOut }
        let unavailable = entry["unavailable"].map { $0 != .null } ?? false
        if (entry["checkedAt"]?.numberValue ?? 0) <= 0 && !unavailable { return .notRead(message: nil) }
        return nil
    }
}
