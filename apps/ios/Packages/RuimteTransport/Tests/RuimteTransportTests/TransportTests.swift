import Foundation
import RuimtePulsar
import XCTest

@testable import RuimteTransport

final class TransportTests: XCTestCase {
    func testUTF16FramingAndLimit() {
        let text = "a🚀e\u{301}😀z"
        let pieces = DirectFraming.split(text, pieceChars: 3)
        XCTAssertEqual(pieces, ["+a🚀", "+e\u{301}", "=😀z"])
        XCTAssertTrue(pieces.allSatisfy { String($0.dropFirst()).utf16.count <= 3 })
        var assembler = FrameAssembler()
        XCTAssertEqual(assembler.push(pieces[0], maxChars: 8), .partial)
        XCTAssertEqual(assembler.push(pieces[1], maxChars: 8), .partial)
        XCTAssertEqual(assembler.push(pieces[2], maxChars: 8), .frame(text))
        XCTAssertEqual(assembler.push("+🚀", maxChars: 2), .partial)
        XCTAssertEqual(assembler.push("=x", maxChars: 2), .invalid)
        XCTAssertEqual(assembler.push("=ok", maxChars: 2), .frame("ok"))
        XCTAssertEqual(assembler.push("missing marker", maxChars: 50), .invalid)
        XCTAssertEqual(assembler.push("=\u{301}a", maxChars: 2), .frame("\u{301}a"))
    }

    func testLivenessUsesPacketsAndStartsTimeoutAtPing() {
        var alive = ChannelLiveness(now: 0)
        XCTAssertEqual(alive.tick(now: 60_000, received: 0), .ping("alive-1"))
        XCTAssertEqual(alive.tick(now: 69_999, received: 0), .none)
        XCTAssertEqual(alive.tick(now: 70_000, received: 1), .none)
        XCTAssertEqual(alive.tick(now: 72_000, received: 1), .ping("alive-2"))
        alive.heard(now: 73_000)
        XCTAssertEqual(alive.tick(now: 74_000), .none)
        XCTAssertEqual(alive.tick(now: 75_000), .ping("alive-3"))
        XCTAssertEqual(alive.tick(now: 85_000), .dead)
    }

    func testProofRejectsIdentityBindingSignatureAndProtocol() throws {
        let machine = DeviceKey()
        let client = DeviceKey()
        let binding = try DirectIdentity.channelBinding(
            offer: "a=fingerprint:sha-256 ab:cd\r\n", answer: "a=fingerprint:sha-256 ef:ab\r\n")
        let nonce = "challenge"
        let message = "ruimte-daemon-channel-v1\nmachine\n\(nonce)\n\(binding)"
        let challenge: JSONValue = .object([
            "type": .string("direct.challenge"), "protocol": .number(Double(WireConstants.protocolVersion)),
            "challenge": .string(nonce),
            "daemon": .object([
                "id": .string("machine"), "publicKey": .string(machine.publicKey),
                "signature": .string(try machine.sign(message)),
            ]),
        ])
        let proof = try DirectIdentity.proof(
            challenge: challenge, binding: binding, machineID: "machine", machineKey: machine.publicKey, signer: client)
        XCTAssertEqual(proof["publicKey"]?.stringValue, client.publicKey)
        XCTAssertTrue(
            DirectIdentity.verify(
                publicKey: client.publicKey,
                message: "ruimte-client-channel-v1\nmachine\nchallenge\n\(client.publicKey)\n\(binding)",
                signature: proof["signature"]!.stringValue!))
        XCTAssertThrowsError(
            try DirectIdentity.proof(
                challenge: challenge, binding: "different", machineID: "machine", machineKey: machine.publicKey,
                signer: client))
        XCTAssertThrowsError(
            try DirectIdentity.proof(
                challenge: challenge, binding: binding, machineID: "another", machineKey: machine.publicKey,
                signer: client))
        XCTAssertThrowsError(
            try DirectIdentity.proof(
                challenge: challenge, binding: binding, machineID: "machine", machineKey: client.publicKey,
                signer: client))
        var changed = challenge.objectValue!
        changed["protocol"] = .number(999)
        XCTAssertThrowsError(
            try DirectIdentity.proof(
                challenge: .object(changed), binding: binding, machineID: "machine", machineKey: machine.publicKey,
                signer: client))
        changed.removeValue(forKey: "protocol")
        XCTAssertThrowsError(
            try DirectIdentity.proof(
                challenge: .object(changed), binding: binding, machineID: "machine", machineKey: machine.publicKey,
                signer: client))
        XCTAssertFalse(
            DirectIdentity.verify(
                publicKey: machine.publicKey, message: message + "tampered", signature: try machine.sign(message)))
    }

