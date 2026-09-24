import Foundation

/// What the phantom cursor shows, in the order of the design.
public enum PhantomState: String, CaseIterable, Sendable {
    case idle
    case move
    case hover
    case click
    case drag
    case type
    case scroll
    case look
    case think
    case waiting
    case permission
    case error
    case done
    case takeover
    case paused
    case tap

    /// What a caller sets with `presence`: the helper cannot see these itself. The action states it sets from the commands it runs.
    public static let presenceStates: [PhantomState] = [.think, .waiting, .permission, .error, .done]

    public var isAction: Bool {
        switch self {
        case .move, .hover, .click, .drag, .type, .scroll, .look, .tap:
            return true
        default:
            return false
        }
    }

    /// The agent waits for the person, so the person's hand on the mouse is expected and not taking over.
    public var waitsOnPerson: Bool {
        self == .waiting || self == .permission
    }
}

/// What `presence` asks for: a state to show, or the end of the session for an agent that went without finishing.
public enum PresenceRequest: Equatable, Sendable {
    case show(PhantomState)
    case end

    public static let names = PhantomState.presenceStates.map(\.rawValue) + ["end"]

    public init?(_ name: String?) {
        if name == "end" {
            self = .end
        } else if let name, let state = PhantomState(rawValue: name), PhantomState.presenceStates.contains(state) {
            self = .show(state)
        } else {
            return nil
        }
    }
}

public enum ScrollDirection: String, Sendable {
    case up
    case down
    case left
    case right
}
