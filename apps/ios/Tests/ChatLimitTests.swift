import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor final class ChatLimitTests: XCTestCase {
    private func info(
        limit: JSONValue?, resumeAt: Double? = nil, active: Bool = false, account: String? = nil,
        resumeAtReset: Bool? = nil
    ) -> ChatInfo {
        var values: [String: JSONValue] = [
            "chatId": .string("chat"), "provider": .string("claude"),
            "activeTurnId": active ? .string("t2") : .null,
        ]
        if let limit { values["limit"] = limit }
        if let resumeAt { values["resumeAt"] = .number(resumeAt) }
        if let account { values["account"] = .string(account) }
        if let resumeAtReset { values["resumeAtReset"] = .bool(resumeAtReset) }
        return ChatWire.info(values).chatInfo
    }

    private let moment: (Double) -> String = { "at\(Int($0))" }

    func testAUsageLimitSaysWhenItResetsOrWhenTheChatGoesOn() {
        let usage = JSONValue.object(["kind": .string("usage"), "resetsAt": .number(5)])
        XCTAssertEqual(
            ChatLimits.view(info: info(limit: usage), moment: moment),
            ChatLimitView(title: "Stopped on a usage limit", detail: "The limit resets at at5."))
        XCTAssertEqual(
            ChatLimits.view(info: info(limit: usage, resumeAt: 7), moment: moment)?.detail,
            "Resumes at at7.")
        XCTAssertNil(
            ChatLimits.view(info: info(limit: .object(["kind": .string("usage")])), moment: moment)?.detail)
    }

    func testAnOverloadAsksForAnotherMessageUnlessItTriesAgainItself() {
        let overload = JSONValue.object(["kind": .string("overload")])
        XCTAssertEqual(
            ChatLimits.view(info: info(limit: overload), moment: moment),
            ChatLimitView(title: "Model overloaded", detail: "Send a message to try again."))
        XCTAssertEqual(
            ChatLimits.view(info: info(limit: overload, resumeAt: 3), moment: moment)?.detail,
            "Retries at at3.")
    }

    func testNothingIsSaidWithoutALimitOrWhileATurnRuns() {
        XCTAssertNil(ChatLimits.view(info: info(limit: nil), moment: moment))
        XCTAssertNil(
            ChatLimits.view(info: info(limit: .object(["kind": .string("usage")]), active: true), moment: moment))
    }

    func testTheLineNamesTheAccountThatRanIntoTheLimit() {
        let view = ChatLimitView(title: "Stopped on a usage limit", detail: "The limit resets at 14:00.")
        XCTAssertEqual(ChatLimits.detail(view, account: "Work"), "Work · The limit resets at 14:00.")
        XCTAssertEqual(ChatLimits.detail(ChatLimitView(title: "", detail: nil), account: "Work"), "Work")
        XCTAssertEqual(ChatLimits.detail(view, account: nil), "The limit resets at 14:00.")
    }

    func testASessionWindowReadsAsAPercentAndItsReset() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(ChatLimits.sessionLine(AccountSessionWindow(used: 0.456, resetsAt: nil), now: now), "46% used")
        let reset = ChatLimits.sessionLine(
            AccountSessionWindow(used: 0.5, resetsAt: (now.timeIntervalSince1970 + 60) * 1000), now: now)
        XCTAssertTrue(reset.hasPrefix("50% used · resets "))
    }

    func testAnotherAccountWithRoomIsOfferedAfterAUsageLimit() async {
        let machine = LimitMachine()
        let model = ChatModel(client: machine, chatID: "chat", machineID: "mac")
        model.connected = true
        model.accounts = machine.accounts
        model.info = info(limit: .object(["kind": .string("usage")]))
        XCTAssertNil(model.continueTarget)
        await model.readLimits(unread: true, now: Date(timeIntervalSince1970: 1))
        XCTAssertEqual(model.continueTarget?.id, "work")
        XCTAssertEqual(machine.requests.map(\.0), ["usage.limits"])
        model.info = info(limit: .object(["kind": .string("overload")]))
        XCTAssertNil(model.continueTarget)
    }

    func testAccountsNobodyReadAreAskedForAtMostEveryFiveMinutes() async {
        let machine = LimitMachine()
        machine.workRead = false
        let model = ChatModel(client: machine, chatID: "chat", machineID: "mac-\(UUID().uuidString)")
        model.connected = true
        model.accounts = machine.accounts
        model.info = info(limit: .object(["kind": .string("usage")]))
        let start = Date(timeIntervalSince1970: 1_000)
        await model.readLimits(unread: true, now: start)
        await model.readLimits(unread: true, now: start.addingTimeInterval(60))
        await model.readLimits(unread: true, now: start.addingTimeInterval(301))
        XCTAssertEqual(machine.requests.filter { $0.0 == "usage.refreshLimits" }.count, 2)
    }

    func testContinuingInPlaceStaysAndInAForkOpensIt() async {
        let machine = LimitMachine()
        let model = ChatModel(client: machine, chatID: "chat", machineID: "mac")
        model.connected = true
        model.info = info(limit: .object(["kind": .string("usage")]))
        let work = ProviderAccountEntry(id: "work", kind: "claude", label: "Work")
        let inPlace = await model.continueOn(work)
        XCTAssertNil(inPlace)
        XCTAssertEqual(machine.requests.last?.1, .object(["chatId": .string("chat"), "account": .string("work")]))
        machine.fork = true
        let fork = await model.continueOn(work)
        XCTAssertEqual(fork, "fork-node")
        XCTAssertNil(model.error)
    }

    func testTheChatsResumeSwitchFollowsTheMachineAndCountsOnlyWhileItAllows() {
        let absent = info(limit: nil)
        XCTAssertTrue(ChatLimits.resumeSwitch(info: absent, machineAllows: true) == (true, true))
        XCTAssertTrue(ChatLimits.resumeSwitch(info: absent, machineAllows: false) == (false, false))
        let off = info(limit: nil, resumeAtReset: false)
        XCTAssertTrue(ChatLimits.resumeSwitch(info: off, machineAllows: true) == (false, true))
        let on = info(limit: nil, resumeAtReset: true)
        XCTAssertTrue(ChatLimits.resumeSwitch(info: on, machineAllows: false) == (false, false))
    }

    func testTurningTheSwitchConfiguresTheChat() async {
        let machine = LimitMachine()
        let model = ChatModel(client: machine, chatID: "chat", machineID: "mac")
        await model.setResumeAtReset(false)
        XCTAssertEqual(machine.requests.last?.0, "chat.configure")
        XCTAssertEqual(machine.requests.last?.1, .object(["chatId": .string("chat"), "resumeAtReset": .bool(false)]))
    }

    func testAFailedContinueOnSaysWhichAccountItWas() async {
        let machine = LimitMachine()
        machine.refuses = true
        let model = ChatModel(client: machine, chatID: "chat", machineID: "mac")
        model.connected = true
        _ = await model.continueOn(ProviderAccountEntry(id: "work", kind: "claude"))
        XCTAssertEqual(model.error, "Could not continue on work. Busy")
    }
}

