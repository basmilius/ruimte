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
        case .off: String(localized: "Off", comment: "Keep awake setting")
        case .working: String(localized: "While agents work")
        case .always: String(localized: "Always", comment: "Keep awake setting")
        }
    }
}

struct MachineKeepAwake: Equatable, Sendable {
    var mode: KeepAwakeMode
    var onBattery: Bool
    var display: Bool
    /// Also with the lid closed, which only does something on a Mac that offers it (`MachineEndpoint.closedLid`).
    var lidClosed: Bool

    /// macOS has no display assertion that lets go on battery, so the display stays on only under `always` and only
    /// together with battery.
    var displayApplies: Bool { mode == .always && onBattery }
}

/// Keep awake with the lid closed on a Mac. Only a person on the Mac can install the rule it needs, so a phone shows
/// the switch and uses it once the rule is there.
struct MachineClosedLid: Equatable, Sendable {
    var ruleInstalled: Bool
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
        switch (terminals, agents) {
        case (0, 0): return ""
        case (_, 0): return String(localized: "\(terminals) terminals")
        case (0, _): return String(localized: "\(agents) agents")
        default: return String(localized: "\(terminals) terminals and \(agents) agents")
        }
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

    private var named: String { version.map { "Ruimte \($0)" } ?? String(localized: "A new version of Ruimte") }

    /// The line over a machine's page, nil when there is nothing to tell.
    var headline: String? {
        switch status {
        case "available": String(localized: "\(named) is available on this machine.")
        case "downloading":
            if let percent {
                String(localized: "Downloading \(named), \(Int(percent))%.")
            } else {
                String(localized: "Downloading \(named).")
            }
        case "ready": String(localized: "\(named) is ready on this machine.")
        case "error":
            error.map { String(localized: "Could not update: \($0)") }
                ?? String(localized: "Could not update this machine.")
        default: nil
        }
    }

    /// What installing does from here; nil when it cannot happen from a phone.
    var action: String? {
        guard installable else { return nil }
        guard app else { return nil }
        return status == "ready"
            ? String(localized: "Restart", comment: "Button that restarts the app on a machine to install an update")
            : String(localized: "Update", comment: "Button that installs an update")
    }

    /// Said under the headline when the app is not there to install it.
    var note: String? {
        installable && !app ? String(localized: "Open Ruimte on the machine to install it there.") : nil
    }

