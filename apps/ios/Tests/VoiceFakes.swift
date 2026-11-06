import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import RuimteVoice
import Testing
import XCTest

@testable import Ruimte

@MainActor final class VoiceMachine: MachineRequesting, MachineFeatures {
    var features: Set<WireRequest> = [
        .voiceStart, .voiceStop, .voiceConfirm, .voiceKeyStatus, .voicePreferences, .voiceSetPreferences,
    ]
    var requests: [(WireRequest, JSONValue)] = []
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
    private let startArrival = NativeArrival()
    private var heldScene = ""
    private var handlers: [WireEvent: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]
    private var connection: [UUID: @MainActor @Sendable (Bool) -> Void] = [:]

    var stops: [JSONValue] { requests.filter { $0.0 == .voiceStop }.map(\.1) }

    func sent(_ type: WireRequest) -> Bool { requests.contains { $0.0 == type } }

    func answers(_ type: WireRequest) -> Bool { features.contains(type) }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        switch type {
        case .voiceKeyStatus: return .object(["present": .bool(keyPresent)])
        case .voiceStart:
            let scene = payload.text("sceneId")
            guard holdStart else { return Self.answer(scene: scene) }
            heldScene = scene
            return try await withCheckedThrowingContinuation {
                heldStart = $0
                startArrival.record()
            }
        case .voiceStop: return .object(["stopped": .bool(true)])
        case .voiceConfirm: return .object(["accepted": .bool(acceptConfirm)])
        case .voicePreferences: return .object(["preferences": preferences])
        case .voiceSetPreferences:
            guard !refuseSet else { throw MachineClientError.invalid(type.rawValue) }
            preferences = payload
            return .object(["preferences": payload])
        default: throw MachineClientError.invalid(type.rawValue)
        }
    }

    func answerStart() {
        let held = heldStart
        heldStart = nil
        held?.resume(returning: Self.answer(scene: heldScene))
    }

    func waitForStart() async { await startArrival.wait() }

    private static func answer(scene: String) -> JSONValue {
        .object([
            "sessionId": .string("session-1"), "sdp": .string("answer-sdp"),
            "status": .object([
                "sessionId": .string("session-1"), "sceneId": .string(scene), "seq": .number(0),
                "phase": .string("starting"),
            ]),
        ])
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
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

    func emit(_ event: WireEvent, _ payload: JSONValue) {
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
    private var actions: [UUID: (deadline: Double, action: @MainActor () -> Void)] = [:]
    private(set) var now = 0.0

    func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void {
        let id = UUID()
        actions[id] = (now + milliseconds, action)
        return { [weak self] in self?.actions.removeValue(forKey: id) }
    }

    var pending: Int { actions.count }

    func advance(by milliseconds: Double) {
        let target = now + milliseconds
        while let next = actions.min(by: { $0.value.deadline < $1.value.deadline }), next.value.deadline <= target {
            now = next.value.deadline
            actions.removeValue(forKey: next.key)
            next.value.action()
        }
        now = target
    }
}

/// Task-local values live until the inheriting tasks finish, including tasks retained by an owner after completion.
/// This waits for the owner's response handling, rather than just the fake's request or continuation resumption.
struct NativeTaskDrain {
    private let completion: XCTestExpectation

    @TaskLocal private static var lifetime: Lifetime?

    init(_ operation: () -> Void) {
        completion = XCTestExpectation(description: "Owner tasks completed")
        Self.$lifetime.withValue(Lifetime(completion: completion), operation: operation)
    }

    func finish(file: StaticString = #filePath, line: UInt = #line) async {
        let result = await XCTWaiter.fulfillment(of: [completion], timeout: 2)
        if result != .completed {
            if Test.current != nil {
                Issue.record("Owner tasks did not finish")
            } else {
                XCTFail("Owner tasks did not finish", file: file, line: line)
            }
        }
    }

    private final class Lifetime: Sendable {
        let completion: XCTestExpectation
        init(completion: XCTestExpectation) { self.completion = completion }
        deinit { completion.fulfill() }
    }
}

@MainActor final class NativeArrival {
    private var count = 0
    private var waiting: [(Int, XCTestExpectation)] = []

    func record() {
        count += 1
        let ready = waiting.filter { count >= $0.0 }
        waiting.removeAll { count >= $0.0 }
        for (_, arrival) in ready { arrival.fulfill() }
    }

    func wait(for target: Int = 1, file: StaticString = #filePath, line: UInt = #line) async {
        if count >= target { return }
        let arrival = XCTestExpectation(description: "Request arrived")
        waiting.append((target, arrival))
        let result = await XCTWaiter.fulfillment(of: [arrival], timeout: 2)
        if result != .completed {
            if Test.current != nil {
                Issue.record("Request did not arrive")
            } else {
                XCTFail("Request did not arrive", file: file, line: line)
            }
        }
    }
}

@MainActor func waitForNativeState(
    file: StaticString = #filePath, line: UInt = #line, _ ready: @escaping @MainActor @Sendable () -> Bool
) async {
    await NativeStateObservation(ready: ready).wait(file: file, line: line)
}

@MainActor private final class NativeStateObservation {
    private let ready: @MainActor @Sendable () -> Bool
    private let arrival = NativeArrival()

    init(ready: @escaping @MainActor @Sendable () -> Bool) { self.ready = ready }

    func wait(file: StaticString, line: UInt) async {
        observe()
        await arrival.wait(file: file, line: line)
    }

    private func observe() {
        if withObservationTracking(ready, onChange: { [weak self] in Task { @MainActor in self?.observe() } }) {
            arrival.record()
        }
    }
}
