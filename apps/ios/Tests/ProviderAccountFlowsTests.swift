import RuimtePulsar
import RuimteTransport
import SwiftUI
import XCTest

@testable import Ruimte

@MainActor final class ProviderAccountFlowsTests: XCTestCase {
    func testAnExplicitOriginalAccountOverridesTheMachineOrderInBothChatPayloads() async throws {
        let machine = AccountFlowMachine()
        let model = NewChatModel(client: machine, machineID: "mac")
        await model.load()
        XCTAssertNil(model.account(for: "claude"))
        model.choose("claude", provider: "claude")
        let project = JSONValue.object(["accounts": .object(["claude": .object(["off": .array([.string("work")])])])])
        await record(
            "account-picker-phone",
            view: NewChatAccountSheet(
                model: model, provider: "claude", project: project, connected: true, start: {}, close: {}), width: 390)
        await record(
            "account-picker-tablet",
            view: NewChatAccountSheet(
                model: model, provider: "claude", project: project, connected: true, start: {}, close: {}), width: 768)
        _ = await model.start(provider: "claude")
        XCTAssertEqual(machine.sent.last?.1["account"], .string("claude"))
        XCTAssertEqual(
            NewChat.projectView(id: "chat", provider: "claude", account: "claude")["node"]?["account"],
            .string("claude"))
        model.choose(nil, provider: "claude")
        XCTAssertNil(model.account(for: "claude"))
    }

    func testAProjectOffRuleRefusesTheExplicitChoiceBeforeCreatingAChat() async {
        let machine = AccountFlowMachine()
        let model = NewChatModel(client: machine, machineID: "mac")
        await model.load()
        model.choose("work", provider: "claude")
        let project = JSONValue.object(["accounts": .object(["claude": .object(["off": .array([.string("work")])])])])
        do {
            _ = try await model.prepare(provider: "claude", project: project)
            XCTFail("An off account must refuse")
        } catch { XCTAssertEqual(error.localizedDescription, "Off in this project") }
        XCTAssertFalse(machine.sent.contains { $0.0 == .projectNewChat })
        XCTAssertEqual(model.choices["claude"], "work")
    }

    func testTheStartableStatesAndADeletedSelectionNeverFallBack() async throws {
        let machine = AccountFlowMachine()
        let model = NewChatModel(client: machine, machineID: "mac")
        for state in [
            "checking", "ready", "disabled", "signed-out", "folder-missing", "unavailable", "not-found", "failed",
        ] {
            machine.status = state
            await model.load()
            model.choose("work", provider: "claude")
            XCTAssertEqual(
                model.refusal(provider: "claude") == nil, ["checking", "ready", "failed"].contains(state), state)
        }
        machine.status = nil
        await model.load()
        XCTAssertNil(model.refusal(provider: "claude"))
        machine.accounts["work"] = nil
        let place = await model.start(provider: "claude")
        XCTAssertNil(place)
        XCTAssertEqual(model.choices["claude"], "work")
        XCTAssertFalse(machine.sent.contains { $0.0 == .projectNewChat })
    }

    func testAFailedGrokProbeStillAllowsAutomaticAndNamedChats() async {
        let machine = AccountFlowMachine()
        machine.providerKind = "grok"
        machine.accounts = ["work": .object(["kind": .string("grok"), "label": .string("Work")])]
        machine.status = "failed"
        let model = NewChatModel(client: machine, machineID: "mac")
        await model.load()
        let automatic = await model.start(provider: "grok")
        XCTAssertNotNil(automatic)
        model.choose("work", provider: "grok")
        let named = await model.start(provider: "grok")
        XCTAssertNotNil(named)
        XCTAssertEqual(machine.sent.last?.1["account"], .string("work"))
    }

    func testAnAccountUpdateDuringPreflightDoesNotCancelTheStart() async {
        let machine = AccountFlowMachine()
        let model = NewChatModel(client: machine, machineID: "mac")
        await model.load()
        model.choose("work", provider: "claude")
        let held = expectation(description: "Start preflight held")
        machine.holdList = true
        machine.listHeld = { held.fulfill() }
        let starting = Task { await model.start(provider: "claude") }
        await fulfillment(of: [held], timeout: 1)
        await model.load()
        machine.releaseList()
        let place = await starting.value
        XCTAssertNotNil(place)
        XCTAssertNil(model.problem)
        XCTAssertEqual(machine.sent.last?.1["account"], .string("work"))
    }

