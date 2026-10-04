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
}
