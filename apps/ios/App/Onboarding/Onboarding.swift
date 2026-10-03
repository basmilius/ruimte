import Foundation
import Observation

enum OnboardingStep: Equatable {
    case welcome
    case notifications
    case home
}

/// The first run: the welcome until there is an account or a machine, then the notification step, once a machine is
/// there. That step only follows a way in a person took from the welcome, so a phone that was set up before it existed
/// is never asked, and it stays asked across a relaunch until it is answered.
@MainActor @Observable
final class Onboarding {
    static let storageKey = "ruimte.ios.onboarding.notifications"

    private let defaults: UserDefaults
    private(set) var asksForNotifications: Bool

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        asksForNotifications = defaults.bool(forKey: Self.storageKey)
    }

    func begin() {
        guard !asksForNotifications else { return }
        asksForNotifications = true
        defaults.set(true, forKey: Self.storageKey)
    }

    func finish() {
        guard asksForNotifications else { return }
        asksForNotifications = false
        defaults.removeObject(forKey: Self.storageKey)
    }

    func step(signedIn: Bool, machines: Int, notificationsEnabled: Bool) -> OnboardingStep {
        Self.step(
            signedIn: signedIn, machines: machines, asksForNotifications: asksForNotifications,
            notificationsEnabled: notificationsEnabled)
    }

    /// An account without machines goes home as well, since its machines may still arrive; the step waits for them.
    nonisolated static func step(
        signedIn: Bool, machines: Int, asksForNotifications: Bool, notificationsEnabled: Bool
    ) -> OnboardingStep {
        if !signedIn && machines == 0 {
            return .welcome
        }
        if asksForNotifications && machines > 0 && !notificationsEnabled {
            return .notifications
        }
        return .home
    }

    /// The line above the notification step, or nil before any machine is there.
    nonisolated static func connected(_ names: [String]) -> String? {
        switch names.count {
        case 0: nil
        case 1: "\(names[0]) is connected"
        default: "\(names.count) machines are connected"
        }
    }
}
