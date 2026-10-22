import Foundation

/// How loud the microphone and the reply are now, each from 0 to 1, as WebRTC's `audioLevel` gives them.
public struct VoiceLevels: Sendable, Equatable {
    public let person: Double
    public let voice: Double

    public init(person: Double, voice: Double) {
        self.person = person
        self.voice = voice
    }

    public static let silent = VoiceLevels(person: 0, voice: 0)

    /// The microphone is the audio `media-source` and the reply the audio `inbound-rtp`, as a stats report of the
    /// peer names them. A report without one reads that side as silent.
    public static func read(_ stats: [(type: String, values: [String: Any])]) -> VoiceLevels {
        func level(_ type: String) -> Double {
            stats.lazy.filter { entry in
                entry.type == type && (entry.values["kind"] as? String ?? entry.values["mediaType"] as? String) == "audio"
            }.compactMap { ($0.values["audioLevel"] as? NSNumber)?.doubleValue }.first ?? 0
        }
        return VoiceLevels(person: level("media-source"), voice: level("inbound-rtp"))
    }
}

/// The last levels the band drew, oldest first, so it scrolls along with the conversation. Each value is already the
/// height a bar takes, from 0 to 1.
public struct VoiceLevelHistory: Sendable, Equatable {
    public static let kept = 48

    public private(set) var person: [Double] = Array(repeating: 0, count: kept)
    public private(set) var voice: [Double] = Array(repeating: 0, count: kept)

    public init() {}

    public mutating func add(_ levels: VoiceLevels) {
        person.append(Self.height(levels.person))
        voice.append(Self.height(levels.voice))
        person.removeFirst(person.count - Self.kept)
        voice.removeFirst(voice.count - Self.kept)
    }

    public mutating func clear() {
        self = VoiceLevelHistory()
    }

    /// `audioLevel` is linear, and speech sits low on it, so the square root lifts a quiet voice into view.
    static func height(_ level: Double) -> Double {
        min(1, max(0, level).squareRoot() * 1.3)
    }
}
