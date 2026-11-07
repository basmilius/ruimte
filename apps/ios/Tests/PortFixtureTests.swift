import CoreGraphics
import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

/// Holds each Swift copy of a Ruimte rule to `Fixtures/ports.json`, which `packages/contracts/scripts/generate-port-fixtures.ts`
/// writes by calling the TypeScript rule on every case. A rule that moves there fails `check:swift` until the fixture is
/// written again, and fails here until this copy reads the new answer.
final class PortFixtureTests: XCTestCase {
    private func fixture() throws -> JSONValue {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ports", withExtension: "json"))
        return try JSONValue.decode(Data(contentsOf: url))
    }

    private func cases(_ name: String) throws -> [JSONValue] {
        try XCTUnwrap(try fixture()[name]?.arrayValue, name)
    }

    private func string(_ value: JSONValue, _ key: String) throws -> String {
        try XCTUnwrap(value[key]?.stringValue, key)
    }

    /// A string, or nil where the TypeScript answer is null.
    private func optionalString(_ value: JSONValue, _ key: String) -> String? { value[key]?.stringValue }

    func testNodeTitleCutsAPromptAsTheDesktopDoes() throws {
        let all = try cases("nodeTitle")
        XCTAssertGreaterThan(all.count, 30)
        for entry in all {
            let prompt = try string(entry, "prompt")
            XCTAssertEqual(NodeTitle.derive(prompt), optionalString(entry, "title"), prompt)
        }
    }

    func testASlugIsTheDesktopsForEveryName() throws {
        for entry in try cases("slug") {
            let name = try string(entry, "name")
            let fallback = try string(entry, "fallback")
            let expected = try string(entry, "slug")
            if let maxLength = entry["maxLength"]?.numberValue {
                XCTAssertEqual(Slug.of(name, fallback: fallback, maxLength: Int(maxLength)), expected, name)
            } else {
                XCTAssertEqual(Slug.of(name, fallback: fallback), expected, name)
            }
        }
        for entry in try cases("freeSlug") {
            let taken = Set(try XCTUnwrap(entry["taken"]?.arrayValue).compactMap(\.stringValue))
            let name = try string(entry, "name")
            XCTAssertEqual(
                Slug.free(name, fallback: try string(entry, "fallback"), taken: taken), try string(entry, "slug"), name)
        }
    }

    func testALaunchRunsWhereTheDesktopSaysItDoes() throws {
        let all = try cases("launchCwd")
        XCTAssertGreaterThan(all.count, 100)
        for entry in all {
            let folder = try string(entry, "folder")
            let launch = try XCTUnwrap(entry["launch"])
            // The overlay's folder wins over the launch's, also when it is empty.
            let named = launch["overlay"]?["cwd"]?.stringValue ?? launch["cwd"]?.stringValue
            XCTAssertEqual(
                LaunchPath.cwd(named, in: folder), try string(entry, "cwd"), "\(folder) + \(named ?? "nothing")")
        }
    }

    func testALaunchLacksWhatTheDesktopSaysItLacks() throws {
        for entry in try cases("launchGap") {
            let launch = try XCTUnwrap(entry["launch"])
            let kind = try XCTUnwrap(LaunchConfigKind(rawValue: try string(launch, "kind")))
            let members = launch["launches"]?.arrayValue?.compactMap(\.stringValue)
            let gap = LaunchEditing.gap(kind: kind, command: launch["command"]?.stringValue, members: members)
            XCTAssertEqual(gap.map { "\($0)" }, optionalString(entry, "gap"), "\(launch)")
        }
    }

    func testAGroupFrameIsTheDesktopsOnTheSameGrid() throws {
        for entry in try cases("groupFrame") {
            let members = try XCTUnwrap(entry["members"]?.arrayValue)
            let frame = CanvasEditing.groupFrame(members)
            guard let expected = entry["frame"], expected != .null else {
                XCTAssertNil(frame)
                continue
            }
            let actual = try XCTUnwrap(frame, "\(members)")
            XCTAssertEqual(actual.minX, expected.number("x"), "\(members)")
            XCTAssertEqual(actual.minY, expected.number("y"), "\(members)")
            XCTAssertEqual(actual.width, expected.number("w"), "\(members)")
            XCTAssertEqual(actual.height, expected.number("h"), "\(members)")
        }
    }

