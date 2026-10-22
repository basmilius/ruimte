#if os(iOS) && canImport(LiveKitWebRTC)
import AVFAudio
import Foundation
@preconcurrency import LiveKitWebRTC

public enum VoiceMediaFailure: Error, LocalizedError, Sendable, Equatable {
    case unavailable(String)

    public var errorDescription: String? {
        switch self {
        case .unavailable(let message): message
        }
    }
}

/// The phone's peer to OpenAI: the microphone out, the reply in, and the `oai-events` channel for captions. It has a
/// factory of its own, so the machine link's factory in RuimteTransport never gets an audio track, and it plays the
/// reply through the audio session `AudioSessionController` turns on. A function call on the channel is the daemon's
/// to run, so the peer reads only captions and whether the session started or failed.
///
/// The band reads the last samples of both sides: the microphone after WebRTC's processing, as the model hears it,
/// and the reply as it plays. They stay in a `VoiceSampleWindow` and go nowhere else.
@MainActor public final class VoiceMediaPeer: NSObject, VoiceMedia {
    private static let microphoneSamples = VoiceSampleWindow()
    /// Held here, since the processing module keeps its delegate weakly.
    private static let microphoneTap = MicrophoneTap(window: microphoneSamples)
    /// The platform's voice-processing audio unit, as the plain factory has it, with a processing module that hands
    /// the microphone to `microphoneTap` once WebRTC processed it.
    private static let factory = LKRTCPeerConnectionFactory(
        audioDeviceModuleType: .platformDefault, bypassVoiceProcessing: false,
        encoderFactory: LKRTCDefaultVideoEncoderFactory(), decoderFactory: LKRTCDefaultVideoDecoderFactory(),
        audioProcessingModule: LKRTCDefaultAudioProcessingModule(
            config: nil, capturePostProcessingDelegate: microphoneTap, renderPreProcessingDelegate: nil))
    /// Past this the offer goes with the candidates it has; OpenAI's side answers a host candidate as well.
    private static let gatherLimit: Duration = .seconds(5)

    public var onEvent: (@MainActor (VoiceMediaEvent) -> Void)?
    public var muted = false {
        didSet { microphone?.isEnabled = !muted }
    }
    private var peer: LKRTCPeerConnection?
    private var channel: LKRTCDataChannel?
    private var microphone: LKRTCAudioTrack?
    private var reply: LKRTCAudioTrack?
    private let replySamples = VoiceSampleWindow()
    private lazy var replyTap = ReplyTap(window: replySamples)
    private var gathered: CheckedContinuation<Void, Never>?
    private var ended = false

    public override init() {
        super.init()
    }

    public func offer() async throws -> String {
        guard !ended, peer == nil else {
            throw Self.failure(String(localized: "Voice already has a connection.", bundle: .module))
        }
        let configuration = LKRTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        configuration.bundlePolicy = .maxBundle
        let constraints = LKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let peer = Self.factory.peerConnection(with: configuration, constraints: constraints, delegate: self)
        else {
            throw Self.failure(String(localized: "WebRTC could not create the Voice connection.", bundle: .module))
        }
        self.peer = peer
        let source = Self.factory.audioSource(with: constraints)
        let microphone = Self.factory.audioTrack(with: source, trackId: "voice-microphone")
        microphone.isEnabled = !muted
        self.microphone = microphone
        guard let sender = peer.add(microphone, streamIds: ["voice"]) else {
            throw Self.failure(String(localized: "WebRTC could not add the microphone.", bundle: .module))
        }
        Self.microphoneSamples.clear()
        // The microphone's transceiver also receives, and its track is the reply.
        if let reply = peer.transceivers.first(where: { $0.sender == sender })?.receiver.track as? LKRTCAudioTrack {
            reply.add(replyTap)
            self.reply = reply
        }
        let channelConfiguration = LKRTCDataChannelConfiguration()
        channelConfiguration.isOrdered = true
        guard let channel = peer.dataChannel(forLabel: "oai-events", configuration: channelConfiguration) else {
            throw Self.failure(String(localized: "WebRTC could not open the captions channel.", bundle: .module))
        }
        channel.delegate = self
        self.channel = channel
        let description = try await peer.offer(for: constraints)
        try checkOpen()
        try await peer.setLocalDescription(description)
        try checkOpen()
        await gatherCandidates()
        try checkOpen()
        guard let sdp = peer.localDescription?.sdp else {
            throw Self.failure(String(localized: "WebRTC made no offer for Voice.", bundle: .module))
        }
        return sdp
    }

    public func accept(answer: String) async throws {
        guard let peer else { throw Self.failure(String(localized: "The Voice connection closed.", bundle: .module)) }
        try await peer.setRemoteDescription(LKRTCSessionDescription(type: .answer, sdp: answer))
        try checkOpen()
    }

    public func samples() -> VoiceSamples {
        guard !ended, peer != nil else { return .silent }
        return VoiceSamples(person: Self.microphoneSamples.take(), voice: replySamples.take())
    }

