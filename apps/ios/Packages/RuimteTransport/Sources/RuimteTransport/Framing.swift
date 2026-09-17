import Foundation
import RuimtePulsar

public enum FramePiece: Equatable {
    case partial
    case frame(String)
    case invalid
}

public enum DirectFraming {
    // Deployed daemons send complete chat histories, which can exceed the WebSocket default of 16 Mi characters.
    public static let authenticatedFrameChars = 64 * 1_024 * 1_024
    public static let handshakeFrameChars = 4_096

    public static func split(_ frame: String, pieceChars: Int = WireConstants.directPieceChars) -> [String] {
        precondition(pieceChars >= 2)
        let units = frame.utf16
        let unitCount = units.count
        if unitCount <= pieceChars {
            return ["=" + frame]
        }
        var pieces: [String] = []
        pieces.reserveCapacity(unitCount / pieceChars + (unitCount.isMultiple(of: pieceChars) ? 0 : 1))
        var start = units.startIndex
        while start < units.endIndex {
            var end = units.index(start, offsetBy: pieceChars, limitedBy: units.endIndex) ?? units.endIndex
            if end < units.endIndex {
                let previous = units.index(before: end)
                if (0xD800...0xDBFF).contains(units[previous]) {
                    end = previous
                }
            }
            pieces.append((end == units.endIndex ? "=" : "+") + String(decoding: units[start..<end], as: UTF16.self))
            start = end
        }
        return pieces
    }
}

public struct FrameAssembler {
    public enum Failure: Equatable {
        case missingMarker
        case tooLarge(limit: Int)
    }

    private var parts: [String] = []
    private var length = 0
    public private(set) var failure: Failure?

    public init() {}

    public mutating func push(_ piece: String, maxChars: Int) -> FramePiece {
        failure = nil
        guard let mark = piece.unicodeScalars.first, mark == "+" || mark == "=" else {
            failure = .missingMarker
            parts.removeAll()
            length = 0
            return .invalid
        }
        let body = String(piece.unicodeScalars.dropFirst())
        length += body.utf16.count
        if length > maxChars {
            failure = .tooLarge(limit: maxChars)
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

    public init(
        now: Double, idleMs: Double = WireConstants.directPingIdleMs,
        timeoutMs: Double = WireConstants.directPingTimeoutMs
    ) {
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
