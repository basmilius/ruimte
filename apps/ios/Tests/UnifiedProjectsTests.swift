import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class UnifiedProjectsTests: XCTestCase {
    @MainActor func testUnifiedSortingKeepsMachineIdentityAndUnavailableRows() throws {
        let fixture = try ProjectListFixture()
        defer { fixture.clean() }
        let first = fixture.machine("first")
        let second = fixture.machine("second")
        let sharedID = UUID().uuidString
        try fixture.cache(
            first,
            [
                fixture.summary(sharedID, opened: 30),
                fixture.summary(opened: 100, closed: 5),
            ])
        try fixture.cache(
            second,
            [
                fixture.summary(sharedID, opened: 20, available: false),
                fixture.summary(opened: 10, closed: 50),
                fixture.summary(opened: 1, closed: 0),
            ])
        fixture.model.reconcile(machines: [second, first], connect: nil)
        XCTAssertEqual(fixture.model.open.map(\.machine.id), ["first", "second"])
        XCTAssertEqual(Set(fixture.model.open.map(\.id)).count, 2)
        XCTAssertEqual(fixture.model.recent.map { $0.summary.number("closedAt") }, [50, 5, 0])
        XCTAssertEqual(fixture.model.unavailable.count, 1)
        XCTAssertTrue((fixture.model.open + fixture.model.recent).allSatisfy { !$0.connected })
    }

    @MainActor func testOfflineCacheSurvivesDisconnectAndStopReleasesOnlyListDemand() async throws {
        let fixture = try ProjectListFixture()
        defer { fixture.clean() }
        let machine = fixture.machine("machine")
        let client = ProjectListClient()
        client.response = .object(["projects": .array([fixture.summary(opened: 42)])])
        fixture.model.reconcile(machines: [machine], connect: { _ in client.connection })
        XCTAssertEqual(client.holds, 1)
        client.setConnected(true)
        await fixture.model.refresh()
        XCTAssertEqual(fixture.model.open.count, 1)
        XCTAssertTrue(fixture.model.open[0].connected)
        client.setConnected(false)
        XCTAssertFalse(fixture.model.open[0].connected)
        fixture.model.stop()
        fixture.model.stop()
        XCTAssertEqual(client.holds, 0)
        XCTAssertTrue(client.eventHandlers.isEmpty)
        XCTAssertTrue(client.connectionHandlers.isEmpty)
        let offline = UnifiedProjects(defaults: fixture.defaults)
        offline.reconcile(machines: [machine], connect: nil)
        XCTAssertEqual(offline.open[0].summary.number("lastOpenedAt"), 42)
        XCTAssertFalse(offline.open[0].connected)
    }

    @MainActor func testReconcileUpdatesLabelsWithoutAcquiringAnotherLease() throws {
        let fixture = try ProjectListFixture()
        defer { fixture.clean() }
        let machine = fixture.machine("machine")
        try fixture.cache(machine, [fixture.summary(opened: 1)])
        let client = ProjectListClient()
        fixture.model.reconcile(machines: [machine], connect: { _ in client.connection })
        let renamed = Machine(
            id: machine.id, name: "Renamed", icon: nil, publicKey: machine.publicKey,
            brokerUrl: machine.brokerUrl, lastSeenAt: nil)
        fixture.model.reconcile(machines: [renamed], connect: { _ in client.connection })
        XCTAssertEqual(client.holds, 1)
        XCTAssertEqual(fixture.model.open[0].machine.name, "Renamed")
        fixture.model.stop()
        fixture.model.reconcile(machines: [renamed], connect: { _ in client.connection })
        XCTAssertEqual(client.holds, 1)
    }

    @MainActor func testRevocationAndRotatedKeysRejectLateResponsesAndDeleteCache() async throws {
        let fixture = try ProjectListFixture()
        defer { fixture.clean() }
        let machine = fixture.machine("machine")
        try fixture.cache(machine, [fixture.summary(opened: 1)])
        let client = ProjectListClient()
        fixture.model.reconcile(machines: [machine], connect: { _ in client.connection })
        client.setConnected(true)
        await fixture.model.refresh()
        client.holdResponses = true
        let refresh = Task { await fixture.model.refresh() }
        await client.waitForHeldRequest()
        fixture.model.reconcile(machines: [], connect: nil)
        client.finishHeld(.object(["projects": .array([fixture.summary(opened: 99)])]))
        await refresh.value
        XCTAssertTrue(fixture.model.open.isEmpty)
        XCTAssertNil(fixture.defaults.data(forKey: "ruimte.ios.projects.machine"))
        XCTAssertEqual(client.holds, 0)
        try fixture.cache(machine, [fixture.summary(opened: 2)])
        fixture.defaults.set(machine.publicKey, forKey: "ruimte.ios.projects.machine.publicKey")
        let rotated = fixture.machine("machine", key: String(repeating: "B", count: 43))
        fixture.model.reconcile(machines: [rotated], connect: nil)
        XCTAssertTrue(fixture.model.open.isEmpty)
        XCTAssertNil(fixture.defaults.data(forKey: "ruimte.ios.projects.machine"))
    }

    @MainActor func testRevocationGuardPreventsUpdatesBeforeReconcileRuns() async throws {
        let fixture = try ProjectListFixture()
        defer { fixture.clean() }
        let machine = fixture.machine("machine")
        let client = ProjectListClient()
        fixture.model.reconcile(machines: [machine], connect: { _ in client.connection })
        client.setConnected(true)
        await fixture.model.refresh()
        client.holdResponses = true
        let refresh = Task { await fixture.model.refresh() }
        await client.waitForHeldRequest()
        client.current = false
        client.finishHeld(.object(["projects": .array([fixture.summary(opened: 99)])]))
        await refresh.value
        XCTAssertTrue(fixture.model.open.isEmpty)
        let cached = try JSONValue.decode(
            XCTUnwrap(fixture.defaults.data(forKey: "ruimte.ios.projects.machine")))
        XCTAssertEqual(cached.arrayValue, [])
    }

    @MainActor func testSummaryEventMovesOpenProjectToRecentAndRefreshesList() async throws {
        let fixture = try ProjectListFixture()
        defer { fixture.clean() }
        let machine = fixture.machine("machine")
        let client = ProjectListClient()
        let project = fixture.summary(opened: 5)
        client.response = .object(["projects": .array([project])])
        fixture.model.reconcile(machines: [machine], connect: { _ in client.connection })
        client.setConnected(true)
        await fixture.model.refresh()
        let closed = project.setting("closedAt", .number(8)).setting("name", .string("Renamed"))
        client.response = .object(["projects": .array([closed])])
        client.emit(.object(["summary": closed]))
        XCTAssertTrue(fixture.model.open.isEmpty)
        XCTAssertEqual(fixture.model.recent.first?.summary.text("name"), "Renamed")
        await fixture.model.refresh()
        XCTAssertEqual(fixture.model.recent.count, 1)
    }

    @MainActor func testInvalidCacheRowsAreDiscardedAndCacheIsBounded() async throws {
        let fixture = try ProjectListFixture()
        defer { fixture.clean() }
        let machine = fixture.machine("machine")
        try fixture.cache(machine, [.string("invalid"), fixture.summary(opened: 1)])
        fixture.model.reconcile(machines: [machine], connect: nil)
        XCTAssertEqual(fixture.model.open.count, 1)
        let client = ProjectListClient()
        client.response = .object([
            "projects": .array((0..<55).map { fixture.summary(opened: Double($0)) })
        ])
        fixture.model.reconcile(machines: [machine], connect: { _ in client.connection })
        client.setConnected(true)
        await fixture.model.refresh()
        XCTAssertEqual(fixture.model.open.count, 55)
        let cache = try JSONValue.decode(
            XCTUnwrap(fixture.defaults.data(forKey: "ruimte.ios.projects.machine")))
        XCTAssertEqual(cache.arrayValue?.count, 50)
        XCTAssertEqual(cache.arrayValue?.first?.number("lastOpenedAt"), 54)
        XCTAssertEqual(cache.arrayValue?.last?.number("lastOpenedAt"), 5)
    }
}

