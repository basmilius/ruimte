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
/// The band reads the last samples of both sides: the microphone after Apple's voice processing, as the model hears
/// it, and the reply as it plays. They stay in a `VoiceSampleWindow` and go nowhere else.
@MainActor public final class VoiceMediaPeer: NSObject, VoiceMedia {
    private static let microphoneSamples = VoiceSampleWindow()
    /// Held here, since the audio device module keeps its observer weakly.
    private static let engineObserver = EngineObserver(window: microphoneSamples)
    /// LiveKit's AVAudioEngine device with Apple's voice processing. The platform device hands the microphone to no
    /// processing delegate or track sink while that processing runs, so the band taps the engine's input instead.
    private static let factory: LKRTCPeerConnectionFactory = {
        let factory = LKRTCPeerConnectionFactory(
            audioDeviceModuleType: .audioEngine, bypassVoiceProcessing: false,
            encoderFactory: LKRTCDefaultVideoEncoderFactory(), decoderFactory: LKRTCDefaultVideoDecoderFactory(),
            audioProcessingModule: nil)
        factory.audioDeviceModule.observer = engineObserver
        return factory
    }()
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

/// Wires LiveKit's audio engine the way it does without an observer, and taps the node that carries the microphone
/// into WebRTC. The tap runs on an audio thread; the samples are floats, averaged over the channels as Web Audio
/// downmixes them.
private final class EngineObserver: NSObject, LKRTCAudioDeviceModuleDelegate, @unchecked Sendable {
    private let window: VoiceSampleWindow
    private let lock = NSLock()
    /// The node the tap sits on, so a new configuration or a released engine takes it off again.
    private var tapped: AVAudioNode?

    init(window: VoiceSampleWindow) {
        self.window = window
    }

    func audioDeviceModule(
        _ audioDeviceModule: LKRTCAudioDeviceModule, engine: AVAudioEngine, configureInputFromSource source: AVAudioNode?,
        toDestination destination: AVAudioNode, format: AVAudioFormat, context: [AnyHashable: Any]
    ) -> Int {
        guard let source else { return 0 }
        engine.connect(source, to: destination, format: format)
        removeTap()
        source.installTap(onBus: 0, bufferSize: 256, format: format) { [weak self] buffer, _ in
            self?.take(buffer)
        }
        lock.withLock { tapped = source }
        return 0
    }

    func audioDeviceModule(
        _ audioDeviceModule: LKRTCAudioDeviceModule, engine: AVAudioEngine, configureOutputFromSource source: AVAudioNode,
        toDestination destination: AVAudioNode?, format: AVAudioFormat, context: [AnyHashable: Any]
    ) -> Int {
        guard let destination else { return 0 }
        engine.connect(source, to: destination, format: format)
        return 0
    }

    func audioDeviceModule(_ audioDeviceModule: LKRTCAudioDeviceModule, didStopEngine engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        window.clear()
        return 0
    }

    func audioDeviceModule(_ audioDeviceModule: LKRTCAudioDeviceModule, didDisableEngine engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        removeTap()
        return 0
    }

    func audioDeviceModule(_ audioDeviceModule: LKRTCAudioDeviceModule, willReleaseEngine engine: AVAudioEngine) -> Int {
        removeTap()
        return 0
    }

    func audioDeviceModule(_ audioDeviceModule: LKRTCAudioDeviceModule, didCreateEngine engine: AVAudioEngine) -> Int { 0 }

    func audioDeviceModule(_ audioDeviceModule: LKRTCAudioDeviceModule, willStartEngine engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int { 0 }

    func audioDeviceModule(_ audioDeviceModule: LKRTCAudioDeviceModule, didReceiveSpeechActivityEvent speechActivityEvent: LKRTCSpeechActivityEvent) {}

    func audioDeviceModuleDidUpdateDevices(_ audioDeviceModule: LKRTCAudioDeviceModule) {}

    private func removeTap() {
        lock.withLock {
            tapped?.removeTap(onBus: 0)
            tapped = nil
        }
        window.clear()
    }

    private func take(_ buffer: AVAudioPCMBuffer) {
        guard let data = buffer.floatChannelData else { return }
        let channels = Int(buffer.format.channelCount)
        guard channels > 0 else { return }
        let frames = Int(buffer.frameLength)
        if buffer.format.isInterleaved {
            window.write(frames: frames) { frame in
                var sum: Float = 0
                for channel in 0..<channels { sum += data[0][frame * channels + channel] }
                return sum / Float(channels)
            }
        } else {
            window.write(frames: frames) { frame in
                var sum: Float = 0
                for channel in 0..<channels { sum += data[channel][frame] }
                return sum / Float(channels)
            }
        }
    }
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
