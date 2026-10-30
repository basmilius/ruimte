import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor final class AccountLoginTests: XCTestCase {
    private func status(_ state: String, email: String? = nil, checkedAt: Double = 1) -> JSONValue {
        .object([
            "id": .string("work"), "state": .string(state), "email": email.map(JSONValue.string) ?? .null,
            "checkedAt": .number(checkedAt),
        ])
    }

    func testALoginLandsOnlyOnceTheAccountReadsDifferentlyLoggedIn() {
        XCTAssertFalse(AccountLoginModel.landed(before: nil, now: status("signed-out")))
        XCTAssertTrue(AccountLoginModel.landed(before: nil, now: status("ready")))
        XCTAssertTrue(AccountLoginModel.landed(before: status("signed-out"), now: status("ready")))
        XCTAssertFalse(
            AccountLoginModel.landed(before: status("ready", checkedAt: 1), now: status("ready", checkedAt: 9)))
        XCTAssertTrue(AccountLoginModel.landed(before: status("ready"), now: status("ready", email: "me@example.com")))
    }

    func testALoginRunsInASessionOfItsOwnAndEndsWithTheSheet() async {
        let machine = LoginMachine()
        let model = AccountLoginModel(client: machine, kind: "claude", accountID: "work", name: "Work")
        await model.begin()
        XCTAssertEqual(model.phase, .running)
        let login = machine.sent.first { $0.0 == "session.login" }?.1
        XCTAssertEqual(login?["sessionId"], .string(model.sessionID))
        XCTAssertEqual(login?["kind"], .string("claude"))
        XCTAssertEqual(login?["account"], .string("work"))
        XCTAssertTrue(machine.sent.contains { $0.0 == "accounts.watchLogin" })
        machine.emit("accounts.changed", .object(["statuses": .array([status("ready", email: "me@example.com")])]))
        XCTAssertEqual(model.phase, .landed(email: "me@example.com"))
        await model.end()
        XCTAssertEqual(machine.sent.last?.0, "session.kill")
        XCTAssertEqual(machine.sent.last?.1["sessionId"], .string(model.sessionID))
    }

    func testAShellThatEndsSaysSoAndATryAgainStartsAFreshSession() async {
        let machine = LoginMachine()
        let model = AccountLoginModel(client: machine, kind: "codex", accountID: "work", name: "Work")
        await model.begin()
        let first = model.sessionID
        machine.emit("session.exit", .object(["sessionId": .string("someone-else")]))
        XCTAssertEqual(model.phase, .running)
        machine.emit("session.exit", .object(["sessionId": .string(first)]))
        XCTAssertEqual(model.phase, .ended(dropped: false))
        await model.retry()
        XCTAssertNotEqual(model.sessionID, first)
        XCTAssertEqual(model.phase, .running)
        XCTAssertTrue(machine.sent.contains { $0.0 == "session.kill" && $0.1["sessionId"] == .string(first) })
    }

    func testARefusedLoginFailsAndNothingIsKilled() async {
        let machine = LoginMachine()
        machine.refusal = "forbidden"
        let model = AccountLoginModel(client: machine, kind: "claude", accountID: "claude", name: "Claude")
        await model.begin()
        XCTAssertEqual(model.phase, .failed("forbidden"))
        await model.end()
        XCTAssertFalse(machine.sent.contains { $0.0 == "session.kill" })
    }

    func testASilentLoginNeedsAnExplicitFinishAndRechecksWithoutClaimingSuccess() async {
        let machine = LoginMachine()
        let model = AccountLoginModel(client: machine, kind: "claude", accountID: "work", name: "Work", silent: true)
        await model.begin()
        XCTAssertFalse(machine.sent.contains { $0.0 == "accounts.watchLogin" })
        machine.emit("accounts.changed", .object(["statuses": .array([status("ready", email: "me@example.com")])]))
        XCTAssertEqual(model.phase, .running)
        await model.finish()
        XCTAssertEqual(machine.sent.last?.0, "accounts.refresh")
        XCTAssertTrue(machine.sent.contains { $0.0 == "session.kill" && $0.1["sessionId"] == .string(model.sessionID) })
    }

    func testTheNativeOfferSendsTheV2AccessStatement() async throws {
        let key = DeviceKey()
        let machineKey = DeviceKey().publicKey
        let client = AddressBookClient(fetch: { request in
            let payload = try JSONDecoder().decode(AccessRequestPayload.self, from: request.httpBody!)
            let statement = AccessStatement(
                machineId: "machine", clientPublicKey: payload.clientPublicKey, nonce: payload.nonce,
                issuedAt: 1_000, expiresAt: 121_000, signature: String(repeating: "a", count: 86),
                machinePublicKey: machineKey, accountId: "account-1",
                accountSignature: String(repeating: "b", count: 86))
            return (
                try JSONEncoder().encode(statement),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            )
        })
        let sent = expectation(description: "The native peer sent its offer through signaling")
        let socket = OfferSocket()
        socket.offered = { sent.fulfill() }
        let sockets = BrokerSockets(now: { 1_000 }, createSocket: { _ in socket })
        let signaling = MachineSignaling(
            machineID: "machine", machineKey: machineKey, signer: key, lan: nil,
            brokerURL: URL(string: "wss://broker.test")!, sockets: sockets)
        let link = try NativeWebRTCLink(
            signaling: signaling, iceServers: [], relayOnly: true,
            access: {
                let access = try await client.signalAccess(
                    accessToken: "access", machineID: "machine", key: key, label: "iPhone")
                return try JSONValue.decode(JSONEncoder().encode(access))
            }, scheduler: OfferScheduler(),
            events: .init(
                opened: {}, message: { _ in },
                closed: { error in
                    if let error { XCTFail("Native offer failed: \(error)") }
                }))
        defer { link.close() }
        try socket.receive(.object(["type": .string("ready")]))
        let iceID = try XCTUnwrap(socket.writes.last?["id"])
        try socket.receive(
            .object([
                "type": .string("ice"), "id": iceID, "servers": .array([]), "expiresAt": .null,
            ]))
        await fulfillment(of: [sent], timeout: 10)
        let relay = try XCTUnwrap(socket.writes.first { $0["envelope"]?["signal"]?["kind"] == .string("offer") })
        let offer = try XCTUnwrap(relay["envelope"]?["signal"])
        XCTAssertTrue(offer["sdp"]?.stringValue?.contains("m=application") == true)
        let access = try XCTUnwrap(offer["access"])
        XCTAssertEqual(access["label"], .string("iPhone"))
        XCTAssertEqual(access["statement"]?["machinePublicKey"], .string(machineKey))
        XCTAssertEqual(access["statement"]?["accountId"], .string("account-1"))
        XCTAssertEqual(access["statement"]?["accountSignature"], .string(String(repeating: "b", count: 86)))
        XCTAssertEqual(access["statement"]?["clientPublicKey"], .string(key.publicKey))
    }
}