@MainActor private final class ProjectListFixture {
    let domain = "app.ruimte.mobile.tests.project-list.\(UUID().uuidString)"
    let defaults: UserDefaults
    let model: UnifiedProjects

    init() throws {
        defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        model = UnifiedProjects(defaults: defaults)
    }
    func clean() {
        model.stop()
        defaults.removePersistentDomain(forName: domain)
    }
    func machine(_ id: String, key: String = String(repeating: "A", count: 43)) -> Machine {
        Machine(
            id: id, name: id, icon: nil, publicKey: key, brokerUrl: "wss://broker.test",
            lastSeenAt: nil)
    }
    func summary(
        _ id: String = UUID().uuidString, opened: Double, closed: Double? = nil,
        available: Bool = true
    ) -> JSONValue {
        .object([
            "projectId": .string(id), "name": .string("Project"), "color": .string("blue"),
            "folder": .null,
            "lastOpenedAt": .number(opened), "closedAt": closed.map(JSONValue.number) ?? .null,
            "available": .bool(available),
            "icon": .object(["kind": .string("initial"), "value": .string("P")]),
            "nameSource": .string("chosen"),
        ])
    }
    func cache(_ machine: Machine, _ summaries: [JSONValue]) throws {
        defaults.set(
            try JSONValue.array(summaries).encoded(), forKey: "ruimte.ios.projects.\(machine.id)")
    }
}

@MainActor private final class ProjectListClient: MachineRequesting {
    var response: JSONValue = .object(["projects": .array([])])
    var eventHandlers: [UUID: @MainActor @Sendable (JSONValue) -> Void] = [:]
    var connectionHandlers: [UUID: @MainActor @Sendable (Bool) -> Void] = [:]
    var connected = false
    var current = true
    var holds = 0
    var holdResponses = false
    private var held: CheckedContinuation<JSONValue, Error>?
    private var waiting: CheckedContinuation<Void, Never>?
    var connection: UnifiedProjectConnection {
        UnifiedProjectConnection(
            client: self, retain: { self.holds += 1 }, release: { self.holds -= 1 },
            isCurrent: { self.current })
    }
    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        XCTAssertEqual(type, "project.list")
        guard holdResponses else { return response }
        return try await withCheckedThrowingContinuation {
            held = $0
            waiting?.resume()
            waiting = nil
        }
    }
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void)
        -> () -> Void
    {
        XCTAssertEqual(event, "project.summary")
        let id = UUID()
        eventHandlers[id] = handler
        return { self.eventHandlers.removeValue(forKey: id) }
    }
    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        let id = UUID()
        connectionHandlers[id] = handler
        handler(connected)
        return { self.connectionHandlers.removeValue(forKey: id) }
    }
    func setConnected(_ value: Bool) {
        connected = value
        for handler in connectionHandlers.values { handler(value) }
    }
    func emit(_ value: JSONValue) { for handler in eventHandlers.values { handler(value) } }
    func waitForHeldRequest() async {
        if held != nil { return }
        await withCheckedContinuation { waiting = $0 }
    }
    func finishHeld(_ value: JSONValue) {
        held?.resume(returning: value)
        held = nil
    }
}
