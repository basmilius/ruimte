import XCTest

@testable import Ruimte

@MainActor final class OnboardingTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let name = "OnboardingTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    func testWelcomeComesUntilThereIsAnAccountOrAMachine() {
        let onboarding = Onboarding(defaults: defaults())
        onboarding.begin()
        XCTAssertEqual(onboarding.step(signedIn: false, machines: 0, notificationsEnabled: false), .welcome)
    }

    func testNotificationStepFollowsTheFirstMachine() {
        let onboarding = Onboarding(defaults: defaults())
        onboarding.begin()
        XCTAssertEqual(onboarding.step(signedIn: false, machines: 1, notificationsEnabled: false), .notifications)
        XCTAssertEqual(onboarding.step(signedIn: true, machines: 2, notificationsEnabled: false), .notifications)
    }

    func testAnAccountWithoutMachinesGoesHomeUntilOneArrives() {
        let onboarding = Onboarding(defaults: defaults())
        onboarding.begin()
        XCTAssertEqual(onboarding.step(signedIn: true, machines: 0, notificationsEnabled: false), .home)
        XCTAssertEqual(onboarding.step(signedIn: true, machines: 1, notificationsEnabled: false), .notifications)
    }

    func testAPhoneSetUpBeforeTheStepIsNeverAsked() {
        let onboarding = Onboarding(defaults: defaults())
        XCTAssertEqual(onboarding.step(signedIn: true, machines: 1, notificationsEnabled: false), .home)
    }

    func testNotificationsAlreadyOnSkipTheStep() {
        let onboarding = Onboarding(defaults: defaults())
        onboarding.begin()
        XCTAssertEqual(onboarding.step(signedIn: false, machines: 1, notificationsEnabled: true), .home)
    }

    func testEitherAnswerEndsTheStepForGood() {
        let store = defaults()
        let onboarding = Onboarding(defaults: store)
        onboarding.begin()
        onboarding.finish()
        XCTAssertEqual(onboarding.step(signedIn: false, machines: 1, notificationsEnabled: false), .home)
        XCTAssertEqual(Onboarding(defaults: store).step(signedIn: false, machines: 1, notificationsEnabled: false), .home)
    }

    func testAnUnansweredStepSurvivesARelaunch() {
        let store = defaults()
        Onboarding(defaults: store).begin()
        XCTAssertEqual(
            Onboarding(defaults: store).step(signedIn: false, machines: 1, notificationsEnabled: false),
            .notifications)
    }

    func testTheStepNamesTheConnectedMachines() {
        XCTAssertNil(Onboarding.connected([]))
        XCTAssertEqual(Onboarding.connected(["MacBook Pro"]), "MacBook Pro is connected")
        XCTAssertEqual(Onboarding.connected(["MacBook Pro", "Studio"]), "2 machines are connected")
    }

    func testAClipboardWithoutAWebAddressIsNeverRead() async {
        let pasteboard = FakePasteboard(webAddress: false, value: "https://machine.example/pair#token")
        let link = await PairingClipboard.link(in: pasteboard)
        XCTAssertNil(link)
        XCTAssertEqual(pasteboard.reads, 0)
    }

    func testAWebAddressThatIsNoPairingLinkIsIgnored() async {
        let pasteboard = FakePasteboard(webAddress: true, value: "https://example.com/docs")
        let link = await PairingClipboard.link(in: pasteboard)
        XCTAssertNil(link)
        XCTAssertEqual(pasteboard.reads, 1)
    }

    func testAPairingLinkOnTheClipboardIsTakenWithoutItsWhitespace() async {
        let pasteboard = FakePasteboard(webAddress: true, value: "  https://machine.example/pair#token\n")
        let link = await PairingClipboard.link(in: pasteboard)
        XCTAssertEqual(link, "https://machine.example/pair#token")
    }

    func testAnInsecureLinkOnTheClipboardIsIgnored() async {
        let pasteboard = FakePasteboard(webAddress: true, value: "http://machine.example/pair#token")
        let link = await PairingClipboard.link(in: pasteboard)
        XCTAssertNil(link)
    }

    func testTheClipboardFillsAnEmptyFieldAndSaysSo() async {
        let pairing = MachinePairing()
        await pairing.readClipboard(FakePasteboard(webAddress: true, value: "https://machine.example/pair#token"))
        XCTAssertEqual(pairing.text, "https://machine.example/pair#token")
        XCTAssertTrue(pairing.fromClipboard)
        XCTAssertTrue(pairing.canPair)
        pairing.text = "https://machine.example/pair#other"
        XCTAssertFalse(pairing.fromClipboard)
    }

    func testTheClipboardLeavesATypedLinkAlone() async {
        let pairing = MachinePairing()
        pairing.text = "https://typed.example/pair#mine"
        let pasteboard = FakePasteboard(webAddress: true, value: "https://machine.example/pair#token")
        await pairing.readClipboard(pasteboard)
        XCTAssertEqual(pairing.text, "https://typed.example/pair#mine")
        XCTAssertEqual(pasteboard.reads, 0)
    }
}

@MainActor private final class FakePasteboard: PairingPasteboard {
    let webAddress: Bool
    let value: String?
    private(set) var reads = 0

    init(webAddress: Bool, value: String?) {
        self.webAddress = webAddress
        self.value = value
    }

    func holdsWebAddress() async -> Bool { webAddress }

    func text() -> String? {
        reads += 1
        return value
    }
}
