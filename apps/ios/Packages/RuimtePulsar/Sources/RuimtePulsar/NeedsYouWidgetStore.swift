import Foundation

/// A node waiting on a person, as the needs-you widgets list it.
public struct NeedsYouWidgetItem: Codable, Sendable, Equatable, Identifiable {
    public let machineID: String
    public let projectID: String
    public let nodeID: String
    /// `chat` or `terminal`, which is what the app opens.
    public let target: String
    public let title: String
    public let projectName: String
    /// What it waits on, in a few words.
    public let detail: String

    public var id: String { "\(machineID):\(nodeID)" }

    public init(
        machineID: String, projectID: String, nodeID: String, target: String, title: String, projectName: String,
        detail: String
    ) {
        self.machineID = machineID
        self.projectID = projectID
        self.nodeID = nodeID
        self.target = target
        self.title = title
        self.projectName = projectName
        self.detail = detail
    }

    /// The address the app opens the node at.
    public var url: URL? {
        var url = URLComponents()
        url.scheme = "ruimte"
        url.host = "node"
        url.queryItems = [
            .init(name: "machine", value: machineID), .init(name: "node", value: nodeID),
            .init(name: "target", value: target),
        ]
        return url.url
    }
}

/// What Now last knew of every machine, for the widgets that never reach a machine themselves.
public struct NeedsYouWidgetSnapshot: Codable, Sendable, Equatable {
    public var items: [NeedsYouWidgetItem]
    public var working: Int
    public var updatedAt: Date

    public init(items: [NeedsYouWidgetItem] = [], working: Int = 0, updatedAt: Date = .now) {
        self.items = items
        self.working = working
        self.updatedAt = updatedAt
    }

    public var projects: Int { Set(items.map { "\($0.machineID):\($0.projectID)" }).count }

    /// Whether two snapshots say the same, whenever each was taken.
    public func says(_ other: NeedsYouWidgetSnapshot) -> Bool { items == other.items && working == other.working }

    /// Where a tap on the count lands: Now.
    public static let nowURL = URL(string: "ruimte://now")!
}

/// The needs-you widgets' side of the app group.
public enum NeedsYouWidgetStore {
    public static let countKind = "app.ruimte.needs-you.count"
    public static let listKind = "app.ruimte.needs-you.list"
    private static let snapshotKey = "needs-you-widget.snapshot"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: SharedPushStore.group) }

    public static func snapshot() -> NeedsYouWidgetSnapshot? {
        guard let data = defaults?.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(NeedsYouWidgetSnapshot.self, from: data)
    }

    public static func save(_ snapshot: NeedsYouWidgetSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults?.set(data, forKey: snapshotKey)
    }

    /// Leaves out the machines that are gone, so a removed machine or a sign-out leaves nothing behind.
    public static func keep(machineIDs: Set<String>) {
        guard var current = snapshot() else { return }
        let items = current.items.filter { machineIDs.contains($0.machineID) }
        guard items != current.items || machineIDs.isEmpty else { return }
        current.items = items
        if machineIDs.isEmpty { current.working = 0 }
        save(current)
    }
}
