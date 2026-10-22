import ActivityKit
import Foundation
import RuimtePulsar

/// Voice's Live Activity on this phone. The app starts, updates and ends it itself; no push token is asked for.
/// `Activity` is not sendable, so only its id stays on the main actor and every change finds it again by that id.
@MainActor final class VoiceLiveActivities: VoiceLivePresenting {
    /// How long the final state stands on the lock screen before it goes.
    static let endedFor: TimeInterval = 4

    private var activityID: String?
    private var work: Task<Void, Never>?

    init() {
        // A session never outlives the process, so an activity an earlier one left behind is stale.
        enqueue { await VoiceLiveCommands.endAll() }
    }

    func show(_ content: VoiceLiveContent, machine: String) {
        enqueue { [weak self] in
            guard let self else { return }
            if let activityID, await Self.update(id: activityID, to: content) { return }
            // Asking needs the app in the foreground; one that could not start then tries again at the next change.
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            activityID =
                (try? Activity.request(
                    attributes: VoiceLiveAttributes(machine: machine),
                    content: ActivityContent(state: content, staleDate: nil), pushType: nil))?.id
        }
    }

    func end(_ content: VoiceLiveContent) {
        enqueue { [weak self] in
            guard let self, let activityID else { return }
            self.activityID = nil
            await Self.end(id: activityID, with: content)
        }
    }

    /// One change after the other, so an end never overtakes the update before it.
    private func enqueue(_ change: @escaping @MainActor () async -> Void) {
        let previous = work
        work = Task { @MainActor in
            await previous?.value
            await change()
        }
    }

    private nonisolated static func update(id: String, to content: VoiceLiveContent) async -> Bool {
        guard let activity = Activity<VoiceLiveAttributes>.activities.first(where: { $0.id == id }),
            activity.activityState == .active
        else { return false }
        await activity.update(ActivityContent(state: content, staleDate: nil))
        return true
    }

    private nonisolated static func end(id: String, with content: VoiceLiveContent) async {
        guard let activity = Activity<VoiceLiveAttributes>.activities.first(where: { $0.id == id }) else { return }
        await activity.end(
            ActivityContent(state: content, staleDate: nil),
            dismissalPolicy: .after(Date().addingTimeInterval(endedFor)))
    }
}
