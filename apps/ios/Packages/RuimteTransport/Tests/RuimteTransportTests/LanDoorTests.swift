import Foundation
import RuimtePulsar
import XCTest

@testable import RuimteTransport

private let candidate: JSONValue = .object([
    "connectionId": .string("connection_1"),
    "signal": .object([
        "kind": .string("candidate"), "candidate": .string(""), "sdpMid": .null, "sdpMLineIndex": .null,
    ]),
])

/// The machine's end of a door: it proves itself over the client's nonce and signs what it sends.
private struct DoorMachine {
    let id = "studio"
    let key = DeviceKey()

    func proof(for hello: JSONValue?, signer: DeviceKey? = nil, id: String? = nil, publicKey: String? = nil) throws
        -> JSONValue
    {
        let nonce = try XCTUnwrap(hello?["nonce"]?.stringValue)
        let message = try DirectIdentity.lanDoorMessage(nonce: nonce, machineID: self.id, publicKey: key.publicKey)
        return .object([
            "type": .string("door"), "machineId": .string(id ?? self.id),
            "publicKey": .string(publicKey ?? key.publicKey), "signature": .string(try (signer ?? key).sign(message)),
        ])
    }

    func answer(to client: String, connectionID: String = "connection_1", signer: DeviceKey? = nil) throws -> JSONValue
    {
        let envelope: JSONValue = .object([
            "connectionId": .string(connectionID),
            "signal": .object(["kind": .string("answer"), "sdp": .string("v=0")]),
        ])
        let message = try DirectIdentity.signalMessage(from: key.publicKey, to: client, envelope: envelope)
        return .object([
            "type": .string("signal"), "envelope": envelope, "signature": .string(try (signer ?? key).sign(message)),
        ])
    }
}

