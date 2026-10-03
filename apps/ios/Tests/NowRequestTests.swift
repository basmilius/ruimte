import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor final class NowRequestTests: XCTestCase {
    private func approval(_ fields: [String: JSONValue]) -> JSONValue {
        var approval: [String: JSONValue] = [
            "toolName": .string("Edit"), "subject": .string("src/pool.ts"), "description": .null,
            "canAllowAlways": .bool(false),
        ]
        approval.merge(fields) { _, new in new }
        return .object([
            "requestId": .string("r1"), "itemId": .string("i1"), "kind": .string("approval"),
            "createdAt": .number(5), "approval": .object(approval),
        ])
    }

    private func question(multiSelect: Bool, choices: [String], count: Int = 1) -> JSONValue {
        let one = JSONValue.object([
            "id": .string("q"), "header": .string("Screens"), "question": .string("Which screenshots?"),
            "choices": .array(choices.map { .object(["label": .string($0), "description": .string("")]) }),
            "multiSelect": .bool(multiSelect),
        ])
        return .object([
            "requestId": .string("r2"), "itemId": .string("i2"), "kind": .string("question"),
            "createdAt": .number(6), "question": .object(["questions": .array(Array(repeating: one, count: count))]),
        ])
    }

    func testAnEditShowsItsFileAndDiffAndACommandItsCommand() throws {
        let edit = try XCTUnwrap(
            NowRequest(approval(["path": .string("src/pool.ts"), "diff": .string("-old\n+new"), "truncated": .bool(true)])))
        XCTAssertEqual(edit.headline, "Edit src/pool.ts")
        XCTAssertEqual(edit.approval?.diff, "-old\n+new")
        XCTAssertEqual(edit.approval?.truncated, true)
        XCTAssertNil(edit.approval?.allowAlways)

        let several = try XCTUnwrap(NowRequest(approval(["path": .string("a.ts"), "files": .number(3)])))
        XCTAssertEqual(several.headline, "Edit 3 files")

        let command = try XCTUnwrap(
            NowRequest(approval(["toolName": .string("Bash"), "subject": .string("bun test"), "command": .string("bun test")])))
        XCTAssertEqual(command.headline, "Run a command")
        XCTAssertEqual(command.summary, "Run a command")

        let fetch = try XCTUnwrap(
            NowRequest(
                approval([
                    "toolName": .string("WebFetch"), "subject": .string("https://ruimte.app"),
                    "canAllowAlways": .bool(true),
                    "allowAlways": .object(["label": .string("Always allow ruimte.app"), "description": .string("")]),
                ])))
        XCTAssertEqual(fetch.headline, "WebFetch https://ruimte.app")
        XCTAssertEqual(fetch.approval?.allowAlways?.label, "Always allow ruimte.app")
    }

    func testAKindThisAppDoesNotKnowOrAnEmptyQuestionMakesNoCard() {
        XCTAssertNil(NowRequest(.object(["requestId": .string("r"), "kind": .string("plan")])))
        XCTAssertNil(NowRequest(question(multiSelect: false, choices: [], count: 0)))
        XCTAssertNil(NowRequest(.object(["kind": .string("approval"), "approval": .object([:])])))
    }

    func testOnlyASingleQuestionIsAnsweredOnTheCard() throws {
        let one = try XCTUnwrap(NowRequest(question(multiSelect: false, choices: ["2026"])))
        XCTAssertEqual(one.inlineQuestion?.text, "Which screenshots?")
        XCTAssertEqual(one.summary, "Asks a question")
        let two = try XCTUnwrap(NowRequest(question(multiSelect: false, choices: ["2026"], count: 2)))
        XCTAssertNil(two.inlineQuestion)
        XCTAssertEqual(two.headline, "2 questions")
    }

    func testPayloadsNameTheChatAndTheRequestAndADenialCarriesItsMessage() throws {
        let request = try XCTUnwrap(NowRequest(approval([:])))
        XCTAssertEqual(
            request.approvePayload(chatID: "chat", decision: .deny, message: "  use a backoff  "),
            .object([
                "chatId": .string("chat"), "requestId": .string("r1"), "decision": .string("deny"),
                "message": .string("use a backoff"),
            ]))
        XCTAssertEqual(
            request.approvePayload(chatID: "chat", decision: .allow, message: "ignored"),
            .object(["chatId": .string("chat"), "requestId": .string("r1"), "decision": .string("allow")]))
        XCTAssertEqual(
            request.approvePayload(chatID: "chat", decision: .allowAlways)["decision"], .string("allow-always"))
        XCTAssertEqual(
            request.answerPayload(chatID: "chat", answers: ["q": "2026"]),
            .object([
                "chatId": .string("chat"), "requestId": .string("r1"), "answers": .object(["q": .string("2026")]),
            ]))
    }

    func testADraftAnswersWithATappedChoiceThePickedOnesOrItsReply() throws {
        let single = try XCTUnwrap(NowRequest(question(multiSelect: false, choices: ["2026", "Keep old"]))?.inlineQuestion)
        var draft = NowRequestDraft()
        XCTAssertEqual(draft.answer(single, choice: "Keep old"), ["q": "Keep old"])
        XCTAssertNil(draft.answer(single))
        draft.replying = true
        draft.reply = "  Both, side by side "
        XCTAssertEqual(draft.answer(single), ["q": "Both, side by side"])

        let multiple = try XCTUnwrap(NowRequest(question(multiSelect: true, choices: ["A", "B", "C"]))?.inlineQuestion)
        var picks = NowRequestDraft()
        XCTAssertNil(picks.answer(multiple, choice: "A"))
        picks.toggle("C")
        picks.toggle("A")
        picks.toggle("B")
        picks.toggle("B")
        XCTAssertEqual(picks.answer(multiple), ["q": "A, C"])

        let open = try XCTUnwrap(NowRequest(question(multiSelect: false, choices: []))?.inlineQuestion)
        var typed = NowRequestDraft()
        typed.reply = "Yes"
        XCTAssertEqual(typed.answer(open), ["q": "Yes"])
    }

    func testAnAnswerSettlesTheCardAndOneSomeoneElseGaveFirstToo() async {
        let machine = AnsweringMachine()
        let answers = NowAnswers()
        answers.drafts["mac:r1"] = NowRequestDraft(reply: "draft", replying: true)
        await answers.send(.chatApprove, payload: .object([:]), key: "mac:r1", client: machine)
        XCTAssertEqual(machine.requests, ["chat.approve"])
        XCTAssertTrue(answers.answered.contains("mac:r1"))
        XCTAssertNil(answers.drafts["mac:r1"])

        machine.refusal = "request-not-found"
        await answers.send(.chatAnswer, payload: .object([:]), key: "mac:r2", client: machine)
        XCTAssertTrue(answers.answered.contains("mac:r2"))
        XCTAssertNil(answers.problems["mac:r2"])

        machine.refusal = "chat-busy"
        await answers.send(.chatAnswer, payload: .object([:]), key: "mac:r3", client: machine)
        XCTAssertFalse(answers.answered.contains("mac:r3"))
        XCTAssertEqual(answers.problems["mac:r3"], "chat-busy")
        XCTAssertTrue(answers.sending.isEmpty)

        answers.keep(["mac:r3"])
        XCTAssertEqual(answers.answered, [])
        XCTAssertEqual(answers.problems.keys.sorted(), ["mac:r3"])
    }
}

@MainActor private final class AnsweringMachine: MachineRequesting {
    var requests: [String] = []
    var refusal: String?

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append(type)
        if let refusal { throw MachineClientError.server(code: refusal, message: refusal) }
        return .object([:])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