    func testBrokerHostAndSignatures() throws {
        let key = DeviceKey()
        var peer = BrokerPeer(host: "broker.test:443", signer: key)
        XCTAssertEqual(try peer.start().count, 1)
        XCTAssertEqual(try peer.start(), [])
        XCTAssertNil(try peer.ice())
        let challenge: JSONValue = .object([
            "type": .string("challenge"), "broker": .string("broker.test:443"),
            "nonce": .string(String(repeating: "a", count: 22)),
        ])
        let answer = try peer.receive(challenge)
        guard case .send(let frame) = answer.first else { return XCTFail("Missing proof") }
        XCTAssertTrue(
            DirectIdentity.verify(
                publicKey: key.publicKey,
                message:
                    "pulsar-broker-hello-v1\n[\"broker.test:443\",\"client\",\"\(key.publicKey)\",\"\(String(repeating: "a", count: 22))\"]",
                signature: frame["signature"]!.stringValue!))
        XCTAssertEqual(try peer.receive(.object(["type": .string("ready")])), [.ready])
        XCTAssertNotNil(try peer.ice())
        let envelope: JSONValue = .object([
            "connectionId": .string("connection_1"),
            "signal": .object([
                "kind": .string("candidate"), "candidate": .string(""), "sdpMid": .null, "sdpMLineIndex": .null,
            ]),
        ])
        let relay = try XCTUnwrap(peer.relay(to: DeviceKey().publicKey, envelope: envelope))
        XCTAssertTrue(
            DirectIdentity.verify(
                publicKey: key.publicKey,
                message: try DirectIdentity.signalMessage(
                    from: key.publicKey, to: relay["to"]!.stringValue!, envelope: envelope),
                signature: relay["signature"]!.stringValue!))
        var wrongHost = BrokerPeer(host: "attacker.test", signer: key)
        _ = try wrongHost.start()
        XCTAssertThrowsError(try wrongHost.receive(challenge))
    }

    func testIceDeduplicationPreservesDifferentTurnCredentials() throws {
        let own: JSONValue = .object(["urls": .string("stun:turn.test:3478")])
        let route: JSONValue = .object([
            "urls": .array([.string("stun:turn.test:3478"), .string("turn:turn.test:3478")]),
            "username": .string("first"), "credential": .string("secret"),
        ])
        let other: JSONValue = .object([
            "urls": .string("turn:turn.test:3478"), "username": .string("second"), "credential": .string("secret"),
        ])
        let merged = try IceServers.merge(own: [own], route: [route, route, other])
        XCTAssertEqual(merged.count, 3)
        XCTAssertEqual(merged[0]["urls"]?.arrayValue, [.string("stun:turn.test:3478")])
        XCTAssertEqual(merged[1]["urls"]?.arrayValue, [.string("turn:turn.test:3478")])
        XCTAssertEqual(merged[2]["username"]?.stringValue, "second")
    }
}

@MainActor private final class FakeBrokerSocket: BrokerSocket {
    var received: ((String) -> Void)?
    var failed: ((Error) -> Void)?
    var writes: [JSONValue] = []
    var closed = false
    func start() {}
    func send(_ text: String) { writes.append(try! JSONValue.decode(Data(text.utf8))) }
    func close() {
        closed = true
        received = nil
        failed = nil
    }
    func receive(_ frame: JSONValue) throws { received?(try wireText(frame)) }
}