    func testAccountChoicesSkipOffAccountsAndLetAnUnavailablePickBeChanged() async {
        let machine = AccountFlowMachine()
        let model = NewChatModel(client: machine, machineID: "mac")
        await model.load()
        XCTAssertTrue(model.needsAccountChoice(provider: "claude"))
        let project = JSONValue.object(["accounts": .object(["claude": .object(["off": .array([.string("work")])])])])
        XCTAssertFalse(model.needsAccountChoice(provider: "claude", project: project))
        model.choose("work", provider: "claude")
        machine.accounts["work"] = nil
        await model.load()
        XCTAssertNotNil(model.refusal(provider: "claude"))
        XCTAssertTrue(model.needsAccountChoice(provider: "claude"))
        model.choose(nil, provider: "claude")
        XCTAssertNil(model.refusal(provider: "claude"))
        XCTAssertFalse(model.needsAccountChoice(provider: "claude"))
    }

    func testOnlyNewAccountsOfferLoginWhileTheMachineIsChecking() async {
        let machine = AccountFlowMachine()
        let model = MachineAgentsModel(client: machine)
        for status: String? in ["checking", nil] {
            machine.status = status
            await model.load()
            let account = model.agents[0].accounts.first { $0.id == "work" }!
            XCTAssertFalse(model.canLogin(account, kind: "claude"))
        }
        let created = await model.create(kind: "claude", label: "New")
        XCTAssertTrue(created)
        let account = model.agents[0].accounts.first { $0.id == "new-account" }!
        XCTAssertTrue(model.canLogin(account, kind: "claude"))
        machine.statusID = "new-account"
        machine.status = "ready"
        await model.refresh()
        XCTAssertFalse(model.canLogin(model.agents[0].accounts.first { $0.id == "new-account" }!, kind: "claude"))
        machine.statusID = "work"
        machine.status = "signed-out"
        await model.refresh()
        XCTAssertTrue(model.canLogin(model.agents[0].accounts.first { $0.id == "work" }!, kind: "claude"))
        machine.status = "failed"
        machine.silentLogins = ["claude"]
        await model.refresh()
        XCTAssertTrue(model.canLogin(model.agents[0].accounts.first { $0.id == "work" }!, kind: "claude"))
        machine.features.remove("session.login")
        XCTAssertFalse(model.canLogin(account, kind: "claude"))
    }

    func testANewerAccountReadWinsWhenAnOlderReplyArrivesLast() async {
        let machine = AccountFlowMachine()
        let model = NewChatModel(client: machine, machineID: "mac")
        await model.load()
        let held = expectation(description: "Older new-chat account list held")
        machine.holdList = true
        machine.listHeld = { held.fulfill() }
        let older = Task { await model.load() }
        await fulfillment(of: [held], timeout: 1)
        machine.accounts["work"] = machine.accounts["work"]!.setting("label", .string("Newest name"))
        await model.load()
        machine.releaseList()
        await older.value
        XCTAssertEqual(model.accounts?.entries.first { $0.id == "work" }?.label, "Newest name")
    }

    func testAutomaticUsesTheProjectDefaultInsteadOfAnOlderRememberedAccount() async throws {
        let machine = AccountFlowMachine()
        machine.features.remove("accounts.reorder")
        let domain = "AccountFlowTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: domain)!
        defer { defaults.removePersistentDomain(forName: domain) }
        let preferences = ChatPreferences(defaults: defaults)
        preferences.rememberAccount("work", provider: "claude", machineID: "mac")
        let model = NewChatModel(client: machine, machineID: "mac", preferences: preferences)
        await model.load()
        XCTAssertEqual(model.account(for: "claude"), "work")
        let project = JSONValue.object([
            "accounts": .object(["claude": .object(["default": .string("claude"), "off": .array([.string("work")])])])
        ])
        let automatic = try await model.prepare(provider: "claude", project: project)
        XCTAssertNil(automatic)
        model.choose("work", provider: "claude")
        do {
            _ = try await model.prepare(provider: "claude", project: project)
            XCTFail("A named off account must refuse")
        } catch { XCTAssertEqual(error.localizedDescription, "Off in this project") }
    }