    func testALineIsDrawnTheWayTheDesktopDrawsIt() throws {
        for entry in try cases("addEdge") {
            let nodes: [JSONValue] = try XCTUnwrap(entry["nodes"]?.arrayValue).map { node in
                var object = node.objectValue ?? [:]
                object["title"] = node["id"]
                return .object(object)
            }
            let edges = try XCTUnwrap(entry["edges"]?.arrayValue)
            let canvas: JSONValue = .object(["nodes": .array(nodes), "edges": .array(edges)])
            var counter = 0
            let linked = CanvasEditing.linking(
                canvas, from: try string(entry, "from"), to: try string(entry, "to")
            ) {
                counter += 1
                return "new-\(counter)"
            }
            let drawn = linked.list("edges").dropFirst(edges.count).map {
                [$0.text("from"), $0.text("to"), $0.text("label", fallback: "none")]
            }
            let expected = try XCTUnwrap(entry["drawn"]?.arrayValue).map {
                [$0.text("from"), $0.text("to"), $0.text("label", fallback: "none")]
            }
            XCTAssertEqual(drawn, expected, "\(entry["from"] ?? .null) to \(entry["to"] ?? .null)")
        }
    }

    func testASessionReadsAsTheDesktopReadsIt() throws {
        for entry in try cases("sessionStatus") {
            guard let state = entry["state"], state != .null else { continue }
            var reading = SessionReading()
            reading.attached = state["attached"]?.boolValue == true
            reading.shellExited = state["exited"] != nil
            if let agent = state["agent"], agent != .null {
                reading.agent = SessionAgent(
                    kind: "claude", agentSessionId: "s", transcriptPath: nil,
                    status: try string(agent, "status"), live: agent["live"]?.boolValue == true, updatedAt: 0)
            }
            let expected = entry["status"]?.stringValue
            XCTAssertEqual(reading.status?.rawValue, expected, "\(state)")
        }
    }

    func testTheSidebarListsAndNamesViewsAsTheDesktopDoes() throws {
        let sidebar = try XCTUnwrap(fixture()["sidebar"])
        let shared = Set(try XCTUnwrap(sidebar["shared"]?.arrayValue).compactMap(\.stringValue))
        var sources = ProjectMarkSources()
        sources.shared = shared
        let entries = try XCTUnwrap(sidebar["views"]?.arrayValue)
        XCTAssertGreaterThan(entries.count, 10)
        for entry in entries {
            let wire = try XCTUnwrap(entry["view"])
            let view = try XCTUnwrap(wire.projectItem, "\(wire)")
            let id = view.id
            let listed = entry["listed"]?.boolValue == true
            XCTAssertEqual(WorkspaceViewSections.isListed(view, selectedID: nil), listed, id)
            XCTAssertEqual(ProjectListLogic.isUnlisted(view), !listed, id)
            guard listed, let row = entry["row"] else { continue }
            XCTAssertEqual(
                ProjectListLogic.marks(view: view, sources: sources).shared, row["shared"]?.boolValue, id)
            XCTAssertEqual(ProjectListLogic.provider(of: view), row["provider"]?.stringValue ?? "", id)
            // The phone opens no design on a canvas, so a design node stays out of its list.
            let stored = view.nodes
            let phoneNodes = ProjectListLogic.nodes(of: view)
            let expected = try XCTUnwrap(row["nodes"]?.arrayValue).filter { node in
                stored.first { $0.id == node.text("id") }?.kind != "design"
            }
            XCTAssertEqual(phoneNodes.map(\.id), expected.map(\.stableID), id)
            for (phone, node) in zip(phoneNodes, expected) {
                XCTAssertEqual(phone.kind, node.text("kind"), id)
                XCTAssertEqual(ProjectListLogic.provider(of: phone), node["provider"]?.stringValue ?? "", id)
            }
        }
    }
}
