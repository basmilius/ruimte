import RuimtePulsar
import XCTest

@testable import RuimteTransport

@MainActor private final class MemoryPairingStore: StatementPairingStore {
    var identities = Set<PairingIdentity>()
    func contains(_ identity: PairingIdentity) -> Bool { identities.contains(identity) }
    func insert(_ identity: PairingIdentity) { identities.insert(identity) }
    func remove(machineID: String) { identities = identities.filter { $0.machineID != machineID } }
}

@MainActor private final class PairingTestLink: MachineLink {
    let access: StatementPairings.Access?
    let events: LinkEvents
    init(access: StatementPairings.Access?, events: LinkEvents) {
        self.access = access
        self.events = events
    }
    func send(_ text: String) throws {}
    func close() {}
}

private func newIdentity() -> PairingIdentity {
    PairingIdentity(machineID: "machine", machineKey: DeviceKey().publicKey, clientKey: DeviceKey().publicKey)
}

@MainActor private func open(
    _ pairings: StatementPairings, _ identity: PairingIdentity, events: LinkEvents = .ignored,
    requestAccess: @escaping StatementPairings.Access = { .object([:]) }
) throws -> PairingTestLink {
    try XCTUnwrap(
        pairings.open(
            identity: identity, requestAccess: requestAccess, events: events,
            makeLink: { PairingTestLink(access: $0, events: $1) }) as? PairingTestLink)
}

final class StatementPairingsTests: XCTestCase {
    @MainActor func testForgetClearsOnlyThatMachineAndBlocksLateAuthentication() throws {
        let domain = "app.ruimte.mobile.tests.forget.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        let store = UserDefaultsPairingStore(defaults: defaults)
        let pairings = StatementPairings(store: store)
        let identity = newIdentity()
        let other = PairingIdentity(machineID: "other", machineKey: identity.machineKey, clientKey: identity.clientKey)
        store.insert(identity)
        store.insert(other)
        var opens = 0
        let link = try open(
            pairings, identity, events: LinkEvents(opened: { opens += 1 }, message: { _ in }, closed: { _ in }))
        pairings.forget(machineID: "machine")
        link.events.accepted()
        link.events.opened()
        XCTAssertEqual(opens, 0)
        XCTAssertFalse(store.contains(identity))
        XCTAssertTrue(store.contains(other))
        let replacement = PairingIdentity(
            machineID: "machine", machineKey: DeviceKey().publicKey, clientKey: identity.clientKey)
        store.insert(identity)
        store.insert(replacement)
        XCTAssertFalse(store.contains(identity))
        XCTAssertTrue(store.contains(replacement))
    }

    @MainActor func testAcceptedStatementSurvivesRestartAndReconnectsWithoutAddressBook() async throws {
        let domain = "app.ruimte.mobile.tests.pairings.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        let store = UserDefaultsPairingStore(defaults: defaults)
        let identity = newIdentity()
        var requests = 0
        var opens = 0
        let events = LinkEvents(opened: { opens += 1 }, message: { _ in }, closed: { _ in })
        let first = try open(StatementPairings(store: store), identity, events: events) {
            requests += 1
            return .object([:])
        }
        _ = try await first.access?()
        XCTAssertEqual(requests, 1)
        XCTAssertFalse(store.contains(identity))
        first.events.accepted()
        XCTAssertTrue(store.contains(identity))
        XCTAssertEqual(opens, 0)
        first.events.opened()
        XCTAssertEqual(opens, 1)

        let restarted = StatementPairings(
            store: UserDefaultsPairingStore(defaults: try XCTUnwrap(UserDefaults(suiteName: domain))))
        let second = try open(restarted, identity, events: events) {
            requests += 1
            throw URLError(.notConnectedToInternet)
        }
        XCTAssertNil(second.access)
        second.events.opened()
        XCTAssertEqual(requests, 1)
        XCTAssertEqual(opens, 2)
    }

    @MainActor func testRefusalDoesNotSettleOrRestoreStatementAccess() throws {
        let store = MemoryPairingStore()
        let pairings = StatementPairings(store: store)
        let identity = newIdentity()
        var failures = 0
        let events = LinkEvents(opened: {}, message: { _ in }, closed: { _ in failures += 1 })
        let first = try open(pairings, identity, events: events)
        first.events.closed(TransportFailure.refused(code: .statementsRefused, reason: "It takes no statement."))
        XCTAssertFalse(store.contains(identity))
        XCTAssertEqual(failures, 1)
        first.events.accepted()
        first.events.opened()
        XCTAssertFalse(store.contains(identity))
        let accepted = try open(pairings, identity, events: events)
        XCTAssertNotNil(accepted.access)
        accepted.events.accepted()
        accepted.events.opened()
        let second = try open(pairings, identity, events: events)
        XCTAssertNil(second.access)
        second.events.closed(TransportFailure.refused(code: .notPaired, reason: "It does not know this device."))
        let retry = try open(pairings, identity, events: events)
        XCTAssertNil(retry.access)
        XCTAssertEqual(failures, 2)
    }

    @MainActor func testARefusalAfterTheMachineAcceptedDoesNotAskForAccessAgain() throws {
        let pairings = StatementPairings(store: MemoryPairingStore())
        let identity = newIdentity()
        let first = try open(pairings, identity)
        XCTAssertNotNil(first.access)
        first.events.accepted()
        first.events.closed(TransportFailure.invalid("older machine"))
        XCTAssertNil(try open(pairings, identity).access)
    }

    @MainActor func testSettlementIsBoundToMachineAndBothPinnedKeys() throws {
        let store = MemoryPairingStore()
        let pairings = StatementPairings(store: store)
        let identity = newIdentity()
        store.insert(identity)
        let changed = [
            PairingIdentity(machineID: "other", machineKey: identity.machineKey, clientKey: identity.clientKey),
            PairingIdentity(
                machineID: identity.machineID, machineKey: DeviceKey().publicKey, clientKey: identity.clientKey),
            PairingIdentity(
                machineID: identity.machineID, machineKey: identity.machineKey, clientKey: DeviceKey().publicKey),
        ]
        for identity in changed {
            XCTAssertNotNil(try open(pairings, identity).access)
        }
    }
}
