import CoreGraphics
import RuimtePulsar
import RuimteTransport
import Testing

@testable import Ruimte

@MainActor @Suite struct DrawingEditorTests {
    private func document(_ elements: [JSONValue], rev: Double) -> JSONValue {
        .object(["version": .number(1), "rev": .number(rev), "elements": .array(elements)])
    }
    private func rectangle(_ id: String, x: Double = 0) -> JSONValue {
        .object([
            "id": .string(id), "kind": .string("rect"), "x": .number(x), "y": .number(0), "w": .number(100),
            "h": .number(80), "stroke": .string("ink"), "strokeWidth": .number(2), "seed": .number(1),
        ])
    }
    @Test func pencilPointsKeepPressureAndNormalizeNegativeCoordinates() throws {
        let stroke = try #require(
            DrawingStroke.element(
                samples: [
                    DrawingSample(point: CGPoint(x: -20, y: 30), pressure: 0.2),
                    DrawingSample(point: CGPoint(x: 10, y: -10), pressure: 0.9),
                ], color: "blue", width: 4))
        #expect(stroke.number("x") == -20)
        #expect(stroke.number("y") == -10)
        #expect(
            stroke.list("points") == [
                .array([.number(0), .number(40), .number(0.2)]), .array([.number(30), .number(0), .number(0.9)]),
            ])
        _ = try WireRequest.drawingSave.validatePayload(
            .object([
                "projectId": .string("project"), "viewId": .string("drawing"), "baseRev": .number(0),
                "content": .object(["elements": .array([stroke])]),
            ]))
    }
    @Test func concurrentNewStrokesPreserveRemoteShapesAndUseRemoteRevision() throws {
        let shape = rectangle("existing")
        let local = rectangle("local")
        let remote = rectangle("remote")
        let merged = try DrawingEditorModel.merge(
            base: document([shape], rev: 1), local: document([shape, local], rev: 1),
            remote: document([shape, remote], rev: 2))
        #expect(Set(merged.list("elements").map(\.stableID)) == Set(["existing", "local", "remote"]))
        #expect(merged.number("rev") == 2)
    }
    @Test func ownSaveEchoKeepsUndoPerformedWhileSaving() throws {
        let stroke = rectangle("just-added")
        let merged = try DrawingEditorModel.merge(
            base: document([], rev: 1), local: document([], rev: 1), remote: document([stroke], rev: 2),
            inFlightElements: [stroke])
        #expect(merged.list("elements").isEmpty)
        #expect(merged.number("rev") == 2)
    }
    @Test func erasingConcurrentlyEditedShapeRefusesToOverwrite() throws {
        let shape = rectangle("existing")
        #expect(throws: WorkspaceConflict.self) {
            try DrawingEditorModel.merge(
                base: document([shape], rev: 1), local: document([], rev: 1),
                remote: document([rectangle("existing", x: 50)], rev: 2))
        }
    }
}
