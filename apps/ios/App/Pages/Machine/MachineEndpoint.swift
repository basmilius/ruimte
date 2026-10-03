import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// When a machine keeps itself from sleeping, as `endpoint.info` names it.
enum KeepAwakeMode: String, CaseIterable, Identifiable, Sendable {
    case off, working, always

    var id: Self { self }

    var label: String {
        switch self {
        case .off: "Off"
        case .working: "While agents work"
        case .always: "Always"
        }
    }
}

struct MachineKeepAwake: Equatable, Sendable {
    var mode: KeepAwakeMode
    var onBattery: Bool
    var display: Bool

    /// macOS has no display assertion that lets go on battery, so the display stays on only under `always` and only
    /// together with battery.
    var displayApplies: Bool { mode == .always && onBattery }
}

/// What a restart of the app on a machine would end, from `endpoint.installUpdate`.
struct MachineWork: Equatable, Sendable {
    let terminals: Int
    let agents: Int

    init(terminals: Int, agents: Int) {
        self.terminals = terminals
        self.agents = agents
    }

    init(_ value: JSONValue?) {
        terminals = Int(value?["terminals"]?.numberValue ?? 0)
        agents = Int(value?["agents"]?.numberValue ?? 0)
    }

    var idle: Bool { terminals == 0 && agents == 0 }

    var summary: String {
        let parts = [
            terminals == 0 ? nil : terminals == 1 ? "1 terminal" : "\(terminals) terminals",
            agents == 0 ? nil : agents == 1 ? "1 agent" : "\(agents) agents",
        ].compactMap { $0 }
        return parts.joined(separator: " and ")
    }
}

/// Where the desktop app on a machine stands with its next version. The status is read as a plain string, so a step
/// a newer app adds reads as nothing to act on instead of hiding the machine.
struct MachineUpdate: Equatable, Sendable {
    let status: String
    let version: String?
    let currentVersion: String?
    let percent: Double?
    let error: String?
    /// False while no app on the machine reports, which is when the update has to be done on the computer itself.
    let app: Bool

    init?(_ value: JSONValue?) {
        guard let value, let status = value["status"]?.stringValue else { return nil }
        self.status = status
        version = value["version"]?.stringValue
        currentVersion = value["currentVersion"]?.stringValue
        percent = value["percent"]?.numberValue
        error = value["error"]?.stringValue
        app = value["app"]?.boolValue ?? false
    }

    /// The steps the machine takes an install for; it downloads first where it has not yet.
    var installable: Bool { ["available", "downloading", "ready"].contains(status) }

    private var named: String { version.map { "Ruimte \($0)" } ?? "A new version of Ruimte" }

    /// The line over a machine's page, nil when there is nothing to tell.
    var headline: String? {
        switch status {
        case "available": "\(named) is available on this machine."
        case "downloading":
            if let percent { "Downloading \(named), \(Int(percent))%." } else { "Downloading \(named)." }
        case "ready": "\(named) is ready on this machine."
        case "error": error.map { "The update failed: \($0)" } ?? "The update failed on this machine."
        default: nil
        }
    }

    /// What installing does from here; nil when it cannot happen from a phone.
    var action: String? {
        guard installable else { return nil }
        guard app else { return nil }
        return status == "ready" ? "Restart" : "Update"
    }

    /// Said under the headline when the app is not there to install it.
    var note: String? {
        installable && !app ? "Open Ruimte on the machine to install it there." : nil
    }
}

/// Where installing an update stands, from the first question to the restart.
enum MachineInstallStep: Equatable, Sendable {
    case idle
    /// Asking the machine what a restart would end.
    case asking
    /// Waiting for the person, with what ends.
    case confirming(MachineWork)
    case installing
    /// The app was asked to install; the machine goes away and comes back on the new version.
    case started
}

