#if os(iOS) && canImport(WebRTC)
import AVFAudio
import Foundation
@preconcurrency import WebRTC

/// The app's one audio session, held by a Voice session and by nothing else. WebRTC runs it by hand
/// (`useManualAudio`), so the microphone and the speaker start only once `activate` turns audio on, and the link to a
/// machine, which shares the process's `RTCAudioSession`, never starts them. `deactivate` hands the audio back to what
/// played before, with `notifyOthersOnDeactivation`, which `RTCAudioSession` passes when it lets go.
@MainActor public final class AudioSessionController: VoiceAudio {
    public static let shared = AudioSessionController()

    public var onChange: (@MainActor (VoiceAudioChange) -> Void)?
    public private(set) var owner: String?
    private let session = RTCAudioSession.sharedInstance()
    private let listener = Listener()

    private init() {
        session.useManualAudio = true
        session.isAudioEnabled = false
        listener.changed = { [weak self] change in
            guard let self, owner != nil else { return }
            onChange?(change)
        }
        session.add(listener)
    }

    public var permission: MicrophonePermission {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: .granted
        case .denied: .denied
        default: .undetermined
        }
    }

    public func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    public func activate(owner: String) throws(VoiceAudioFailure) {
        if let current = self.owner {
            guard current == owner else { throw .busy }
            return
        }
        guard permission == .granted else { throw .microphoneDenied }
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        do {
            // The speaker rather than the earpiece, since a person talks to Voice with the phone away from the ear.
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
            try session.setActive(true)
        } catch {
            throw .unavailable(error.localizedDescription)
        }
        session.isAudioEnabled = true
        self.owner = owner
    }

    public func deactivate(owner: String) {
        guard self.owner == owner else { return }
        self.owner = nil
        session.isAudioEnabled = false
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        try? session.setActive(false)
    }

    /// The current output, as iOS names it, for the panel.
    public var route: String? { session.currentRoute.outputs.first?.portName }

    /// `RTCAudioSession` calls its delegates on a notification thread of the system.
    private final class Listener: NSObject, RTCAudioSessionDelegate, @unchecked Sendable {
        @MainActor var changed: (@MainActor (VoiceAudioChange) -> Void)?

        private func send(_ change: VoiceAudioChange) {
            Task { @MainActor [weak self] in self?.changed?(change) }
        }

        func audioSessionDidBeginInterruption(_ session: RTCAudioSession) {
            send(.interrupted)
        }

        func audioSessionDidChangeRoute(
            _ session: RTCAudioSession, reason: AVAudioSession.RouteChangeReason,
            previousRoute: AVAudioSessionRouteDescription
        ) {
            let moved: Set<AVAudioSession.RouteChangeReason> = [.newDeviceAvailable, .oldDeviceUnavailable, .override]
            guard moved.contains(reason) else { return }
            send(.route(session.currentRoute.outputs.first?.portName ?? ""))
        }

        func audioSessionMediaServerReset(_ session: RTCAudioSession) {
            send(.reset)
        }
    }
}
#endif
