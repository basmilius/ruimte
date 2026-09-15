import Foundation
import Testing
@testable import RuimtePulsar

struct WireSchemaTests {
    @Test func typeScriptValidationFixtures() throws {
        let url = try #require(Bundle.module.url(forResource: "wire", withExtension: "json"))
        let fixture = try JSONValue.decode(Data(contentsOf: url))
        for entry in try #require(fixture["validations"]?.arrayValue) {
            let name = try #require(entry["schema"]?.stringValue)
            let input = try #require(entry["input"])
            if entry["valid"] == .bool(true) {
                #expect(try WireSchema.validate(name, input) == entry["output"])
            } else {
                #expect(throws: (any Error).self) { try WireSchema.validate(name, input) }
            }
        }
    }

    @Test func nullableIsRequiredAndOptionalNullIsRejected() throws {
        let decoder = JSONDecoder()
        #expect(throws: (any Error).self) {
            try decoder.decode(Account.self, from: Data(#"{"id":"account","provider":"github"}"#.utf8))
        }
        let account = try decoder.decode(Account.self, from: Data(#"{"id":"account","provider":"github","login":null}"#.utf8))
        #expect(account.login == nil)
        #expect(throws: (any Error).self) {
            try decoder.decode(ServerHelloResult.self, from: Data(#"{"version":"1","platform":"darwin","home":"/Users/bas","model":null}"#.utf8))
        }
    }

    @Test func defaultsDecodeAndRoundTrip() throws {
        let value = try JSONDecoder().decode(ProjectCanvasDefaults.self, from: Data("{}".utf8))
        #expect(value.layouts.isEmpty)
        #expect(try JSONValue.decode(JSONEncoder().encode(value)) == .object(["layouts": .array([])]))
    }

    @Test func optionalNullableHasThreeStates() throws {
        let fixture = try JSONValue.decode(Data(contentsOf: #require(Bundle.module.url(forResource: "wire", withExtension: "json"))))
        let entries = try #require(fixture["validations"]?.arrayValue).filter { $0["schema"] == .string("RegisterMachinePayloadSchema") }
        let decoder = JSONDecoder()
        let absent = try decoder.decode(RegisterMachinePayload.self, from: #require(entries.first?["input"]).encoded())
        let null = try decoder.decode(RegisterMachinePayload.self, from: #require(entries.last?["input"]).encoded())
        #expect(absent.brokerUrl == .missing)
        #expect(null.brokerUrl == .null)
        #expect(try JSONValue.decode(JSONEncoder().encode(absent))["brokerUrl"] == nil)
        #expect(try JSONValue.decode(JSONEncoder().encode(null))["brokerUrl"] == .null)
    }

    @Test func stringBoundsUseTypeScriptUTF16() throws {
        #expect(throws: (any Error).self) {
            try WireSchema.validate("ProvidersResultSchema", .object(["providers": .array([.string(String(repeating: "📱", count: 17))])]))
        }
    }
}
