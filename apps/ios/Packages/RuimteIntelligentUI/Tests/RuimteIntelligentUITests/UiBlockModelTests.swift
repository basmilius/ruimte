import Foundation
import Testing
import RuimtePulsar
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
            return .object(["state": .string("fresh"), "readId": .string("read-ticket"), "readAt": .number(1), "value": .object(["files": .array([.string("a")])])])
        }
        return .object(["state": .string("plain"), "reason": .string("The file was removed")])
    }
}

@MainActor struct UiBlockModelTests {
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
        await model.refresh()
        #expect(await recorder.calls.isEmpty)
        model.setActive(visible: true, connected: true)
        await model.refresh()
        await model.refresh()
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
}
