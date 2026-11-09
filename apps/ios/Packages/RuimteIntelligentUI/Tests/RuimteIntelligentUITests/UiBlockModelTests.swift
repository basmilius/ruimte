import Foundation
import RuimtePulsar
import Testing

@testable import RuimteIntelligentUI

/// Answers each `ui.query` with the next reading it was handed, the last one again once they run out.
private actor UiQueryScript {
    private var answers: [JSONValue] = []

    func next(_ answer: JSONValue) { answers.append(answer) }

    func request(_ request: WireRequest, _ payload: JSONValue) async throws -> JSONValue {
        answers.count > 1 ? answers.removeFirst() : answers.first ?? .null
    }
}

private func fresh(_ value: JSONValue, at: Double) -> JSONValue {
    .object(["state": .string("fresh"), "value": value, "readId": .string("read-\(Int(at))"), "readAt": .number(at)])
}

private func failed(_ code: String, at: Double = 9_000) -> JSONValue {
    .object(["state": .string("failed"), "code": .string(code), "readAt": .number(at)])
}

private func status(files: Int, rows: [(String, String)]) -> JSONValue {
    .object([
        "files": .array(Array(repeating: .string("f"), count: files)),
        "rows": .array(rows.map { .object(["name": .string($0.0), "state": .string($0.1)]) }),
    ])
}

@MainActor struct UiBlockLiveTests {
    /// A visible block after its first read, which polling does at once and then not again for ten seconds, so every
    /// later read is one the test asks for.
    private func model(_ script: UiQueryScript) async throws -> UiBlockModel {
        let block = try parityBlock("live table")
        let model = UiBlockModel(
            chatID: "chat", itemID: "item", block: block, readInterval: .zero, request: script.request)
        await model.update(block: block)
        model.setActive(visible: true, connected: true)
        for _ in 0..<1_000 where model.readings["$status"]?["readAt"] != .number(1_000) || model.reading {
            await Task.yield()
        }
        try #require(model.readings["$status"]?["readAt"] == .number(1_000))
        return model
    }

    private func node(_ type: String, in model: UiBlockModel) throws -> JSONValue {
        func find(_ nodes: [JSONValue]) -> JSONValue? {
            for node in nodes {
                if node["type"] == .string(type) { return node }
                if let found = find(node["children"]?.arrayValue ?? []) { return found }
            }
            return nil
        }
        return try #require(find(model.nodes))
    }

    @Test func aFailedReadKeepsItsValueAndReadTimeAndDimsOnlyTheNodesThatReadIt() async throws {
        let script = UiQueryScript()
        await script.next(fresh(status(files: 2, rows: [("core", "ok")]), at: 1_000))
        await script.next(failed("unreadable"))
        let model = try await model(script)
        let stat = try node("Stat", in: model)
        let statID = try #require(stat["id"]?.stringValue)
        #expect(model.liveState(sourceID: statID) == .live)
        #expect(model.liveState(sourceID: try #require(node("Summary", in: model)["id"]?.stringValue)) == nil)

        await model.refresh()
        #expect(try node("Stat", in: model)["props"]?["value"] == .number(2))
        #expect(model.liveState(sourceID: statID) == .stale)
        #expect(model.readAt == 1_000)
    }

    @Test func aReadTheDaemonNeverTriedChangesNothingWhileAValueStands() async throws {
        let script = UiQueryScript()
        await script.next(fresh(status(files: 2, rows: []), at: 1_000))
        await script.next(failed("busy"))
        await script.next(failed("refresh-limit"))
        let model = try await model(script)
        await model.refresh()
        let statID = try #require(node("Stat", in: model)["id"]?.stringValue)
        #expect(model.liveState(sourceID: statID) == .live)
        await model.refresh()
        #expect(model.liveState(sourceID: statID) == .live)
        #expect(model.readings["$status"]?["state"] == .string("fresh"))
    }

    @Test func aChangedValueLightsOnceAndAnAddedRowLightsNothing() async throws {
        let script = UiQueryScript()
        await script.next(fresh(status(files: 2, rows: [("core", "ok")]), at: 1_000))
        await script.next(fresh(status(files: 2, rows: [("core", "bad")]), at: 2_000))
        await script.next(failed("unreadable"))
        await script.next(fresh(status(files: 3, rows: [("core", "bad")]), at: 4_000))
        await script.next(fresh(status(files: 3, rows: [("new", "fine"), ("core", "bad")]), at: 5_000))
        let model = try await model(script)
        #expect(model.lit.isEmpty)
        let statID = try #require(node("Stat", in: model)["id"]?.stringValue)
        let tableID = try #require(node("Table", in: model)["id"]?.stringValue)

        await model.refresh()
        #expect(Set(model.lit.keys) == [UiBlockModel.litKey(nodeID: tableID, row: 0, column: "state")])
        await model.refresh()
        let dimmed = model.lit
        await model.refresh()
        let stat = UiBlockModel.litKey(nodeID: statID)
        #expect(model.lit[stat] != nil && dimmed[stat] == nil)
        let before = model.lit
        await model.refresh()
        #expect(model.lit == before)
    }
}

private actor UiRequestRecorder {
    private(set) var calls: [(WireRequest, JSONValue)] = []
    var queued = false
    func setQueued() { queued = true }
    func request(_ name: WireRequest, _ payload: JSONValue) async throws -> JSONValue {
        calls.append((name, payload))
        if name == .chatUiChoice {
            try await Task.sleep(for: .milliseconds(20))
            return .object(["queued": .bool(queued)])
        }
        if name == .uiQuery {
            return .object([
                "state": .string("fresh"), "readId": .string("read-ticket"), "readAt": .number(1),
                "value": .object(["files": .array([.string("a")])]),
            ])
        }
        return .object(["state": .string("plain"), "reason": .string("The file was removed")])
    }
}

@MainActor struct UiBlockModelTests {
    private func block(_ name: String) throws -> JSONValue { try parityBlock(name) }

    private func block(_ index: Int) throws -> JSONValue {
        try #require(parityFixtures()[index]["request"]?["block"])
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
        #expect(calls.first?.0 == .chatUiChoice)
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
        #expect(call.0 == .uiLink)
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
