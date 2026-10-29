import RuimtePulsar
import XCTest

@testable import Ruimte

final class NotificationPreferencesTests: XCTestCase {
    func testWithoutChoicesAMachineHearsOfWhatNeedsYouAndNoProject() {
        let preferences = NotificationPreferences()
        XCTAssertEqual(
            preferences.subscription(machineID: "studio"),
            ["notify": .array([.string("needs-you")]), "projects": .array([])])
    }

    @MainActor func testTheSubscriptionFollowsEveryNodeWithoutListingAny() {
        var preferences = NotificationPreferences()
        preferences.set(.off, machineID: "studio", projectID: "recipes")
        let payload = NotificationCoordinator.subscription(
            handle: "handle", publicKey: "key", approvals: true, activities: false, preferences: preferences,
            machineID: "studio")
        XCTAssertEqual(
            payload,
            .object([
                "handle": .string("handle"), "publicKey": .string("key"), "follow": .array([]),
                "followAll": .bool(true), "approvals": .bool(true), "readSync": .bool(true),
                "activities": .bool(false), "activityScope": .string("machine"),
                "notify": .array([.string("needs-you")]),
                "projects": .array([.object(["projectId": .string("recipes"), "notify": .array([])])]),
            ]))
    }

    func testAllIsNoEntryNeedsYouOnlyIsOneKindAndOffIsEmpty() {
        var preferences = NotificationPreferences(notify: [.process, .needsYou, .turn])
        preferences.set(.needsYou, machineID: "studio", projectID: "recipes")
        preferences.set(.off, machineID: "studio", projectID: "portfolio")
        preferences.set(.all, machineID: "studio", projectID: "site")
        preferences.set(.off, machineID: "laptop", projectID: "elsewhere")
        XCTAssertEqual(
            preferences.subscription(machineID: "studio"),
            [
                "notify": .array([.string("needs-you"), .string("turn"), .string("process")]),
                "projects": .array([
                    .object(["projectId": .string("portfolio"), "notify": .array([])]),
                    .object(["projectId": .string("recipes"), "notify": .array([.string("needs-you")])]),
                ]),
            ])
        XCTAssertEqual(preferences.choice(machineID: "studio", projectID: "site"), .all)
        XCTAssertEqual(preferences.choice(machineID: "laptop", projectID: "elsewhere"), .off)
    }

    func testChoosingAllAgainDropsTheEntry() {
        var preferences = NotificationPreferences()
        preferences.set(.off, machineID: "studio", projectID: "recipes")
        preferences.set(.all, machineID: "studio", projectID: "recipes")
        XCTAssertEqual(preferences.projects, [:])
    }

    func testAMachinesEntriesReadAsTheThreeChoices() {
        XCTAssertEqual(ProjectNotifyChoice(kinds: []), .off)
        XCTAssertEqual(ProjectNotifyChoice(kinds: ["needs-you"]), .needsYou)
        XCTAssertEqual(ProjectNotifyChoice(kinds: ["needs-you", "turn"]), .all)
        XCTAssertEqual(ProjectNotifyChoice(kinds: ["a-kind-from-later"]), .all)
    }

    func testAdoptingTakesTheMachinesProjectsAndOnlyWhenAskedItsKinds() {
        var preferences = NotificationPreferences()
        let result = JSONValue.object([
            "subscribed": .bool(true), "approvals": .bool(true), "notify": .array([.string("turn")]),
            "projects": .array([
                .object(["projectId": .string("recipes"), "notify": .array([])]),
                .object(["projectId": .string("site"), "notify": .array([.string("needs-you"), .string("turn")])]),
            ]),
        ])
        preferences.adopt(result, machineID: "studio", kinds: false)
        XCTAssertEqual(preferences.notify, [.needsYou])
        XCTAssertEqual(preferences.projects, ["studio": ["recipes": .off]])
        preferences.adopt(result, machineID: "studio", kinds: true)
        XCTAssertEqual(preferences.notify, [.turn])
    }

    func testAMachineWithoutASubscriptionChangesNothing() {
        var preferences = NotificationPreferences()
        preferences.set(.off, machineID: "studio", projectID: "recipes")
        preferences.adopt(
            .object(["subscribed": .bool(false), "approvals": .bool(false), "notify": .array([]), "projects": .array([])]),
            machineID: "studio", kinds: true)
        XCTAssertEqual(preferences.projects, ["studio": ["recipes": .off]])
        XCTAssertEqual(preferences.notify, [.needsYou])
    }

