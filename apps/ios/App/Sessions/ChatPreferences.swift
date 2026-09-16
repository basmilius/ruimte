import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// The mode and the model per CLI a person last picked in a composer on this device. A machine starts the chats it
/// opens on its own with the newest pick among its connected clients, so this is told to every machine on connect
/// and on every change.
@MainActor @Observable
final class ChatPreferences {
    static let shared = ChatPreferences()
    static let storageKey = "ruimte.chat.preferences"
    static let runtimeModes = ["supervised", "auto-accept-edits", "auto", "full-access"]
    static let providers = ["claude", "codex", "gemini", "copilot"]

    private(set) var runtimeMode = "full-access"
    private(set) var selections: [String: JSONValue] = [:]
    /// Milliseconds since the epoch; zero is older than any pick made on another client.
    private(set) var changedAt: Double = 0
    @ObservationIgnored private var listeners: [UUID: () -> Void] = [:]
    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        guard let data = defaults.data(forKey: Self.storageKey), let stored = try? JSONValue.decode(data) else {
            return
        }
        if let mode = stored["runtimeMode"]?.stringValue, Self.runtimeModes.contains(mode) { runtimeMode = mode }
        for (provider, selection) in stored["selections"]?.objectValue ?? [:] where Self.isSelection(selection) {
            if Self.providers.contains(provider) { selections[provider] = selection }
        }
        changedAt = stored["changedAt"]?.numberValue ?? 0
    }

    /// The `chat.setPreferences` payload. There is no terminal mode setting on this device, so the machine keeps
    /// its own default for terminal agents while this client holds the newest pick.
    var payload: JSONValue {
        .object([
            "runtimeMode": .string(runtimeMode), "selections": .object(selections), "changedAt": .number(changedAt),
        ])
    }

    func rememberSelection(_ selection: JSONValue, provider: String, now: Date = .now) {
        guard Self.providers.contains(provider), Self.isSelection(selection) else { return }
        selections[provider] = selection
        write(now)
    }

    func rememberRuntimeMode(_ mode: String, now: Date = .now) {
        guard Self.runtimeModes.contains(mode) else { return }
        runtimeMode = mode
        write(now)
    }

    func observe(_ handler: @escaping () -> Void) -> () -> Void {
        let id = UUID()
        listeners[id] = handler
        return { [weak self] in self?.listeners.removeValue(forKey: id) }
    }

    /// Tells a machine the current pick. An older machine does not know the request, which leaves it on its own
    /// defaults, so every failure is ignored.
    func send(to client: any MachineRequesting) {
        let payload = payload
        Task { _ = try? await client.request("chat.setPreferences", payload: payload) }
    }

    private func write(_ now: Date) {
        changedAt = (now.timeIntervalSince1970 * 1000).rounded()
        if let data = try? payload.encoded() { defaults.set(data, forKey: Self.storageKey) }
        for listener in Array(listeners.values) { listener() }
    }

    private static func isSelection(_ value: JSONValue) -> Bool {
        guard let model = value["model"]?.stringValue, !model.isEmpty else { return false }
        return (value["options"]?.objectValue ?? [:]).values.allSatisfy { $0.stringValue != nil || $0.boolValue != nil }
            && value["options"]?.objectValue != nil
    }
}
