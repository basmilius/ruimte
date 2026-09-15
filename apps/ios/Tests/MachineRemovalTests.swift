import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class MachineRemovalTests: XCTestCase {
    private func machine(
        _ id: String, key: String = String(repeating: "A", count: 43), broker: String = "wss://broker.test"
    ) -> Machine {
        Machine(id: id, name: id, icon: nil, publicKey: key, brokerUrl: broker, lastSeenAt: nil)
    }

    @MainActor func testAccountRemovalsForgetPairedMachinesButKeepManualOnlyMachines() throws {
        let domain = "app.ruimte.mobile.tests.machines.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        let pool = MachineConnections(monitorPaths: false)
        defer { pool.shutdown() }
        let runtime = AppRuntime(defaults: defaults, connections: pool)
        let removed = machine("removed")
        let manual = machine("manual")
        runtime.addPairedMachine(removed)
        runtime.addPairedMachine(manual)
        let pairings = UserDefaultsPairingStore(defaults: defaults)
        let identity = PairingIdentity(machineID: removed.id, machineKey: removed.publicKey, clientKey: "client")
        pairings.insert(identity)
        runtime.applyMachineList(MachineListResult(machines: [machine("account")], removedMachineIds: ["removed"]))
        XCTAssertEqual(Set(runtime.machines.map(\.id)), Set(["account", "manual"]))
        XCTAssertFalse(pairings.contains(identity))
        let persisted = try JSONDecoder().decode(
            [Machine].self, from: XCTUnwrap(defaults.data(forKey: "ruimte.ios.pairedMachines")))
        XCTAssertEqual(persisted.map(\.id), ["manual"])
        runtime.applyMachineList(MachineListResult(machines: []))
        XCTAssertEqual(runtime.machines.map(\.id), ["manual"])
    }

    @MainActor func testKeyAndBrokerChangesReplaceSessionsAndStaleMachineArgumentsUseCurrentIdentity() throws {
        let domain = "app.ruimte.mobile.tests.machine-identity.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        let pool = MachineConnections(monitorPaths: false)
        defer { pool.shutdown() }
        let runtime = AppRuntime(defaults: defaults, connections: pool)
        let old = machine("machine", key: String(repeating: "B", count: 43))
        runtime.addPairedMachine(old)
        let original = runtime.session(for: old)
        let pairings = UserDefaultsPairingStore(defaults: defaults)
        let identity = PairingIdentity(machineID: old.id, machineKey: old.publicKey, clientKey: "client")
        pairings.insert(identity)
        let rotated = machine("machine", key: String(repeating: "C", count: 43))
        runtime.applyMachineList(MachineListResult(machines: [rotated]))
        let current = runtime.session(for: old)
        XCTAssertFalse(current === original)
        XCTAssertEqual(current.machine.publicKey, rotated.publicKey)
        XCTAssertFalse(pairings.contains(identity))
        let rerouted = machine("machine", key: String(repeating: "C", count: 43), broker: "wss://replacement.test")
        runtime.applyMachineList(MachineListResult(machines: [rerouted]))
        let routed = runtime.session(for: old)
        XCTAssertFalse(routed === current)
        XCTAssertEqual(routed.machine.brokerUrl, "wss://replacement.test")
        runtime.forgetMachine("machine")
        XCTAssertTrue(runtime.machines.isEmpty)
        let removed = runtime.session(for: old)
        XCTAssertFalse(removed === routed)
        XCTAssertTrue(runtime.machines.isEmpty)
    }
}
