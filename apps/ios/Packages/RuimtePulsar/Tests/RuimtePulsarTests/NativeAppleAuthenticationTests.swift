import Foundation
import Testing

@testable import RuimtePulsar

private let appleTestNow: Int64 = 1_800_000_000_000
private let appleAttempt = String(repeating: "a", count: 43)
private let appleNonce = String(repeating: "n", count: 43)
private let appleCode = String(repeating: "c", count: 43)

private func appleCredential(
    state: String? = appleAttempt, identity: Data? = Data("signed-token".utf8), code: Data? = Data("apple-code".utf8)
) -> NativeAppleCredential {
    NativeAppleCredential(state: state, identityToken: identity, authorizationCode: code)
}

private final class AppleSessionStore: SessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: StoredSession?
    func read() -> StoredSession? { lock.withLock { value } }
    func write(_ value: StoredSession?) { lock.withLock { self.value = value } }
}

private actor AppleGate {
    private var arrived = false
    private var released = false
    private var arrival: CheckedContinuation<Void, Never>?
    private var waiter: CheckedContinuation<Void, Never>?
    func wait() async {
        arrived = true
        arrival?.resume()
        arrival = nil
        if !released { await withCheckedContinuation { waiter = $0 } }
    }
    func waitForArrival() async {
        if !arrived { await withCheckedContinuation { arrival = $0 } }
    }
    func release() {
        released = true
        waiter?.resume()
        waiter = nil
    }
}

private actor AppleTestAPI: NativeAppleAPI, SessionAPI {
    enum Stage: CaseIterable { case start, complete, exchange }
    var challenge: String?
    var completion: NativeAppleCompletePayload?
    var exchanges: [SessionExchangePayload] = []
    var revoked: [String] = []
    var expired = false
    var heldExchange = 1
    func holdExchange(_ index: Int) { heldExchange = index }
    let stage: Stage?
    let gate: AppleGate?
    init(stage: Stage? = nil, gate: AppleGate? = nil) {
        self.stage = stage
        self.gate = gate
    }
    func setExpired() { expired = true }
    func startApple(_ payload: NativeAppleStartPayload) async throws -> NativeAppleStartResult {
        challenge = payload.codeChallenge
        if stage == .start { await gate?.wait() }
        return .init(attempt: appleAttempt, nonce: appleNonce, expiresAt: appleTestNow + (expired ? -1 : 300_000))
    }
    func completeApple(_ payload: NativeAppleCompletePayload) async throws -> NativeAppleCompleteResult {
        completion = payload
        if stage == .complete { await gate?.wait() }
        return .init(code: appleCode)
    }
    func exchange(_ payload: SessionExchangePayload) async throws -> SessionResult {
        exchanges.append(payload)
        if stage == .exchange && exchanges.count == heldExchange { await gate?.wait() }
        return .init(
            accessToken: "access-\(exchanges.count)", accessExpiresAt: appleTestNow + 900_000,
            refreshToken: "refresh-\(exchanges.count)", expiresAt: appleTestNow + 86_400_000,
            account: .init(id: "apple-account", provider: .apple, login: "Apple user"))
    }
    func refresh(_ payload: SessionRefreshPayload) throws -> SessionResult { throw NativeAppleLoginError.unavailable }
    func endSession(accessToken: String) { revoked.append(accessToken) }
}