    /// What the person reads before the restart: what installs and what that ends on the machine right now.
    static func restartQuestion(update: MachineUpdate?, work: MachineWork, machine: String) -> String {
        let named = update?.version.map { "Ruimte \($0)" } ?? String(localized: "The update")
        let installs =
            update?.status == "ready"
            ? String(localized: "\(named) installs and Ruimte restarts on \(machine).")
            : String(localized: "\(named) downloads, installs and Ruimte restarts on \(machine).")
        if work.idle {
            return String(
                localized: "\(installs) Nothing that runs there ends.", comment: "%@ is the sentence on what installs")
        }
        return String(
            localized: "\(installs) That ends \(work.summary) running there now.",
            comment: "%1$@ is the sentence on what installs, %2$@ what still runs, like 2 terminals")
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
/// version, the update of its app, keep awake and its door on the local network, with the round trip measured while a
/// page shows it. It also sets keep awake, the door, the name and the icon, and runs the two asks of an update install.
@MainActor @Observable
final class MachineEndpoint {
    private(set) var info: JSONValue?
    private(set) var update: MachineUpdate?
    /// Nil on a machine that cannot hold a block on sleep.
    private(set) var keepAwake: MachineKeepAwake?
    /// Nil where the machine does not offer keep awake with the lid closed, which only a Mac does.
    private(set) var closedLid: MachineClosedLid?
    /// The last round trip in milliseconds, nil while unmeasured or after a failed one.
    private(set) var latency: Int?
    private(set) var lastConnected: Date?
    private(set) var install = MachineInstallStep.idle
    private(set) var savingKeepAwake = false
    private(set) var savingLanDoor = false
    /// Why the last action failed, until the next one.
    var problem: String?
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private let machineID: String
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let clock: @MainActor () -> Date
    @ObservationIgnored private let learnedLan: @MainActor (LanDoorAddress?) -> Void
    @ObservationIgnored private var subscriptions: [() -> Void] = []
    @ObservationIgnored private var reading: Task<Void, Never>?
    @ObservationIgnored private var connected = false
    @ObservationIgnored private var generation = 0

    /// `learnedLan` hears where the machine's door listens each time the machine says, nil once it is closed.
    init(
        client: any MachineRequesting, machineID: String, defaults: UserDefaults = .standard,
        clock: @escaping @MainActor () -> Date = { Date() },
        learnedLan: @escaping @MainActor (LanDoorAddress?) -> Void = { _ in }
    ) {
        self.client = client
        self.machineID = machineID
        self.defaults = defaults
        self.clock = clock
        self.learnedLan = learnedLan
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
    /// Whether this machine hands out browser and device pictures.
    var streamingAllowed: Bool { info?["streamingAllowed"]?.boolValue ?? true }
    /// Whether a person keeps the door on the local network open, which it is unless the machine says otherwise; nil
    /// while nothing was read.
    var lanDoor: Bool? { info.map { $0["lanDoor"]?.boolValue ?? true } }
    /// A flag the machine started with decides the door, so the switch changes nothing.
    var lanDoorFixed: Bool { info?["lanDoorFixed"]?.boolValue == true }

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
        closedLid = Self.closedLid(in: value)
        learnedLan(LanDoorAddress(value["lan"]))
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
            display: value["keepAwakeDisplay"]?.boolValue ?? false,
            lidClosed: value["keepAwakeLidClosed"]?.boolValue ?? false)
    }

    static func closedLid(in value: JSONValue) -> MachineClosedLid? {
        guard value["keepAwakeLidAvailable"]?.boolValue == true else { return nil }
        return MachineClosedLid(ruleInstalled: value["keepAwakeLidRule"]?.boolValue == true)
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
        var payload: [String: JSONValue] = [
            "name": currentName, "icon": info?["icon"] ?? .null,
            "keepAwake": .string(next.mode.rawValue), "keepAwakeOnBattery": .bool(next.onBattery),
            "keepAwakeDisplay": .bool(next.display),
        ]
        // A machine that does not offer the closed lid is not told about it.
        if closedLid != nil { payload["keepAwakeLidClosed"] = .bool(next.lidClosed) }
        do {
            let answer = try await client.request(WireRequest.endpointSetIdentity.rawValue, payload: .object(payload))
            apply(answer)
            problem = nil
        } catch {
            keepAwake = previous
            problem = String(localized: "Could not change keep awake. \(error.localizedDescription)")
        }
    }

    func setLanDoor(_ open: Bool) async {
        guard let previous = info, lanDoor != open, !savingLanDoor else { return }
        info = previous.setting("lanDoor", .bool(open))
        savingLanDoor = true
        defer { savingLanDoor = false }
        do {
            let answer = try await client.request(
                WireRequest.endpointSetIdentity.rawValue,
                payload: .object(["name": currentName, "icon": previous["icon"] ?? .null, "lanDoor": .bool(open)]))
            apply(answer)
            problem = nil
        } catch {
            info = previous
            problem = String(localized: "Could not change the local network setting. \(error.localizedDescription)")
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
        guard install != .asking, install != .installing else { return }
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
        case "update-no-app": return String(localized: "Ruimte is not open on this machine. Install the update there.")
        case "update-none": return String(localized: "There is no update to install on this machine.")
        default: return message
        }
    }
}

extension LinkRoute {
    var label: String {
        switch self {
        case .localNetwork: String(localized: "Local network", comment: "A machine reached on the local network")
        case .broker: String(localized: "Through your account", comment: "A machine reached through the broker")
        case .relayed: String(localized: "Relayed", comment: "A machine whose connection runs through a relay")
        }
    }
}

/// How a machine is reached, in the line under its name.
enum MachineReach {
    static func line(
        connected: Bool, connecting: Bool, route: LinkRoute?, latency: Int?, problem: String?, lastSeen: Date?
    ) -> String {
        if connected {
            let route = route?.label ?? String(localized: "Connected")
            return latency.map {
                String(
                    localized: "\(route) · \($0) ms",
                    comment: "How the machine is connected, then the round trip in milliseconds")
            } ?? route
        }
        if connecting { return String(localized: "Connecting") }
        if let lastSeen {
            let relative = Format.ago(milliseconds: Date.now.timeIntervalSince(lastSeen) * 1000)
            return String(localized: "Last connected \(relative)", comment: "%@ is a relative time, like 5 minutes ago")
        }
        return problem ?? String(localized: "Not connected")
    }
}

/// One account of a CLI on a machine's card: its five hour window above its week, or why it has no numbers.
struct MachineLimitLine: Identifiable, Equatable {
    struct Bar: Equatable {
        let label: String
        let used: Double
    }

