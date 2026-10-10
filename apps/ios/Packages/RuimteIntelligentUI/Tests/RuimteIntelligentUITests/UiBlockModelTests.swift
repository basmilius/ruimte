import Foundation
import RuimtePulsar
import Testing

@testable import RuimteIntelligentUI

private actor UiRequestRecorder {
    private(set) var calls: [(String, JSONValue)] = []
    var queued = false
    func setQueued() { queued = true }
    func request(_ name: String, _ payload: JSONValue) async throws -> JSONValue {
        calls.append((name, payload))
        if name == "chat.uiChoice" {
            try await Task.sleep(for: .milliseconds(20))
            return .object(["queued": .bool(queued)])
        }
        if name == "ui.query" {
            return .object([
                "state": .string("fresh"), "readId": .string("read-ticket"), "readAt": .number(1),
                "value": .object(["files": .array([.string("a")])]),
            ])
        }
        return .object(["state": .string("plain"), "reason": .string("The file was removed")])
    }
}

@MainActor struct UiBlockModelTests {
    private func block(_ name: String) throws -> JSONValue {
        let url = try #require(Bundle.module.url(forResource: "parity", withExtension: "json"))
        let fixtures = try #require(JSONValue.decode(Data(contentsOf: url)).arrayValue)
        return try #require(fixtures.first { $0["name"] == .string(name) }?["request"]?["block"])
    }

    private func block(_ index: Int) throws -> JSONValue {
        let url = try #require(Bundle.module.url(forResource: "parity", withExtension: "json"))
        let fixtures = try #require(JSONValue.decode(Data(contentsOf: url)).arrayValue)
        return try #require(fixtures[index]["request"]?["block"])
    }

    @Test func choicesSendOnceAndPreserveTheQueuedState() async throws {
        let recorder = UiRequestRecorder()
        await recorder.setQueued()
        let block = try block(2)
        let model = UiBlockModel(chatID: "chat", itemID: "item", block: block, request: recorder.request)
        await model.update(block: block)
        model.setActive(visible: false, connected: true)
        let choiceID = try #require(model.nodes.last?["children"]?.arrayValue?.first?["id"]?.stringValue)
        async let first: Void = model.choose(nodeID: choiceID)
        async let second: Void = model.choose(nodeID: choiceID)
        _ = await (first, second)
        let calls = await recorder.calls
        #expect(calls.count == 1)
        #expect(calls.first?.0 == "chat.uiChoice")
        #expect(calls.first?.1["choiceId"] == .string(choiceID))
        #expect(calls.first?.1["itemId"] == .string("item"))
        #expect(model.answer?["state"] == .string("queued"))
        #expect(!model.canChoose)
        await model.choose(nodeID: choiceID)
        #expect(await recorder.calls.count == 1)
    }

    @Test func invisibleBlocksNeverReadAndVisibleReadsAreThrottled() async throws {
        let recorder = UiRequestRecorder()
        let block = try block(3)
        let model = UiBlockModel(chatID: "chat", itemID: "item", block: block, request: recorder.request)
        await model.update(block: block)
        model.setActive(visible: false, connected: true)
        #expect(!model.canChoose)
        await model.refresh()
        #expect(await recorder.calls.isEmpty)
        model.setActive(visible: true, connected: true)
        await model.refresh()
        await model.refresh()
        #expect(model.canChoose)
        model.stop()
        #expect(await recorder.calls.count == 1)
        #expect(model.readings["$status"]?["readId"] == .string("read-ticket"))
        let stat = try #require(model.nodes.first?["children"]?.arrayValue?.first)
        #expect(stat["props"]?["value"] == .number(1))
    }

    @Test func linkRequestContainsIdentityAndValuesButNoClientTarget() async throws {
        let recorder = UiRequestRecorder()
        let block = try block(2)
        let model = UiBlockModel(chatID: "chat", itemID: "item", block: block, request: recorder.request)
        await model.update(block: block)
        model.setActive(visible: false, connected: true)
        let nodeID = try #require(model.nodes.first?["id"]?.stringValue)
        let result = try await model.link(nodeID: nodeID)
        #expect(result["state"] == .string("plain"))
        let call = try #require(await recorder.calls.first)
        #expect(call.0 == "ui.link")
        #expect(call.1["nodeId"] == .string(nodeID))
        #expect(call.1["target"] == nil)
        #expect(call.1["path"] == nil)
    }

    @Test func aCanceledEvaluationLeavesTheBlockReadable() async throws {
        let recorder = UiRequestRecorder()
        let block = try block("local input")
        let model = UiBlockModel(chatID: "chat", itemID: "item", block: block, request: recorder.request)
        let update = Task { await model.update(block: block) }
        update.cancel()
        await update.value
        #expect(model.error == nil)
        await model.update(block: block)
        #expect(model.error == nil)
        #expect(!model.nodes.isEmpty)
    }

    @Test func twoFastTogglesBothLand() async throws {
        let recorder = UiRequestRecorder()
        let block = try block("values and change")
        let model = UiBlockModel(chatID: "chat", itemID: "item", block: block, request: recorder.request)
        await model.update(block: block)
        let checklist = try #require(model.nodes.first { $0["type"] == .string("Checklist") }?["id"]?.stringValue)
        func toggle(_ item: JSONValue) -> @MainActor (JSONValue?) -> JSONValue {
            { current in
                let values = current?.arrayValue ?? []
                return .array(values.contains(item) ? values.filter { $0 != item } : values + [item])
            }
        }
        async let first: Void = model.change(nodeID: checklist, prop: "value", update: toggle(.string("b")))
        async let second: Void = model.change(nodeID: checklist, prop: "value", update: toggle(.string("a")))
        _ = await (first, second)
        #expect(model.values["$picked"] == .array([.string("b")]))
        #expect(model.error == nil)
    }

    @Test func aButtonChangesLocalValues() async throws {
        let recorder = UiRequestRecorder()
        let block = try block("button action")
        let model = UiBlockModel(chatID: "chat", itemID: "item", block: block, request: recorder.request)
        await model.update(block: block)
        let button = try #require(model.nodes.first { $0["type"] == .string("Button") }?["id"]?.stringValue)
        await model.act(nodeID: button)
        #expect(model.values["$mode"] == .string("b"))
        await model.act(nodeID: "missing")
        #expect(model.values["$mode"] == .string("b"))
        #expect(model.error == nil)
    }

    @Test func aChangedInputReadsAgainSoonInDeclarationOrder() async throws {
        let recorder = UiRequestRecorder()
        let block = try block("live input")
        let model = UiBlockModel(
            chatID: "chat", itemID: "item", block: block, inputSettle: .zero, request: recorder.request)
        await model.update(block: block)
        #expect(model.queryNames == ["$alpha", "$zeta"])
        let source = "$limit = 1\n$zeta = @Query(\"git.status\", {})\n$alpha = @Query(\"git.status\", {})"
        await model.update(block: block, source: source)
        #expect(model.queryNames == ["$zeta", "$alpha"])
        model.setActive(visible: true, connected: true)
        await model.refresh()
        while model.reading { await Task.yield() }
        #expect(await recorder.calls.map { $0.1["query"] } == [.string("$zeta"), .string("$alpha")])
        let slider = try #require(model.nodes.first?["id"]?.stringValue)
        await model.change(nodeID: slider, prop: "value", value: .number(3))
        #expect(model.queryInputsDirty)
        await model.inputRead?.value
        let calls = await recorder.calls
        model.stop()
        #expect(calls.count == 4)
        #expect(calls.last?.1["values"]?["$limit"] == .number(3))
        #expect(!model.queryInputsDirty)
    }
}
