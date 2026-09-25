import Foundation

public struct UsageWidgetMachine: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// What the usage widgets draw for one machine, as the app last heard it. A widget never reaches a machine itself,
/// so this is all it knows once the machine is out of reach.
public struct UsageWidgetSnapshot: Codable, Sendable, Equatable {
    public struct Window: Codable, Sendable, Equatable {
        /// `session`, `weekly`, `monthly` or `other`; nil in a snapshot written before the kind was kept.
        public let kind: String?
        public let label: String
        /// A fraction, as `usage.limits` has it.
        public let used: Double
        public let resetsAt: Date?

        public init(kind: String?, label: String, used: Double, resetsAt: Date?) {
            self.kind = kind
            self.label = label
            self.used = used
            self.resetsAt = resetsAt
        }
    }

    public struct Account: Codable, Sendable, Equatable {
        public let id: String
        public let label: String
        /// A node accent id, as the account has it.
        public let color: String?

        public init(id: String, label: String, color: String? = nil) {
            self.id = id
            self.label = label
            self.color = color
        }
    }

    public struct Provider: Codable, Sendable, Equatable {
        public let kind: String
        /// Nil from a machine before accounts, and in a snapshot written before the account was kept.
        public let account: Account?
        public let windows: [Window]

        public init(kind: String, account: Account? = nil, windows: [Window]) {
            self.kind = kind
            self.account = account
            self.windows = windows
        }

        /// The default account of a CLI has the CLI's kind as its id.
        public var accountID: String { account?.id ?? kind }
    }

    public struct Cost: Codable, Sendable, Equatable {
        /// The day the amount is of, from `day(of:)`; on any other day it says nothing about today.
        public let day: String
        public let usd: Double
        /// Nil in a snapshot written before the cost was kept per provider.
        public let usdByProvider: [String: Double]?
        /// By account id; only while a CLI has several accounts, and nil from a machine before accounts.
        public let usdByAccount: [String: Double]?
        public let rate: JSONValue?
        public let fetchedAt: Date

        public init(
            day: String, usd: Double, usdByProvider: [String: Double]? = nil, usdByAccount: [String: Double]? = nil,
            rate: JSONValue?, fetchedAt: Date
        ) {
            self.day = day
            self.usd = usd
            self.usdByProvider = usdByProvider
            self.usdByAccount = usdByAccount
            self.rate = rate
            self.fetchedAt = fetchedAt
        }
    }

    public var providers: [Provider]
    public var updatedAt: Date
    public var cost: Cost?

    public init(providers: [Provider] = [], updatedAt: Date = .now, cost: Cost? = nil) {
        self.providers = providers
        self.updatedAt = updatedAt
        self.cost = cost
    }

    /// `YYYY-MM-DD` in the phone's time zone, the form `usage.summary` takes its days in.
    public static func day(of date: Date, in timeZone: TimeZone = .current) -> String {
        date.formatted(Date.ISO8601FormatStyle(timeZone: timeZone).year().month().day())
    }
}

/// The widgets' side of the app group: the machines a widget can pick and the last snapshot of each.
public enum UsageWidgetStore {
    public static let kind = "app.ruimte.usage"

    /// The widget kind of one provider's widget, or of the widget over every provider for nil.
    public static func kind(provider: String?) -> String { provider.map { "\(kind).\($0)" } ?? kind }
    private static let machinesKey = "usage-widget.machines"
    private static let snapshotsKey = "usage-widget.snapshots"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: SharedPushStore.group) }

    public static func machines() -> [UsageWidgetMachine] { read(machinesKey) ?? [] }

    /// Drops the snapshot of every machine that left the list, so a removed machine or a sign-out leaves nothing behind.
    public static func setMachines(_ machines: [UsageWidgetMachine]) {
        write(machines, machinesKey)
        let ids = Set(machines.map(\.id))
        write(snapshots().filter { ids.contains($0.key) }, snapshotsKey)
    }

    public static func snapshot(machineID: String) -> UsageWidgetSnapshot? { snapshots()[machineID] }

    public static func save(_ snapshot: UsageWidgetSnapshot, machineID: String) {
        guard machines().contains(where: { $0.id == machineID }) else { return }
        var all = snapshots()
        all[machineID] = snapshot
        write(all, snapshotsKey)
    }

    private static func snapshots() -> [String: UsageWidgetSnapshot] { read(snapshotsKey) ?? [:] }

    private static func read<Value: Decodable>(_ key: String) -> Value? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(Value.self, from: data)
    }

    private static func write<Value: Encodable>(_ value: Value, _ key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        defaults?.set(data, forKey: key)
    }
}