final class LanDoorPeerTests: XCTestCase {
    /// The bytes `lanDoorMessage` in `packages/pulsar/src/signing.ts` writes for the same three strings.
    func testTheDoorMessageMatchesWhatJavaScriptSigns() throws {
        let message = try DirectIdentity.lanDoorMessage(
            nonce: "n0nce-n0nce_n0nce-n0nce", machineID: "studio/mac \"é\"", publicKey: "K3y_with-URL-safe")
        XCTAssertEqual(
            message, "pulsar-lan-door-v1\n" + #"["n0nce-n0nce_n0nce-n0nce","studio/mac \"é\"","K3y_with-URL-safe"]"#)
    }

    func testTheClientSaysWhoItIsOnlyAfterTheMachineProvedItself() throws {
        let machine = DoorMachine()
        let client = DeviceKey()
        var peer = LanDoorPeer(
            machineID: machine.id, machineKey: machine.key.publicKey, signer: client,
            nonce: String(repeating: "n", count: 43))
        let hello = peer.hello()
        XCTAssertEqual(hello, .object(["type": .string("hello"), "nonce": .string(String(repeating: "n", count: 43))]))
        XCTAssertThrowsError(try peer.signal(candidate))
        XCTAssertEqual(try peer.receive(machine.proof(for: hello)), [.ready])
        let frame = try peer.signal(candidate)
        XCTAssertEqual(frame["from"]?.stringValue, client.publicKey)
        XCTAssertTrue(
            DirectIdentity.verify(
                publicKey: client.publicKey,
                message: try DirectIdentity.signalMessage(
                    from: client.publicKey, to: machine.key.publicKey, envelope: candidate),
                signature: try XCTUnwrap(frame["signature"]?.stringValue)))
        let answer = try machine.answer(to: client.publicKey)
        XCTAssertEqual(try peer.receive(answer), [.signal(answer["envelope"]!)])
        XCTAssertEqual(try peer.receive(.object(["type": .string("notice")])), [])
    }

    func testAProofThatDoesNotHoldIsRefused() throws {
        let machine = DoorMachine()
        let impostor = DeviceKey()
        let forgeries: [(JSONValue) throws -> JSONValue] = [
            { hello in try machine.proof(for: hello, signer: impostor) },
            { hello in try machine.proof(for: hello, publicKey: impostor.publicKey) },
            { hello in try machine.proof(for: hello, id: "another") },
            { _ in try machine.proof(for: .object(["nonce": .string(String(repeating: "x", count: 43))])) },
        ]
        for forge in forgeries {
            var peer = LanDoorPeer(
                machineID: machine.id, machineKey: machine.key.publicKey, signer: DeviceKey(),
                nonce: String(repeating: "n", count: 43))
            let hello = peer.hello()
            XCTAssertThrowsError(try peer.receive(forge(hello)))
            XCTAssertFalse(peer.isReady)
        }
    }

    func testNothingButAProofOrAnErrorComesBeforeTheProof() throws {
        let machine = DoorMachine()
        let client = DeviceKey()
        var peer = LanDoorPeer(
            machineID: machine.id, machineKey: machine.key.publicKey, signer: client,
            nonce: String(repeating: "n", count: 43))
        _ = peer.hello()
        XCTAssertThrowsError(try peer.receive(machine.answer(to: client.publicKey)))
        XCTAssertThrowsError(try peer.receive(.object(["type": .string("notice")])))
        XCTAssertEqual(
            try peer.receive(
                .object(["type": .string("error"), "code": .string("rate-limited"), "message": .string("Slow down")])),
            [.refused("Slow down")])
    }

    func testAnAnswerSignedByAnotherKeyIsRefused() throws {
        let machine = DoorMachine()
        let client = DeviceKey()
        var peer = LanDoorPeer(
            machineID: machine.id, machineKey: machine.key.publicKey, signer: client,
            nonce: String(repeating: "n", count: 43))
        let hello = peer.hello()
        _ = try peer.receive(machine.proof(for: hello))
        XCTAssertThrowsError(try peer.receive(machine.answer(to: client.publicKey, signer: DeviceKey())))
    }

    func testAddressesBecomeSocketsWithIPv6InBrackets() {
        let door = LanDoorAddress(
            .object([
                "port": .number(4220), "addresses": .array([.string("192.168.1.20"), .string("fd7a:115c::1")]),
            ]))
        XCTAssertEqual(
            door?.urls.map(\.absoluteString), ["ws://192.168.1.20:4220/signal", "ws://[fd7a:115c::1]:4220/signal"])
        XCTAssertNil(LanDoorAddress(.null))
        XCTAssertNil(LanDoorAddress(nil))
        XCTAssertNil(LanDoorAddress(.object(["port": .number(4220), "addresses": .array([])])))
        XCTAssertNil(LanDoorAddress(.object(["port": .number(70_000), "addresses": .array([.string("10.0.0.2")])])))
    }
}

final class SignalingRaceTests: XCTestCase {
    private let broker = URL(string: "wss://broker.test")!

    @MainActor private final class Harness {
        let machine = DoorMachine()
        let client = DeviceKey()
        let scheduler = FakeScheduler()
        var doors: [String: FakeSignalSocket] = [:]
        var brokerSockets: [FakeSignalSocket] = []
        var routes: [SignalingRoute] = []
        var signals: [JSONValue] = []
        var failures: [String] = []
        /// What the link holds in the app; the race keeps no strong hold on itself.
        var races: [SignalingRace] = []
        lazy var sockets = BrokerSockets(createSocket: { [unowned self] _ in
            let socket = FakeSignalSocket()
            brokerSockets.append(socket)
            return socket
        })

        func race(addresses: [String], broker: URL?) throws -> SignalingRace {
            let lan = addresses.isEmpty ? nil : LanDoorAddress(port: 4220, addresses: addresses)
            let signaling = MachineSignaling(
                machineID: machine.id, machineKey: machine.key.publicKey, signer: client, lan: lan, brokerURL: broker,
                sockets: sockets,
                openDoor: { [unowned self] url in
                    let socket = FakeSignalSocket()
                    doors[url.host ?? ""] = socket
                    return socket
                })
            let race = try signaling.race(
                connectionID: "connection_1", scheduler: scheduler,
                events: .init(
                    ready: { [unowned self] route, _ in routes.append(route) },
                    signal: { [unowned self] in signals.append($0) },
                    failed: { [unowned self] in failures.append($0.localizedDescription) }))
            races.append(race)
            race.start()
            return race
        }