    func testPreferencesSurviveARestart() {
        let name = "NotificationPreferencesTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        XCTAssertNil(NotificationPreferences.load(defaults))
        var preferences = NotificationPreferences(notify: [.turn])
        preferences.set(.needsYou, machineID: "studio", projectID: "recipes")
        preferences.save(defaults)
        XCTAssertEqual(NotificationPreferences.load(defaults), preferences)
    }
}

private actor FakeAccountAPI: AccountAPI {
    var result: AccountResult?
    var refusal: AddressBookRequestError?
    private(set) var deletions: [AccountDeletePayload] = []

    init(result: AccountResult? = nil) {
        self.result = result
    }

    func refuse(_ code: String?) {
        refusal = code.map { AddressBookRequestError(code: $0, status: 400, message: "Refused") }
    }

    func account(accessToken: String) async throws -> AccountResult {
        guard let result else { throw AddressBookRequestError(code: "network", status: 0, message: "Offline") }
        return result
    }

    func deleteAccount(accessToken: String, payload: AccountDeletePayload) async throws {
        deletions.append(payload)
        if let refusal { throw refusal }
    }
}

@MainActor final class AccountDeletionTests: XCTestCase {
    private let github = Account(id: "a", provider: .github, login: "someone", displayName: .value("Bas Milius"))
    private var signedOut = 0
    private var appleCodes = 0

    private func model(_ api: FakeAccountAPI, account: Account? = nil, appleCancelled: Bool = false)
        -> AccountDeletionModel
    {
        AccountDeletionModel(
            account: account ?? github, api: api, accessToken: { "token" },
            appleCode: {
                self.appleCodes += 1
                if appleCancelled { throw LoginError.cancelled }
                return "apple-code"
            },
            signOut: { self.signedOut += 1 })
    }

    func testNothingIsSentUntilTheNameIsTyped() async {
        let api = FakeAccountAPI()
        let deletion = model(api)
        deletion.typed = "Bas"
        XCTAssertFalse(deletion.confirmed)
        await deletion.delete()
        let sent = await api.deletions
        XCTAssertTrue(sent.isEmpty)
        XCTAssertEqual(signedOut, 0)
    }

    func testATypedNameDeletesAndSignsOut() async {
        let api = FakeAccountAPI()
        let deletion = model(api)
        deletion.typed = " bas milius"
        await deletion.delete()
        let sent = await api.deletions
        XCTAssertEqual(sent, [AccountDeletePayload(confirmation: " bas milius")])
        XCTAssertTrue(deletion.deleted)
        XCTAssertEqual(signedOut, 1)
        XCTAssertEqual(appleCodes, 0)
    }

    func testAnAppleIdentityOnTheAccountSendsAFreshCode() async {
        let api = FakeAccountAPI(
            result: AccountResult(
                account: github,
                identities: [
                    Identity(provider: .github, login: "someone", createdAt: 1),
                    Identity(provider: .apple, login: nil, createdAt: 2),
                ]))
        let deletion = model(api)
        await deletion.load()
        XCTAssertTrue(deletion.usesApple)
        deletion.typed = "Bas Milius"
        await deletion.delete()
        let sent = await api.deletions
        XCTAssertEqual(sent, [AccountDeletePayload(confirmation: "Bas Milius", appleAuthorizationCode: "apple-code")])
        XCTAssertEqual(appleCodes, 1)
    }

    func testANamelessAppleAccountAsksForTheWordAndStopsWhenAppleIsCancelled() async {
        let api = FakeAccountAPI()
        let deletion = model(api, account: Account(id: "a", provider: .apple, login: nil), appleCancelled: true)
        XCTAssertTrue(deletion.asksForWord)
        XCTAssertEqual(deletion.confirmationName, "DELETE")
        deletion.typed = "delete"
        await deletion.delete()
        let sent = await api.deletions
        XCTAssertTrue(sent.isEmpty)
        XCTAssertNil(deletion.problem)
        XCTAssertEqual(signedOut, 0)
    }

    func testARefusalSaysWhyAndKeepsTheAccount() async {
        let api = FakeAccountAPI()
        await api.refuse("apple-revocation-failed")
        let deletion = model(api, account: Account(id: "a", provider: .apple, login: nil))
        deletion.typed = "DELETE"
        await deletion.delete()
        XCTAssertEqual(
            deletion.problem, "Apple did not end Sign in with Apple for Ruimte, so your account is still here. Try again.")
        XCTAssertFalse(deletion.deleted)
        XCTAssertEqual(signedOut, 0)

        await api.refuse("confirmation-mismatch")
        await deletion.delete()
        XCTAssertEqual(deletion.problem, "That is not the name of this account. Type DELETE to delete it.")

        await api.refuse(nil)
        await deletion.delete()
        XCTAssertNil(deletion.problem)
        XCTAssertEqual(signedOut, 1)
        XCTAssertEqual(appleCodes, 3)
    }

