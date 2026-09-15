import Foundation
import Testing
@testable import RuimtePulsar

private let authNow: Int64 = 1_800_000_000_000
private let authAccount = Account(id: "account-1", provider: .github, login: "someone")
private let authLogin = SessionLoginCode(code: String(repeating: "c", count: 43), codeVerifier: String(repeating: "v", count: 43), redirectUri: PKCELogin.redirectURI, label: "iPhone")

private final class MemorySessionStore: SessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: StoredSession?

    func read() -> StoredSession? {
        lock.withLock { session }
    }

    func write(_ session: StoredSession?) {
        lock.withLock { self.session = session }
    }
}

private actor FakeSessionAPI: SessionAPI {
    var refreshCalls = 0
    var endedTokens: [String] = []
    var failure: String?
    private var generation = 0
    private var publicKey: String?
    private var refreshToken: String?
    private let gate: RefreshGate?
    private let exchangeGate: RefreshGate?

    init(gate: RefreshGate? = nil, exchangeGate: RefreshGate? = nil) {
        self.gate = gate
        self.exchangeGate = exchangeGate
    }

    func setFailure(_ code: String?) {
        failure = code
    }

    func exchange(_ payload: SessionExchangePayload) async throws -> SessionResult {
        #expect(DeviceKey.verify(signature: payload.sessionKeySignature,
                                 message: try SigningBytes.sessionKey(code: payload.code, publicKey: payload.sessionKey),
                                 publicKey: payload.sessionKey))
        publicKey = payload.sessionKey
        await exchangeGate?.wait()
        return nextSession()
    }

    func refresh(_ payload: SessionRefreshPayload) async throws -> SessionResult {
        refreshCalls += 1
        await gate?.wait()
        if let failure {
            throw AddressBookRequestError(code: failure, status: 401, message: "Rejected")
        }
        guard payload.refreshToken == refreshToken, let publicKey,
              DeviceKey.verify(signature: payload.signature,
                               message: try SigningBytes.sessionRefresh(token: payload.refreshToken, issuedAt: payload.issuedAt),
                               publicKey: publicKey) else {
            throw AddressBookRequestError(code: "bad-signature", status: 403, message: "Rejected")
        }
        return nextSession()
    }

    func endSession(accessToken: String) throws {
        endedTokens.append(accessToken)
        if failure != nil {
            throw URLError(.notConnectedToInternet)
        }
    }

    private func nextSession() -> SessionResult {
        generation += 1
        let refresh = String(repeating: String(generation), count: 43)
        refreshToken = refresh
        return SessionResult(accessToken: "access-\(generation)", accessExpiresAt: authNow + 900_000,
                             refreshToken: refresh, expiresAt: authNow + 86_400_000, account: authAccount)
    }
}

private actor RefreshGate {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var arrivals: [CheckedContinuation<Void, Never>] = []
    private var arrived = false

    func wait() async {
        arrived = true
        let arrivals = arrivals
        self.arrivals = []
        for arrival in arrivals { arrival.resume() }
        if !opened {
            await withCheckedContinuation { waiters.append($0) }
        }
    }

    func waitForArrival() async {
        if !arrived {
            await withCheckedContinuation { arrivals.append($0) }
        }
    }

    func open() {
        opened = true
        let continuations = waiters
        waiters = []
        for continuation in continuations {
            continuation.resume()
        }
    }
}

@Suite("Authentication")
struct AuthenticationTests {
    @MainActor @Test func cancelDuringExchangeDoesNotKeepTheSession() async throws {
        let gate = RefreshGate()
        let api = FakeSessionAPI(exchangeGate: gate)
        let store = MemorySessionStore()
        let key = DeviceKey()
        let vault = SessionVault(client: api, store: store, signer: { key }, now: { authNow })
        let operation = SignInOperation()
        let signIn = Task { try await operation.perform { try await vault.exchange(authLogin) } }
        await gate.waitForArrival()
        operation.cancel()
        await gate.open()
        await #expect(throws: CancellationError.self) { try await signIn.value }
        #expect(store.read() == nil)
        #expect(try await vault.restore() == nil)
        #expect(try await vault.accessToken() == nil)

        _ = try await operation.perform { try await vault.exchange(authLogin) }
        #expect(store.read() != nil)
    }

    @Test func parallelRefreshesSpendTheTokenOnce() async throws {
        let gate = RefreshGate()
        let api = FakeSessionAPI(gate: gate)
        let store = MemorySessionStore()
        let key = DeviceKey()
        let vault = SessionVault(client: api, store: store, signer: { key }, now: { authNow })
        _ = try await vault.exchange(authLogin)
        let first = await vault.refreshOperation()
        let second = await vault.refreshOperation()
        await gate.open()
        #expect(try await first.value?.accessToken == "access-2")
        #expect(try await second.value?.accessToken == "access-2")
        #expect(await api.refreshCalls == 1)
    }