        func prove(_ host: String) throws {
            let socket = try XCTUnwrap(doors[host])
            try socket.receive(machine.proof(for: socket.writes.first))
        }

        func brokerReady() throws {
            let socket = try XCTUnwrap(brokerSockets.first)
            try socket.receive(.object(["type": .string("ready")]))
            try socket.receive(
                .object([
                    "type": .string("ice"), "id": socket.writes.last!["id"]!, "servers": .array([]), "expiresAt": .null,
                ]))
        }
    }

    @MainActor func testTheFirstDoorThatProvesItselfCarriesTheAttempt() throws {
        let harness = Harness()
        let race = try harness.race(addresses: ["192.168.1.20", "10.0.0.5"], broker: broker)
        XCTAssertEqual(harness.scheduler.delays, [SignalingRace.brokerDelayMilliseconds])
        XCTAssertEqual(SignalingRace.brokerDelayMilliseconds, 1_000)
        try harness.prove("10.0.0.5")
        XCTAssertEqual(harness.routes, [.localNetwork])
        XCTAssertTrue(harness.doors["192.168.1.20"]!.closed)
        XCTAssertFalse(harness.doors["10.0.0.5"]!.closed)
        XCTAssertTrue(harness.scheduler.pending.isEmpty)
        XCTAssertTrue(harness.brokerSockets.isEmpty)

        try race.send(candidate)
        let door = harness.doors["10.0.0.5"]!
        XCTAssertEqual(door.writes.last?["type"]?.stringValue, "signal")
        XCTAssertEqual(door.writes.last?["from"]?.stringValue, harness.client.publicKey)
        try door.receive(harness.machine.answer(to: harness.client.publicKey))
        try door.receive(harness.machine.answer(to: harness.client.publicKey, connectionID: "connection_2"))
        XCTAssertEqual(harness.signals.count, 1)
        race.close()
        XCTAssertTrue(door.closed)
    }

    @MainActor func testAWrongProofIsRefusedBeforeTheClientKeyLeaves() throws {
        let harness = Harness()
        _ = try harness.race(addresses: ["192.168.1.20"], broker: nil)
        let door = try XCTUnwrap(harness.doors["192.168.1.20"])
        try door.receive(harness.machine.proof(for: door.writes.first, signer: DeviceKey()))
        XCTAssertEqual(door.writes.count, 1)
        XCTAssertEqual(door.writes.first?["type"]?.stringValue, "hello")
        let written = String(decoding: try JSONValue.array(door.writes).encoded(), as: UTF8.self)
        XCTAssertFalse(written.contains(harness.client.publicKey))
        XCTAssertTrue(door.closed)
        XCTAssertEqual(harness.routes, [])
        XCTAssertEqual(harness.failures.count, 1)
    }

    @MainActor func testTheBrokerJoinsWhenNoDoorIsReadyWithinASecondAndWinsWhenItIsReadyFirst() throws {
        let harness = Harness()
        _ = try harness.race(addresses: ["192.168.1.20"], broker: broker)
        XCTAssertTrue(harness.brokerSockets.isEmpty)
        harness.scheduler.advance()
        XCTAssertEqual(harness.brokerSockets.count, 1)
        try harness.brokerReady()
        XCTAssertEqual(harness.routes, [.broker])
        XCTAssertTrue(harness.doors["192.168.1.20"]!.closed)
    }

    @MainActor func testADoorReadyAfterTheBrokerJoinedStillWins() throws {
        let harness = Harness()
        _ = try harness.race(addresses: ["192.168.1.20"], broker: broker)
        harness.scheduler.advance()
        try harness.prove("192.168.1.20")
        XCTAssertEqual(harness.routes, [.localNetwork])
        XCTAssertTrue(harness.brokerSockets[0].closed)
        XCTAssertEqual(harness.sockets.socketCount, 0)
    }

