import Foundation
import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class DocumentSceneTests: XCTestCase {
    func testBundledRendererMatchesDaemonScenesForAllDrawingKindsAndDiagrams() async throws {
        let renderer = LocalDocumentRenderer()
        for fixture in try fixtures() {
            let kind = try XCTUnwrap(fixture["kind"]?.stringValue)
            let document = try XCTUnwrap(fixture["document"])
            let result = try await renderer.render(kind: kind, document: document)
            XCTAssertEqual(result, fixture["scene"], kind)
        }
    }

    @MainActor func testTheMachinesSceneIsUsedWithoutOpeningTheDocument() async throws {
        let client = DocumentSceneClient()
        let result = try await DocumentSceneLoader.load(
            client: client, projectID: "project", viewID: "view", kind: "drawing")
        XCTAssertEqual(result, client.scene)
        XCTAssertEqual(client.requests.map(\.0), [.drawingPaths])
    }

    @MainActor func testAccessErrorsAreNotRetriedThroughAnotherEndpoint() async {
        let client = DocumentSceneClient()
        client.failure = .server(code: "forbidden", message: "Not authorized")
        do {
            _ = try await DocumentSceneLoader.load(
                client: client, projectID: "project", viewID: "view", kind: "drawing")
            XCTFail("The request should have failed")
        } catch {
            XCTAssertEqual(error as? MachineClientError, client.failure)
        }
        XCTAssertEqual(client.requests.map(\.0), [.drawingPaths])
    }

    func testDocumentTextCannotExecuteJavaScript() async throws {
        let document: JSONValue = .object([
            "version": .number(1), "rev": .number(0),
            "elements": .array([
                .object([
                    "id": .string("text"), "kind": .string("text"),
                    "text": .string("'); throw new Error('injected'); //"),
                    "x": .number(0), "y": .number(0), "w": .number(400), "h": .number(80),
                    "stroke": .string("ink"), "strokeWidth": .number(1), "seed": .number(1), "size": .number(16),
                ])
            ]),
        ])
        let result = try await LocalDocumentRenderer().render(kind: "drawing", document: document)
        XCTAssertEqual(
            result["elements"]?.arrayValue?.first?["text"]?.arrayValue?.first?["text"],
            .string("'); throw new Error('injected'); //"))
    }

    private func fixtures() throws -> [JSONValue] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "document-scenes", withExtension: "json"))
        return try XCTUnwrap(JSONValue.decode(Data(contentsOf: url)).arrayValue)
    }
}

@MainActor private final class DocumentSceneClient: MachineRequesting {
    var requests: [(WireRequest, JSONValue)] = []
    var failure: MachineClientError?
    var document: JSONValue = .object(["version": .number(1), "rev": .number(0), "elements": .array([])])
    let scene: JSONValue = .object([
        "rev": .number(0), "bounds": .object(["x": .number(0), "y": .number(0), "w": .number(0), "h": .number(0)]),
        "elements": .array([]),
    ])

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if type.rawValue.hasSuffix(".open") { return .object(["document": document]) }
        if let failure { throw failure }
        return scene
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
