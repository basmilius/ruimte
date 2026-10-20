import Foundation
import RuimtePulsar

/// Who said a caption: the person into the microphone, or the model in its reply.
public enum VoiceSpeaker: String, Sendable, Equatable {
    case person
    case model
}

/// One piece of a transcript as GPT-Live sends it on the `oai-events` channel, with the times the service gives it.
public struct LiveCaption: Sendable, Equatable {
    public let speaker: VoiceSpeaker
    public let delta: String
    public let startMs: Double
    public let endMs: Double

    public init(speaker: VoiceSpeaker, delta: String, startMs: Double, endMs: Double) {
        self.speaker = speaker
        self.delta = delta
        self.startMs = startMs
        self.endMs = endMs
    }
}

/// What the phone does with an event of the service. The daemon runs every tool call on its own side band, so a
/// function call that also reaches the phone is ignored here and never answered.
public enum LiveServiceEvent: Sendable, Equatable {
    case caption(LiveCaption)
    case started
    /// The service ended the session with an error; what it said stays out of the app, which may show it.
    case failed
    case ignored

    public static func parse(_ text: String) -> LiveServiceEvent {
        parse(Data(text.utf8))
    }

    public static func parse(_ data: Data) -> LiveServiceEvent {
        guard let event = try? JSONValue.decode(data), let type = event["type"]?.stringValue else { return .ignored }
        switch type {
        case "session.started":
            return .started
        case "session.error":
            return .failed
        case "session.input_transcript.delta", "session.output_transcript.delta":
            guard let delta = event["delta"]?.stringValue, !delta.isEmpty else { return .ignored }
            return .caption(
                LiveCaption(
                    speaker: type == "session.input_transcript.delta" ? .person : .model, delta: delta,
                    startMs: event["start_ms"]?.numberValue ?? 0, endMs: event["end_ms"]?.numberValue ?? 0))
        default:
            return .ignored
        }
    }
}

/// A line of the transcript: what one speaker said in a row, and whether the person spoke over the model's reply.
public struct VoiceUtterance: Sendable, Equatable, Identifiable {
    public let id: Int
    public let speaker: VoiceSpeaker
    public internal(set) var text: String
    public let startMs: Double
    public internal(set) var endMs: Double
    public internal(set) var interrupted: Bool
}

/// The captions of one Voice session, put together the way the desktop's transcript is: deltas of the same speaker
/// join the line they continue, and a person who starts within 750 ms of the reply's end interrupted it. Only the last
/// lines are kept, since the phone shows captions and not a record of the conversation.
public struct VoiceTranscript: Sendable, Equatable {
    public static let keptLines = 40
    /// How close behind the model's last word the person's first one counts as speaking over it.
    static let overlapMs: Double = 750

    public private(set) var lines: [VoiceUtterance] = []
    private var nextID = 0

    public init() {}

    /// The line the caption bar shows: the one being spoken now.
    public var current: VoiceUtterance? { lines.last }

    public mutating func add(_ caption: LiveCaption) {
        guard !caption.delta.isEmpty else { return }
        if caption.speaker == .person, let last = lines.last, last.speaker == .model, !last.interrupted,
            caption.startMs <= last.endMs + Self.overlapMs
        {
            lines[lines.count - 1].interrupted = true
        }
        if let last = lines.last, last.speaker == caption.speaker {
            lines[lines.count - 1].text += caption.delta
            lines[lines.count - 1].endMs = max(last.endMs, caption.endMs)
            return
        }
        let text = String(caption.delta.drop { $0.isWhitespace })
        guard !text.isEmpty else { return }
        lines.append(
            VoiceUtterance(
                id: nextID, speaker: caption.speaker, text: text, startMs: caption.startMs, endMs: caption.endMs,
                interrupted: false))
        nextID += 1
        if lines.count > Self.keptLines { lines.removeFirst(lines.count - Self.keptLines) }
    }

    public mutating func clear() {
        lines.removeAll()
    }
}
