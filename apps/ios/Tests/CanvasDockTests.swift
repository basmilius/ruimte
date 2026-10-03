import Foundation
import RuimtePulsar
import Testing

@testable import Ruimte

@Suite struct CanvasDockTests {
    private func canvas(_ json: String) throws -> JSONValue { try JSONValue.decode(Data(json.utf8)) }

    @Test func locksReadAbsentAsNothingLockedAndKeepWhatAPhoneCannotSet() {
        #expect(CanvasLocks(nil) == CanvasLocks())
        let read = CanvasLocks(.object(["pan": .bool(true), "move": .bool(true)]))
        #expect(read.pan && read.move && !read.zoom && !read.resize)
        #expect(read.any && !read.all)
        #expect(CanvasLocks(read.json) == read)
        #expect(read.locking(everything: true).all)
        #expect(!read.locking(everything: false).any)
    }

    @Test func theNeedsYouCountWalksThroughItsNodesInTurn() {
        let status = CanvasStatus(needsYou: ["a", "b", "c"], working: 2)
        #expect(status.next(after: nil) == "a")
        #expect(status.next(after: "a") == "b")
        #expect(status.next(after: "c") == "a")
        #expect(status.next(after: "elsewhere") == "a")
        #expect(CanvasStatus().next(after: "a") == nil)
        #expect(CanvasStatus().isEmpty && !status.isEmpty)
    }

    @Test func aSavedLayoutReplacesOneOfTheSameNameAndAppliesOnlyWhatItSaw() throws {
        let view = try canvas(
            #"{"nodes":[{"id":"a","x":0,"y":0,"w":100,"h":80},{"id":"b","x":200,"y":0,"w":100,"h":80}],"texts":[{"id":"t","x":5,"y":6}],"layouts":[{"name":"work","nodes":{},"texts":{}},{"name":"old","nodes":{"a":{"x":-50,"y":-60,"w":120,"h":90}},"texts":{"t":{"x":1,"y":2}}}]}"#
        )
        let saved = CanvasEditing.savingLayout(view, name: "work")
        #expect(CanvasEditing.layoutNames(saved) == ["old", "work"])
        let work = saved.list("layouts").last
        #expect(work?["nodes"]?["b"]?["x"] == .number(200))
        #expect(work?["texts"]?["t"]?["y"] == .number(6))

        let applied = CanvasEditing.applyingLayout(view, name: "old")
        #expect(applied.list("nodes")[0]["x"] == .number(-50))
        #expect(applied.list("nodes")[0]["w"] == .number(120))
        #expect(applied.list("nodes")[1] == view.list("nodes")[1])
        #expect(applied.list("texts")[0]["x"] == .number(1))
        #expect(CanvasEditing.applyingLayout(view, name: "missing") == view)

        #expect(CanvasEditing.layoutNames(CanvasEditing.deletingLayout(view, name: "old")) == ["work"])
    }

    @Test func snappingRoundsAHalfUpAsTheDesktopDoes() {
        #expect(CanvasEditing.snap(4) == 8)
        #expect(CanvasEditing.snap(3.9) == 0)
        #expect(CanvasEditing.snap(-4) == 0)
        #expect(CanvasEditing.snap(-4.1) == -8)
    }
}
