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
}
