import Observation
import RuimtePulsar
import RuimteTransport
import Synchronization
import XCTest

@testable import Ruimte

final class SessionWorkspaceTests: XCTestCase {
    func testMergeCombinesIndependentNodeEditsAndPreservesUnknownRawData() throws {
        let opaque: JSONValue = .object([
            "id": .string("future"), "kind": .string("unknown"), "raw": .object(["tracks": .array([.number(42)])]),
        ])
        let base: JSONValue = .object([
            "rev": .number(1),
            "views": .array([
                .object(["id": .string("chat"), "kind": .string("chat"), "name": .string("Before")]), opaque,
            ]),
        ])
        let local = base.setting("name", .string("Renamed project"))
        let remote = base.setting("rev", .number(2)).setting(
            "views",
            .array([
                .object(["id": .string("chat"), "kind": .string("chat"), "name": .string("Remote title")]), opaque,
            ]))
        let merged = try XCTUnwrap(MobileProjectMerge.merge(base: base, local: local, remote: remote))
        XCTAssertEqual(merged["name"], .string("Renamed project"))
        XCTAssertEqual(merged.list("views")[0]["name"], .string("Remote title"))
        XCTAssertEqual(merged.list("views")[1], opaque)
        XCTAssertEqual(merged["rev"], .number(2))
    }

    func testMergeRefusesEditAgainstDeletionAndConflictingReorder() {
        let one: JSONValue = .object(["id": .string("one"), "name": .string("One")])
        let two: JSONValue = .object(["id": .string("two")])
        let three: JSONValue = .object(["id": .string("three")])
        XCTAssertThrowsError(
            try MobileProjectMerge.merge(
                base: .array([one]), local: .array([one.setting("name", .string("Edited"))]), remote: .array([])))
        XCTAssertThrowsError(
            try MobileProjectMerge.merge(
                base: .array([one, two, three]), local: .array([two, one, three]), remote: .array([one, three, two])))
    }

    func testNestedVersionIsContentRatherThanProjectRevisionMetadata() {
        let base: JSONValue = .object(["settings": .object(["version": .number(1)])])
        let local: JSONValue = .object(["settings": .object(["version": .number(2)])])
        let remote: JSONValue = .object(["settings": .object(["version": .number(3)])])
        XCTAssertThrowsError(try MobileProjectMerge.merge(base: base, local: local, remote: remote))
    }

    @MainActor func testLastViewerReleaseWaitsForInFlightOpen() async throws {
        let gate = WorkspaceRequestGate()
        let subscriptions = ProjectSubscriptions { type, payload in try await gate.request(type, payload) }
        subscriptions.retain("project")
        let opening = Task { try await subscriptions.open("project") }
        await gate.waitForOpen()
        let closing = subscriptions.release("project", connected: true)
        XCTAssertEqual(gate.requests, ["project.open"])
        gate.completeOpen()
        _ = try await opening.value
        await closing.value
        XCTAssertEqual(gate.requests, ["project.open", "project.release"])
    }

    @MainActor func testAnotherWindowRetainsProjectSubscription() async throws {
        let gate = WorkspaceRequestGate()
        let subscriptions = ProjectSubscriptions { type, payload in try await gate.request(type, payload) }
        subscriptions.retain("project")
        subscriptions.retain("project")
        let opening = Task { try await subscriptions.open("project") }
        await gate.waitForOpen()
        await subscriptions.release("project", connected: true).value
        XCTAssertEqual(gate.requests, ["project.open"])
        gate.completeOpen()
        _ = try await opening.value
        await subscriptions.release("project", connected: true).value
        XCTAssertEqual(gate.requests, ["project.open", "project.release"])
    }

    @MainActor func testASaveThatConflictedGoesOutAgainOnceMerged() async throws {
        let runtime = AppRuntime(connections: MachineConnections(monitorPaths: false))
        let machine = Machine(
            id: "conflict-\(UUID().uuidString)", name: "Mac", icon: nil, publicKey: DeviceKey().publicKey,
            brokerUrl: nil, lastSeenAt: nil)
        let session = runtime.session(for: machine)
        let wire = ConflictWire()
        session.rpc = wire.client
        let workspace = MobileWorkspace(session: session, projectID: "project")
        defer {
            workspace.stop()
            wire.client.shutdown()
            runtime.connections.shutdown()
            UserDefaults.standard.removeObject(forKey: workspace.storageKey)
        }
        workspace.start()
        await workspace.open()
        XCTAssertTrue(workspace.ready, workspace.problem ?? "The project did not open")
        wire.remote = wire.remote.setting("rev", .number(2)).setting("color", .string("#e7000b"))
        wire.conflicts = 1

        await workspace.edit { $0.setting("name", .string("Renamed on the phone")) }

        XCTAssertEqual(wire.saves.count, 2)
        XCTAssertEqual(wire.saves.last?["baseRev"], .number(2))
        XCTAssertEqual(wire.saves.last?["content"]?["name"], .string("Renamed on the phone"))
        XCTAssertEqual(wire.saves.last?["content"]?["color"], .string("#e7000b"))
        XCTAssertNil(workspace.problem)
    }

