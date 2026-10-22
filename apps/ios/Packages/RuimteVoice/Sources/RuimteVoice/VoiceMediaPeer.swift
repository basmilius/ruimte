#if os(iOS) && canImport(WebRTC)
import Foundation
@preconcurrency import WebRTC

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
@MainActor public final class VoiceMediaPeer: NSObject, VoiceMedia {
    private static let factory = RTCPeerConnectionFactory()
    /// Past this the offer goes with the candidates it has; OpenAI's side answers a host candidate as well.
    private static let gatherLimit: Duration = .seconds(5)

    public var onEvent: (@MainActor (VoiceMediaEvent) -> Void)?
    public var muted = false {
        didSet { microphone?.isEnabled = !muted }
    }
    private var peer: RTCPeerConnection?
    private var channel: RTCDataChannel?
    private var microphone: RTCAudioTrack?
    private var gathered: CheckedContinuation<Void, Never>?
    private var ended = false

    public override init() {
        super.init()
    }

    public func offer() async throws -> String {
        guard !ended, peer == nil else {
            throw Self.failure(String(localized: "Voice already has a connection.", bundle: .module))
        }
        let configuration = RTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        configuration.bundlePolicy = .maxBundle
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let peer = Self.factory.peerConnection(with: configuration, constraints: constraints, delegate: self)
        else {
            throw Self.failure(String(localized: "WebRTC could not create the Voice connection.", bundle: .module))
        }
        self.peer = peer
        let source = Self.factory.audioSource(with: constraints)
        let microphone = Self.factory.audioTrack(with: source, trackId: "voice-microphone")
        microphone.isEnabled = !muted
        self.microphone = microphone
        guard peer.add(microphone, streamIds: ["voice"]) != nil else {
            throw Self.failure(String(localized: "WebRTC could not add the microphone.", bundle: .module))
        }
        let channelConfiguration = RTCDataChannelConfiguration()
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
        try await peer.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: answer))
        try checkOpen()
    }

    public func levels() async -> VoiceLevels? {
        guard !ended, let peer else { return nil }
        return await withCheckedContinuation { continuation in
            peer.statistics { report in
                let stats = report.statistics.values.map { (type: $0.type, values: $0.values as [String: Any]) }
                continuation.resume(returning: VoiceLevels.read(stats))
            }
        }
    }

    public func close() {
        guard !ended else { return }
        ended = true
        onEvent = nil
        finishGathering()
        microphone?.isEnabled = false
        microphone = nil
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

extension VoiceMediaPeer: RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    nonisolated public func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        let state = dataChannel.readyState
        Task { @MainActor [weak self] in
            if state == .closed { self?.lost() }
        }
    }

    nonisolated public func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        guard !buffer.isBinary else { return }
        let data = buffer.data
        Task { @MainActor [weak self] in self?.received(data) }
    }

    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        Task { @MainActor [weak self] in
            if newState == .failed || newState == .closed { self?.lost() }
        }
    }

    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        Task { @MainActor [weak self] in
            if newState == .complete { self?.finishGathering() }
        }
    }

    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated public func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
#endif
