import Foundation
import Testing

@testable import RuimtePulsar

struct WireSchemaTests {
    @Test func typeScriptValidationFixtures() throws {
        let fixture = try wireFixture()
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

    @Test func literalTagsStillRequireTheirWholePayloadAndStripUnknownKeys() throws {
        let action: [String: JSONValue] = [
            "deviceId": .string("phone"), "backendId": .string("ios"),
            "platform": .string("ios"), "action": .string("erase"),
        ]
        var extended = action
        extended["future"] = .bool(true)
        #expect(try WireSchema.validate("request.device.action.payload", .object(extended)) == .object(action))

        var missingTag = action
        missingTag.removeValue(forKey: "action")
        var unknownTag = action
        unknownTag["action"] = .string("future")
        var invalidField = action
        invalidField["deviceId"] = .number(1)
        var missingField = action
        missingField.removeValue(forKey: "deviceId")
        for input in [missingTag, unknownTag, invalidField, missingField] {
            #expect(throws: (any Error).self) {
                try WireSchema.validate("request.device.action.payload", .object(input))
            }
        }
    }

    @Test func booleanTagsKeepReplyValidationAndNullableFailureIDs() throws {
        let success: JSONValue = .object([
            "id": .string("reply"), "ok": .bool(true), "result": .object(["future": .number(42)]),
        ])
        #expect(try WireSchema.validate("ReplySchema", success) == success)
        let failure: JSONValue = .object([
            "id": .null, "ok": .bool(false),
            "error": .object(["code": .string("invalid-query"), "message": .string("Invalid query")]),
        ])
        #expect(try WireSchema.validate("ReplySchema", failure) == failure)
        for input: JSONValue in [
            .object(["id": .string("reply"), "ok": .bool(true)]),
            .object(["id": .null, "ok": .bool(false), "error": .object(["message": .string("Missing code")])]),
            .object(["id": .string("reply"), "ok": .string("true"), "result": .null]),
        ] {
            #expect(throws: (any Error).self) { try WireSchema.validate("ReplySchema", input) }
        }
    }

    @Test func aValidationErrorNamesTheField() {
        do {
            try WireSchema.validate("request.server.ping.result", .object(["time": .string("now")]))
            Issue.record("A string time validated")
        } catch {
            #expect(error.localizedDescription.contains("request.server.ping.result.time"))
        }
    }

    @Test func aLoneSurrogateHalfDecodesAsAReplacementCharacter() throws {
        let value = try JSONValue.decode(
            Data(
                #"{"high":"x\ud83d","low":"\udc00y","pair":"\ud83d\ude00","twice":"\uD83D\uD83D\uDE00","escaped":"\\ud83d","end":"\ud83d"}"#
                    .utf8))
        #expect(value["high"] == .string("x\u{FFFD}"))
        #expect(value["low"] == .string("\u{FFFD}y"))
        #expect(value["pair"] == .string("😀"))
        #expect(value["twice"] == .string("\u{FFFD}😀"))
        #expect(value["escaped"] == .string(#"\ud83d"#))
        #expect(value["end"] == .string("\u{FFFD}"))
        let plain = Data(#"{"text":"café \"🚀\" \\u"}"#.utf8)
        #expect(JSONValue.replacingLoneSurrogates(in: plain) == plain)
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
        let fixture = try wireFixture()
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

    @Test func stringBoundsMatchZodCodePoints() throws {
        let providers: [(String, Bool)] = [
            ("", true),
            (String(repeating: "a", count: 32), true),
            (String(repeating: "a", count: 33), false),
            (String(repeating: "📱", count: 16), true),
            (String(repeating: "📱", count: 17), true),
            (String(repeating: "📱", count: 32), true),
            (String(repeating: "📱", count: 33), false),
            (String(repeating: "é", count: 32), true),
            (String(repeating: "e\u{301}", count: 16), true),
            (String(repeating: "e\u{301}", count: 16) + "a", false),
            (String(repeating: "e\u{301}", count: 17), false),
        ]
        for (provider, valid) in providers {
            let input: JSONValue = .object(["providers": .array([.string(provider)])])
            let parsed = try? WireSchema.validate("ProvidersResultSchema", input)
            #expect(parsed == (valid ? input : nil), "Provider: \(provider.debugDescription)")
            if let parsed { #expect(try parsed.encoded() == input.encoded()) }
        }
        let languages: [(String, Bool)] = [
            ("", false),
            ("a", false),
            ("en", true),
            ("📱", false),
            ("📱📱", true),
            ("e\u{301}", true),
            (String(repeating: "a", count: 16), true),
            (String(repeating: "a", count: 17), false),
            (String(repeating: "📱", count: 16), true),
            (String(repeating: "📱", count: 17), false),
            (String(repeating: "e\u{301}", count: 8), true),
            (String(repeating: "e\u{301}", count: 9), false),
        ]
        for (language, valid) in languages {
            let input: JSONValue = .object(["language": .string(language)])
            let parsed = try? WireSchema.validate("request.computer.setLanguage.payload", input)
            #expect(parsed == (valid ? input : nil), "Language: \(language.debugDescription)")
            if let parsed { #expect(try parsed.encoded() == input.encoded()) }
        }
    }
}
