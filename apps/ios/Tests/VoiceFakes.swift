import Foundation
import RuimtePulsar
import RuimteTransport
import RuimteVoice

@testable import Ruimte

@MainActor final class VoiceMachine: MachineRequesting, MachineFeatures {
    var features: Set<WireRequest> = [
        .voiceStart, .voiceStop, .voiceConfirm, .voiceKeyStatus, .voicePreferences, .voiceSetPreferences,
    ]
    var requests: [(String, JSONValue)] = []
    var keyPresent = true
    /// What the machine stores of how Voice talks; null for none.
    var preferences: JSONValue = .null
    var refuseSet = false
    /// False for a confirmation the machine no longer holds.
    var acceptConfirm = true
    var holdStart = false
    /// What `observeConnection` answers at once, as `MachineClient` does with where its link stands.
    var connected = true
    private var heldStart: CheckedContinuation<JSONValue, Error>?
    private var heldScene = ""
    private var handlers: [String: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]
    private var connection: [UUID: @MainActor @Sendable (Bool) -> Void] = [:]

    var stops: [JSONValue] { requests.filter { $0.0 == "voice.stop" }.map(\.1) }

    func sent(_ type: String) -> Bool { requests.contains { $0.0 == type } }

    func answers(_ type: WireRequest) -> Bool { features.contains(type) }

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        switch type {
        case "voice.keyStatus": return .object(["present": .bool(keyPresent)])
        case "voice.start":
            let scene = payload.text("sceneId")
            guard holdStart else { return Self.answer(scene: scene) }
            heldScene = scene
            return try await withCheckedThrowingContinuation { heldStart = $0 }
        case "voice.stop": return .object(["stopped": .bool(true)])
        case "voice.confirm": return .object(["accepted": .bool(acceptConfirm)])
        case "voice.preferences": return .object(["preferences": preferences])
        case "voice.setPreferences":
            guard !refuseSet else { throw MachineClientError.invalid(type) }
            preferences = payload
            return .object(["preferences": payload])
        default: throw MachineClientError.invalid(type)
        }
    }

    func answerStart() {
        let held = heldStart
        heldStart = nil
        held?.resume(returning: Self.answer(scene: heldScene))
    }

    private static func answer(scene: String) -> JSONValue {
        .object([
            "sessionId": .string("session-1"), "sdp": .string("answer-sdp"),
            "status": .object([
                "sessionId": .string("session-1"), "sceneId": .string(scene), "seq": .number(0),
                "phase": .string("starting"),
            ]),
        ])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        let id = UUID()
        handlers[event, default: [:]][id] = handler
        return { [weak self] in self?.handlers[event]?.removeValue(forKey: id) }
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        let id = UUID()
        connection[id] = handler
        handler(connected)
        return { [weak self] in self?.connection.removeValue(forKey: id) }
    }

    func emit(_ event: String, _ payload: JSONValue) {
        for handler in Array(handlers[event]?.values ?? [:].values) { handler(payload) }
    }

    func drop() {
        for handler in Array(connection.values) { handler(false) }
    }

    /// Subscriptions still standing, events and the connection together.
    var listeners: Int { handlers.values.reduce(0) { $0 + $1.count } + connection.count }
}

@MainActor final class FakeMedia: VoiceMedia {
    var onEvent: (@MainActor (VoiceMediaEvent) -> Void)?
    var muted = false
    var answer: String?
    var closed = false
    var offers = 0
    /// What `samples()` reads.
    var reading = VoiceSamples.silent

    func offer() async throws -> String {
        offers += 1
        return "offer-sdp"
    }
    func accept(answer: String) async throws { self.answer = answer }
    func samples() -> VoiceSamples { closed ? .silent : reading }
    func close() { closed = true }
}

@MainActor final class FakeLive: VoiceLivePresenting {
    var shown: [VoiceLiveContent] = []
    var ended: [VoiceLiveContent] = []
    var machine: String?

    func show(_ content: VoiceLiveContent, machine: String) {
        shown.append(content)
        self.machine = machine
    }

    func end(_ content: VoiceLiveContent) { ended.append(content) }
}

/// Whether the coordinator holds the machine links open, in the order it asked.
@MainActor final class LinkHolds {
    var holds: [Bool] = []
}

@MainActor final class FakeAudio: VoiceAudio {
    var permission = MicrophonePermission.granted
    var onChange: (@MainActor (VoiceAudioChange) -> Void)?
    var owner: String?
    var grants = true
    var activations: [String] = []

    func requestPermission() async -> Bool {
        permission = grants ? .granted : .denied
        return grants
    }

    func activate(owner: String) throws(VoiceAudioFailure) {
        if let current = self.owner, current != owner { throw .busy }
        self.owner = owner
        activations.append(owner)
    }

    func deactivate(owner: String) {
        if self.owner == owner { self.owner = nil }
    }
}

@MainActor final class ManualScheduler: TransportScheduling {
    private var actions: [UUID: @MainActor () -> Void] = [:]

    func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void {
        let id = UUID()
        actions[id] = action
        return { [weak self] in self?.actions.removeValue(forKey: id) }
    }

    var pending: Int { actions.count }

    func fire() {
        let due = Array(actions.values)
        actions.removeAll()
        for action in due { action() }
    }
}