    @MainActor func testAProjectHasTheTitleAndKindOfItsRowBeforeItOpens() {
        let runtime = AppRuntime(connections: MachineConnections(monitorPaths: false))
        let machine = Machine(
            id: "row-\(UUID().uuidString)", name: "Mac", icon: nil, publicKey: DeviceKey().publicKey,
            brokerUrl: nil, lastSeenAt: nil)
        defer { runtime.connections.shutdown() }
        let workspace = MobileWorkspace(
            session: runtime.session(for: machine), projectID: "chats",
            summary: .object(["name": .string("Chats"), "scratch": .bool(true)]))

        XCTAssertFalse(workspace.ready)
        XCTAssertEqual(workspace.title, "Chats")
        XCTAssertTrue(workspace.isScratch)
    }

    @MainActor func testCameraBurstKeepsLatestPositionWithoutPublishingOrWritingEveryTick() throws {
        let fixture = CameraWorkspaceFixture()
        let workspace = fixture.workspace
        let before = workspace.local
        let publications = Mutex(0)
        withObservationTracking {
            _ = workspace.camera(for: "canvas")
        } onChange: {
            publications.withLock { $0 += 1 }
        }
        for offset in 0..<100 {
            workspace.setCamera(.object(["zoom": .number(Double(offset + 1))]), viewID: "canvas")
        }
        let latest = JSONValue.object(["zoom": .number(100)])
        XCTAssertEqual(workspace.camera(for: "canvas"), latest)
        XCTAssertEqual(workspace.local, before)
        XCTAssertEqual(publications.withLock { $0 }, 0)
        XCTAssertNil(UserDefaults.standard.data(forKey: workspace.storageKey))

        workspace.stop()
        let stored = try JSONValue.decode(XCTUnwrap(UserDefaults.standard.data(forKey: workspace.storageKey)))
        XCTAssertEqual(stored["views"]?["canvas"]?["camera"], latest)
        XCTAssertEqual(publications.withLock { $0 }, 1)
    }

    @MainActor func testLocalSavesIncludePendingCamerasAndPreserveSelectionAndLocks() throws {
        let fixture = CameraWorkspaceFixture()
        let workspace = fixture.workspace
        workspace.select("first")
        let locks = CanvasLocks(pan: true, zoom: false, move: true, resize: true)
        workspace.setLocks(locks, viewID: "first")
        workspace.setCamera(.object(["zoom": .number(2)]), viewID: "first")
        workspace.setCamera(.object(["zoom": .number(3)]), viewID: "second")
        workspace.setLocks(locks, viewID: "second")
        workspace.setCamera(.object(["zoom": .number(4)]), viewID: "first")
        workspace.select("second")

        let selected = try JSONValue.decode(XCTUnwrap(UserDefaults.standard.data(forKey: workspace.storageKey)))
        XCTAssertEqual(selected["activeViewId"], .string("second"))
        XCTAssertEqual(selected["views"]?["first"]?["camera"], .object(["zoom": .number(4)]))
        XCTAssertEqual(selected["views"]?["second"]?["camera"], .object(["zoom": .number(3)]))
        for id in ["first", "second"] {
            XCTAssertEqual(selected["views"]?[id]?["locks"], locks.json)
            XCTAssertEqual(selected["views"]?[id]?["focusedNodeId"], .null)
        }

        workspace.setCamera(.object(["zoom": .number(5)]), viewID: "second")
        workspace.flushCameras()
        let flushed = try JSONValue.decode(XCTUnwrap(UserDefaults.standard.data(forKey: workspace.storageKey)))
        XCTAssertEqual(flushed["views"]?["second"]?["camera"], .object(["zoom": .number(5)]))
        XCTAssertEqual(flushed["views"]?["first"], selected["views"]?["first"])
        XCTAssertEqual(flushed["activeViewId"], .string("second"))
    }

