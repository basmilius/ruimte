import CoreGraphics
import RuimtePulsar
import RuimteTransport
import Testing
import UIKit

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
    @Test func allAuthoringToolsProduceExistingWireShapes() throws {
        for tool in [DrawingTool.rect, .diamond, .ellipse, .line, .arrow, .text, .note] {
            let shape = try #require(
                DrawingGeometry.create(
                    tool: tool, from: CGPoint(x: 60, y: 40), to: CGPoint(x: -20, y: -10), style: DrawingStyle(),
                    id: tool.rawValue))
            _ = try WireRequest.drawingSave.validatePayload(
                .object([
                    "projectId": .string("project"), "viewId": .string("drawing"), "baseRev": .number(0),
                    "content": .object(["elements": .array([shape])]),
                ]))
            #expect(DrawingGeometry.box(shape).minX == -20)
            #expect(DrawingGeometry.box(shape).minY == -10)
            if tool == .arrow { #expect(shape["arrowEnd"] == .bool(true)) }
            if tool == .note { #expect(shape.text("fillColor") == "yellow") }
        }
    }
    @Test func resizingFreehandPreservesPressureAndScalesRelativePoints() throws {
        let stroke = try #require(
            DrawingStroke.element(
                samples: [
                    DrawingSample(point: CGPoint(x: 10, y: 20), pressure: 0.3),
                    DrawingSample(point: CGPoint(x: 30, y: 40), pressure: 0.8),
                ], color: "ink", width: 2))
        let resized = DrawingGeometry.scaled(
            stroke, from: CGRect(x: 10, y: 20, width: 20, height: 20), to: CGRect(x: 100, y: 200, width: 40, height: 60)
        )
        #expect(resized.number("x") == 100 && resized.number("y") == 200)
        #expect(resized.list("points").last == .array([.number(40), .number(60), .number(0.8)]))
    }
    @Test func rotatedHitTestingAndLockedShapesRespectSelection() {
        let shape = rectangle("shape").setting("w", .number(100)).setting("h", .number(20)).setting(
            "angle", .number(.pi / 2))
        #expect(DrawingGeometry.hit(shape, point: CGPoint(x: 50, y: 50), tolerance: 1))
        #expect(!DrawingGeometry.hit(shape, point: CGPoint(x: 5, y: 10), tolerance: 1))
        #expect(!DrawingGeometry.hit(shape.setting("locked", .bool(true)), point: CGPoint(x: 50, y: 10)))
    }
    @Test func undoRedoKeepDocumentFieldsAndNewEditClearsRedo() throws {
        let machine = UUID().uuidString
        let key = "drawing-draft:" + [machine, "project", "drawing"].joined(separator: ":")
        let original = rectangle("existing").setting("radius", .number(12))
        let saved = document([original], rev: 3)
        UserDefaults.standard.set(try JSONValue.object(["base": saved, "document": saved]).encoded(), forKey: key)
        defer { UserDefaults.standard.removeObject(forKey: key) }
        let client = MachineClient(send: { _ in throw MachineClientError.disconnected })
        let model = DrawingEditorModel(client: client, machineID: machine, projectID: "project", viewID: "drawing")
        #expect(model.tool == .pan)
        model.append(rectangle("new"))
        model.undo()
        #expect(model.elements == [original])
        model.redo()
        #expect(model.elements.map(\.stableID) == ["existing", "new"])
        #expect(model.elements.first?["radius"] == .number(12))
        model.undo()
        model.append(rectangle("different"))
        #expect(model.future.isEmpty)
    }
    @Test func svgExportEscapesWrittenContentAndKeepsTransforms() {
        let scene: JSONValue = .object([
            "bounds": .object(["x": .number(-10), "y": .number(20), "w": .number(100), "h": .number(60)]),
            "elements": .array([
                .object([
                    "x": .number(10), "y": .number(20), "angle": .number(.pi / 2), "centerX": .number(50),
                    "centerY": .number(30), "paths": .array([]),
                    "text": .array([
                        .object([
                            "text": .string("<script>& hello"), "x": .number(2), "y": .number(20), "size": .number(20),
                            "color": .object(["tone": .string("ink")]),
                        ])
                    ]),
                ])
            ]),
        ])
        let svg = DrawingExport.svg(
            scene: scene, background: false, traits: UITraitCollection(userInterfaceStyle: .light))
        #expect(svg.contains("&lt;script&gt;&amp; hello"))
        #expect(!svg.contains("<script>"))
        #expect(svg.contains("rotate(90.0)"))
        #expect(svg.contains("viewBox=\"0 0 164.0 124.0\""))
    }

}
