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

final class StatementPairingsTests: XCTestCase {
    @MainActor func testForgetClearsOnlyThatMachineAndBlocksLateAuthentication() throws {
        let domain = "app.ruimte.mobile.tests.forget.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        let store = UserDefaultsPairingStore(defaults: defaults)
        let pairings = StatementPairings(store: store)
        let identity = PairingIdentity(
            machineID: "machine", machineKey: DeviceKey().publicKey, clientKey: DeviceKey().publicKey)
        let other = PairingIdentity(machineID: "other", machineKey: identity.machineKey, clientKey: identity.clientKey)
        store.insert(identity)
        store.insert(other)
        var opens = 0
        let link = try XCTUnwrap(
            pairings.open(
                identity: identity, requestAccess: { .object([:]) },
                events: LinkEvents(opened: { opens += 1 }, message: { _ in }, closed: { _ in }),
                makeLink: { PairingTestLink(access: $0, events: $1) }) as? PairingTestLink)
        pairings.forget(machineID: "machine")
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
        let identity = PairingIdentity(
            machineID: "machine", machineKey: DeviceKey().publicKey, clientKey: DeviceKey().publicKey)
        var requests = 0
        var opens = 0
        let events = LinkEvents(opened: { opens += 1 }, message: { _ in }, closed: { _ in })
        let first = try XCTUnwrap(
            StatementPairings(store: store).open(
                identity: identity,
                requestAccess: {
                    requests += 1
                    return .object([:])
                }, events: events, makeLink: { PairingTestLink(access: $0, events: $1) }) as? PairingTestLink)
        _ = try await first.access?()
        XCTAssertEqual(requests, 1)
        XCTAssertFalse(store.contains(identity))
        first.events.opened()
        XCTAssertEqual(opens, 1)
        XCTAssertTrue(store.contains(identity))

        let restarted = StatementPairings(
            store: UserDefaultsPairingStore(defaults: try XCTUnwrap(UserDefaults(suiteName: domain))))
        let second = try XCTUnwrap(
            restarted.open(
                identity: identity,
                requestAccess: {
                    requests += 1
                    throw URLError(.notConnectedToInternet)
                }, events: events, makeLink: { PairingTestLink(access: $0, events: $1) }) as? PairingTestLink)
        XCTAssertNil(second.access)
        second.events.opened()
        XCTAssertEqual(requests, 1)
        XCTAssertEqual(opens, 2)
    }

    @MainActor func testRefusalDoesNotSettleOrRestoreStatementAccess() throws {
        let store = MemoryPairingStore()
        let pairings = StatementPairings(store: store)
        let identity = PairingIdentity(
            machineID: "machine", machineKey: DeviceKey().publicKey, clientKey: DeviceKey().publicKey)
        var failures = 0
        let events = LinkEvents(opened: {}, message: { _ in }, closed: { _ in failures += 1 })
        let first = try XCTUnwrap(
            pairings.open(
                identity: identity, requestAccess: { .object([:]) }, events: events,
                makeLink: { PairingTestLink(access: $0, events: $1) }) as? PairingTestLink)
        first.events.closed(TransportFailure.invalid("statements-refused"))
        XCTAssertFalse(store.contains(identity))
        XCTAssertEqual(failures, 1)
        first.events.opened()
        XCTAssertFalse(store.contains(identity))
        let accepted = try XCTUnwrap(
            pairings.open(
                identity: identity, requestAccess: { .object([:]) }, events: events,
                makeLink: { PairingTestLink(access: $0, events: $1) }) as? PairingTestLink)
        XCTAssertNotNil(accepted.access)
        accepted.events.opened()
        let second = try XCTUnwrap(
            pairings.open(
                identity: identity, requestAccess: { .object([:]) }, events: events,
                makeLink: { PairingTestLink(access: $0, events: $1) }) as? PairingTestLink)
        XCTAssertNil(second.access)
        second.events.closed(TransportFailure.invalid("not-paired"))
        let retry = try XCTUnwrap(
            pairings.open(
                identity: identity, requestAccess: { .object([:]) }, events: events,
                makeLink: { PairingTestLink(access: $0, events: $1) }) as? PairingTestLink)
        XCTAssertNil(retry.access)
        XCTAssertEqual(failures, 2)
    }

    @MainActor func testSettlementIsBoundToMachineAndBothPinnedKeys() {
        let store = MemoryPairingStore()
        let pairings = StatementPairings(store: store)
        let identity = PairingIdentity(
            machineID: "machine", machineKey: DeviceKey().publicKey, clientKey: DeviceKey().publicKey)
        store.insert(identity)
        let changed = [
            PairingIdentity(machineID: "other", machineKey: identity.machineKey, clientKey: identity.clientKey),
            PairingIdentity(
                machineID: identity.machineID, machineKey: DeviceKey().publicKey, clientKey: identity.clientKey),
            PairingIdentity(
                machineID: identity.machineID, machineKey: identity.machineKey, clientKey: DeviceKey().publicKey),
        ]
        for identity in changed {
            _ = pairings.open(
                identity: identity, requestAccess: { .object([:]) },
                events: LinkEvents(opened: {}, message: { _ in }, closed: { _ in }),
                makeLink: { access, events in
                    XCTAssertNotNil(access)
                    return PairingTestLink(access: access, events: events)
                })
        }
    }
}
