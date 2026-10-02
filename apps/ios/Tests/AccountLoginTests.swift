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
        XCTAssertFalse(AccountLoginModel.landed(before: status("ready", checkedAt: 1), now: status("ready", checkedAt: 9)))
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

    func testAnOlderMachineNeedsAnUpdateAndNothingIsKilled() async {
        let machine = LoginMachine()
        machine.refusal = "unknown-request"
        let model = AccountLoginModel(client: machine, kind: "claude", accountID: "claude", name: "Claude")
        await model.begin()
        XCTAssertEqual(model.phase, .outdated)
        await model.end()
        XCTAssertFalse(machine.sent.contains { $0.0 == "session.kill" })
    }
}

@MainActor private final class LoginMachine: MachineRequesting {
    var sent: [(String, JSONValue)] = []
    var refusal: String?
    var handlers: [String: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        switch type {
        case "accounts.list":
            return .object([
                "accounts": .object([:]),
                "statuses": .array([.object(["id": .string("work"), "state": .string("signed-out"), "checkedAt": .number(1)])]),
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