    @MainActor func testCameraProgressIsCheckpointedWhileUpdatesContinue() async throws {
        let fixture = CameraWorkspaceFixture()
        let workspace = fixture.workspace
        let checkpoint = expectation(description: "An ongoing pan checkpoints its camera")
        withObservationTracking {
            _ = workspace.local
        } onChange: {
            checkpoint.fulfill()
        }
        let movement = Task {
            for zoom in 1...100 {
                workspace.setCamera(.object(["zoom": .number(Double(zoom))]), viewID: "canvas")
                do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
            }
        }
        await fulfillment(of: [checkpoint], timeout: 3)
        movement.cancel()
        await movement.value

        let stored = try JSONValue.decode(XCTUnwrap(UserDefaults.standard.data(forKey: workspace.storageKey)))
        let zoom = stored["views"]?["canvas"]?["camera"]?.number("zoom") ?? 0
        XCTAssertGreaterThan(zoom, 0)
        XCTAssertLessThan(zoom, 100)
        XCTAssertEqual(stored, workspace.local)
    }
}

@MainActor private final class CameraWorkspaceFixture {
    let runtime = AppRuntime(connections: MachineConnections(monitorPaths: false))
    let workspace: MobileWorkspace

    init() {
        let machine = Machine(
            id: "camera-\(UUID().uuidString)", name: "Mac", icon: nil, publicKey: DeviceKey().publicKey,
            brokerUrl: nil, lastSeenAt: nil)
        workspace = MobileWorkspace(session: runtime.session(for: machine), projectID: "project")
    }

    isolated deinit {
        workspace.stop()
        runtime.connections.shutdown()
        UserDefaults.standard.removeObject(forKey: workspace.storageKey)
    }
}

/// A machine whose project changed elsewhere: the next `conflicts` saves are refused until the phone reopens it.
@MainActor private final class ConflictWire {
    var remote: JSONValue = .object([
        "version": .number(3), "rev": .number(1), "name": .string("Ruimte"), "color": .string("#155dfc"),
        "views": .array([]),
    ])
    var conflicts = 0
    private(set) var saves: [JSONValue] = []
    lazy var client = MachineClient(send: { [weak self] text in try self?.receive(text) }, connected: true)

    private func receive(_ text: String) throws {
        let frame = try JSONValue.decode(Data(text.utf8))
        let id = frame["id"] ?? .null
        let reply: JSONValue
        switch frame.text("type") {
        case "project.open":
            reply = .object([
                "id": id, "ok": .bool(true),
                "result": .object([
                    "summary": summary, "document": remote,
                    "local": .object(["activeViewId": .null, "views": .object([:])]),
                ]),
            ])
        case "project.save" where conflicts > 0:
            conflicts -= 1
            saves.append(frame["payload"] ?? .null)
            reply = .object([
                "id": id, "ok": .bool(false),
                "error": .object(["code": .string("rev-conflict"), "message": .string("The project changed.")]),
            ])
        case "project.save":
            saves.append(frame["payload"] ?? .null)
            let rev = remote.number("rev") + 1
            remote = (frame["payload"]?["content"] ?? remote).setting("rev", .number(rev))
            reply = .object(["id": id, "ok": .bool(true), "result": .object(["rev": .number(rev)])])
        default:
            reply = .object(["id": id, "ok": .bool(true), "result": .object([:])])
        }
        client.receive(String(decoding: try reply.encoded(), as: UTF8.self))
    }

    private var summary: JSONValue {
        .object([
            "projectId": .string("project"), "name": .string("Ruimte"), "color": .string("#155dfc"),
            "folder": .string("/work/project"), "lastOpenedAt": .number(1), "closedAt": .null, "available": .bool(true),
            "icon": .object(["kind": .string("initial"), "value": .string("R")]), "nameSource": .string("chosen"),
        ])
    }
}

@MainActor private final class WorkspaceRequestGate {
    var requests: [String] = []
    private var openContinuation: CheckedContinuation<JSONValue, Error>?
    private var waiting: CheckedContinuation<Void, Never>?
    func request(_ type: String, _ payload: JSONValue) async throws -> JSONValue {
        requests.append(type)
        if type == "project.open" {
            return try await withCheckedThrowingContinuation { continuation in
                openContinuation = continuation
                waiting?.resume()
                waiting = nil
            }
        }
        return .object([:])
    }
    func waitForOpen() async {
        if openContinuation != nil { return }
        await withCheckedContinuation { waiting = $0 }
    }
    func completeOpen() {
        openContinuation?.resume(returning: .object([:]))
        openContinuation = nil
    }
}
