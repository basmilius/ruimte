import Foundation
import RuimtePulsar
import RuimteTransport
import Synchronization
import XCTest

@testable import Ruimte

final class RuntimeStartupTests: XCTestCase {
    @MainActor func testRestoringAnAccountSurvivesTheRootViewTaskBeingCanceled() async throws {
        let fixture = try RuntimeStartupFixture()
        defer { fixture.close() }
        fixture.runtime.problem = "Could not reach the address book."
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

final class NotificationSyncTests: XCTestCase {
    @MainActor func testACancelledSyncLeavesNoProblem() async throws {
        for replacementFails in [false, true] {
            for lateFailure in [false, true] {
                let probe = NotificationSyncProbe(replacementFails: replacementFails, lateFailure: lateFailure)
                let fixture = try NotificationSyncFixture(probe: probe)
                defer { fixture.close() }
                let coordinator = fixture.runtime.notifications
                let waiting = Task { await coordinator.synchronize() }
                await probe.waitForRequest()
                let request = await probe.firstRequest
                XCTAssertEqual(request?.httpMethod, "DELETE")
                XCTAssertEqual(request?.url?.path, "/v1/push/devices/retired")
                XCTAssertEqual(request?.value(forHTTPHeaderField: "Authorization"), "Bearer \(fixture.accessToken)")

                waiting.cancel()
                await coordinator.synchronize()
                let expected = replacementFails ? "Newer sync failed" : nil
                XCTAssertEqual(coordinator.problem, expected)
                await probe.releaseRequest()
                await waiting.value
                XCTAssertEqual(coordinator.problem, expected)
                let state = await probe.state()
                XCTAssertEqual(state.requests, 2)
                XCTAssertTrue(state.cancelledAtCompletion)
            }
        }
        try await assertCancellationWhileConnecting()
    }

    @MainActor private func assertCancellationWhileConnecting() async throws {
        let connections = MachineConnections(scheduler: NotificationSyncScheduler(), monitorPaths: false)
        let fixture = try NotificationSyncFixture(connections: connections)
        defer { fixture.close() }
        let machine = Machine(
            id: fixture.domain, name: "Offline", icon: nil,
            publicKey: String(repeating: "A", count: 43), brokerUrl: "wss://broker.test", lastSeenAt: nil)
        fixture.runtime.machines = [machine]
        let arrival = NativeArrival()
        var attempts = 0
        var opened: NotificationSyncLink?
        connections.setScene("notification-sync", foreground: true)
        let seed = connections.hold(
            machineID: machine.id,
            open: { events in
                attempts += 1
                // Leave the existing opener cached for the real session's next hold.
                if attempts == 1 { throw MachineClientError.disconnected }
                let link = NotificationSyncLink(events: events)
                opened = link
                arrival.record()
                return link
            }, events: LinkEvents(opened: {}, message: { _ in }, closed: { _ in }))
        seed.release()
        let coordinator = fixture.runtime.notifications
        let atOnce = Task { await coordinator.synchronize() }
        atOnce.cancel()
        await atOnce.value
        XCTAssertNil(coordinator.problem)
        let waiting = Task { await coordinator.synchronize() }
        await arrival.wait()
        let link = try XCTUnwrap(opened)
        XCTAssertEqual(attempts, 2)
        XCTAssertNil(coordinator.problem)
        waiting.cancel()
        await waiting.value
        XCTAssertNil(coordinator.problem)
        let lateOpen = NativeTaskDrain {
            link.events.features(["push.subscribe"])
            link.events.opened()
        }
        await lateOpen.finish()
        XCTAssertFalse(fixture.runtime.session(for: machine).connected)
        XCTAssertTrue(link.sent.isEmpty)
    }

    @MainActor func testSynchronizationUsesOnlyItsRuntimeDefaultsAndPushStore() async throws {
        let standardBefore = UserDefaults.standard.dictionaryRepresentation().filter {
            $0.key.hasPrefix("ruimte.push.")
        }
        let shared = try XCTUnwrap(UserDefaults(suiteName: SharedPushStore.group))
        let sharedBefore = shared.data(forKey: "push-context")
        let first = try NotificationSyncFixture()
        let second = try NotificationSyncFixture(enabled: false)
        defer {
            first.close()
            second.close()
        }
        XCTAssertTrue(first.runtime.notifications.enabled)
        XCTAssertFalse(second.runtime.notifications.enabled)
        await first.runtime.notifications.synchronize()
        XCTAssertEqual(try first.store.context()?.handle, first.domain)
        XCTAssertEqual(try first.store.context()?.machinePublicKeys, [:])
        XCTAssertEqual(try second.store.context()?.handle, second.domain)
        XCTAssertEqual(try second.store.context()?.machinePublicKeys, ["untouched": "key"])
        XCTAssertNil(first.runtime.notifications.problem)
        XCTAssertEqual(shared.data(forKey: "push-context"), sharedBefore)
        let standardAfter = UserDefaults.standard.dictionaryRepresentation().filter { $0.key.hasPrefix("ruimte.push.") }
        XCTAssertEqual(standardAfter as NSDictionary, standardBefore as NSDictionary)
    }
}

@MainActor
private final class NotificationSyncFixture {
    let domain = "app.ruimte.tests.notifications.\(UUID().uuidString)"
    let runtime: AppRuntime
    let store: SharedPushStore
    let accessToken = String(repeating: "a", count: 43)
    private let defaults: UserDefaults
    private let connections: MachineConnections

    init(probe: NotificationSyncProbe? = nil, enabled: Bool = true, connections: MachineConnections? = nil) throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defaults.set(enabled, forKey: "ruimte.push.enabled")
        if probe != nil { defaults.set(["retired"], forKey: "ruimte.push.retired-handles") }
        let store = try SharedPushStore(accessGroup: domain, suiteName: domain)
        try store.save(PushDeviceContext(handle: domain, machinePublicKeys: ["untouched": "key"]))
        let connections = connections ?? MachineConnections(monitorPaths: false)
        let key = DeviceKey()
        let account = Account(id: "push-account", provider: .apple, login: nil)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let session = SessionResult(
            accessToken: accessToken, accessExpiresAt: now + 900_000,
            refreshToken: String(repeating: "r", count: 43), expiresAt: now + 86_400_000, account: account)
        let vault = probe.map { _ in
            SessionVault(
                client: RuntimeStartupSessionAPI(session: session),
                store: RuntimeStartupStore(
                    StoredSession(refreshToken: session.refreshToken, expiresAt: session.expiresAt, account: account)),
                signer: { key })
        }
        self.defaults = defaults
        self.store = store
        self.connections = connections
        runtime = AppRuntime(
            vault: vault, defaults: defaults, connections: connections, deviceKey: key,
            pushAPI: PushAPI(fetch: { request in
                guard let probe else { throw URLError(.unsupportedURL) }
                return try await probe.fetch(request)
            }), pushStore: { store })
    }

    func close() {
        connections.shutdown()
        defaults.removePersistentDomain(forName: domain)
    }
}

@MainActor private struct NotificationSyncScheduler: TransportScheduling {
    func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void { {} }
}

@MainActor private final class NotificationSyncLink: MachineLink {
    let events: LinkEvents
    private(set) var sent: [String] = []
    init(events: LinkEvents) { self.events = events }
    func send(_ text: String) throws { sent.append(text) }
    func close() {}
}

private actor NotificationSyncProbe {
    private let replacementFails: Bool
    private let lateFailure: Bool
    private var arrived: CheckedContinuation<Void, Never>?
    private var pending: CheckedContinuation<Void, Never>?
    private var requests = 0
    private var cancelledAtCompletion = false
    private(set) var firstRequest: URLRequest?

    init(replacementFails: Bool, lateFailure: Bool) {
        self.replacementFails = replacementFails
        self.lateFailure = lateFailure
    }

    func waitForRequest() async {
        if pending == nil { await withCheckedContinuation { arrived = $0 } }
    }

    func releaseRequest() {
        pending?.resume()
        pending = nil
    }

    func state() -> (requests: Int, cancelledAtCompletion: Bool) { (requests, cancelledAtCompletion) }

    func fetch(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if request.httpMethod == "DELETE" {
            requests += 1
            if requests == 1 {
                firstRequest = request
                await withCheckedContinuation {
                    pending = $0
                    arrived?.resume()
                    arrived = nil
                }
                cancelledAtCompletion = Task.isCancelled
                if lateFailure { throw URLError(.networkConnectionLost) }
                throw CancellationError()
            }
            if replacementFails {
                throw AddressBookRequestError(code: "push", status: 503, message: "Newer sync failed")
            }
        }
        return (
            Data("{}".utf8),
            HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        )
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
        let pushStore = try SharedPushStore(accessGroup: domain, suiteName: domain)
        self.defaults = defaults
        self.connections = connections
        self.probe = probe
        runtime = AppRuntime(
            client: client, vault: vault, defaults: defaults, connections: connections, deviceKey: key,
            pushStore: { pushStore })
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

private final class RuntimeStartupStore: SessionStore {
    private let session: Mutex<StoredSession?>
    init(_ session: StoredSession) { self.session = Mutex(session) }
    func read() throws -> StoredSession? { session.withLock { $0 } }
    func write(_ session: StoredSession?) throws { self.session.withLock { $0 = session } }
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