    @Test func signOutDiscardsALateRefresh() async throws {
        let gate = RefreshGate()
        let api = FakeSessionAPI(gate: gate)
        let store = MemorySessionStore()
        let key = DeviceKey()
        let vault = SessionVault(client: api, store: store, signer: { key }, now: { authNow })
        _ = try await vault.exchange(authLogin)
        let refresh = await vault.refreshOperation()
        try await vault.signOut()
        await gate.open()
        await #expect(throws: CancellationError.self) { try await refresh.value }
        #expect(store.read() == nil)
    }
    @Test func exchangeRotationAndRestore() async throws {
        let api = FakeSessionAPI()
        let store = MemorySessionStore()
        let key = DeviceKey()
        let vault = SessionVault(client: api, store: store, signer: { key }, now: { authNow })
        let first = try await vault.exchange(authLogin)
        #expect(first.accessToken == "access-1")
        #expect(store.read()?.refreshToken == String(repeating: "1", count: 43))
        let second = try await vault.refresh()
        #expect(second?.accessToken == "access-2")
        #expect(store.read()?.refreshToken == String(repeating: "2", count: 43))
        let restarted = SessionVault(client: api, store: store, signer: { key }, now: { authNow })
        #expect(try await restarted.restore()?.account == authAccount)
        #expect(try await restarted.refresh()?.accessToken == "access-3")
    }

    @Test func networkFailureKeepsSessionAndRefusalClearsIt() async throws {
        let api = FakeSessionAPI()
        let store = MemorySessionStore()
        let key = DeviceKey()
        let vault = SessionVault(client: api, store: store, signer: { key }, now: { authNow })
        _ = try await vault.exchange(authLogin)
        await api.setFailure("network")
        await #expect(throws: AddressBookRequestError.self) { try await vault.refresh() }
        #expect(store.read() != nil)
        await api.setFailure("unauthorized")
        #expect(try await vault.refresh() == nil)
        #expect(store.read() == nil)
    }

    @Test func expiredOrKeylessSessionNeverRefreshes() async throws {
        let api = FakeSessionAPI()
        let store = MemorySessionStore()
        let key = DeviceKey()
        store.write(StoredSession(refreshToken: "kept", expiresAt: authNow, account: authAccount))
        let expired = SessionVault(client: api, store: store, signer: { key }, now: { authNow })
        #expect(try await expired.restore() == nil)
        #expect(try await expired.refresh() == nil)
        store.write(StoredSession(refreshToken: "kept", expiresAt: authNow + 1, account: authAccount))
        let keyless = SessionVault(client: api, store: store, signer: { nil }, now: { authNow })
        #expect(try await keyless.refresh() == nil)
        #expect(store.read() == nil)
        #expect(await api.refreshCalls == 0)
        await #expect(throws: AddressBookRequestError.self) { try await keyless.exchange(authLogin) }
    }

    @Test func signOutForgetsEvenWhenServerIsUnreachable() async throws {
        let api = FakeSessionAPI()
        let store = MemorySessionStore()
        let key = DeviceKey()
        let vault = SessionVault(client: api, store: store, signer: { key }, now: { authNow })
        _ = try await vault.exchange(authLogin)
        await api.setFailure("network")
        try await vault.signOut()
        #expect(store.read() == nil)
        #expect(await api.endedTokens == ["access-1"])
        #expect(try await vault.accessToken() == nil)
    }

