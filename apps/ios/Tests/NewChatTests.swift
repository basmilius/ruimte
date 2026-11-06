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
        XCTAssertEqual(model.agents?.map(\.kind), ["claude"])
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

    func testAMachineThatOrdersItsAccountsGetsNoRememberedAccount() async {
        let machine = NewChatMachine()
        machine.features = ["accounts.reorder"]
        preferences.rememberAccount("work", provider: "claude", machineID: "mac")
        let model = NewChatModel(client: machine, machineID: "mac", preferences: preferences)
        await model.load()
        XCTAssertNil(model.account(for: "claude"))
        _ = await model.start(provider: "claude")
        XCTAssertEqual(machine.requests.last?.1, .object(["provider": .string("claude")]))
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

    func testTheRefusalAPersonCanActOnIsSaidInTheirWords() async {
        let machine = NewChatMachine()
        let model = NewChatModel(client: machine, machineID: "mac", preferences: preferences)
        machine.refusal = "scratch-unavailable"
        let place = await model.start(provider: "claude")
        XCTAssertNil(place)
        XCTAssertEqual(
            model.problem,
            "This machine keeps its Ruimte folder inside a git checkout, so it cannot hold chats outside a project.")
    }
}

@MainActor private final class NewChatMachine: MachineRequesting, MachineFeatures {
    var requests: [(WireRequest, JSONValue)] = []
    var refusal: String?
    var workEnabled = true
    var features: Set<String> = []

    func answers(_ type: WireRequest) -> Bool { features.contains(type.rawValue) }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if let refusal { throw MachineClientError.server(code: refusal, message: refusal) }
        switch type {
        case .providerList:
            return ProviderWire.list([
                ProviderWire.provider("claude"), ProviderWire.provider("gemini", installed: false),
                ProviderWire.provider("codex", capabilities: ["chat": .bool(false)]),
            ])
        case .accountsList:
            return AccountsWire.snapshot(accounts: [
                "claude": .object(["kind": .string("claude")]),
                "work": .object(["kind": .string("claude"), "enabled": .bool(workEnabled)]),
            ])
        case .projectNewChat:
            return .object([
                "summary": .object(["projectId": .string("chats"), "scratch": .bool(true)]),
                "viewId": .string("chat-1"),
            ])
        case .agentChildren:
            return .object(["nodeIds": .array([.string("c1"), .string("child")])])
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
