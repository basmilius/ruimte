import CryptoKit
import RuimtePulsar
import RuimteTransport
import Security
import XCTest
@testable import Ruimte

final class PhaseZeroTests: XCTestCase {
    @MainActor func testMachineListFinishingAfterSignOutIsDiscarded() async throws {
        let gate = MachineListGate()
        let account = Account(id: "old-account", provider: .github, login: "old-user")
        let key = DeviceKey()
        let session = SessionResult(accessToken: String(repeating: "a", count: 43), accessExpiresAt: 900_000,
                                    refreshToken: String(repeating: "r", count: 43), expiresAt: 90_000_000, account: account)
        let sessionData = try JSONEncoder().encode(session)
        let client = AddressBookClient(fetch: { request in
            if request.url?.path == "/v1/machines" { return await gate.request() }
            return (sessionData, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })
        let vault = SessionVault(client: client, store: ProbeSessionStore(), signer: { key }, now: { 0 })
        _ = try await vault.exchange(SessionLoginCode(code: String(repeating: "c", count: 43), codeVerifier: String(repeating: "v", count: 43),
                                                    redirectUri: WireConstants.appRedirectURI))
        let runtime = AppRuntime(client: client, vault: vault)
        runtime.account = account
        let pending = Task { await runtime.refreshMachines() }
        await gate.waitUntilRequested()
        await runtime.signOut()
        let oldMachine = Machine(id: "old-machine", name: "Old machine", icon: nil, publicKey: key.publicKey, brokerUrl: nil, lastSeenAt: nil)
        await gate.complete(try JSONEncoder().encode(MachineListResult(machines: [oldMachine])))
        await pending.value
        XCTAssertNil(runtime.account)
        XCTAssertTrue(runtime.machines.isEmpty)
        XCTAssertNil(runtime.problem)
        runtime.connections.shutdown()
    }

    @MainActor func testEventsWithoutPendingHelloDoNotChangeProbeStatus() {
        let probe = ConnectionProbe()
        probe.receive(#"{"type":"event","event":"session.status","payload":{}}"#)
        XCTAssertEqual(probe.status, "Not connected")
        XCTAssertTrue(probe.history.isEmpty)
    }

    func testGeneratedContractsAndUnicodeSignaturesOnIOS() throws {
        let message = String(repeating: "A", count: 15_999) + "📱漢字"
        let key = DeviceKey()
        let signature = try key.sign(message)
        XCTAssertTrue(DeviceKey.verify(signature: signature, message: message, publicKey: key.publicKey))
        XCTAssertFalse(DeviceKey.verify(signature: signature, message: message + "!", publicKey: key.publicKey))
        let account = try JSONDecoder().decode(Account.self, from: Data(#"{"id":"account","provider":"github","login":null}"#.utf8))
        XCTAssertNil(account.login)
    }

    // Needs local signing on the Simulator: unsigned, every Keychain call fails with -34018 (missing
    // entitlement), which is not a malformed query.
    func testKeychainUsesDeviceOnlyAfterFirstUnlockWithoutSync() throws {
        let service = "app.ruimte.mobile.tests.\(UUID().uuidString)"
        let store = KeychainStore(service: service)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        defer { SecItemDelete(query as CFDictionary) }
        let first = try DeviceKey.loadOrCreate(in: store)
        let second = try DeviceKey.loadOrCreate(in: store)
        XCTAssertEqual(first.publicKey, second.publicKey)
        var attributesQuery = query
        attributesQuery[kSecReturnAttributes as String] = true
        attributesQuery[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        XCTAssertEqual(SecItemCopyMatching(attributesQuery as CFDictionary, &found), errSecSuccess)
        let attributes = try XCTUnwrap(found as? [String: Any])
        XCTAssertEqual(attributes[kSecAttrAccessible as String] as? String, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        XCTAssertEqual(attributes[kSecAttrSynchronizable as String] as? Bool, false)
    }
}

private final class ProbeSessionStore: SessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: StoredSession?
    func read() -> StoredSession? { lock.withLock { session } }
    func write(_ session: StoredSession?) { lock.withLock { self.session = session } }
}

private actor MachineListGate {
    private var pending: CheckedContinuation<(Data, HTTPURLResponse), Never>?
    private var started: CheckedContinuation<Void, Never>?

    func request() async -> (Data, HTTPURLResponse) {
        await withCheckedContinuation { continuation in
            pending = continuation
            started?.resume()
            started = nil
        }
    }

    func waitUntilRequested() async {
        if pending == nil { await withCheckedContinuation { started = $0 } }
    }

    func complete(_ data: Data) {
        pending?.resume(returning: (data, HTTPURLResponse(url: URL(string: "https://pulsar.ruimte.app/v1/machines")!, statusCode: 200,
                                                        httpVersion: nil, headerFields: nil)!))
        pending = nil
    }
}