    /// A refused Local Network permission fails every door at once, and the broker goes on without waiting or a word.
    @MainActor func testDoorsThatFailAtOnceHandTheAttemptToTheBrokerSilently() throws {
        let harness = Harness()
        _ = try harness.race(addresses: ["192.168.1.20", "10.0.0.5"], broker: broker)
        for door in harness.doors.values { door.failed?(URLError(.notConnectedToInternet)) }
        XCTAssertEqual(harness.brokerSockets.count, 1)
        XCTAssertTrue(harness.scheduler.pending.isEmpty)
        XCTAssertEqual(harness.failures, [])
        try harness.brokerReady()
        XCTAssertEqual(harness.routes, [.broker])
    }

    @MainActor func testWithoutAddressesTheBrokerIsTheWayAtOnce() throws {
        let harness = Harness()
        _ = try harness.race(addresses: [], broker: broker)
        XCTAssertEqual(harness.brokerSockets.count, 1)
        XCTAssertEqual(harness.scheduler.delays, [])
        XCTAssertThrowsError(try harness.race(addresses: [], broker: nil))
    }

    @MainActor func testTheBrokersFailureIsWhatThePersonReadsOnceTheDoorsFailedToo() throws {
        let harness = Harness()
        _ = try harness.race(addresses: ["192.168.1.20"], broker: broker)
        harness.scheduler.advance()
        harness.brokerSockets[0].failed?(TransportFailure.invalid("Broker down"))
        XCTAssertEqual(harness.failures, [])
        harness.doors["192.168.1.20"]!.failed?(URLError(.timedOut))
        XCTAssertEqual(harness.failures, ["Broker down"])
    }

    @MainActor func testTheWinnerLosingItsWayEndsTheAttempt() throws {
        let harness = Harness()
        _ = try harness.race(addresses: ["192.168.1.20"], broker: broker)
        try harness.prove("192.168.1.20")
        harness.doors["192.168.1.20"]!.failed?(URLError(.networkConnectionLost))
        XCTAssertEqual(harness.failures.count, 1)
        XCTAssertTrue(harness.brokerSockets.isEmpty)
    }
}

final class LanDoorsTests: XCTestCase {
    @MainActor func testADoorIsKeptPerMachineKeyAndSkippedForFiveMinutesAfterAFailure() throws {
        let domain = "app.ruimte.transport.tests.lan-doors.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        var now = 0.0
        let door = LanDoorAddress(port: 4220, addresses: ["192.168.1.20"])
        let doors = LanDoors(defaults: defaults, now: { now })
        doors.remember(door, machineID: "studio", machineKey: "key")
        XCTAssertEqual(LanDoors(defaults: defaults).door(machineID: "studio", machineKey: "key", hasBroker: true), door)
        XCTAssertNil(doors.door(machineID: "studio", machineKey: "rotated", hasBroker: true))

        doors.skip(machineID: "studio")
        XCTAssertNil(doors.door(machineID: "studio", machineKey: "key", hasBroker: true))
        XCTAssertEqual(doors.door(machineID: "studio", machineKey: "key", hasBroker: false), door)
        now += LanDoors.skipMilliseconds - 1
        XCTAssertNil(doors.door(machineID: "studio", machineKey: "key", hasBroker: true))
        now += 1
        XCTAssertEqual(doors.door(machineID: "studio", machineKey: "key", hasBroker: true), door)
        XCTAssertEqual(LanDoors.skipMilliseconds, 300_000)

        doors.remember(nil, machineID: "studio", machineKey: "key")
        XCTAssertNil(doors.door(machineID: "studio", machineKey: "key", hasBroker: true))
        doors.remember(door, machineID: "studio", machineKey: "key")
        doors.forget(machineID: "studio")
        XCTAssertNil(doors.door(machineID: "studio", machineKey: "key", hasBroker: false))
    }
}
