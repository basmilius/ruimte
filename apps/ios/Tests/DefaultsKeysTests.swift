import XCTest

@testable import Ruimte

/// These strings are stored on every install and written by the Notification Service extension, so a rename would
/// drop a person's settings or leave a notification unmatched.
final class DefaultsKeysTests: XCTestCase {
    func testSettingsKeepTheirStoredNamesAndDefaults() {
        XCTAssertEqual(Settings.appearance.name, "ruimte.ios.appearance")
        XCTAssertEqual(Settings.appearance.fallback, "system")
        XCTAssertEqual(Settings.terminalFontSize.name, "ruimte.ios.terminalFontSize")
        XCTAssertEqual(Settings.terminalFontSize.fallback, 14.0)
        XCTAssertEqual(Settings.showHiddenFiles.name, "ruimte.ios.showHiddenFiles")
        XCTAssertFalse(Settings.showHiddenFiles.fallback)
        XCTAssertEqual(Settings.chatStreaming.name, "ruimte.chat.streaming")
        XCTAssertEqual(Settings.chatStreaming.fallback, .words)
    }

    func testHidingToolCallsKeepsTheNameItIsStoredUnder() {
        XCTAssertEqual(ChatToolCallsSetting.key, "ruimte.chat.hideToolCalls")
    }

    func testTheProjectsCacheIsKeptPerMachine() {
        XCTAssertEqual(ProjectsCache.key(machineID: "m1"), "ruimte.ios.projects.m1")
        XCTAssertEqual(ProjectsCache.publicKeyKey(machineID: "m1"), "ruimte.ios.projects.m1.publicKey")
    }

    func testNotificationKeysMatchWhatTheExtensionWrites() {
        XCTAssertEqual(NotificationKeys.envelope, "ruimte")
        XCTAssertEqual(NotificationKeys.seenKey, "ruimte.seenKey")
        XCTAssertEqual(NotificationKeys.issuedAt, "ruimte.issuedAt")
        XCTAssertEqual(NotificationCategory.approval, "ruimte.approval")
        XCTAssertEqual(NotificationCategory.approvalRemember, "ruimte.approval.remember")
    }
}
