import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor final class NewChatTests: XCTestCase {
    private var domain = ""
    private var preferences: ChatPreferences!

    override func setUp() async throws {
        domain = "NewChatTests.\(UUID().uuidString)"
        preferences = ChatPreferences(defaults: UserDefaults(suiteName: domain)!)
    }

    override func tearDown() async throws {
        UserDefaults().removePersistentDomain(forName: domain)
    }

    func testTheAgentsOfferedAreTheInstalledOnesThatChat() async {
        let machine = NewChatMachine()
        let model = NewChatModel(client: machine, machineID: "mac", preferences: preferences)
        await model.load()
        XCTAssertEqual(model.agents?.map { $0.text("kind") }, ["claude"])
    }

    func testAChatStartsOnTheAgentAndTheAccountRememberedForThisMachine() async {
        let machine = NewChatMachine()
        preferences.rememberAccount("work", provider: "claude", machineID: "mac")
        preferences.rememberAccount("home", provider: "claude", machineID: "other")
        let model = NewChatModel(client: machine, machineID: "mac", preferences: preferences)
        await model.load()
        let place = await model.start(provider: "claude")
        XCTAssertEqual(place, NewChatPlace(projectID: "chats", viewID: "chat-1"))
        XCTAssertEqual(
            machine.requests.last?.1, .object(["provider": .string("claude"), "account": .string("work")]))
    }

    func testAnAccountTheMachineTurnedOffIsNotAskedFor() async {
        let machine = NewChatMachine()
        machine.workEnabled = false
        preferences.rememberAccount("work", provider: "claude", machineID: "mac")
        let model = NewChatModel(client: machine, machineID: "mac", preferences: preferences)
        await model.load()
        _ = await model.start(provider: "claude")
        XCTAssertEqual(machine.requests.last?.1, .object(["provider": .string("claude")]))
    }

    func testTheRefusalsAPersonCanActOnAreSaidInTheirWords() async {
        let machine = NewChatMachine()
        let model = NewChatModel(client: machine, machineID: "mac", preferences: preferences)
        machine.refusal = "unknown-request"
        let older = await model.start(provider: "claude")
        XCTAssertNil(older)
        XCTAssertEqual(model.problem, "Update Ruimte on this machine to start chats outside a project.")
        machine.refusal = "scratch-unavailable"
        _ = await model.start(provider: "claude")
        XCTAssertEqual(
            model.problem,
            "This machine keeps its Ruimte folder inside a git checkout, so it cannot hold chats outside a project.")
    }

    func testAChatOrACanvasTakesItsChatsAlongWhenItGoes() {
        let chat = JSONValue.object(["id": .string("c1"), "kind": .string("chat")])
        let canvas = JSONValue.object([
            "id": .string("v1"), "kind": .string("canvas"),
            "nodes": .array([
                .object(["id": .string("n1"), "kind": .string("chat")]),
                .object(["id": .string("n2"), "kind": .string("terminal")]),
            ]),
        ])
        XCTAssertEqual(ChatEnding.chats(in: chat), ["c1"])
        XCTAssertEqual(ChatEnding.chats(in: canvas), ["n1"])
        XCTAssertEqual(ChatEnding.chats(in: .object(["id": .string("t"), "kind": .string("terminal")])), [])
    }

    func testADeleteSaysTheChatEndsAndCountsTheAgentsItOpened() async {
        XCTAssertNil(ChatEnding.warning(chats: 0, agents: 0))
        XCTAssertEqual(
            ChatEnding.warning(chats: 1, agents: 0), "The chat ends on this machine, and its conversation is gone.")
        XCTAssertEqual(
            ChatEnding.warning(chats: 2, agents: 1),
            "Its 2 chats end on this machine, and their conversations are gone. "
                + "Also ends the agent it opened. Its node stays on the canvas with what it did so far.")
        let machine = NewChatMachine()
        let question = await ChatEnding.question(
            for: .object(["id": .string("c1"), "kind": .string("chat")]), client: machine)
        XCTAssertEqual(question.chats, ["c1"])
        XCTAssertTrue(question.warning?.contains("Also ends the agent it opened.") == true)
    }
}

@MainActor private final class NewChatMachine: MachineRequesting {
    var requests: [(String, JSONValue)] = []
    var refusal: String?
    var workEnabled = true

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if let refusal { throw MachineClientError.server(code: refusal, message: refusal) }
        switch type {
        case "provider.list":
            let chat = JSONValue.object(["chat": .bool(true)])
            return .object([
                "providers": .array([
                    .object(["kind": .string("claude"), "installed": .bool(true), "capabilities": chat]),
                    .object(["kind": .string("gemini"), "installed": .bool(false), "capabilities": chat]),
                    .object([
                        "kind": .string("codex"), "installed": .bool(true),
                        "capabilities": .object(["chat": .bool(false), "terminal": .bool(true)]),
                    ]),
                ])
            ])
        case "accounts.list":
            return .object([
                "accounts": .object([
                    "claude": .object(["kind": .string("claude")]),
                    "work": .object(["kind": .string("claude"), "enabled": .bool(workEnabled)]),
                ]),
                "statuses": .array([]),
            ])
        case "project.newChat":
            return .object([
                "summary": .object(["projectId": .string("chats"), "scratch": .bool(true)]),
                "viewId": .string("chat-1"),
            ])
        case "agent.children":
            return .object(["nodeIds": .array([.string("c1"), .string("child")])])
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