@MainActor private final class FakeScheduler: TransportScheduling {
    var pending: [UUID: @MainActor () -> Void] = [:]
    var delays: [Double] = []
    func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void {
        let id = UUID()
        delays.append(milliseconds)
        pending[id] = action
        return { self.pending.removeValue(forKey: id) }
    }
    func advance() {
        let actions = Array(pending.values)
        pending.removeAll()
        for action in actions { action() }
    }
}

@MainActor private final class FakeLink: MachineLink {
    let events: LinkEvents
    var closes = 0
    init(events: LinkEvents) { self.events = events }
    func send(_ text: String) throws {}
    func close() {
        closes += 1
        events.closed(nil)
    }
}

final class BrokerAndLifecycleTests: XCTestCase {
    @MainActor func testForgetInvalidatesOldLinkAndLeaseWithoutTouchingReplacement() throws {
        let scheduler = FakeScheduler()
        let pool = MachineConnections(scheduler: scheduler, monitorPaths: false)
        pool.setScene("scene", foreground: true)
        var old: FakeLink!
        var replacement: FakeLink!
        var received: [String] = []
        let events = LinkEvents(opened: {}, message: { received.append($0) }, closed: { _ in })
        let oldLease = pool.hold(
            machineID: "machine",
            open: {
                old = FakeLink(events: $0)
                return old
            }, events: events)
        old.events.opened()
        pool.forget(machineID: "machine")
        XCTAssertEqual(old.closes, 1)
        XCTAssertThrowsError(try oldLease.send("stale"))
        let newLease = pool.hold(
            machineID: "machine",
            open: {
                replacement = FakeLink(events: $0)
                return replacement
            }, events: events)
        replacement.events.opened()
        old.events.message("stale event")
        replacement.events.message("current event")
        XCTAssertEqual(received, ["current event"])
        pool.setScene("scene", foreground: false)
        oldLease.release()
        XCTAssertEqual(pool.machineCount, 1)
        pool.setScene("scene", foreground: true)
        XCTAssertEqual(pool.machineCount, 1)
        newLease.release()
        pool.shutdown()
    }

    @MainActor func testParallelAttemptsShareSocketWaitForIceAndRefreshExpiry() throws {
        var sockets: [FakeBrokerSocket] = []
        var now = 0.0
        let pool = BrokerSockets(
            now: { now },
            createSocket: { _ in
                let socket = FakeBrokerSocket()
                sockets.append(socket)
                return socket
            })
        let key = DeviceKey()
        var ready = 0
        let member = BrokerSockets.Member(
            ready: { _ in ready += 1 }, relayed: { _ in }, refused: { _ in }, lost: { _ in XCTFail("Unexpected loss") })
        let first = try pool.join(url: URL(string: "wss://broker.test")!, signer: key, member: member)
        let second = try pool.join(url: URL(string: "wss://broker.test")!, signer: key, member: member)
        XCTAssertEqual(sockets.count, 1)
        try sockets[0].receive(.object(["type": .string("ready")]))
        XCTAssertEqual(ready, 0)
        XCTAssertEqual(sockets[0].writes.last?["type"]?.stringValue, "ice")
        let iceID = sockets[0].writes.last!["id"]!
        try sockets[0].receive(
            .object(["type": .string("ice"), "id": iceID, "servers": .array([]), "expiresAt": .number(100)]))
        XCTAssertEqual(ready, 2)
        now = 101
        let third = try pool.join(url: URL(string: "wss://broker.test")!, signer: key, member: member)
        XCTAssertEqual(ready, 2)
        XCTAssertNotEqual(sockets[0].writes.last?["id"], iceID)
        let refreshID = sockets[0].writes.last!["id"]!
        try sockets[0].receive(
            .object(["type": .string("ice"), "id": refreshID, "servers": .array([]), "expiresAt": .number(200)]))
        XCTAssertEqual(ready, 3)
        first.leave()
        second.leave()
        XCTAssertFalse(sockets[0].closed)
        third.leave()
        XCTAssertTrue(sockets[0].closed)
        XCTAssertEqual(pool.socketCount, 0)
    }

