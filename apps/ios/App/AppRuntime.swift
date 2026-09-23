import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit
import WidgetKit

@MainActor @Observable
final class AppRuntime {
    var providers: [ProviderId] = []
    var account: Account?
    var machines: [Machine] = []
    var problem: String?
    var signingIn = false
    var signingOut = false
    var loading = false
    var relayOnly = false
    private(set) var key: DeviceKey?
    let client: AddressBookClient
    let sockets = BrokerSockets()
    let connections: MachineConnections
    let pairings: StatementPairings
    private let defaults: UserDefaults
    private(set) var vault: SessionVault?
    private var authentication: WebAuthentication?
    private var appleAuthentication: NativeAppleAuthentication?
    @ObservationIgnored lazy var notifications = NotificationCoordinator(runtime: self)
    private var sessions: [String: SharedMachineSession] = [:]
    private var initialized = false
    @ObservationIgnored private var notificationSyncTask: Task<Void, Never>?
    @ObservationIgnored private var startupTask: Task<Void, Never>?
    private var startupRevision = 0
    private var sessionRevision = 0
    private(set) var connectionRevision = 0

    init(
        client: AddressBookClient = AddressBookClient(), vault: SessionVault? = nil, defaults: UserDefaults = .standard,
        connections: MachineConnections? = nil, pairings: StatementPairings? = nil, deviceKey: DeviceKey? = nil
    ) {
        self.client = client
        self.vault = vault
        self.key = deviceKey
        self.defaults = defaults
        self.connections = connections ?? MachineConnections()
        self.pairings = pairings ?? StatementPairings(store: UserDefaultsPairingStore(defaults: defaults))
    }

    var attentionKeys: Set<String> {
        Set(
            sessions.values.flatMap { session in
                let attention = session.attention
                let ids = attention.unseen.union(attention.statuses.keys.filter { attention.needsYou($0) })
                return ids.compactMap { try? PushReplayLedger.nodeKey(machineID: session.machine.id, nodeID: $0) }
            })
    }

    func session(for machine: Machine) -> SharedMachineSession {
        guard let current = machines.first(where: { $0.id == machine.id }) else {
            let removed = SharedMachineSession(machine: machine, runtime: self)
            removed.invalidate()
            return removed
        }
        if let existing = sessions[current.id] {
            if existing.machine.publicKey == current.publicKey && existing.machine.brokerUrl == current.brokerUrl {
                return existing
            }
            invalidateMachine(current.id, forgetPairing: existing.machine.publicKey != current.publicKey)
        }
        let session = SharedMachineSession(machine: current, runtime: self)
        sessions[machine.id] = session
        return session
    }

    func start() async {
        if let startupTask {
            await startupTask.value
            return
        }
        guard !initialized, !signingOut else { return }
        startupRevision += 1
        let startup = startupRevision
        let operation = sessionRevision
        // Restoring account changes the root view's identity. Its canceled .task must not cancel this shared startup.
        let task = Task { [weak self] in
            guard let self else { return }
            await self.initialize(startup: startup, operation: operation)
        }
        startupTask = task
        await task.value
    }

    private func initialize(startup: Int, operation: Int) async {
        loading = true
        defer {
            if startup == startupRevision {
                startupTask = nil
                loading = false
            }
        }
        do {
            let store = KeychainStore()
            if key == nil { key = try DeviceKey.loadOrCreate(in: store) }
            machines = pairedMachines
            if vault == nil {
                vault = SessionVault(
                    client: client, store: store,
                    signer: {
                        guard let bytes = try store.readData(account: "device-key") else { return nil }
                        return try DeviceKey(rawRepresentation: bytes)
                    })
            }
            let restored = try await vault?.restore()
            try Task.checkCancellation()
            guard operation == sessionRevision else { return }
            account = restored?.account
            initialized = true
            notifications.startBackgroundActivityDelivery()
            async let availableProviders = client.providers()
            if account != nil { await refreshMachines() }
            do {
                let available = try await availableProviders
                try Task.checkCancellation()
                guard operation == sessionRevision else { return }
                providers = available.compactMap(ProviderId.init(rawValue:))
                if account == nil { problem = nil }
            } catch is CancellationError {
                return
            } catch {
                // Provider discovery is optional for a restored account and must not hide its machine list.
                if operation == sessionRevision, account == nil { problem = error.localizedDescription }
            }
        } catch is CancellationError {
            return
        } catch {
            if operation == sessionRevision {
                problem = error.localizedDescription
                initialized = false
            }
        }
    }

    private func cancelStartup() {
        startupRevision += 1
        startupTask?.cancel()
        startupTask = nil
        loading = false
    }

    func signIn(_ provider: ProviderId, window: UIWindow) async {
        guard let vault, !signingIn, !signingOut else { return }
        cancelStartup()
        sessionRevision += 1
        let operation = sessionRevision
        signingIn = true
        problem = nil
        defer {
            if operation == sessionRevision {
                signingIn = false
                authentication = nil
                appleAuthentication = nil
            }
        }
        do {
            let session: SessionView
            let label = "Ruimte on \(UIDevice.current.model)"
            if provider == .apple {
                let authentication = NativeAppleAuthentication(anchor: window)
                appleAuthentication = authentication
                session = try await authentication.signIn(client: client, vault: vault, label: label)
            } else {
                let authentication = WebAuthentication(anchor: window)
                self.authentication = authentication
                session = try await authentication.signIn(
                    provider: provider, client: client, vault: vault, label: label)
            }
            guard operation == sessionRevision else {
                await withTaskCancellationShield {
                    await vault.discard(accessToken: session.accessToken)
                }
                return
            }
            account = session.account
            await refreshMachines()
        } catch LoginError.cancelled {
            return
        } catch {
            if operation == sessionRevision { problem = error.localizedDescription }
        }
    }

