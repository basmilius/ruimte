import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// Stores this device's last mode and model per CLI, and per machine the account each CLI starts under, and shares
/// changes with connected machines.
@MainActor @Observable
final class ChatPreferences {
    static let shared = ChatPreferences()
    static let storageKey = "ruimte.chat.preferences"
    static let runtimeModes = ["supervised", "auto-accept-edits", "auto", "full-access"]
    static let providers = ["claude", "codex", "gemini", "copilot"]

    private(set) var runtimeMode = "full-access"
    private(set) var selections: [String: JSONValue] = [:]
    /// Per machine and CLI the account a new agent starts under; an account id only means something on its own machine.
    private(set) var accounts: [String: [String: String]] = [:]
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
        for (machine, picks) in stored["accountByMachine"]?.objectValue ?? [:] {
            let valid = (picks.objectValue ?? [:]).compactMapValues(\.stringValue).filter {
                Self.providers.contains($0.key) && !$0.value.isEmpty
            }
            if !valid.isEmpty { accounts[machine] = valid }
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

    /// The payload for one machine, with the accounts picked there. Given the machine's accounts, a pick it turned off
    /// or removed falls away, so a new chat is never refused over it.
    func payload(machineID: String, accounts list: ProviderAccountList?) -> JSONValue {
        var picks: [String: String] = [:]
        for provider in (accounts[machineID] ?? [:]).keys {
            picks[provider] = account(machineID: machineID, provider: provider, accounts: list)
        }
        guard !picks.isEmpty, var values = payload.objectValue else { return payload }
        values["accounts"] = .object(picks.mapValues(JSONValue.string))
        return .object(values)
    }

    /// The account a new agent of this CLI starts under on this machine; nil is the CLI's default account. A machine
    /// that did not say which accounts it has leaves the pick standing.
    func account(machineID: String, provider: String, accounts list: ProviderAccountList?) -> String? {
        guard let picked = accounts[machineID]?[provider] else { return nil }
        guard let list else { return picked }
        let entry = list.entries.first { $0.id == picked }
        return entry?.kind == provider && entry?.enabled == true ? picked : nil
    }

    func rememberSelection(_ selection: JSONValue, provider: String, now: Date = .now) {
        guard Self.providers.contains(provider), Self.isSelection(selection) else { return }
        selections[provider] = selection
        write(now)
    }

    /// The default account is what an absent pick means, so picking it takes the pick away.
    func rememberAccount(_ account: String?, provider: String, machineID: String, now: Date = .now) {
        guard Self.providers.contains(provider) else { return }
        var picks = accounts[machineID] ?? [:]
        if let account, account != provider, !account.isEmpty {
            picks[provider] = account
        } else {
            picks[provider] = nil
        }
        guard picks != (accounts[machineID] ?? [:]) else { return }
        accounts[machineID] = picks.isEmpty ? nil : picks
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
    func send(to client: any MachineRequesting, machineID: String) {
        let picked = accounts[machineID] != nil
        Task {
            // Only asked when there is a pick to check against what the machine has.
            let list =
                picked
                ? (try? await client.request(WireRequest.accountsList.rawValue, payload: .object([:]))).map(
                    ProviderAccountList.init) : nil
            _ = try? await client.request(
                "chat.setPreferences", payload: payload(machineID: machineID, accounts: list))
        }
    }

    private func write(_ now: Date) {
        changedAt = (now.timeIntervalSince1970 * 1000).rounded()
        if var stored = payload.objectValue {
            stored["accountByMachine"] = .object(accounts.mapValues { .object($0.mapValues(JSONValue.string)) })
            if let data = try? JSONValue.object(stored).encoded() { defaults.set(data, forKey: Self.storageKey) }
        }
        for listener in Array(listeners.values) { listener() }
    }

    private static func isSelection(_ value: JSONValue) -> Bool {
        guard let model = value["model"]?.stringValue, !model.isEmpty else { return false }
        return (value["options"]?.objectValue ?? [:]).values.allSatisfy { $0.stringValue != nil || $0.boolValue != nil }
            && value["options"]?.objectValue != nil
    }
}