    func testTheAddressBookUnreachableKeepsTheAccountThisPhoneKnows() async {
        let deletion = model(FakeAccountAPI())
        await deletion.load()
        XCTAssertEqual(deletion.confirmationName, "Bas Milius")
        XCTAssertFalse(deletion.usesApple)
    }
}

@MainActor final class MachineAgentsTests: XCTestCase {
    func testASwitchKeepsANameNobodyChoseUnchosen() {
        let endpoint = JSONValue.object([
            "label": .string("studio.local"), "nameSource": .string("default"), "icon": .null,
        ])
        XCTAssertEqual(
            MachineAgentsModel.identityPayload(endpoint: endpoint, key: "resumeAtReset", value: true),
            .object(["name": .null, "icon": .null, "resumeAtReset": .bool(true)]))
        let named = JSONValue.object([
            "label": .string("Studio"), "nameSource": .string("chosen"),
            "icon": .object(["kind": .string("lucide"), "value": .string("monitor")]),
        ])
        XCTAssertEqual(
            MachineAgentsModel.identityPayload(endpoint: named, key: "agentsDeleteAnyView", value: false),
            .object([
                "name": .string("Studio"), "icon": .object(["kind": .string("lucide"), "value": .string("monitor")]),
                "agentsDeleteAnyView": .bool(false),
            ]))
    }

    func testInstalledAgentsCarryTheirAccountsInOneLine() {
        let providers: [JSONValue] = [
            .object([
                "kind": .string("claude"), "name": .string("Claude Code"), "installed": .bool(true),
                "version": .string("2.0.14"), "capabilities": .object(["chat": .bool(true)]),
                "models": .array([
                    .object(["slug": .string("opus"), "legacy": .bool(false)]),
                    .object(["slug": .string("old"), "legacy": .bool(true)]),
                ]),
                "defaultModel": .string("opus"),
            ]),
            .object(["kind": .string("gemini"), "name": .string("Gemini"), "installed": .bool(false)]),
        ]
        let accounts = JSONValue.object([
            "accounts": .object([
                "claude": .object(["kind": .string("claude")]),
                "work": .object(["kind": .string("claude"), "label": .string("Work")]),
            ]),
            "statuses": .array([
                .object([
                    "id": .string("claude"), "state": .string("ready"), "plan": .string("Max"),
                    "email": .string("bas@example.com"),
                ]),
                .object(["id": .string("work"), "state": .string("signed-out")]),
            ]),
        ])
        let agents = MachineAgentsModel.agents(providers: providers, accounts: accounts)
        XCTAssertEqual(agents.map(\.kind), ["claude"])
        XCTAssertEqual(agents[0].models.map { $0.text("slug") }, ["opus"])
        XCTAssertEqual(agents[0].accounts.map(\.detail), ["Max · bas@example.com", "Not logged in"])
        XCTAssertEqual(agents[0].accounts.map(\.name), ["Claude Code", "Work"])
        XCTAssertTrue(agents[0].accounts[1].signedOut)
        XCTAssertEqual(agents[0].defaultAccount, "claude")
    }

    @MainActor func testTheAgentsSettingsFollowTheOrderAndTagTheTopAccountThatIsOn() {
        let providers: [JSONValue] = [.object(["kind": .string("claude"), "installed": .bool(true)])]
        let accounts = JSONValue.object([
            "accounts": .object([
                "claude": .object(["kind": .string("claude")]),
                "off": .object(["kind": .string("claude"), "order": .number(0), "enabled": .bool(false)]),
                "work": .object(["kind": .string("claude"), "order": .number(1)]),
            ]),
            "statuses": .array([]),
        ])
        let agents = MachineAgentsModel.agents(providers: providers, accounts: accounts)
        XCTAssertEqual(agents[0].accounts.map(\.id), ["off", "work", "claude"])
        XCTAssertEqual(agents[0].defaultAccount, "work")
        XCTAssertEqual(
            MachineAgentsModel.reorderPayload(kind: "claude", ids: ["work", "claude"]),
            .object(["kind": .string("claude"), "ids": .array([.string("work"), .string("claude")])]))
        let single = MachineAgentsModel.agents(
            providers: providers,
            accounts: .object(["accounts": .object(["claude": .object(["kind": .string("claude")])])]))
        XCTAssertNil(single[0].defaultAccount)
    }
}
