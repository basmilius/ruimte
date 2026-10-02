import RuimtePulsar
import XCTest

@testable import Ruimte

final class ChatPreferencesTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let name = "ChatPreferencesTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @MainActor func testUntouchedPreferencesAreOlderThanAnyPick() {
        let preferences = ChatPreferences(defaults: defaults())
        XCTAssertEqual(
            preferences.payload,
            .object(["runtimeMode": .string("full-access"), "selections": .object([:]), "changedAt": .number(0)]))
    }

    @MainActor func testAPickIsKeptPerProviderAndSurvivesARestart() {
        let store = defaults()
        let preferences = ChatPreferences(defaults: store)
        var told = 0
        let stop = preferences.observe { told += 1 }
        let selection = JSONValue.object(["model": .string("opus"), "options": .object(["effort": .string("high")])])
        preferences.rememberSelection(selection, provider: "claude", now: Date(timeIntervalSince1970: 10))
        preferences.rememberRuntimeMode("supervised", now: Date(timeIntervalSince1970: 20))
        stop()
        preferences.rememberRuntimeMode("auto", now: Date(timeIntervalSince1970: 30))
        XCTAssertEqual(told, 2)
        let restored = ChatPreferences(defaults: store)
        XCTAssertEqual(restored.selections["claude"], selection)
        XCTAssertEqual(restored.runtimeMode, "auto")
        XCTAssertEqual(restored.changedAt, 30_000)
    }

    @MainActor func testWhatTheWireRefusesIsNeverRemembered() {
        let preferences = ChatPreferences(defaults: defaults())
        preferences.rememberSelection(.object(["model": .null, "options": .object([:])]), provider: "claude")
        preferences.rememberSelection(.object(["model": .string("gpt"), "options": .object([:])]), provider: "")
        preferences.rememberRuntimeMode("plan")
        XCTAssertTrue(preferences.selections.isEmpty)
        XCTAssertEqual(preferences.changedAt, 0)
    }

    @MainActor func testAnAccountIsRememberedPerMachineAndCLIAndSurvivesARestart() {
        let store = defaults()
        let preferences = ChatPreferences(defaults: store)
        preferences.rememberAccount("work", provider: "claude", machineID: "mac", now: Date(timeIntervalSince1970: 10))
        preferences.rememberAccount("spare", provider: "codex", machineID: "mac")
        preferences.rememberAccount("home", provider: "claude", machineID: "mini")
        let restored = ChatPreferences(defaults: store)
        XCTAssertEqual(restored.account(machineID: "mac", provider: "claude", accounts: nil), "work")
        XCTAssertEqual(restored.account(machineID: "mini", provider: "claude", accounts: nil), "home")
        XCTAssertNil(restored.account(machineID: "mini", provider: "codex", accounts: nil))
        restored.rememberAccount("claude", provider: "claude", machineID: "mini")
        XCTAssertNil(restored.accounts["mini"])
    }

    @MainActor func testAMachineIsToldOnlyItsOwnPicksAndNoneItTurnedOff() {
        let preferences = ChatPreferences(defaults: defaults())
        preferences.rememberAccount("work", provider: "claude", machineID: "mac", now: Date(timeIntervalSince1970: 10))
        preferences.rememberAccount("spare", provider: "codex", machineID: "mac", now: Date(timeIntervalSince1970: 10))
        let accounts = ProviderAccountList(entries: [
            ProviderAccountEntry(id: "work", kind: "claude"),
            ProviderAccountEntry(id: "spare", kind: "codex", enabled: false),
        ])
        XCTAssertEqual(
            preferences.payload(machineID: "mac", accounts: accounts)["accounts"],
            .object(["claude": .string("work")]))
        XCTAssertEqual(
            preferences.payload(machineID: "mac", accounts: nil)["accounts"],
            .object(["claude": .string("work"), "codex": .string("spare")]))
        XCTAssertNil(preferences.payload(machineID: "mini", accounts: nil)["accounts"])
    }
}
