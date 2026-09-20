import Foundation
import Testing

@testable import RuimtePulsar

private func pairedEndpoint(_ changes: [String: Any] = [:]) -> [String: Any] {
    let endpoint: [String: Any] = [
        "id": "machine-1", "label": "Mac", "platform": "darwin", "version": "1.0",
        "protocol": WireConstants.protocolVersion, "reachability": "public", "authenticated": true,
        "publicKey": String(repeating: "A", count: 43), "brokerUrl": "wss://broker.example",
        "icon": ["kind": "lucide", "value": "rocket"],
    ]
    return endpoint.merging(changes) { _, replacement in replacement }
}

private func answer(_ body: [String: Any], status: Int = 200) throws -> PairingClient.Fetch {
    let data = try JSONSerialization.data(withJSONObject: body)
    return { _ in
        let response = HTTPURLResponse(
            url: URL(string: "https://machine.example/auth/pair")!, statusCode: status, httpVersion: nil,
            headerFields: nil)!
        return (data, response)
    }
}

@Suite struct PairingLinkTests {
    @Test func aLinkKeepsItsTokenAndPointsAtTheMachinesPairingRoute() throws {
        let link = try SecurePairingLink(" https://machine.example/pair#one-time\n")
        #expect(link.token == "one-time")
        #expect(link.endpoint.absoluteString == "https://machine.example/auth/pair")
    }

    @Test(arguments: [
        "http://machine.example/pair#token", "https://machine.example/paired#token",
        "https://machine.example/pair?extra=1#token", "https://machine.example/pair", "https://machine.example/pair#",
        "https://user:secret@machine.example/pair#token", "https:///pair#token", "not a link",
    ])
    func anythingElseIsRefused(_ text: String) {
        #expect(throws: PairingFailure.self) { try SecurePairingLink(text) }
    }
}

@Suite struct PairingClientTests {
    @Test func itSendsTheTokenAndKeyAsJSONAndReadsTheMachineBack() async throws {
        let sent = Mailbox()
        let reply = try answer(["endpoint": pairedEndpoint()])
        let client = PairingClient { request in
            await sent.put(request)
            return try await reply(request)
        }
        let result = try await client.pair(
            try SecurePairingLink("https://machine.example/pair#one-time"), publicKey: String(repeating: "K", count: 43),
            label: "Ruimte on iOS")
        let request = try #require(await sent.take())
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://machine.example/auth/pair")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.timeoutInterval == 30)
        let payload = try JSONDecoder().decode(PairPayload.self, from: try #require(request.httpBody))
        #expect(payload.token == "one-time")
        #expect(payload.label == "Ruimte on iOS")
        #expect(payload.publicKey == String(repeating: "K", count: 43))
        let machine = try #require(result.endpoint.pairedMachine())
        #expect(machine.id == "machine-1")
        #expect(machine.name == "Mac")
        #expect(machine.brokerUrl == "wss://broker.example")
        #expect(machine.icon == MachineIcon(value: "rocket"))
        #expect(machine.lastSeenAt == nil)
    }

    @Test func aMachineWithoutASecureBrokerOrAKeyIsNotOneThisPhoneCanReach() async throws {
        var withoutKey = pairedEndpoint()
        withoutKey.removeValue(forKey: "publicKey")
        let broken = [
            pairedEndpoint(["brokerUrl": "ws://broker.example"]), pairedEndpoint(["brokerUrl": NSNull()]), withoutKey,
        ]
        for endpoint in broken {
            let client = PairingClient(fetch: try answer(["endpoint": endpoint]))
            let result = try await client.pair(
                try SecurePairingLink("https://machine.example/pair#one-time"), publicKey: "key", label: "iPhone")
            #expect(result.endpoint.pairedMachine() == nil)
        }
    }

    @Test func aRefusedLinkSaysSoAndKeepsTheStatusOutOfTheWording() async throws {
        let client = PairingClient(fetch: try answer(["error": "used"], status: 409))
        await #expect(throws: PairingFailure.self) {
            try await client.pair(
                try SecurePairingLink("https://machine.example/pair#one-time"), publicKey: "key", label: "iPhone")
        }
    }

    @Test func anAnswerThisAppCannotReadIsARefusalAndNotACrash() async throws {
        let client = PairingClient(fetch: try answer(["endpoint": ["id": "machine-1"]]))
        await #expect(throws: PairingFailure.self) {
            try await client.pair(
                try SecurePairingLink("https://machine.example/pair#one-time"), publicKey: "key", label: "iPhone")
        }
    }

    /// A person who backs out of pairing should read nothing; only a real failure is worth a line on the page.
    @Test func aCancelledAttemptStaysACancellation() async throws {
        let client = PairingClient { _ in throw URLError(.cancelled) }
        await #expect(throws: CancellationError.self) {
            try await client.pair(
                try SecurePairingLink("https://machine.example/pair#one-time"), publicKey: "key", label: "iPhone")
        }
    }

    @Test func aMachineThatCannotBeReachedSaysThatAndNotTheURLErrorsOwnWords() async throws {
        let client = PairingClient { _ in throw URLError(.cannotFindHost) }
        do {
            _ = try await client.pair(
                try SecurePairingLink("https://machine.example/pair#one-time"), publicKey: "key", label: "iPhone")
            Issue.record("A machine that cannot be reached must not pair")
        } catch let failure as PairingFailure {
            #expect(failure.code == "network")
        }
    }
}

private actor Mailbox {
    private var request: URLRequest?
    func put(_ value: URLRequest) { request = value }
    func take() -> URLRequest? { request }
}