    enum Content: Equatable {
        /// The session window a person hits within a day and the week the account has; either is nil when the CLI
        /// reports none.
        case bars(session: Bar?, week: Bar?)
        /// What the machine says about an account it cannot read, in place of numbers that may be old.
        case status(String)
    }

    let kind: String
    let accountID: String
    let name: String
    /// Whether the CLI has more than one account on the card, which is when a row wears the account's dot.
    let named: Bool
    let color: String?
    let content: Content

    var id: String { "\(kind):\(accountID)" }
}

/// The rows of a machine's card, and whether the machine could not say which accounts it has, in which case the
/// numbers stand without the state of their accounts.
struct MachineLimits: Equatable {
    var lines: [MachineLimitLine] = []
    var accountsUnavailable = false

    /// States in which an account's numbers no longer say anything, so the state stands in their place.
    private static let quiet: Set<String> = ["signed-out", "failed", "folder-missing", "unavailable"]

    /// What the card of a machine shows: the reading of this connection, or the saved snapshot before there is one.
    @MainActor static func card(_ recorder: UsageWidgetRecorder, now: Date = .now) -> MachineLimits {
        if let limits = recorder.limits {
            return of(limits: limits, accounts: recorder.accounts, now: now)
        }
        return of(providers: recorder.providers, accounts: recorder.accounts, now: now)
    }

    /// Every account the machine reads and every one that is on, per CLI in the machine's order, the default account
    /// first and the rest as the account list has them. An account that is off, not installed or without a
    /// subscription has no row, as on the usage page.
    @MainActor static func of(limits: JSONValue, accounts: UsageAccounts, now: Date = .now) -> MachineLimits {
        let entries = limits.list("providers")
        let readings = zip(UsageWidgetRecorder.providers(limits), entries).map { provider, entry in
            Reading(
                provider: provider, checkedAt: entry["checkedAt"]?.numberValue,
                unavailable: entry["unavailable"]?["reason"]?.stringValue)
        }
        return of(readings, accounts: accounts, now: now)
    }

    /// The saved snapshot, before this connection read the limits. It knows the windows only, so an account without
    /// any has no row unless the account list names it.
    @MainActor static func of(
        providers: [UsageWidgetSnapshot.Provider], accounts: UsageAccounts, now: Date = .now
    ) -> MachineLimits {
        of(providers.map { Reading(provider: $0, checkedAt: nil, unavailable: nil) }, accounts: accounts, now: now)
    }

    private struct Reading {
        let provider: UsageWidgetSnapshot.Provider
        /// When the machine read it; nil for a snapshot, which keeps only what it read.
        let checkedAt: Double?
        let unavailable: String?
    }