@Suite("Native Apple authentication")
struct NativeAppleAuthenticationTests {
    @MainActor @Test func challengeStateNonceAndPKCEStayBoundToTheNativeAttempt() async throws {
        let api = AppleTestAPI()
        let store = AppleSessionStore()
        let vault = SessionVault(client: api, store: store, signer: { DeviceKey() }, now: { appleTestNow })
        let flow = NativeAppleSignIn(
            authorize: { challenge in
                #expect(challenge.attempt == appleAttempt)
                #expect(challenge.nonce == appleNonce)
                return appleCredential(state: challenge.attempt)
            }, now: { appleTestNow })
        let session = try await flow.signIn(client: api, vault: vault, label: "iPhone")
        let exchange = try #require(await api.exchanges.first)
        #expect(await api.challenge == PKCELogin(verifier: exchange.codeVerifier, state: "").challenge)
        #expect(exchange.code == appleCode)
        #expect(exchange.redirectUri == PKCELogin.redirectURI)
        #expect(
            await api.completion
                == NativeAppleCompletePayload(
                    attempt: appleAttempt, identityToken: "signed-token", authorizationCode: "apple-code"))
        #expect(session.account.provider == .apple)
        #expect(store.read()?.account.provider == .apple)
    }

    @Test func theNameAppleSendsOnceRidesAlongAndAnEmptyOneStaysOut() throws {
        var name = PersonNameComponents()
        name.givenName = "Bas"
        name.familyName = "Milius"
        let named = NativeAppleCredential(
            state: appleAttempt, identityToken: Data("signed-token".utf8), authorizationCode: Data("apple-code".utf8),
            fullName: name)
        #expect(try named.payload(for: appleAttempt).displayName == "Bas Milius")
        let empty = NativeAppleCredential(
            state: appleAttempt, identityToken: Data("signed-token".utf8), authorizationCode: Data("apple-code".utf8),
            fullName: PersonNameComponents())
        #expect(try empty.payload(for: appleAttempt).displayName == nil)
        #expect(try appleCredential().payload(for: appleAttempt).displayName == nil)
    }

    @Test func incompleteWrongStateAndOversizedNativeCredentialsAreRejected() throws {
        #expect(throws: NativeAppleLoginError.wrongState) {
            try appleCredential(state: "other").payload(for: appleAttempt)
        }
        #expect(throws: NativeAppleLoginError.wrongState) { try appleCredential(state: nil).payload(for: appleAttempt) }
        for credential in [
            appleCredential(identity: nil), appleCredential(code: nil), appleCredential(identity: Data()),
            appleCredential(identity: Data([0xff])), appleCredential(code: Data()),
            appleCredential(identity: Data(repeating: 65, count: 16_385)),
            appleCredential(code: Data(repeating: 65, count: 4_097)),
        ] {
            #expect(throws: NativeAppleLoginError.invalidCredential) { try credential.payload(for: appleAttempt) }
        }
    }

    @MainActor @Test func expiredChallengeNeverOpensNativeAuthorization() async throws {
        let api = AppleTestAPI()
        await api.setExpired()
        let vault = SessionVault(
            client: api, store: AppleSessionStore(), signer: { DeviceKey() }, now: { appleTestNow })
        var opened = false
        let flow = NativeAppleSignIn(
            authorize: { _ in
                opened = true
                return appleCredential()
            }, now: { appleTestNow })
        await #expect(throws: NativeAppleLoginError.expired) {
            try await flow.signIn(client: api, vault: vault, label: "iPhone")
        }
        #expect(!opened)
        #expect(await api.completion == nil)
    }

    @MainActor @Test(arguments: AppleTestAPI.Stage.allCases)
    fileprivate func cancellationAtEveryNetworkBoundaryCannotPersistASession(stage: AppleTestAPI.Stage) async throws {
        let gate = AppleGate()
        let api = AppleTestAPI(stage: stage, gate: gate)
        let store = AppleSessionStore()
        let vault = SessionVault(client: api, store: store, signer: { DeviceKey() }, now: { appleTestNow })
        let flow = NativeAppleSignIn(authorize: { _ in appleCredential() }, now: { appleTestNow })
        let task = Task { try await flow.signIn(client: api, vault: vault, label: "iPhone") }
        await gate.waitForArrival()
        flow.cancel()
        await gate.release()
        await #expect(throws: LoginError.cancelled) { try await task.value }
        #expect(store.read() == nil)
    }

    @MainActor @Test func supersededNativeAuthorizationCannotCompleteTheOldAttempt() async throws {
        let gate = AppleGate()
        let api = AppleTestAPI()
        let store = AppleSessionStore()
        let vault = SessionVault(client: api, store: store, signer: { DeviceKey() }, now: { appleTestNow })
        var presentations = 0
        let flow = NativeAppleSignIn(
            authorize: { _ in
                presentations += 1
                if presentations == 1 { await gate.wait() }
                return appleCredential()
            }, now: { appleTestNow })
        let old = Task { try await flow.signIn(client: api, vault: vault, label: "Old") }
        await gate.waitForArrival()
        let current = try await flow.signIn(client: api, vault: vault, label: "Current")
        await gate.release()
        await #expect(throws: LoginError.cancelled) { try await old.value }
        #expect(await api.exchanges.count == 1)
        #expect(current.accessToken == "access-1")
        #expect(store.read()?.account == current.account)
    }

    @MainActor @Test func anAlreadyCancelledCallerCannotInterruptAnActiveSignIn() async throws {
        let operation = SignInOperation()
        let gate = AppleGate()
        let session = SessionView(
            accessToken: "active", accessExpiresAt: appleTestNow + 60_000,
            expiresAt: appleTestNow + 600_000,
            account: Account(id: "a", provider: .apple, login: "Apple user"))
        let active = Task {
            try await operation.perform {
                await gate.wait()
                return session
            }
        }
        await gate.waitForArrival()
        let cancelled = Task { try await operation.perform { session } }
        cancelled.cancel()
        await #expect(throws: CancellationError.self) { try await cancelled.value }
        await gate.release()
        #expect(try await active.value.accessToken == "active")
    }

    @MainActor @Test func cancellationAfterPersistenceRollsBackOnlyItsOwnSession() async throws {
        for startNewLogin in [false, true] {
            let api = AppleTestAPI()
            let store = AppleSessionStore()
            let vault = SessionVault(client: api, store: store, signer: { DeviceKey() }, now: { appleTestNow })
            let operation = SignInOperation()
            let gate = AppleGate()
            let login = SessionLoginCode(
                code: appleCode, codeVerifier: String(repeating: "v", count: 43), redirectUri: PKCELogin.redirectURI,
                label: "iPhone")
            let task = Task {
                try await operation.perform(onCancelledResult: { await vault.discard(accessToken: $0.accessToken) }) {
                    let session = try await vault.exchange(login)
                    await gate.wait()
                    return session
                }
            }
            await gate.waitForArrival()
            operation.cancel()
            if startNewLogin { _ = try await vault.exchange(login) }
            await gate.release()
            await #expect(throws: CancellationError.self) { try await task.value }
            #expect(await api.revoked == ["access-1"])
            #expect(store.read()?.refreshToken == (startNewLogin ? "refresh-2" : nil))
        }
    }

    @Test func discardingCompletedLoginDoesNotCancelANewerExchangeInFlight() async throws {
        let gate = AppleGate()
        let api = AppleTestAPI(stage: .exchange, gate: gate)
        await api.holdExchange(2)
        let store = AppleSessionStore()
        let vault = SessionVault(client: api, store: store, signer: { DeviceKey() }, now: { appleTestNow })
        let login = SessionLoginCode(
            code: appleCode, codeVerifier: String(repeating: "v", count: 43), redirectUri: PKCELogin.redirectURI,
            label: "iPhone")
        let old = try await vault.exchange(login)
        let newer = Task { try await vault.exchange(login) }
        await gate.waitForArrival()
        await vault.discard(accessToken: old.accessToken)
        await gate.release()
        let session = try await newer.value
        #expect(session.accessToken == "access-2")
        #expect(store.read()?.refreshToken == "refresh-2")
        #expect(await api.revoked == ["access-1"])
    }

    @Test func staleSignerCannotExchangeAfterAnotherLogin() async throws {
        let api = AppleTestAPI()
        let gate = AppleGate()
        let firstSigner = AppleFirstSigner(gate: gate)
        let vault = SessionVault(
            client: api, store: AppleSessionStore(), signer: { await firstSigner.signer() }, now: { appleTestNow })
        let login = SessionLoginCode(
            code: appleCode, codeVerifier: String(repeating: "v", count: 43), redirectUri: PKCELogin.redirectURI,
            label: "iPhone")
        let stale = Task { try await vault.exchange(login) }
        await gate.waitForArrival()
        _ = try await vault.exchange(login)
        await gate.release()
        await #expect(throws: CancellationError.self) { try await stale.value }
        #expect(await api.exchanges.count == 1)
    }

    @Test func nativeRoutesValidatePayloadsAndResponses() async throws {
        let client = AddressBookClient(fetch: { request in
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            let data: Data
            switch request.url?.path {
            case "/v1/apple/start":
                let payload = try JSONDecoder().decode(NativeAppleStartPayload.self, from: #require(request.httpBody))
                #expect(payload.codeChallenge == appleNonce)
                data = try JSONEncoder().encode(
                    NativeAppleStartResult(attempt: appleAttempt, nonce: appleNonce, expiresAt: appleTestNow + 300_000))
            case "/v1/apple/complete":
                _ = try JSONDecoder().decode(NativeAppleCompletePayload.self, from: #require(request.httpBody))
                data = try JSONEncoder().encode(NativeAppleCompleteResult(code: appleCode))
            default: throw NativeAppleLoginError.unavailable
            }
            return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })
        #expect(try await client.startApple(.init(codeChallenge: appleNonce)).nonce == appleNonce)
        #expect(try await client.completeApple(appleCredential().payload(for: appleAttempt)).code == appleCode)
        await #expect(throws: (any Error).self) { try await client.startApple(.init(codeChallenge: "invalid")) }
        let invalid = AddressBookClient(fetch: { request in
            (
                Data(#"{"code":"too-short"}"#.utf8),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            )
        })
        await #expect(throws: AddressBookRequestError.self) {
            try await invalid.completeApple(appleCredential().payload(for: appleAttempt))
        }
    }

    @MainActor @Test func unavailableBackendNeverFallsBackToBrowser() async throws {
        let client = AddressBookClient(fetch: { request in
            (Data(), HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!)
        })
        let vault = SessionVault(
            client: client, store: AppleSessionStore(), signer: { DeviceKey() }, now: { appleTestNow })
        var opened = false
        let flow = NativeAppleSignIn(
            authorize: { _ in
                opened = true
                return appleCredential()
            }, now: { appleTestNow })
        await #expect(throws: NativeAppleLoginError.unavailable) {
            try await flow.signIn(client: client, vault: vault, label: "iPhone")
        }
        #expect(!opened)
    }
}

private actor AppleFirstSigner {
    let gate: AppleGate
    private var calls = 0
    init(gate: AppleGate) { self.gate = gate }
    func signer() async -> DeviceKey {
        calls += 1
        if calls == 1 { await gate.wait() }
        return DeviceKey()
    }
}
