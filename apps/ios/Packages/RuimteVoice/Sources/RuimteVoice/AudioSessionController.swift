#if os(iOS) && canImport(LiveKitWebRTC)
import AVFAudio
import Foundation
@preconcurrency import LiveKitWebRTC

/// The app's one audio session, held by a Voice session and by nothing else. Voice's WebRTC runs it by hand
/// (`useManualAudio`), so the microphone and the speaker start only once `activate` turns audio on. The link to a
/// machine has a WebRTC of its own that carries no audio. `deactivate` hands the audio back to what played before, with
/// `notifyOthersOnDeactivation`, which `LKRTCAudioSession` passes when it lets go.
@MainActor public final class AudioSessionController: VoiceAudio {
    public static let shared = AudioSessionController()

    public var onChange: (@MainActor (VoiceAudioChange) -> Void)?
    public private(set) var owner: String?
    private let session = LKRTCAudioSession.sharedInstance()
    private let listener = Listener()

    private init() {
        // WebRTC's audio unit applies its own configuration once audio is on, which would leave out the speaker, so
        // that configuration is this one.
        LKRTCAudioSessionConfiguration.setWebRTC(Self.configuration)
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
            try session.setConfiguration(Self.configuration, active: true)
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

    /// Voice chat on the speaker rather than the earpiece, since a person talks to Voice with the phone away from the
    /// ear, and on a Bluetooth headset when one is there.
    private static var configuration: LKRTCAudioSessionConfiguration {
        let configuration = LKRTCAudioSessionConfiguration.webRTC()
        configuration.category = AVAudioSession.Category.playAndRecord.rawValue
        configuration.mode = AVAudioSession.Mode.voiceChat.rawValue
        configuration.categoryOptions = [.allowBluetoothHFP, .defaultToSpeaker]
        return configuration
    }

    /// The current output, as iOS names it, for the panel.
    public var route: String? { session.currentRoute.outputs.first?.portName }

    /// `LKRTCAudioSession` calls its delegates on a notification thread of the system.
    private final class Listener: NSObject, LKRTCAudioSessionDelegate, @unchecked Sendable {
        @MainActor var changed: (@MainActor (VoiceAudioChange) -> Void)?

        private func send(_ change: VoiceAudioChange) {
            Task { @MainActor [weak self] in self?.changed?(change) }
        }

        func audioSessionDidBeginInterruption(_ session: LKRTCAudioSession) {
            send(.interrupted)
        }

        func audioSessionDidChangeRoute(
            _ session: LKRTCAudioSession, reason: AVAudioSession.RouteChangeReason,
            previousRoute: AVAudioSessionRouteDescription
        ) {
            // Something in the process set another category, which turns the microphone off without a word.
            if reason == .categoryChange, session.category != AVAudioSession.Category.playAndRecord.rawValue {
                send(.taken)
                return
            }
            let moved: Set<AVAudioSession.RouteChangeReason> = [.newDeviceAvailable, .oldDeviceUnavailable, .override]
            guard moved.contains(reason) else { return }
            send(.route(session.currentRoute.outputs.first?.portName ?? ""))
        }

        func audioSessionMediaServerReset(_ session: LKRTCAudioSession) {
            send(.reset)
        }
    }
}
#endif