    @MainActor private static func of(_ readings: [Reading], accounts: UsageAccounts, now: Date) -> MachineLimits {
        let list: ProviderAccountList? = if case .loaded(let loaded) = accounts { loaded } else { nil }
        var kinds: [String] = []
        for kind in readings.map(\.provider.kind) + (list?.entries.map(\.kind) ?? []) where !kinds.contains(kind) {
            kinds.append(kind)
        }
        let lines = kinds.flatMap { kind in
            lines(kind: kind, readings: readings.filter { $0.provider.kind == kind }, list: list, now: now)
        }
        return MachineLimits(lines: lines, accountsUnavailable: accounts == .failed && !lines.isEmpty)
    }

    @MainActor private static func lines(
        kind: String, readings: [Reading], list: ProviderAccountList?, now: Date
    ) -> [MachineLimitLine] {
        let provider = usageProviderName(kind)
        let known = list?.accounts(of: kind) ?? []
        let read = readings.filter { $0.provider.accountID == kind } + readings.filter { $0.provider.accountID != kind }
        // A loaded list is the truth about which accounts there are; a reading of an account it no longer has is old.
        // The default account stays, for a machine whose list leaves it out.
        let ids =
            list == nil
            ? read.map(\.provider.accountID)
            : known.map(\.id) + read.map(\.provider.accountID).filter { $0 == kind && !known.map(\.id).contains($0) }
        typealias Row = (id: String, name: String, color: String?, content: MachineLimitLine.Content)
        let rows: [Row] = ids.compactMap { id in
            let account = known.first { $0.id == id }
            let reading = read.first { $0.provider.accountID == id }
            if account?.enabled == false || account?.state == "disabled" || account?.state == "not-found" { return nil }
            if ["not-installed", "no-subscription"].contains(reading?.unavailable) { return nil }
            guard let content = content(account: account, reading: reading, now: now) else { return nil }
            let name =
                account?.name(provider: provider) ?? reading?.provider.account?.label ?? (id == kind ? provider : id)
            return (id, name, account?.color ?? reading?.provider.account?.color, content)
        }
        let names = rows.map(\.name)
        return rows.map { row in
            // Two accounts by one name are told apart by their id.
            let twin = names.filter { $0 == row.name }.count > 1
            return MachineLimitLine(
                kind: kind, accountID: row.id, name: twin ? "\(row.name) (\(row.id))" : row.name,
                named: rows.count > 1, color: row.color, content: row.content)
        }
    }

    @MainActor private static func content(
        account: ProviderAccountEntry?, reading: Reading?, now: Date
    ) -> MachineLimitLine.Content? {
        if let state = account?.state, quiet.contains(state) {
            let status = account?.message.map { JSONValue.object(["message": .string($0)]) }
            return .status(MachineAgentsModel.detail(state: state, status: status))
        }
        let windows = reading?.provider.windows ?? []
        let session = windows.first { $0.kind == "session" }
        // The week of the whole account; a week of one model ("Weekly · Opus") stays on the usage page.
        let week = windows.first { $0.kind == "weekly" && !$0.label.contains(" · ") }
        if session != nil || week != nil {
            return .bars(session: session.map { bar($0, now: now) }, week: week.map { bar($0, now: now) })
        }
        if reading?.unavailable == "failed" { return .status(String(localized: "Unavailable")) }
        if account?.state == "checking" { return .status(MachineAgentsModel.detail(state: "checking", status: nil)) }
        if reading == nil || (reading?.checkedAt ?? 1) <= 0 {
            return .status(
                String(localized: "Not read yet", comment: "An account whose limits the machine has not read"))
        }
        return nil
    }

    /// Past its reset a window starts over, which the app has not heard yet, so it reads as unused, as in the widget.
    private static func bar(_ window: UsageWidgetSnapshot.Window, now: Date) -> MachineLimitLine.Bar {
        let reset = window.resetsAt.map { $0 <= now } ?? false
        return MachineLimitLine.Bar(label: window.label, used: reset ? 0 : window.used)
    }
}