/// One machine as `endpoint.info` describes it, followed with `endpoint.changed` and `endpoint.updateChanged`: its
/// version, the update of its app and keep awake, with the round trip measured while a page shows it. It also sets
/// keep awake, the name and the icon, and runs the two asks of an update install.
@MainActor @Observable
final class MachineEndpoint {
    private(set) var info: JSONValue?
    private(set) var update: MachineUpdate?
    /// Nil on a machine that cannot hold a block on sleep, or whose daemon predates the setting.
    private(set) var keepAwake: MachineKeepAwake?
    /// The last round trip in milliseconds, nil while unmeasured or after a failed one.
    private(set) var latency: Int?
    private(set) var lastConnected: Date?
    private(set) var install = MachineInstallStep.idle
    private(set) var savingKeepAwake = false
    /// Why the last action failed, until the next one.
    var problem: String?
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private let machineID: String
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let clock: @MainActor () -> Date
    @ObservationIgnored private var subscriptions: [() -> Void] = []
    @ObservationIgnored private var reading: Task<Void, Never>?
    @ObservationIgnored private var connected = false
    @ObservationIgnored private var generation = 0

    init(
        client: any MachineRequesting, machineID: String, defaults: UserDefaults = .standard,
        clock: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.client = client
        self.machineID = machineID
        self.defaults = defaults
        self.clock = clock
        let stored = defaults.double(forKey: lastConnectedKey)
        lastConnected = stored > 0 ? Date(timeIntervalSince1970: stored) : nil
    }

    private var lastConnectedKey: String { "ruimte.ios.machine.lastConnected.\(machineID)" }

    var version: String? { info?["version"]?.stringValue }
    var label: String? { info?["label"]?.stringValue }
    var icon: MachineIcon? {
        guard let value = info?["icon"], value != .null, let kind = value["kind"]?.stringValue,
            let name = value["value"]?.stringValue
        else { return nil }
        return MachineIcon(kind: kind, value: name)
    }
    /// Whether this machine hands out browser and device pictures; an older daemon that does not say did.
    var streamingAllowed: Bool { info?["streamingAllowed"]?.boolValue ?? true }

    func start() {
        guard subscriptions.isEmpty else { return }
        subscriptions = [
            client.subscribe(WireEvent.endpointChanged.rawValue) { [weak self] value in
                self?.merge(value)
            },
            client.subscribe(WireEvent.endpointUpdateChanged.rawValue) { [weak self] value in
                guard let self, let update = MachineUpdate(value["update"]) else { return }
                self.update = update
            },
            client.observeConnection { [weak self] connected in
                self?.connectionChanged(connected)
            },
        ]
    }

    func stop() {
        subscriptions.forEach { $0() }
        subscriptions.removeAll()
        reading?.cancel()
        reading = nil
        generation += 1
        connected = false
    }

    /// Reads `endpoint.info` again; the page calls it on a pull, the connection on every link.
    func refresh() async {
        generation += 1
        let operation = generation
        guard let value = try? await client.request(WireRequest.endpointInfo.rawValue, payload: .object([:])),
            operation == generation
        else { return }
        apply(value)
    }

    private func connectionChanged(_ connected: Bool) {
        self.connected = connected
        remember()
        reading?.cancel()
        latency = nil
        guard connected else { return }
        if install == .started { install = .idle }
        reading = Task { [weak self] in await self?.refresh() }
    }

    private func remember() {
        let now = clock()
        lastConnected = now
        defaults.set(now.timeIntervalSince1970, forKey: lastConnectedKey)
    }

    private func apply(_ value: JSONValue) {
        info = value
        update = MachineUpdate(value["update"])
        keepAwake = Self.keepAwake(in: value)
    }

    /// An event leaves out what it does not change, and never carries whether keep awake is available.
    private func merge(_ value: JSONValue) {
        guard var merged = info?.objectValue, let changes = value.objectValue else { return }
        for (key, change) in changes { merged[key] = change }
        apply(.object(merged).setting("update", info?["update"]))
    }