    func cancelSignIn() {
        authentication?.cancel()
        appleAuthentication?.cancel()
        authentication = nil
        appleAuthentication = nil
        if signingIn {
            sessionRevision += 1
            signingIn = false
        }
    }

    func refreshMachines() async {
        let operation = sessionRevision
        do {
            let token = try await vault?.accessToken()
            guard operation == sessionRevision else { return }
            guard let token else {
                account = nil
                applyMachines(pairedMachines)
                scheduleNotificationSync()
                if operation == sessionRevision { problem = nil }
                return
            }
            let result = try await client.listMachines(accessToken: token)
            guard operation == sessionRevision else { return }
            applyMachineList(result)
            scheduleNotificationSync()
            if operation == sessionRevision { problem = nil }
        } catch is CancellationError {
            return
        } catch {
            if operation == sessionRevision { problem = error.localizedDescription }
        }
    }

    private func scheduleNotificationSync() {
        notificationSyncTask?.cancel()
        notificationSyncTask = Task { [weak self] in await self?.notifications.synchronize() }
    }

    func applyMachineList(_ result: MachineListResult) {
        let removed = Set(result.removedMachineIds ?? [])
        let accountMachines = result.machines.filter { !removed.contains($0.id) }
        let accountByID = Dictionary(uniqueKeysWithValues: accountMachines.map { ($0.id, $0) })
        let paired = pairedMachines.filter { !removed.contains($0.id) }.map { accountByID[$0.id] ?? $0 }
        savePairedMachines(paired)
        for id in removed { invalidateMachine(id, forgetPairing: true) }
        applyMachines(accountMachines + paired.filter { accountByID[$0.id] == nil })
    }

    func forgetMachine(_ id: String) {
        invalidateMachine(id, forgetPairing: true)
        savePairedMachines(pairedMachines.filter { $0.id != id })
        machines.removeAll { $0.id == id }
        publishWidgetMachines()
    }

    private func applyMachines(_ next: [Machine]) {
        let byID = Dictionary(uniqueKeysWithValues: next.map { ($0.id, $0) })
        let previous = Dictionary(
            (machines + sessions.values.map(\.machine)).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        for (id, old) in previous {
            guard let replacement = byID[id] else {
                invalidateMachine(id, forgetPairing: true)
                continue
            }
            if old.publicKey != replacement.publicKey || old.brokerUrl != replacement.brokerUrl {
                invalidateMachine(id, forgetPairing: old.publicKey != replacement.publicKey)
            }
        }
        machines = next
        publishWidgetMachines()
    }

    private func publishWidgetMachines() {
        UsageWidgetStore.setMachines(machines.map { UsageWidgetMachine(id: $0.id, name: $0.name) })
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// For a background refresh, which has no scene of its own to let connections open.
    func refreshUsageWidgets() async {
        await start()
        let scene = "usage-widget-refresh"
        connections.setScene(scene, foreground: true)
        defer { connections.setScene(scene, foreground: false) }
        await withTaskGroup(of: Void.self) { group in
            for machine in machines {
                let held = self.session(for: machine)
                group.addTask { await held.refreshUsageWidget() }
            }
        }
    }

    private func invalidateMachine(_ id: String, forgetPairing: Bool) {
        connectionRevision += 1
        sessions.removeValue(forKey: id)?.invalidate()
        connections.forget(machineID: id)
        if forgetPairing { pairings.forget(machineID: id) }
    }

    private func savePairedMachines(_ machines: [Machine]) {
        if let data = try? JSONEncoder().encode(machines) { defaults.set(data, forKey: "ruimte.ios.pairedMachines") }
    }

    private var pairedMachines: [Machine] {
        guard let data = defaults.data(forKey: "ruimte.ios.pairedMachines") else { return [] }
        return (try? JSONDecoder().decode([Machine].self, from: data)) ?? []
    }

    func addPairedMachine(_ machine: Machine) {
        var paired = pairedMachines.filter { $0.id != machine.id }
        paired.append(machine)
        savePairedMachines(paired)
        invalidateMachine(machine.id, forgetPairing: false)
        machines.removeAll { $0.id == machine.id }
        machines.append(machine)
        publishWidgetMachines()
    }

    func signOut() async {
        guard !signingOut else { return }
        signingOut = true
        defer { signingOut = false }
        cancelStartup()
        cancelSignIn()
        sessionRevision += 1
        let operation = sessionRevision
        notificationSyncTask?.cancel()
        notificationSyncTask = nil
        await notifications.disable()
        for id in Set(machines.map(\.id)).union(sessions.keys) { invalidateMachine(id, forgetPairing: true) }
        sessions.removeAll()
        connections.disconnectAll()
        account = nil
        machines = []
        publishWidgetMachines()
        defaults.removeObject(forKey: "ruimte.ios.pairedMachines")
        problem = nil
        do {
            try await vault?.signOut()
        } catch {
            if operation == sessionRevision { problem = error.localizedDescription }
        }
    }
}
