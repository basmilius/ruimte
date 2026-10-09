import Foundation
import Testing
import RuimtePulsar
@testable import RuimteIntelligentUI

struct UiInterpreterTests {
    private func fixtures() throws -> [JSONValue] {
        let url = try #require(Bundle.module.url(forResource: "parity", withExtension: "json"))
        return try #require(JSONValue.decode(Data(contentsOf: url)).arrayValue)
    }

    @Test func sharedInterpreterParity() async throws {
        let interpreter = UiInterpreter()
        for fixture in try fixtures() {
            let request = try #require(fixture["request"])
            let result = try await interpreter.evaluate(
                block: #require(request["block"]), queries: request["queries"] ?? .object([:]))
            #expect(result == fixture["result"], "\(fixture["name"]?.stringValue ?? "fixture")")
        }
    }

    @Test func localInputUpdatesExpressionAndKeepsBlockIndependent() async throws {
        let interpreter = UiInterpreter()
        let block = try #require(fixtures().first?["request"]?["block"])
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
        let block = try #require(fixtures().first?["request"]?["block"])
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
        let block = try #require(fixtures().last?["request"]?["block"])
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
        let block = try #require(fixtures().first?["request"]?["block"])
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
}