@MainActor private final class LimitMachine: MachineRequesting {
    var requests: [(String, JSONValue)] = []
    var fork = false
    var refuses = false
    var workRead = true
    let accounts = ProviderAccountList(entries: [
        ProviderAccountEntry(id: "claude", kind: "claude", state: "ready"),
        ProviderAccountEntry(id: "work", kind: "claude", label: "Work", state: "ready"),
    ])

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if refuses { throw MachineClientError.server(code: "chat-busy", message: "Busy") }
        switch type {
        case "usage.limits", "usage.refreshLimits":
            let window = JSONValue.object([
                "id": .string("session"), "kind": .string("session"), "label": .string("Session"),
                "used": .number(0.2), "resetsAt": .null, "durationMs": .null,
            ])
            return .object([
                "providers": .array([
                    .object([
                        "kind": .string("claude"), "account": .object(["id": .string("work")]), "plan": .null,
                        "checkedAt": .number(workRead ? 1 : 0), "source": .string("probe"),
                        "windows": .array([window]), "cost": .null, "unavailable": .null,
                    ])
                ])
            ])
        case "chat.continueOn":
            guard fork else { return .object(["chatId": .string("chat")]) }
            return .object(["chatId": .string("fork-chat"), "fork": .object(["nodeId": .string("fork-node")])])
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
