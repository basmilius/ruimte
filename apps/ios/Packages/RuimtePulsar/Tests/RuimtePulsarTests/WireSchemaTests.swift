import Foundation
import Testing

@testable import RuimtePulsar

struct WireSchemaTests {
    @Test func typeScriptValidationFixtures() throws {
        let url = try #require(Bundle.module.url(forResource: "wire", withExtension: "json"))
        let fixture = try JSONValue.decode(Data(contentsOf: url))
        #expect(
            Set(WireRequest.allCases.map(\.rawValue))
                == Set(try #require(fixture["requestTypes"]?.arrayValue).compactMap(\.stringValue)))
        #expect(
            Set(WireEvent.allCases.map(\.rawValue))
                == Set(try #require(fixture["eventTypes"]?.arrayValue).compactMap(\.stringValue)))
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
        let account = try decoder.decode(
            Account.self, from: Data(#"{"id":"account","provider":"github","login":null}"#.utf8))
        #expect(account.login == nil)
        #expect(throws: (any Error).self) {
            try decoder.decode(
                ServerHelloResult.self,
                from: Data(#"{"version":"1","platform":"darwin","home":"/Users/bas","model":null}"#.utf8))
        }
    }

    @Test func defaultsDecodeAndRoundTrip() throws {
        let value = try JSONDecoder().decode(ProjectCanvasDefaults.self, from: Data("{}".utf8))
        #expect(value.layouts.isEmpty)
        #expect(try JSONValue.decode(JSONEncoder().encode(value)) == .object(["layouts": .array([])]))
    }

    @Test func optionalNullableHasThreeStates() throws {
        let fixture = try JSONValue.decode(
            Data(contentsOf: #require(Bundle.module.url(forResource: "wire", withExtension: "json"))))
        let entries = try #require(fixture["validations"]?.arrayValue).filter {
            $0["schema"] == .string("RegisterMachinePayloadSchema")
        }
        let decoder = JSONDecoder()
        let absent = try decoder.decode(RegisterMachinePayload.self, from: #require(entries.first?["input"]).encoded())
        let null = try decoder.decode(RegisterMachinePayload.self, from: #require(entries.last?["input"]).encoded())
        #expect(absent.brokerUrl == .missing)
        #expect(null.brokerUrl == .null)
        #expect(try JSONValue.decode(JSONEncoder().encode(absent))["brokerUrl"] == nil)
        #expect(try JSONValue.decode(JSONEncoder().encode(null))["brokerUrl"] == .null)
    }

    @Test func aNewerMachinesAgentWordsStillValidate() throws {
        let info = { (provider: String, mode: String, status: String) -> JSONValue in
            .object([
                "chatId": .string("chat-1"), "provider": .string(provider), "cwd": .string("/work"),
                "agentSessionId": .null, "model": .null,
                "selection": .object(["model": .string("model-1"), "options": .object([:])]),
                "runtimeMode": .string(mode), "status": .string(status), "running": .bool(true),
                "activeTurnId": .null, "slashCommands": .array([]),
                "usage": .object([
                    "contextTokens": .number(0), "contextWindow": .null, "costUsd": .number(0), "turns": .number(0),
                ]),
                "createdAt": .number(0),
            ])
        }
        let known = try WireSchema.validate(
            "event.chat.status", .object(["chatId": .string("chat-1"), "info": info("claude", "auto", "running")]))
        #expect(known["info"]?["provider"] == .string("claude"))
        let future = try WireSchema.validate(
            "event.chat.status",
            .object(["chatId": .string("chat-1"), "info": info("future-cli", "future-mode", "future-status")]))
        #expect(future["info"]?["provider"] == .string("future-cli"))
        #expect(future["info"]?["runtimeMode"] == .string("future-mode"))
        #expect(future["info"]?["status"] == .string("future-status"))
        #expect(AgentKind(rawValue: "future-cli") == nil)
        var numbered = try #require(info("claude", "auto", "running").objectValue)
        numbered["provider"] = .number(1)
        #expect(throws: (any Error).self) {
            try WireSchema.validate(
                "event.chat.status", .object(["chatId": .string("chat-1"), "info": .object(numbered)]))
        }
    }

    @Test func stringBoundsUseTypeScriptUTF16() throws {
        #expect(throws: (any Error).self) {
            try WireSchema.validate(
                "ProvidersResultSchema", .object(["providers": .array([.string(String(repeating: "📱", count: 17))])]))
        }
    }
}
