import Foundation
import Testing
import RuimtePulsar
@testable import RuimteIntelligentUI

struct UiInterpreterTests {
    private func fixtures() throws -> [JSONValue] {
        let url = try #require(Bundle.module.url(forResource: "parity", withExtension: "json"))
        return try #require(JSONValue.decode(Data(contentsOf: url)).arrayValue)
    }

    private func block(_ name: String) throws -> JSONValue {
        try #require(fixtures().first { $0["name"] == .string(name) }?["request"]?["block"])
    }

    @Test func sharedInterpreterParity() async throws {
        let interpreter = UiInterpreter()
        for fixture in try fixtures() {
            let request = try #require(fixture["request"])
            let result = try await interpreter.evaluate(
                block: #require(request["block"]), values: request["values"] ?? .object([:]),
                queries: request["queries"] ?? .object([:]), change: request["change"],
                action: request["action"]?["nodeId"]?.stringValue)
            #expect(result == fixture["result"], "\(fixture["name"]?.stringValue ?? "fixture")")
        }
    }

    @Test func localInputUpdatesExpressionAndKeepsBlockIndependent() async throws {
        let interpreter = UiInterpreter()
        let block = try block("local input")
        let initial = try await interpreter.evaluate(block: block)
        let sliderID = try #require(initial["nodes"]?.arrayValue?.first?["id"])
        let changed = try await interpreter.evaluate(block: block, change: .object([
            "nodeId": sliderID, "prop": .string("value"), "value": .number(7),
        ]))
        #expect(changed["values"]?["$count"] == .number(7))
        let summary = try #require(changed["nodes"]?.arrayValue?.last?["children"]?.arrayValue)
        #expect(summary.contains { $0["props"]?["text"] == .string("10") })
        let separate = try await interpreter.evaluate(block: block)
        #expect(separate["values"]?["$count"] == .number(2))
    }

    @Test func streamedInputAndInvisibleChoiceAreNotBindings() async throws {
        let interpreter = UiInterpreter()
        let block = try block("local input")
        var partial = try #require(block.objectValue)
        partial["complete"] = .bool(false)
        let initial = try await interpreter.evaluate(block: block)
        let nodeID = try #require(initial["nodes"]?.arrayValue?.first?["id"])
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(block: .object(partial), change: .object([
                "nodeId": nodeID, "prop": .string("value"), "value": .number(7),
            ]))
        }
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(block: block, values: .object(["injected": .string("data")]))
        }
    }

    @Test func segmentedMembershipIsValidated() async throws {
        let interpreter = UiInterpreter()
        let block = try block("segmented input")
        let initial = try await interpreter.evaluate(block: block)
        let nodeID = try #require(initial["nodes"]?.arrayValue?.first?["id"])
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(block: block, change: .object([
                "nodeId": nodeID, "prop": .string("value"), "value": .string("not-an-option"),
            ]))
        }
    }

    @Test func agentTextStaysDataAndOversizedInputIsRefused() async throws {
        let interpreter = UiInterpreter()
        let block = try block("local input")
        var contents = try #require(block.objectValue)
        var nodes = try #require(contents["nodes"]?.arrayValue)
        var slider = try #require(nodes.first?.objectValue)
        var children = try #require(slider["children"]?.arrayValue)
        var label = try #require(children.first?.objectValue)
        let script = "globalThis.injected = true; throw new Error('executed');"
        label["props"] = .object(["text": .string(script)])
        children[0] = .object(label)
        slider["children"] = .array(children)
        nodes[0] = .object(slider)
        contents["nodes"] = .array(nodes)
        let result = try await interpreter.evaluate(block: .object(contents))
        #expect(result["nodes"]?.arrayValue?.first?["children"]?.arrayValue?.first?["props"]?["text"] == .string(script))
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(block: .string(String(repeating: "a", count: 1024 * 1024 + 1)))
        }
        let again = try await interpreter.evaluate(block: block)
        #expect(again["values"]?["$count"] == .number(2))
    }

    @Test func aButtonSetsOnlyItsConstantAndADisabledOneRunsNothing() async throws {
        let interpreter = UiInterpreter()
        let block = try block("button action")
        let initial = try await interpreter.evaluate(block: block)
        let buttons = try #require(initial["nodes"]?.arrayValue).filter { $0["type"] == .string("Button") }
        let set = try #require(buttons.first?["id"]?.stringValue)
        let reset = try #require(buttons.last?["id"]?.stringValue)
        let pressed = try await interpreter.evaluate(block: block, action: set)
        #expect(pressed["values"]?["$mode"] == .string("b"))
        let restored = try await interpreter.evaluate(block: block, values: pressed["values"]!, action: reset)
        #expect(restored["values"]?["$mode"] == .string("a"))
        var disabled = try #require(block.objectValue)
        var nodes = try #require(disabled["nodes"]?.arrayValue)
        var first = try #require(nodes.first?.objectValue)
        var props = first["props"]?.objectValue ?? [:]
        props["disabled"] = .bool(true)
        first["props"] = .object(props)
        nodes[0] = .object(first)
        disabled["nodes"] = .array(nodes)
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(block: .object(disabled), action: set)
        }
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(block: block, action: "not-a-node")
        }
    }
}
