import Foundation
import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class RuntimeStartupTests: XCTestCase {
    @MainActor func testRestoringAnAccountSurvivesTheRootViewTaskBeingCanceled() async throws {
        let fixture = try RuntimeStartupFixture()
        defer { fixture.close() }
        fixture.runtime.problem = "The address book could not be reached."
        let firstView = Task { await fixture.runtime.start() }
        await fixture.probe.waitForMachines()
        XCTAssertEqual(fixture.runtime.account?.id, "startup-account")
        firstView.cancel()
        let replacementView = Task { await fixture.runtime.start() }
        await fixture.probe.releaseMachines()
        await firstView.value
        await replacementView.value
        XCTAssertEqual(fixture.runtime.machines.map(\.id), ["startup-machine"])
        XCTAssertNil(fixture.runtime.problem)
        XCTAssertFalse(fixture.runtime.loading)
        let counts = await fixture.probe.counts()
        XCTAssertEqual(counts.machines, 1)
        XCTAssertEqual(counts.providers, 1)
    }

    @MainActor func testProviderDiscoveryFailureDoesNotPreventLoadingARestoredAccountsMachines() async throws {
        let fixture = try RuntimeStartupFixture(providerFailure: true)
        defer { fixture.close() }
        await fixture.probe.releaseMachines()
        await fixture.runtime.start()
        XCTAssertEqual(fixture.runtime.machines.map(\.id), ["startup-machine"])
        XCTAssertNil(fixture.runtime.problem)
        XCTAssertTrue(fixture.runtime.providers.isEmpty)
        XCTAssertFalse(fixture.runtime.loading)
    }

    @MainActor func testSignOutCancelsStartupWithoutAllowingItsLateMachineListToRestoreTheAccount() async throws {
        let fixture = try RuntimeStartupFixture()
        defer { fixture.close() }
        let startup = Task { await fixture.runtime.start() }
        await fixture.probe.waitForMachines()
        await fixture.runtime.signOut()
        await fixture.probe.releaseMachines()
        await startup.value
        XCTAssertNil(fixture.runtime.account)
        XCTAssertTrue(fixture.runtime.machines.isEmpty)
        XCTAssertNil(fixture.runtime.problem)
        XCTAssertFalse(fixture.runtime.loading)
        let session = try await fixture.runtime.vault?.restore()
        XCTAssertNil(session)
    }
}

@MainActor
private final class RuntimeStartupFixture {
    let runtime: AppRuntime
    let probe: RuntimeStartupProbe
    private let domain = "app.ruimte.tests.startup.\(UUID().uuidString)"
    private let defaults: UserDefaults
    private let connections: MachineConnections

    init(providerFailure: Bool = false) throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        let connections = MachineConnections(monitorPaths: false)
        let probe = RuntimeStartupProbe(providerFailure: providerFailure)
        let client = AddressBookClient(fetch: { try await probe.fetch($0) })
        let key = DeviceKey()
        let account = Account(id: "startup-account", provider: .apple, login: nil)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let session = SessionResult(
            accessToken: String(repeating: "a", count: 43), accessExpiresAt: now + 900_000,
            refreshToken: String(repeating: "r", count: 43), expiresAt: now + 86_400_000, account: account)
        let store = RuntimeStartupStore(
            StoredSession(refreshToken: session.refreshToken, expiresAt: session.expiresAt, account: account))
        let vault = SessionVault(client: RuntimeStartupSessionAPI(session: session), store: store, signer: { key })
        self.defaults = defaults
        self.connections = connections
        self.probe = probe
        runtime = AppRuntime(client: client, vault: vault, defaults: defaults, connections: connections, deviceKey: key)
    }

    func close() {
        connections.shutdown()
        defaults.removePersistentDomain(forName: domain)
    }
}

private struct RuntimeStartupSessionAPI: SessionAPI {
    let session: SessionResult
    func exchange(_ payload: SessionExchangePayload) async throws -> SessionResult { session }
    func refresh(_ payload: SessionRefreshPayload) async throws -> SessionResult { session }
    func endSession(accessToken: String) async throws {}
}

private final class RuntimeStartupStore: SessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: StoredSession?
    init(_ session: StoredSession) { self.session = session }
    func read() throws -> StoredSession? { lock.withLock { session } }
    func write(_ session: StoredSession?) throws { lock.withLock { self.session = session } }
}

private actor RuntimeStartupProbe {
    private let providerFailure: Bool
    private var providerCalls = 0
    private var machineCalls = 0
    private var arrived = false
    private var released = false
    private var arrivals: [CheckedContinuation<Void, Never>] = []
    private var requests: [CheckedContinuation<Void, Never>] = []

    init(providerFailure: Bool) { self.providerFailure = providerFailure }
    func counts() -> (machines: Int, providers: Int) { (machineCalls, providerCalls) }
    func waitForMachines() async {
        if !arrived { await withCheckedContinuation { arrivals.append($0) } }
    }
    func releaseMachines() {
        released = true
        let pending = requests
        requests.removeAll()
        for request in pending { request.resume() }
    }

    func fetch(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        if request.url?.path == "/v1/providers" {
            providerCalls += 1
            if providerFailure { throw URLError(.notConnectedToInternet) }
            data = Data(#"{"providers":["apple","github"]}"#.utf8)
        } else {
            machineCalls += 1
            arrived = true
            let waiting = arrivals
            arrivals.removeAll()
            for waiter in waiting { waiter.resume() }
            if !released { await withCheckedContinuation { requests.append($0) } }
            try Task.checkCancellation()
            let machine = Machine(
                id: "startup-machine", name: "Computer", icon: nil,
                publicKey: String(repeating: "k", count: 43), brokerUrl: "wss://broker.test", lastSeenAt: nil)
            data = try JSONEncoder().encode(MachineListResult(machines: [machine]))
        }
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
