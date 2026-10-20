import Foundation

/// What the media peer tells the session it carries.
public enum VoiceMediaEvent: Sendable, Equatable {
    case caption(LiveCaption)
    /// The service said the session started, so the model hears the microphone.
    case started
    /// The peer, its channel or the service ended without `close()`, as after a dropped network.
    case lost
}

/// The phone's own peer to OpenAI. The machine mints the session and hands the offer on, so the peer only makes an
/// offer, takes the answer and carries audio and captions; it runs no tool and sends nothing on its channel.
@MainActor public protocol VoiceMedia: AnyObject {
    /// Called on the main actor for every event, until `close()`.
    var onEvent: (@MainActor (VoiceMediaEvent) -> Void)? { get set }
    /// An offer with the microphone track and every candidate gathered, since the machine passes it on once.
    func offer() async throws -> String
    func accept(answer: String) async throws
    /// Ends the peer. No event follows.
    func close()
}

public enum MicrophonePermission: Sendable, Equatable {
    case undetermined
    case denied
    case granted
}

/// What happened to the app's audio while a session held it.
public enum VoiceAudioChange: Sendable, Equatable {
    /// A call, a timer or Siri took the audio. Voice ends, since the machine cannot pause a session.
    case interrupted
    /// The output moved, to Bluetooth or the speaker; the name is the new route's, as iOS calls it.
    case route(String)
    /// The media services restarted and every audio object went with them.
    case reset
}

public enum VoiceAudioFailure: Error, Sendable, Equatable {
    /// Another scene of this app has Voice running.
    case busy
    case microphoneDenied
    case unavailable(String)
}

/// The one audio session of the app. Only a running Voice session holds it, and only one at a time: an iPad scene
/// that asks while another holds it gets `busy` instead of taking the microphone over.
@MainActor public protocol VoiceAudio: AnyObject {
    var permission: MicrophonePermission { get }
    var onChange: (@MainActor (VoiceAudioChange) -> Void)? { get set }
    /// The scene that holds the audio, or nil.
    var owner: String? { get }
    func requestPermission() async -> Bool
    /// Puts the session in voice chat and starts the microphone and the speaker for `owner`.
    func activate(owner: String) throws(VoiceAudioFailure)
    /// Stops them and hands the audio back to what played before. Only the owner lets go.
    func deactivate(owner: String)
}
