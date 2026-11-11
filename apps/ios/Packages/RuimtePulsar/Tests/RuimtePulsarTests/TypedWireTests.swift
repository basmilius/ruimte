import Foundation
import Testing

@testable import RuimtePulsar

struct TypedWireTests {
    private func fixtures(_ schema: String) throws -> [JSONValue] {
        return try #require(wireFixture()["validations"]?.arrayValue).filter {
            $0["schema"] == .string(schema) && $0["valid"] == .bool(true)
        }.compactMap { $0["output"] }
    }

    @Test func everyChatItemKindDecodesAsTheMachineSendsIt() throws {
        let output = try #require(try fixtures("request.chat.attach.result").first)
        let result = try WireSchema.validate("request.chat.attach.result", output).decoded(as: ChatAttachResult.self)
        #expect(result.seq == 12)
        #expect(result.history?.cursor == "c1")
        #expect(result.info.activeTurnId == "turn-1")
        #expect(result.info.selection.options["thinking"] == .bool(true))
        #expect(
            result.items.map(\.kind) == [
                "turn", "user", "thinking", "assistant", "tool", "subagent", "approval", "question", "note",
                "compaction",
            ])
        guard case .tool(let tool) = result.items[4], case .assistant(let assistant) = result.items[3],
            case .question(let question) = result.items[7], case .compaction(let compaction) = result.items[9]
        else {
            Issue.record("The items decoded as other kinds")
            return
        }
        #expect(tool.state == .running)
        #expect(tool.input == .object(["command": .string("ls"), "nested": .array([.number(1), .null])]))
        #expect(tool.output == nil)
        #expect(assistant.parentToolUseId == .null)
        #expect(question.questions.first?.choices.first?.label == "A")
        #expect(question.answers == nil)
        #expect(compaction.turnId == nil)
        #expect(compaction.preTokens == 90000)
    }

    @Test func eventsAfterSinceDecodeInOrder() throws {
        let output = try #require(try fixtures("request.chat.attach.result").last)
        let result = try output.decoded(as: ChatAttachResult.self)
        let events = try #require(result.events)
        guard case .item(let item) = events[0], case .delta(let delta) = events[1], case .info(let info) = events[2],
            case .reset = events[3]
        else {
            Issue.record("The events decoded as other types")
            return
        }
        #expect(item.historyIndex == 4)
        #expect(delta.text == " there")
        #expect(info.info.activeTurnId == nil)
        let envelope = try #require(try fixtures("event.chat.event").first).decoded(as: ChatEventEnvelope.self)
        #expect(envelope.seq == 15)
    }

    @Test func itemsAndEventsThisAppCannotReadDecodeAsUnknownAndEncodeBackUnchanged() throws {
        let cases = try #require(wireFixture()["tolerated"]?.arrayValue)
        let attach = try #require(cases.first { $0["schema"] == .string("request.chat.attach.result") })
        let result = try #require(attach["output"]).decoded(as: ChatAttachResult.self)
        let unknown = result.items.compactMap { item -> ChatItemUnknown? in
            if case .unknown(let value) = item { value } else { nil }
        }
        #expect(unknown.map(\.id) == ["future-1", "tool-2", "approval-2", "approval-3", "question-2"])
        #expect(unknown.map(\.kind) == ["future-kind", "tool", "approval", "approval", "question"])
        #expect(result.items.count - unknown.count == 10)
        // The decoders alone degrade what the interpreter degrades, for a path that reads without it.
        let unchecked = try #require(attach["input"]).decoded(as: ChatAttachResult.self)
        #expect(unchecked.items == result.items)
        // The last input item has no id, so the list leaves it out.
        let inputs = try #require(attach["input"]?["items"]?.arrayValue).dropFirst(10).prefix(5)
        #expect(try unknown.map { try JSONValue(encoding: $0) } == Array(inputs))
        let events = cases.filter { $0["schema"] == .string("event.chat.event") }
        let envelopes = try events.map { try #require($0["output"]).decoded(as: ChatEventEnvelope.self) }
        guard case .item(let item) = envelopes[0].event, case .unknown = item.item,
            case .unknown(let event) = envelopes[1].event
        else {
            Issue.record("A newer item or event decoded as a known one")
            return
        }
        #expect(event.type == "future-event")
    }

    @Test func aStateOfANewerMachineDecodesAsUnknownAndKeepsItsWord() throws {
        let cases = try #require(wireFixture()["tolerated"]?.arrayValue)
        let status = try #require(cases.first { $0["schema"] == .string("event.chat.status") })
        let event = try #require(status["output"]).decoded(as: ChatStatusEvent.self)
        #expect(event.info.goal?.status == .unknown("future-status"))
        #expect(try JSONValue(encoding: event.info.goal?.status) == .string("future-status"))
        #expect(ChatGoalStatus(rawValue: "active") == .active)
    }

    @Test func anAgentWordThisAppDoesNotKnowStillDecodes() throws {
        let output = try #require(try fixtures("event.session.status").first)
        var agent = try #require(output["agent"]?.objectValue)
        agent["kind"] = .string("future-cli")
        agent["status"] = .string("future-status")
        let event = try WireSchema.validate(
            "event.session.status", .object(["sessionId": .string("session-1"), "agent": .object(agent)])
        ).decoded(as: SessionStatusEvent.self)
        #expect(event.agent?.kind == "future-cli")
        #expect(event.agent?.status == "future-status")
        #expect(event.agent?.requests?.first?.kind == .approval)
        let idle = try #require(try fixtures("event.session.status").last).decoded(as: SessionStatusEvent.self)
        #expect(idle.agent == nil)
    }

    @Test func aFutureMachineTextProviderDoesNotBreakEndpointInfo() throws {
        let endpoint = try JSONValue.object([
            "id": .string("machine"), "label": .string("Mac"), "platform": .string("darwin"),
            "version": .string("1"), "reachability": .string("lan"), "authenticated": .bool(true),
            "textModel": .object(["provider": .string("future-cli"), "model": .null]),
        ]).decoded(as: EndpointInfo.self)
        #expect(endpoint.id == "machine")
        #expect(endpoint.textModel != .missing)
    }

    @Test func gitAndProjectPayloadsDecode() throws {
        let git = try #require(try fixtures("event.git.status").first).decoded(as: GitStatusEvent.self)
        #expect(git.status.operation == .merge)
        #expect(git.status.ahead == 2)
        #expect(git.status.files.first?.state == .staged)
        #expect(git.status.files.first?.oldPath == "a.ts")
        let event = try #require(try fixtures("event.project.summary").first)
        let summary = try #require(event["summary"]).decoded(as: ProjectSummary.self)
        #expect(summary.closedAt == .null)
        #expect(summary.scratch == nil)
    }

    @Test func aRenamedOrMistypedFieldIsAnErrorAndNotAnEmptyValue() throws {
        let output = try #require(try fixtures("event.git.status").first)
        var status = try #require(output["status"]?.objectValue)
        status["ahead"] = .number(1.5)
        #expect(throws: DecodingError.self) {
            try JSONValue.object(["cwd": .string("/work"), "status": .object(status)]).decoded(as: GitStatusEvent.self)
        }
        status["ahead"] = output["status"]?["ahead"]
        status.removeValue(forKey: "branch")
        #expect(throws: DecodingError.self) { try JSONValue.object(status).decoded(as: GitStatus.self) }
    }

    @Test func theFieldsEveryItemSharesReadWithoutASwitch() throws {
        let output = try #require(try fixtures("request.chat.attach.result").first)
        let items = try output.decoded(as: ChatAttachResult.self).items
        #expect(items.map(\.id).first == "turn-1")
        #expect(items.allSatisfy { $0.createdAt == 1000 })
        #expect(items.filter(\.isPending).map(\.id) == ["approval-1", "question-1"])
        let child = try JSONValue.object([
            "id": .string("tool-2"), "createdAt": .number(1), "turnId": .null, "kind": .string("tool"),
            "toolUseId": .string("use-3"), "name": .string("Read"), "input": .null, "output": .null,
            "state": .string("done"), "parentToolUseId": .string("use-2"),
        ]).decoded(as: ChatItem.self)
        #expect(child.parentToolUseID == "use-2")
        #expect(items.compactMap(\.parentToolUseID).isEmpty)
    }
}