    func testEachMachineKeepsItsOwnExplicitChoice() async {
        let machine = AccountFlowMachine()
        let one = NewChatModel(client: machine, machineID: "one")
        let two = NewChatModel(client: machine, machineID: "two")
        await one.load()
        await two.load()
        one.choose("work", provider: "claude")
        XCTAssertEqual(one.account(for: "claude"), "work")
        XCTAssertNil(two.account(for: "claude"))
    }

    func testASaveReadsTheLatestWholeMapAndPreservesUneditedRawFields() async {
        let machine = AccountFlowMachine()
        let model = MachineAgentsModel(client: machine)
        await model.load()
        machine.accounts["added-on-desktop"] = .object(["kind": .string("claude"), "label": .string("Desktop")])
        let before = machine.accounts["work"]!
        let result1 = await model.save(id: "work", kind: "claude", label: " Renamed ", enabled: nil)
        XCTAssertTrue(result1)
        let payload = machine.sent.last { $0.0 == .accountsSave }!.1
        XCTAssertEqual(payload["accounts"]?["added-on-desktop"], machine.accounts["added-on-desktop"])
        XCTAssertEqual(payload["accounts"]?["work"], before.setting("label", .string("Renamed")))
        XCTAssertEqual(machine.sent.suffix(2).map(\.0), [.accountsList, .accountsSave])
        let result2 = await model.save(id: "work", kind: "claude", label: "", enabled: false)
        XCTAssertTrue(result2)
        XCTAssertNil(machine.accounts["work"]?["label"])
        XCTAssertEqual(machine.accounts["work"]?["enabled"], .bool(false))
        let target = ProviderAccountEditorTarget(kind: "claude", accountID: "work", label: "Renamed", enabled: false)
        await record(
            "account-editor-phone", view: ProviderAccountEditor(model: model, target: target, connected: true),
            width: 390)
        await record(
            "account-editor-dark",
            view: ProviderAccountEditor(model: model, target: target, connected: true).preferredColorScheme(.dark),
            width: 390)
        await record(
            "account-editor-large-text",
            view: ProviderAccountEditor(model: model, target: target, connected: true).dynamicTypeSize(.accessibility3),
            width: 390)
    }

    func testCreateTrimsTheLabelAndNeverStartsALogin() async {
        let machine = AccountFlowMachine()
        let model = MachineAgentsModel(client: machine)
        await model.load()
        let result3 = await model.create(kind: "claude", label: " New account ")
        XCTAssertTrue(result3)
        XCTAssertEqual(machine.sent.last?.0, .accountsCreate)
        XCTAssertEqual(machine.sent.last?.1, .object(["kind": .string("claude"), "label": .string("New account")]))
        XCTAssertTrue(model.agents.first?.accounts.contains { $0.id == "new-account" } == true)
        XCTAssertFalse(machine.sent.contains { $0.0.rawValue.hasPrefix("session.") })
    }

    func testUnsupportedOperationsSendNoMutationAndARefusedSaveKeepsTheAccount() async {
        let machine = AccountFlowMachine()
        let model = MachineAgentsModel(client: machine)
        await model.load()
        machine.features = []
        let result4 = await model.create(kind: "claude", label: "No")
        XCTAssertFalse(result4)
        let result5 = await model.save(id: "work", kind: "claude", label: "No", enabled: nil)
        XCTAssertFalse(result5)
        await model.refresh()
        XCTAssertFalse(
            machine.sent.contains { [.accountsCreate, .accountsSave, .accountsRefresh].contains($0.0) })
        machine.features = AccountFlowMachine.supported
        machine.refuseSave = true
        let result6 = await model.save(id: "work", kind: "claude", label: "Keep the form", enabled: nil)
        XCTAssertFalse(result6)
        XCTAssertEqual(model.state.problem, "Save refused")
        XCTAssertEqual(machine.accounts["work"]?["label"], .string("Work"))
    }

