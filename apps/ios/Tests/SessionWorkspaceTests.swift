import RuimtePulsar
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
