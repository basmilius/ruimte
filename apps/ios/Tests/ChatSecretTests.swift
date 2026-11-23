import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor
final class ChatSecretTests: XCTestCase {
    private func request(_ id: String, extra: [String: JSONValue] = [:]) -> JSONValue {
        var object: [String: JSONValue] = [
            "requestId": .string(id), "nodeId": .string("chat"), "projectId": .string("project"),
            "launchId": .string("launch"), "launchName": .string("Dev server"), "variable": .string("STRIPE_KEY"),
            "label": .string("Stripe test key"), "reason": .string("To try the checkout"), "replaces": .bool(false),
            "createdAt": .number(1), "expiresAt": .number(601),
        ]
        object.merge(extra) { _, new in new }
        return .object(object)
    }

    private let fields: JSONValue = .array([
        .object(["name": .string("user"), "label": .string("User name"), "masked": .bool(false)]),
        .object(["name": .string("password"), "label": .string("Password"), "placeholder": .string("hunter2")]),
    ])

    func testACardForOneValueDecodesAsALaunchSecret() throws {
        let card = try request("s1", extra: ["url": .string("https://dashboard.stripe.com/test/apikeys")])
            .decoded(as: SecretRequest.self)

        XCTAssertNil(card.delivery, "absent is launch, as every card of an older machine")
        XCTAssertNil(card.severalFields)
        XCTAssertEqual(card.entries.map(\.name), [SecretRequest.singleFieldName])
        XCTAssertEqual(card.entries.first?.placeholder, "Paste the secret")
        XCTAssertEqual(card.page?.host(), "dashboard.stripe.com")
        XCTAssertEqual(
            card.privacyLine, "Saved on this machine as STRIPE_KEY. Only Dev server gets it, never the agent.")
        XCTAssertNil(card.replacesLine)
    }

    func testACardWithFieldsDecodesEachField() throws {
        let card = try request("s1", extra: ["delivery": .string("file"), "fields": fields, "replaces": .bool(true)])
            .decoded(as: SecretRequest.self)

        XCTAssertEqual(card.delivery, .file)
        XCTAssertEqual(card.entries.map(\.name), ["user", "password"])
        XCTAssertEqual(card.entries.map(\.masked), [false, nil], "only a field marked unmasked shows as typed")
        XCTAssertEqual(
            card.privacyLine, "Kept out of chat, in private files this agent's commands can read for 24 hours")
        XCTAssertNil(card.replacesLine, "a file card replaces no launch variable")
    }

    func testAPageThatIsNoWebAddressIsNotOffered() throws {
        let card = try request("s1", extra: ["url": .string("file:///etc/passwd")]).decoded(as: SecretRequest.self)
        XCTAssertNil(card.page)
    }

    func testTheSavePayloadOfOneValue() throws {
        let card = try request("s1").decoded(as: SecretRequest.self)

        XCTAssertNil(card.savePayload([:]), "an empty field sends nothing")
        XCTAssertEqual(
            card.savePayload([SecretRequest.singleFieldName: "sk_test_1"]),
            .object(["requestId": .string("s1"), "value": .string("sk_test_1")]))
    }

    func testTheSavePayloadOfSeveralValues() throws {
        let card = try request("s1", extra: ["fields": fields]).decoded(as: SecretRequest.self)

        XCTAssertNil(card.savePayload(["user": "ada"]), "every field needs a value")
        XCTAssertEqual(
            card.savePayload(["user": "ada", "password": "secret", "stray": "x"]),
            .object([
                "requestId": .string("s1"),
                "values": .object(["user": .string("ada"), "password": .string("secret")]),
            ]))
    }

    func testTheStoreKeepsOnlyTheCardsItCanReadForTheirChat() throws {
        let store = ProposalStore(client: SecretMachine())
        store.setSecrets(
            SecretRequests(
                requests: .array([
                    request("s2", extra: ["createdAt": .number(5)]), request("s1"),
                    request("other", extra: ["nodeId": .string("elsewhere")]),
                    request("newer", extra: ["delivery": .string("vault")]),
                ])))

        XCTAssertEqual(store.secretCards(for: "chat").map(\.requestId), ["s1", "s2"])
    }

    func testASavedCardIsHidden() async throws {
        let machine = SecretMachine()
        machine.reply = .object(["accepted": .bool(true)])
        let card = try request("s1").decoded(as: SecretRequest.self)
        let answers = ChatSecretAnswers()
        answers.update([card])

        let saved = await answers.save(card, values: [SecretRequest.singleFieldName: "sk_test_1"], client: machine)

        XCTAssertTrue(saved)
        XCTAssertEqual(machine.sent.map(\.0), [.secretSave])
        XCTAssertTrue(answers.cards.isEmpty)
    }

    func testACardThatWasGoneSaysSo() async throws {
        let machine = SecretMachine()
        machine.reply = .object(["accepted": .bool(false)])
        let card = try request("s1").decoded(as: SecretRequest.self)
        let answers = ChatSecretAnswers()
        answers.update([card])

        let saved = await answers.save(card, values: [SecretRequest.singleFieldName: "sk_test_1"], client: machine)
        XCTAssertFalse(saved)
        XCTAssertEqual(answers.errors["s1"], "Already answered or expired")

        await answers.decline(card, client: machine)
        XCTAssertEqual(machine.sent.last?.0, .secretDecline)
        XCTAssertEqual(machine.sent.last?.1, .object(["requestId": .string("s1")]))
        XCTAssertEqual(answers.cards, [card])
    }

    func testTheRecordOfASettledCardDecodesAsAChatItem() throws {
        let item = try JSONValue.object([
            "id": .string("i1"), "createdAt": .number(1), "turnId": .string("t1"), "kind": .string("secret"),
            "label": .string("Database login"), "outcome": .string("timed-out"),
            "fields": .array([.string("User name"), .string("Password")]),
        ]).decoded(as: ChatItem.self)

        guard case .secret(let secret) = item else { return XCTFail("The record decodes as \(item)") }
        XCTAssertEqual(secret.outcome, .timedOut)
        XCTAssertEqual(secret.fields, ["User name", "Password"])
        XCTAssertFalse(item.isPending, "a record never waits on the person")
    }

    func testTheRecordReadsItsOutcome() {
        let words = ChatSecretItemOutcome.allCases.map {
            ChatSecretRecord.line(ChatSecretItem(id: "i", createdAt: 1, turnId: nil, label: "Stripe key", outcome: $0))
        }
        XCTAssertEqual(
            words,
            [
                "Stripe key · Saved", "Stripe key · Declined", "Stripe key · Not answered in time",
                "Stripe key · No longer needed",
            ])
    }
}

@MainActor private final class SecretMachine: MachineRequesting, MachineFeatures {
    var reply: JSONValue = .object([:])
    private(set) var sent: [(WireRequest, JSONValue)] = []

    func answers(_ type: WireRequest) -> Bool { true }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        return reply
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        {}
    }
}