    func testAnOlderPageLoadCannotReplaceASavedAccount() async {
        let machine = AccountFlowMachine()
        let model = MachineAgentsModel(client: machine)
        await model.load()
        let held = expectation(description: "Older account list held")
        machine.holdList = true
        machine.listHeld = { held.fulfill() }
        let older = Task { await model.load() }
        await fulfillment(of: [held], timeout: 1)
        let result7 = await model.save(id: "work", kind: "claude", label: "New name", enabled: nil)
        XCTAssertTrue(result7)
        machine.releaseList()
        await older.value
        XCTAssertEqual(model.agents.first?.accounts.first { $0.id == "work" }?.name, "New name")
    }

    private func record<Content: View>(_ name: String, view: Content, width: CGFloat) async {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: width, height: 844)
        let host = UIHostingController(rootView: view)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            previous?.makeKey()
        }
        host.view.frame = window.bounds
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        await Task.yield()
        host.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testLabelsUseTheWireBoundAndAnEmptyRenameMeansNoLabel() throws {
        XCTAssertEqual(try MachineAgentsModel.label(" Name ", required: true), "Name")
        XCTAssertEqual(try MachineAgentsModel.label(" ", required: false), "")
        XCTAssertThrowsError(try MachineAgentsModel.label(" ", required: true))
        XCTAssertThrowsError(try MachineAgentsModel.label(String(repeating: "x", count: 81), required: false))
        XCTAssertThrowsError(try MachineAgentsModel.label(String(repeating: "😀", count: 41), required: true))
    }
}

@MainActor private final class AccountFlowMachine: MachineRequesting, MachineFeatures {
    static let supported: Set<String> = [
        "accounts.create", "accounts.save", "accounts.refresh", "accounts.reorder", "session.login",
    ]
    var features = supported
    var sent: [(WireRequest, JSONValue)] = []
    var status: String? = "ready"
    var providerKind = "claude"
    var statusID = "work"
    var silentLogins: [String] = []
    var refuseSave = false
    var holdList = false
    var listHeld: (() -> Void)?
    private var release: CheckedContinuation<Void, Never>?
    var accounts: [String: JSONValue] = [
        "claude": .object(["kind": .string("claude"), "order": .number(1)]),
        "work": .object([
            "kind": .string("claude"), "label": .string("Work"), "order": .number(0),
            "home": .string("/accounts/work"), "shadowHome": .string("/accounts/auth"),
            "future": .object(["keep": .bool(true)]),
            "env": .array([
                .object([
                    "name": .string("SECRET"), "value": .string(""), "sensitive": .bool(true),
                    "valueRedacted": .bool(true),
                ])
            ]),
        ]),
    ]

    func answers(_ type: WireRequest) -> Bool { features.contains(type.rawValue) }
    func releaseList() {
        release?.resume()
        release = nil
    }
    private var snapshot: JSONValue {
        .object([
            "accounts": .object(accounts), "loginCommands": .object(["claude": .string("claude auth login")]),
            "statuses": .array(status.map { [AccountsWire.status(statusID, kind: providerKind, state: $0)] } ?? []),
            "silentLogins": .array(silentLogins.map(JSONValue.string)),
        ])
    }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        switch type {
        case .providerList:
            return ProviderWire.list([ProviderWire.provider(providerKind, name: "Agent")])
        case .accountsList:
            let value = snapshot
            if holdList {
                holdList = false
                await withCheckedContinuation { continuation in
                    release = continuation
                    listHeld?()
                }
            }
            return value
        case .accountsSave:
            if refuseSave { throw MachineClientError.invalid("Save refused") }
            accounts = payload["accounts"]!.objectValue!
            return snapshot
        case .accountsCreate:
            accounts["new-account"] = .object(["kind": .string("claude"), "label": payload["label"]!])
            return snapshot.setting("id", .string("new-account"))
        case .projectNewChat:
            return .object(["summary": ProjectRowWire.summary("chats", scratch: true), "viewId": .string("chat")])
        case .accountsRefresh: return snapshot
        default: return .object([:])
        }
    }
    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
