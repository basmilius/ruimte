import Foundation

/// The project this device looked at last, so a cold start lands in it again. Leaving a project forgets it, the same
/// way closing a project on the desktop does.
struct LastProject: Codable, Equatable {
    static let storageKey = "ruimte.ios.lastProject"

    let machineID: String
    let projectID: String

    static func read(from defaults: UserDefaults = .standard) -> LastProject? {
        guard let data = defaults.data(forKey: storageKey) else { return nil }
        return try? JSONDecoder().decode(LastProject.self, from: data)
    }

    static func remember(machineID: String, projectID: String, in defaults: UserDefaults = .standard) {
        let value = LastProject(machineID: machineID, projectID: projectID)
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: storageKey) }
    }

    static func forget(in defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: storageKey)
    }
}