@MainActor private final class OfferSocket: SignalSocket {
    var received: ((String) -> Void)?
    var failed: ((Error) -> Void)?
    var writes: [JSONValue] = []
    var offered: (() -> Void)?
    func start() {}
    func send(_ text: String) {
        guard let frame = try? JSONValue.decode(Data(text.utf8)) else { return }
        writes.append(frame)
        if frame["envelope"]?["signal"]?["kind"] == .string("offer") { offered?() }
    }
    func receive(_ frame: JSONValue) throws {
        received?(String(decoding: try JSONEncoder().encode(frame), as: UTF8.self))
    }
    func close() {
        received = nil
        failed = nil
        offered = nil
    }
}

@MainActor private struct OfferScheduler: TransportScheduling {
    func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void {
        // No ICE servers are used; finish the real peer's gathering at the injected deadline.
        guard milliseconds == 5_000 else { return {} }
        let task = Task { action() }
        return { task.cancel() }
    }
}

@MainActor private final class LoginMachine: MachineRequesting, MachineFeatures {
    func answers(_ type: WireRequest) -> Bool { type == .accountsRefresh }

    var sent: [(String, JSONValue)] = []
    var refusal: String?
    var handlers: [String: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        switch type {
        case "accounts.list":
            return .object([
                "accounts": .object([:]),
                "statuses": .array([
                    .object(["id": .string("work"), "state": .string("signed-out"), "checkedAt": .number(1)])
                ]),
            ])
        case "session.login":
            if let refusal { throw MachineClientError.server(code: refusal, message: refusal) }
            return .object(["sessionId": payload["sessionId"] ?? .null])
        default:
            return .object([:])
        }
    }

    func emit(_ event: String, _ payload: JSONValue) {
        for handler in (handlers[event] ?? [:]).values { handler(payload) }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        let id = UUID()
        handlers[event, default: [:]][id] = handler
        return { [weak self] in self?.handlers[event]?[id] = nil }
    }
}
