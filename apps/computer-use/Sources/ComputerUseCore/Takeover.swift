import Foundation

/// Whether the person's own hand on the mouse takes the session over. A click anywhere does. Movement only does
/// when it covers more than `distance` points within `window` seconds inside the app the agent operates, so a
/// person who reaches for Ruimte to read along, or bumps the desk, leaves the agent at work.
public struct TakeoverDetector: Sendable {
    public static let distance: CGFloat = 12
    public static let window: TimeInterval = 0.5
    private var moves: [(time: TimeInterval, distance: CGFloat)] = []

    public init() {}

    public mutating func reset() {
        moves.removeAll()
    }

    /// Notes one event of the person's, at a time in seconds on one monotonic clock; true when it takes over.
    public mutating func note(press: Bool, distance: CGFloat, inside: Bool, at now: TimeInterval) -> Bool {
        if press {
            reset()
            return true
        }
        moves.removeAll { now - $0.time > Self.window }
        guard inside else {
            return false
        }
        moves.append((time: now, distance: distance))
        return moves.reduce(0) { $0 + $1.distance } > Self.distance
    }
}
