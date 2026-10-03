import RuimtePulsar
import RuimteTransport
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