    @Test func pkceRFC7636AndExactCallback() throws {
        let login = PKCELogin(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", state: "expected-state")
        #expect(login.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let code = String(repeating: "a", count: 43)
        let valid = URL(string: "ruimte://pulsar/callback?state=expected-state&code=\(code)")!
        #expect(try login.loginCode(callback: valid, label: "iPhone").code == code)
        for prefix in ["ruimte://evil/callback", "ruimte://pulsar/callback/extra", "ruimte://pulsar:42/callback", "ruimte://user@pulsar/callback", "ruimte://pulsar/%63allback"] {
            #expect(throws: LoginError.invalidCallback) {
                try login.loginCode(callback: URL(string: "\(prefix)?state=expected-state&code=\(code)")!, label: "iPhone")
            }
        }
        #expect(throws: LoginError.wrongState) {
            try login.loginCode(callback: URL(string: "ruimte://pulsar/callback?state=other&code=\(code)")!, label: "iPhone")
        }
        #expect(throws: LoginError.wrongState) {
            try login.loginCode(callback: URL(string: "ruimte://pulsar/callback?state=expected-state&state=expected-state&code=\(code)")!, label: "iPhone")
        }
        #expect(throws: LoginError.cancelled) {
            try login.loginCode(callback: URL(string: "ruimte://pulsar/callback?state=expected-state&error=access_denied")!, label: "iPhone")
        }
        #expect(throws: LoginError.invalidCallback) {
            try login.loginCode(callback: URL(string: valid.absoluteString + "#fragment")!, label: "iPhone")
        }
        #expect(throws: LoginError.invalidCallback) {
            try login.loginCode(callback: URL(string: valid.absoluteString + "&code=\(code)")!, label: "iPhone")
        }
    }

    @Test func unknownProvidersAreRetainedAndMalformedAnswersRejected() async throws {
        let client = AddressBookClient(fetch: { request in
            #expect(request.url?.scheme == "https")
            let body = request.url?.path == "/v1/providers" ? #"{"providers":["github","future"]}"# : #"{"machines":[{"id":"machine","name":""}]}"#
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })
        #expect(try await client.providers() == ["github", "future"])
        await #expect(throws: AddressBookRequestError.self) { try await client.listMachines(accessToken: "access") }
    }

    @Test func signaturesRejectChanges() throws {
        let key = DeviceKey()
        let message = "hello / 👩🏽‍🚀\n\u{2028}\u{2029}"
        let signature = try key.sign(message)
        #expect(DeviceKey.verify(signature: signature, message: message, publicKey: key.publicKey))
        #expect(!DeviceKey.verify(signature: signature, message: message + "!", publicKey: key.publicKey))
        #expect(!DeviceKey.verify(signature: signature, message: message, publicKey: DeviceKey().publicKey))
        #expect(!DeviceKey.verify(signature: "bad", message: message, publicKey: key.publicKey))
    }

    @Test func deviceLabelsRespectWireUTF16Limit() throws {
        let login = PKCELogin(verifier: String(repeating: "v", count: 43), state: "state")
        let callback = URL(string: "ruimte://pulsar/callback?state=state&code=\(String(repeating: "a", count: 43))")!
        let result = try login.loginCode(callback: callback, label: String(repeating: "🚀", count: 80))
        #expect(result.label?.utf16.count == 80)
        #expect(result.label == String(repeating: "🚀", count: 40))
        #expect(try login.loginCode(callback: callback, label: "").label == "Ruimte")
    }

    @Test func statementsMustMatchTheRequestedMachineAndKey() async throws {
        let key = DeviceKey()
        let client = AddressBookClient(fetch: { request in
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access")
            let payload = try JSONDecoder().decode(AccessRequestPayload.self, from: request.httpBody!)
            #expect(DeviceKey.verify(signature: payload.signature,
                                     message: try SigningBytes.accessRequest(machineID: payload.machineId, publicKey: payload.clientPublicKey, nonce: payload.nonce),
                                     publicKey: key.publicKey))
            let statement = AccessStatement(machineId: "another-machine", clientPublicKey: payload.clientPublicKey,
                                            nonce: payload.nonce, issuedAt: authNow, expiresAt: authNow + 120_000,
                                            signature: String(repeating: "a", count: 86))
            return (try JSONEncoder().encode(statement), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })
        await #expect(throws: AddressBookRequestError.self) {
            try await client.signalAccess(accessToken: "access", machineID: "machine", key: key, label: "iPhone")
        }
    }

    @Test func typeScriptSessionSigningFixtures() throws {
        let url = try #require(Bundle.module.url(forResource: "wire", withExtension: "json"))
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let cases = try #require(root["signatures"] as? [[String: Any]])
        for fixture in cases {
            let kind = try #require(fixture["kind"] as? String)
            let arguments = try #require(fixture["args"] as? [Any])
            let expected = try #require(fixture["expected"] as? String)
            let actual: String
            switch kind {
            case "sessionKey":
                actual = try SigningBytes.sessionKey(code: #require(arguments[0] as? String), publicKey: #require(arguments[1] as? String))
            case "sessionRefresh":
                actual = try SigningBytes.sessionRefresh(token: #require(arguments[0] as? String), issuedAt: #require(arguments[1] as? NSNumber).int64Value)
            case "accessRequest":
                actual = try SigningBytes.accessRequest(machineID: #require(arguments[0] as? String), publicKey: #require(arguments[1] as? String), nonce: #require(arguments[2] as? String))
            default: continue
            }
            #expect(actual == expected)
            #expect(Data(actual.utf8) == Data(expected.utf8))
        }
        let crypto = try #require(root["crypto"] as? [[String: String]])
        for fixture in crypto {
            let encodedSeed = try #require(fixture["seed"])
            let seed = try #require(Base64URL.decode(encodedSeed))
            let publicKey = try #require(fixture["publicKey"])
            let message = try #require(fixture["message"])
            let signature = try #require(fixture["signature"])
            let key = try DeviceKey(rawRepresentation: seed)
            #expect(key.publicKey == publicKey)
            // CryptoKit may randomize Ed25519 signatures; compatibility is verification over identical bytes.
            let swiftSignature = try key.sign(message)
            #expect(DeviceKey.verify(signature: swiftSignature, message: message, publicKey: publicKey))
            #expect(DeviceKey.verify(signature: signature, message: message, publicKey: publicKey))
        }
    }
}