    @MainActor func testExpiredIceAnswerFailsBeforeGathering() throws {
        let socket = FakeBrokerSocket()
        let pool = BrokerSockets(now: { 100 }, createSocket: { _ in socket })
        var failures = 0
        let member = BrokerSockets.Member(
            ready: { _ in XCTFail("Must not gather") }, relayed: { _ in }, refused: { _ in },
            lost: { _ in failures += 1 })
        let first = try pool.join(url: URL(string: "wss://broker.test")!, signer: DeviceKey(), member: member)
        try socket.receive(.object(["type": .string("ready")]))
        let iceID = socket.writes.last!["id"]!
        try socket.receive(
            .object(["type": .string("ice"), "id": iceID, "servers": .array([]), "expiresAt": .number(99)]))
        XCTAssertEqual(failures, 1)
        XCTAssertEqual(pool.socketCount, 0)
        first.leave()
    }

    @MainActor func testCancelledAttemptCannotReceiveIceReadiness() throws {
        let socket = FakeBrokerSocket()
        let pool = BrokerSockets(createSocket: { _ in socket })
        let key = DeviceKey()
        var ready = 0
        let cancelled = try pool.join(
            url: URL(string: "wss://broker.test")!, signer: key,
            member: .init(
                ready: { _ in XCTFail("Cancelled member became ready") }, relayed: { _ in }, refused: { _ in },
                lost: { _ in }))
        let held = try pool.join(
            url: URL(string: "wss://broker.test")!, signer: key,
            member: .init(ready: { _ in ready += 1 }, relayed: { _ in }, refused: { _ in }, lost: { _ in }))
        try socket.receive(.object(["type": .string("ready")]))
        cancelled.leave()
        try socket.receive(
            .object([
                "type": .string("ice"), "id": socket.writes.last!["id"]!, "servers": .array([]), "expiresAt": .null,
            ]))
        XCTAssertEqual(ready, 1)
        held.leave()
        XCTAssertTrue(socket.closed)
    }

    @MainActor func testMultipleScenesOneMachineAndReconnectCancellation() {
        let scheduler = FakeScheduler()
        let pool = MachineConnections(scheduler: scheduler, monitorPaths: false)
        var links: [FakeLink] = []
        let opener: MachineConnections.Opener = { events in
            let link = FakeLink(events: events)
            links.append(link)
            return link
        }
        let events = LinkEvents(opened: {}, message: { _ in }, closed: { _ in })
        pool.setScene("one", foreground: true)
        pool.setScene("two", foreground: true)
        let first = pool.hold(machineID: "machine", open: opener, events: events)
        let second = pool.hold(machineID: "machine", open: opener, events: events)
        XCTAssertEqual(links.count, 1)
        links[0].events.opened()
        pool.setScene("one", foreground: false)
        XCTAssertEqual(links[0].closes, 0)
        pool.setScene("two", foreground: false)
        XCTAssertEqual(links[0].closes, 1)
        pool.setScene("one", foreground: true)
        XCTAssertEqual(links.count, 2)
        links[0].events.closed(TransportFailure.invalid("Stale callback"))
        XCTAssertEqual(scheduler.pending.count, 0)
        links[1].events.closed(TransportFailure.invalid("Network lost"))
        XCTAssertEqual(scheduler.pending.count, 1)
        scheduler.advance()
        XCTAssertEqual(links.count, 3)
        pool.pathChanged(fingerprint: "wifi", reachable: true)
        pool.pathChanged(fingerprint: "cellular", reachable: true)
        XCTAssertEqual(links.count, 4)
        first.release()
        XCTAssertEqual(pool.machineCount, 1)
        second.release()
        XCTAssertEqual(scheduler.delays.last, 30_000)
        XCTAssertEqual(pool.machineCount, 1)
        let returning = pool.hold(machineID: "machine", open: opener, events: events)
        XCTAssertEqual(scheduler.pending.count, 0)
        XCTAssertEqual(links.count, 4)
        returning.release()
        scheduler.advance()
        XCTAssertEqual(pool.machineCount, 0)
        XCTAssertEqual(links.count, 4)
        pool.shutdown()
    }
}
