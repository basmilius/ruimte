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

    @MainActor func testAccountRemovalsForgetTheMachineItsPairingAndItsDoor() throws {
        let domain = "app.ruimte.mobile.tests.machines.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        let pool = MachineConnections(monitorPaths: false)
        defer { pool.shutdown() }
        let runtime = AppRuntime(defaults: defaults, connections: pool)
        let removed = machine("removed")
        runtime.applyMachineList(MachineListResult(machines: [removed, machine("kept")]))
        let pairings = UserDefaultsPairingStore(defaults: defaults)
        let identity = PairingIdentity(machineID: removed.id, machineKey: removed.publicKey, clientKey: "client")
        pairings.insert(identity)
        let door = LanDoorAddress(port: 4220, addresses: ["192.168.1.20"])
        runtime.lanDoors.remember(door, machineID: removed.id, machineKey: removed.publicKey)
        runtime.applyMachineList(MachineListResult(machines: [machine("kept")], removedMachineIds: ["removed"]))
        XCTAssertEqual(runtime.machines.map(\.id), ["kept"])
        XCTAssertFalse(pairings.contains(identity))
        XCTAssertNil(runtime.lanDoors.door(machineID: removed.id, machineKey: removed.publicKey, hasBroker: false))
    }

    /// A machine without a broker is still reachable once this phone knows the door on its local network.
    @MainActor func testAMachineIsReachableThroughItsBrokerOrItsDoor() throws {
        let domain = "app.ruimte.mobile.tests.reach.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        let runtime = AppRuntime(defaults: defaults, connections: MachineConnections(monitorPaths: false))
        let insecure = Machine(
            id: "studio", name: "Studio", icon: nil, publicKey: String(repeating: "A", count: 43),
            brokerUrl: "ws://broker.test", lastSeenAt: nil)
        XCTAssertTrue(runtime.reachable(machine("secure")))
        XCTAssertFalse(runtime.reachable(insecure))
        let door = LanDoorAddress(port: 4220, addresses: ["192.168.1.20"])
        runtime.lanDoors.remember(door, machineID: insecure.id, machineKey: insecure.publicKey)
        XCTAssertTrue(runtime.reachable(insecure))
        runtime.lanDoors.skip(machineID: insecure.id)
        XCTAssertTrue(runtime.reachable(insecure), "Without a broker the door is the only way, skipped or not")
    }

    @MainActor func testKeyAndBrokerChangesReplaceSessionsAndStaleMachineArgumentsUseCurrentIdentity() throws {
        let domain = "app.ruimte.mobile.tests.machine-identity.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        let pool = MachineConnections(monitorPaths: false)
        defer { pool.shutdown() }
        let runtime = AppRuntime(defaults: defaults, connections: pool)
        let old = machine("machine", key: String(repeating: "B", count: 43))
        runtime.applyMachineList(MachineListResult(machines: [old]))
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
