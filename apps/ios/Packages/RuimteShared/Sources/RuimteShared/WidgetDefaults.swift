import Foundation
import RuimtePulsar

/// The app group's defaults, where the app leaves what the widgets draw. A widget never reaches a machine itself.
enum WidgetDefaults {
    private static var defaults: UserDefaults? { UserDefaults(suiteName: SharedPushStore.group) }

    static func read<Value: Decodable>(_ key: String) -> Value? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(Value.self, from: data)
    }

    static func write<Value: Encodable>(_ value: Value, _ key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        defaults?.set(data, forKey: key)
    }

    /// The address the app opens a node or a view at.
    static func nodeURL(machineID: String, nodeID: String, target: String) -> URL? {
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
