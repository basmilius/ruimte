import Foundation
import RuimtePulsar

public enum FramePiece: Equatable {
    case partial
    case frame(String)
    case invalid
}

public enum DirectFraming {
    public static func split(_ frame: String, pieceChars: Int = WireConstants.directPieceChars) -> [String] {
        precondition(pieceChars >= 2)
        let units = Array(frame.utf16)
        if units.count <= pieceChars {
            return ["=" + frame]
        }
        var pieces: [String] = []
        var start = 0
        while start < units.count {
            var end = min(start + pieceChars, units.count)
            if end < units.count && (0xD800...0xDBFF).contains(units[end - 1]) {
                end -= 1
            }
            pieces.append((end == units.count ? "=" : "+") + String(decoding: units[start..<end], as: UTF16.self))
            start = end
        }
        return pieces
    }
}

public struct FrameAssembler {
    private var parts: [String] = []
    private var length = 0

    public init() {}

    public mutating func push(_ piece: String, maxChars: Int) -> FramePiece {
        guard let mark = piece.unicodeScalars.first, mark == "+" || mark == "=" else {
            return .invalid
        }
        let body = String(piece.unicodeScalars.dropFirst())
        length += body.utf16.count
        if length > maxChars {
            parts.removeAll()
            length = 0
            return .invalid
        }
        parts.append(body)
        if mark == "+" {
            return .partial
        }
        let frame = parts.joined()
        parts.removeAll()
        length = 0
        return .frame(frame)
    }
}

public struct ChannelLiveness {
    public enum Action: Equatable {
        case none
        case ping(String)
        case dead
    }

    private var lastHeard: Double
    private var lastReceived: Double?
    private var pingSentAt: Double?
    private var nextID = 1
    private let idleMs: Double
    private let timeoutMs: Double

    public init(now: Double, idleMs: Double = WireConstants.directPingIdleMs, timeoutMs: Double = WireConstants.directPingTimeoutMs) {
        lastHeard = now
        self.idleMs = idleMs
        self.timeoutMs = timeoutMs
    }

    public mutating func heard(now: Double) {
        lastHeard = now
        pingSentAt = nil
    }

    public mutating func tick(now: Double, received: Double? = nil) -> Action {
        if let received {
            let grew = lastReceived.map { received > $0 } ?? false
            lastReceived = received
            if grew {
                heard(now: now)
                return .none
            }
        }
        if let pingSentAt {
            return now - pingSentAt >= timeoutMs ? .dead : .none
        }
        if now - lastHeard >= idleMs {
            pingSentAt = now
            let id = "alive-\(nextID)"
            nextID += 1
            return .ping(id)
        }
        return .none
    }
}