    public func close() {
        guard !ended else { return }
        ended = true
        onEvent = nil
        finishGathering()
        microphone?.isEnabled = false
        microphone = nil
        reply?.remove(replyTap)
        reply = nil
        Self.microphoneSamples.clear()
        replySamples.clear()
        let closingChannel = channel
        let closingPeer = peer
        channel = nil
        peer = nil
        closingChannel?.delegate = nil
        closingPeer?.delegate = nil
        closingChannel?.close()
        closingPeer?.close()
    }

    private func checkOpen() throws {
        if ended || Task.isCancelled { throw CancellationError() }
    }

    /// The machine passes the offer on once, so it waits for the candidates, as the desktop's peer does.
    private func gatherCandidates() async {
        guard let peer, peer.iceGatheringState != .complete else { return }
        await withCheckedContinuation { continuation in
            gathered = continuation
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: Self.gatherLimit)
                self?.finishGathering()
            }
        }
    }

    private func finishGathering() {
        let continuation = gathered
        gathered = nil
        continuation?.resume()
    }

    private func lost() {
        guard !ended else { return }
        let report = onEvent
        close()
        report?(.lost)
    }

    private func received(_ data: Data) {
        guard !ended else { return }
        switch LiveServiceEvent.parse(data) {
        case .caption(let caption): onEvent?(.caption(caption))
        case .started: onEvent?(.started)
        case .failed: lost()
        case .ignored: break
        }
    }

    private static func failure(_ message: String) -> VoiceMediaFailure { .unavailable(message) }
}

extension VoiceMediaPeer: LKRTCPeerConnectionDelegate, LKRTCDataChannelDelegate {
    nonisolated public func dataChannelDidChangeState(_ dataChannel: LKRTCDataChannel) {
        let state = dataChannel.readyState
        Task { @MainActor [weak self] in
            if state == .closed { self?.lost() }
        }
    }

    nonisolated public func dataChannel(_ dataChannel: LKRTCDataChannel, didReceiveMessageWith buffer: LKRTCDataBuffer) {
        guard !buffer.isBinary else { return }
        let data = buffer.data
        Task { @MainActor [weak self] in self?.received(data) }
    }

    nonisolated public func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange newState: LKRTCPeerConnectionState) {
        Task { @MainActor [weak self] in
            if newState == .failed || newState == .closed { self?.lost() }
        }
    }

    nonisolated public func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange newState: LKRTCIceGatheringState) {
        Task { @MainActor [weak self] in
            if newState == .complete { self?.finishGathering() }
        }
    }

    nonisolated public func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange stateChanged: LKRTCSignalingState) {}
    nonisolated public func peerConnection(_ peerConnection: LKRTCPeerConnection, didAdd stream: LKRTCMediaStream) {}
    nonisolated public func peerConnection(_ peerConnection: LKRTCPeerConnection, didRemove stream: LKRTCMediaStream) {}
    nonisolated public func peerConnectionShouldNegotiate(_ peerConnection: LKRTCPeerConnection) {}
    nonisolated public func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange newState: LKRTCIceConnectionState) {}
    nonisolated public func peerConnection(_ peerConnection: LKRTCPeerConnection, didGenerate candidate: LKRTCIceCandidate) {}
    nonisolated public func peerConnection(_ peerConnection: LKRTCPeerConnection, didRemove candidates: [LKRTCIceCandidate]) {}
    nonisolated public func peerConnection(_ peerConnection: LKRTCPeerConnection, didOpen dataChannel: LKRTCDataChannel) {}
}

/// Takes the microphone after WebRTC's processing, on its audio thread, every 10 ms. The samples are 16-bit values as
/// floats, one plane per channel, and the channels are averaged as Web Audio downmixes them.
private final class MicrophoneTap: NSObject, LKRTCAudioCustomProcessingDelegate, Sendable {
    private let window: VoiceSampleWindow

    init(window: VoiceSampleWindow) {
        self.window = window
    }

    func audioProcessingInitialize(sampleRate: Int, channels: Int) {}

    func audioProcessingProcess(audioBuffer: LKRTCAudioBuffer) {
        let channels = audioBuffer.channels
        guard channels > 0 else { return }
        let first = audioBuffer.rawBuffer(forChannel: 0)
        let second = channels > 1 ? audioBuffer.rawBuffer(forChannel: 1) : first
        window.write(frames: audioBuffer.frames) { frame in (first[frame] + second[frame]) / 2 / 32_768 }
    }

    func audioProcessingRelease() {}
}

/// Takes the reply as it plays, on WebRTC's playout thread: interleaved 16-bit samples, averaged over the channels.
private final class ReplyTap: NSObject, LKRTCAudioRenderer, Sendable {
    private let window: VoiceSampleWindow

    init(window: VoiceSampleWindow) {
        self.window = window
    }

    func render(pcmBuffer: AVAudioPCMBuffer) {
        guard let data = pcmBuffer.int16ChannelData?[0] else { return }
        let channels = Int(pcmBuffer.format.channelCount)
        guard channels > 0 else { return }
        window.write(frames: Int(pcmBuffer.frameLength)) { frame in
            var sum: Float = 0
            for channel in 0..<channels { sum += Float(data[frame * channels + channel]) }
            return sum / Float(channels) / 32_768
        }
    }
}
#endif