    static func keepAwake(in value: JSONValue) -> MachineKeepAwake? {
        guard value["keepAwakeAvailable"]?.boolValue == true,
            let mode = value["keepAwake"]?.stringValue.flatMap(KeepAwakeMode.init(rawValue:))
        else { return nil }
        return MachineKeepAwake(
            mode: mode, onBattery: value["keepAwakeOnBattery"]?.boolValue ?? false,
            display: value["keepAwakeDisplay"]?.boolValue ?? false)
    }

    /// Times `server.ping` every interval for as long as the calling task runs, which is as long as a page shows it.
    func followLatency(every interval: Duration = .seconds(10)) async {
        while !Task.isCancelled {
            await measureLatency()
            try? await Task.sleep(for: interval)
        }
    }

    func measureLatency() async {
        guard connected else {
            latency = nil
            return
        }
        let started = ContinuousClock.now
        do {
            _ = try await client.request(WireRequest.serverPing.rawValue, payload: .object([:]))
            latency = Int(((ContinuousClock.now - started) / .milliseconds(1)).rounded())
        } catch {
            latency = nil
        }
    }

    /// The name a write sends back: a machine nobody named answers to its default, and sending that back would make
    /// it a chosen one.
    private var currentName: JSONValue {
        guard info?["nameSource"]?.stringValue == "chosen", let label else { return .null }
        return .string(label)
    }

    func setKeepAwake(_ next: MachineKeepAwake) async {
        guard let previous = keepAwake, next != previous, !savingKeepAwake else { return }
        keepAwake = next
        savingKeepAwake = true
        defer { savingKeepAwake = false }
        do {
            let answer = try await client.request(
                WireRequest.endpointSetIdentity.rawValue,
                payload: .object([
                    "name": currentName, "icon": info?["icon"] ?? .null,
                    "keepAwake": .string(next.mode.rawValue), "keepAwakeOnBattery": .bool(next.onBattery),
                    "keepAwakeDisplay": .bool(next.display),
                ]))
            apply(answer)
            problem = nil
        } catch {
            keepAwake = previous
            problem = "Keep awake could not be changed. \(error.localizedDescription)"
        }
    }

    /// Names the machine for every client; an empty name hands it back to the one it starts with.
    func setIdentity(name: String, icon: MachineIcon?) async throws {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let answer = try await client.request(
            WireRequest.endpointSetIdentity.rawValue,
            payload: .object([
                "name": trimmed.isEmpty ? .null : .string(trimmed),
                "icon": icon.map { .object(["kind": .string($0.kind), "value": .string($0.value)]) } ?? .null,
            ]))
        apply(answer)
    }

    /// The first ask, which only learns what a restart would end.
    func askToInstall() async {
        guard install == .idle || install == .started else { return }
        install = .asking
        do {
            let answer = try await client.request(
                WireRequest.endpointInstallUpdate.rawValue, payload: .object(["confirm": .bool(false)]))
            install = .confirming(MachineWork(answer["ending"]))
            problem = nil
        } catch {
            install = .idle
            problem = Self.installProblem(error)
        }
    }

    func cancelInstall() {
        if case .confirming = install { install = .idle }
    }

    /// The second ask, after the person saw what ends.
    func confirmInstall() async {
        guard case .confirming = install else { return }
        install = .installing
        do {
            let answer = try await client.request(
                WireRequest.endpointInstallUpdate.rawValue, payload: .object(["confirm": .bool(true)]))
            install = answer["started"]?.boolValue == true ? .started : .idle
            problem = nil
        } catch {
            install = .idle
            problem = Self.installProblem(error)
        }
    }

    static func installProblem(_ error: Error) -> String {
        guard case .server(let code, let message) = error as? MachineClientError else {
            return error.localizedDescription
        }
        switch code {
        case "update-no-app": return "Ruimte is not open on this machine. Install the update there."
        case "update-none": return "There is no update to install on this machine."
        default: return message
        }
    }
}
