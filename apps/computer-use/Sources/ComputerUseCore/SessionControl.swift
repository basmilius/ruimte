import Foundation

/// Who holds the Mac during a session.
public enum SessionMode: String, Sendable {
    case running
    case paused
    case takenOver
}

/// A button of the session bar, pressed there or from Ruimte: the same three wherever the person is.
public enum SessionAction: String, Sendable {
    case pause
    case resume
    case stop

    /// Whether pressing it now changes anything; a pause while paused is not a resume, and nothing acts without a session.
    public func applies(to control: SessionControl) -> Bool {
        guard control.isActive else {
            return false
        }
        switch self {
        case .pause:
            return control.mode == .running
        case .resume:
            return control.mode != .running
        case .stop:
            return true
        }
    }
}

/// The person's control over a session and the clock of the session bar, apart from anything on screen.
/// Times are seconds on one monotonic clock that the caller supplies.
public struct SessionControl: Sendable {
    public private(set) var isActive = false
    public private(set) var mode = SessionMode.running
    /// Set by the person's stop; only a new `state` clears it, so an agent that missed the stop cannot carry on.
    public private(set) var stopped = false
    /// The last state the agent showed or set, kept while paused so resuming shows it again.
    public private(set) var agentState = PhantomState.idle
    private var runningSince: TimeInterval?
    private var banked: TimeInterval = 0

    public init() {}

    public var shownState: PhantomState {
        switch mode {
        case .running:
            return agentState
        case .paused:
            return .paused
        case .takenOver:
            return .takeover
        }
    }

    /// Why an agent command may not run now; nil when it may.
    public var refusal: AgentError? {
        if stopped {
            return .stopped
        }
        switch mode {
        case .running:
            return nil
        case .paused:
            return .paused
        case .takenOver:
            return .takenOver
        }
    }

    /// How the session stands, for the `session` of a `doctor` reply.
    public var summary: [String: Any] {
        ["active": isActive, "mode": mode.rawValue, "stopped": stopped]
    }

    /// The person's hand on the mouse takes over only while the agent is the one acting.
    public var acceptsTakeover: Bool {
        isActive && mode == .running && !agentState.waitsOnPerson && agentState != .done
    }

    public mutating func begin(at now: TimeInterval) {
        guard !isActive else {
            return
        }
        isActive = true
        mode = .running
        banked = 0
        runningSince = now
    }

    public mutating func end(at now: TimeInterval) {
        bank(at: now)
        isActive = false
        mode = .running
        agentState = .idle
    }

    public mutating func show(_ state: PhantomState) {
        agentState = state
    }

    public mutating func pause(at now: TimeInterval) {
        hold(.paused, at: now)
    }

    public mutating func takeOver(at now: TimeInterval) {
        hold(.takenOver, at: now)
    }

    public mutating func resume(at now: TimeInterval) {
        guard isActive, mode != .running else {
            return
        }
        mode = .running
        runningSince = now
    }

    public mutating func togglePause(at now: TimeInterval) {
        if mode == .running {
            pause(at: now)
        } else {
            resume(at: now)
        }
    }

    public mutating func stop(at now: TimeInterval) {
        stopped = true
        end(at: now)
    }

    public mutating func clearStop() {
        stopped = false
    }

    /// Time the agent held the Mac: the clock stands still while paused or taken over.
    public func elapsed(at now: TimeInterval) -> TimeInterval {
        banked + (runningSince.map { max(0, now - $0) } ?? 0)
    }

    private mutating func hold(_ newMode: SessionMode, at now: TimeInterval) {
        guard isActive, mode != newMode else {
            return
        }
        bank(at: now)
        mode = newMode
    }

    private mutating func bank(at now: TimeInterval) {
        if let runningSince {
            banked += max(0, now - runningSince)
        }
        runningSince = nil
    }

    /// `mm:ss`, and `h:mm:ss` from an hour on.
    public static func clock(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let rest = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, rest)
        }
        return String(format: "%02d:%02d", minutes, rest)
    }
}
