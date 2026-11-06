import Foundation

/// What Voice's Live Activity shows while a session runs on this phone. The app starts, updates and ends it itself;
/// no push ever reaches it.
public struct VoiceLiveContent: Codable, Hashable, Sendable {
    public enum Phase: String, Codable, Hashable, Sendable {
        case connecting
        case listening
        case speaking
        /// An action runs on the machine, named by `action`.
        case acting
        case stopping
        case ended
    }

    public var phase: Phase
    public var muted: Bool
    public var action: String?
    public var project: String?
    /// When the conversation began, for the timer; nil while it connects.
    public var startedAt: Date?
    /// Why it ended, when a problem ended it.
    public var problem: String?

    public init(
        phase: Phase, muted: Bool = false, action: String? = nil, project: String? = nil, startedAt: Date? = nil,
        problem: String? = nil
    ) {
        self.phase = phase
        self.muted = muted
        self.action = action
        self.project = project
        self.startedAt = startedAt
        self.problem = problem
    }
}

/// A session never moves to another machine, so the machine's name is fixed for the activity.
public struct VoiceLiveAttributes: Codable, Hashable, Sendable {
    public var machine: String

    public init(machine: String) {
        self.machine = machine
    }

    /// Opens the Voice sheet of the app.
    public static let url = URL(string: "ruimte://voice")!
}

#if os(iOS) && canImport(ActivityKit)
    import ActivityKit

    extension VoiceLiveAttributes: ActivityAttributes {
        public typealias ContentState = VoiceLiveContent
    }
#endif
