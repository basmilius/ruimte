import Foundation

/// A view of a project as the project widget lists it, with the state of the view and the nodes on it.
public struct ProjectWidgetView: Codable, Sendable, Equatable, Identifiable {
    public enum State: String, Codable, Sendable {
        case needsYou, working, idle
    }

    public let id: String
    public let title: String
    /// The Lucide name of the view's mark.
    public let icon: String
    public let state: State

    public init(id: String, title: String, icon: String, state: State) {
        self.id = id
        self.title = title
        self.icon = icon
        self.state = state
    }
}

/// An open project with its views, as Now last read it.
public struct ProjectWidgetProject: Codable, Sendable, Equatable, Identifiable {
    public let machineID: String
    public let projectID: String
    public let name: String
    public let machineName: String
    public let views: [ProjectWidgetView]

    public var id: String { "\(machineID):\(projectID)" }

    public init(machineID: String, projectID: String, name: String, machineName: String, views: [ProjectWidgetView]) {
        self.machineID = machineID
        self.projectID = projectID
        self.name = name
        self.machineName = machineName
        self.views = views
    }

    /// The address the app opens a view of this project at, the same door the needs-you widgets use.
    public func url(for view: ProjectWidgetView) -> URL? {
        var url = URLComponents()
        url.scheme = "ruimte"
        url.host = "node"
        url.queryItems = [
            .init(name: "machine", value: machineID), .init(name: "node", value: view.id),
            .init(name: "target", value: "view"),
        ]
        return url.url
    }
}

public struct ProjectWidgetSnapshot: Codable, Sendable, Equatable {
    public var projects: [ProjectWidgetProject]
    public var updatedAt: Date

    public init(projects: [ProjectWidgetProject] = [], updatedAt: Date = .now) {
        self.projects = projects
        self.updatedAt = updatedAt
    }

    /// Whether two snapshots say the same, whenever each was taken.
    public func says(_ other: ProjectWidgetSnapshot) -> Bool { projects == other.projects }
}

/// The project widget's side of the app group. The widget never reaches a machine itself.
public enum ProjectWidgetStore {
    public static let kind = "app.ruimte.project"
    private static let snapshotKey = "project-widget.snapshot"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: SharedPushStore.group) }

    public static func snapshot() -> ProjectWidgetSnapshot? {
        guard let data = defaults?.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(ProjectWidgetSnapshot.self, from: data)
    }

    public static func save(_ snapshot: ProjectWidgetSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults?.set(data, forKey: snapshotKey)
    }

    /// Leaves out the machines that are gone, so a removed machine or a sign-out leaves nothing behind.
    public static func keep(machineIDs: Set<String>) {
        guard var current = snapshot() else { return }
        let projects = current.projects.filter { machineIDs.contains($0.machineID) }
        guard projects != current.projects else { return }
        current.projects = projects
        save(current)
    }
}
