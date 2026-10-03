import Foundation
import RuimtePulsar
import Testing

@testable import Ruimte

@Suite struct CanvasNodeMenuTests {
    private func node(_ id: String, _ kind: String, x: Double = 0, y: Double = 0, w: Double = 100, h: Double = 80)
        -> JSONValue
    {
        .object([
            "id": .string(id), "kind": .string(kind), "title": .string(id.uppercased()), "x": .number(x),
            "y": .number(y), "w": .number(w), "h": .number(h),
        ])
    }

    @Test func theMenuOffersWhatEachKindCanDo() {
        #expect(
            CanvasNodeAction.actions(for: node("c", "chat")) == [
                .openAsView, .linkAsContext, .groupSelection, .rename, .snooze, .delete,
            ])
        #expect(
            CanvasNodeAction.actions(for: node("d", "device")) == [
                .openAsView, .linkAsContext, .groupSelection, .rename, .delete,
            ])
        #expect(CanvasNodeAction.actions(for: node("n", "note")) == [.linkAsContext, .groupSelection, .rename, .delete])
        #expect(CanvasNodeAction.actions(for: node("g", "group")) == [.linkAsContext, .rename, .delete])
        #expect(CanvasNodeAction.actions(for: node("u", "hologram")) == [.delete])
    }

    @Test func aGroupFramesItsMembersOnTheGridWithRoomForItsTitle() throws {
        let canvas: JSONValue = .object([
            "nodes": .array([node("a", "chat", x: 10, y: 20), node("b", "note", x: 300, y: 100), node("g", "group")])
        ])
        let grouped = try #require(CanvasEditing.grouping(canvas, ids: ["a", "b", "g"], groupID: "new"))
        let group = try #require(grouped.list("nodes").last)
        #expect(group.text("kind") == "group")
        #expect(group["x"] == .number(-24))
        #expect(group["y"] == .number(-48))
        #expect(group["w"] == .number(456))
        #expect(group["h"] == .number(264))
        #expect(CanvasEditing.grouping(canvas, ids: ["g"], groupID: "none") == nil)
        #expect(CanvasEditing.members(of: group, in: grouped).map(\.stableID) == ["a", "b"])
    }

    @Test func aCollapsedGroupHoldsTheIdsItSpellsOut() {
        let group = node("g", "group", w: 10, h: 10).setting("collapsed", .bool(true)).setting(
            "memberIds", .array([.string("far"), .string("gone")]))
        let canvas: JSONValue = .object(["nodes": .array([group, node("far", "chat", x: 5000)])])
        #expect(CanvasEditing.members(of: group, in: canvas).map(\.stableID) == ["far"])
    }

    @Test func aContextLinkIntoAnAgentIsLabeledAndRunsBothWaysBetweenAgents() {
        var ids = ["one", "two", "three"].makeIterator()
        let canvas: JSONValue = .object([
            "nodes": .array([node("note", "note"), node("chat", "chat"), node("term", "terminal")]),
            "edges": .array([]),
        ])
        let fromNote = CanvasEditing.linking(canvas, from: "note", to: "chat") { ids.next()! }
        #expect(fromNote.list("edges").count == 1)
        #expect(fromNote.list("edges")[0]["label"] == .string("context"))

        let agents = CanvasEditing.linking(fromNote, from: "chat", to: "term") { ids.next()! }
        let pairs = agents.list("edges").map { "\($0.text("from"))>\($0.text("to"))" }
        #expect(pairs == ["note>chat", "chat>term", "term>chat"])

        let again = CanvasEditing.linking(agents, from: "note", to: "chat") { "unused" }
        #expect(again == agents)
        let nodes = Dictionary(uniqueKeysWithValues: canvas.list("nodes").map { ($0.stableID, $0) })
        #expect(CanvasEditing.isContext(fromNote.list("edges")[0], nodes: nodes))
        let intoNote: JSONValue = .object(["from": .string("chat"), "to": .string("note")])
        #expect(!CanvasEditing.isContext(intoNote, nodes: nodes))
    }

    @Test func openAsViewKeepsTheSessionsIdAndWhatItRunsWith() {
        let chat = node("chat-1", "chat").setting("provider", .string("claude")).setting("cwd", .string("app"))
        let view = CanvasEditing.view(for: chat)
        #expect(view.stableID == "chat-1")
        #expect(view["node"]?["provider"] == .string("claude"))
        #expect(view["node"]?["cwd"] == .string("app"))
        let reference: JSONValue = .object(["platform": .string("ios"), "name": .string("iPhone 17")])
        let device = CanvasEditing.view(for: node("dev", "device").setting("device", reference))
        #expect(device["device"] == reference)
        #expect(device["node"] == nil)
    }
}
