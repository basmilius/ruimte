import Foundation
import RuimtePulsar
import RuimteTransport
import RuimteVoice
import Testing

@testable import Ruimte

@Suite @MainActor struct VoiceCoordinatorTests {
    private static let target = VoiceTarget(machineID: "machine", projectID: "project", projectName: "Ruimte")

    private struct Setup {
        let voice: VoiceCoordinator
        let machine: VoiceMachine
        let media: FakeMedia
        let audio: FakeAudio
        let scheduler: ManualScheduler
    }

    private static func setup(declaresMicrophone: Bool = true) -> Setup {
        let machine = VoiceMachine()
        let media = FakeMedia()
        let audio = FakeAudio()
        let scheduler = ManualScheduler()
        let voice = VoiceCoordinator(
            media: { media }, audio: { audio }, scheduler: scheduler,
            preferences: { VoicePreferences(language: "nl", voice: "cedar") },
            makeID: { "start-1" }, timeZone: { "Europe/Amsterdam" }, declaresMicrophone: declaresMicrophone)
        return Setup(voice: voice, machine: machine, media: media, audio: audio, scheduler: scheduler)
    }

    private static func settle() async {
        for _ in 0..<20 { await Task.yield() }
    }

    private static func status(_ phase: String, seq: Int, scene: String = "A", session: String = "session-1")
        -> JSONValue
    {
        .object([
            "sessionId": .string(session), "sceneId": .string(scene), "seq": .number(Double(seq)),
            "phase": .string(phase),
        ])
    }

    private static func activity(_ id: String, status: String, seq: Int, scene: String = "A") -> JSONValue {
        .object([
            "sessionId": .string("session-1"), "sceneId": .string(scene), "seq": .number(Double(seq)),
            "entry": .object([
                "id": .string(id), "at": .number(1), "kind": .string("chat"), "status": .string(status),
                "label": .string("Read the chat"), "detail": .string("Release notes"),
            ]),
        ])
    }

    @Test func aStartSendsTheOfferWithItsSceneAndPlaysTheAnswer() async {
        let setup = Self.setup()
        var target = Self.target
        target.viewID = "canvas-1"
        await setup.voice.start(scene: "A", target: target, client: setup.machine)
        let start = setup.machine.requests.first { $0.0 == "voice.start" }?.1
        #expect(
            start
                == .object([
                    "startId": .string("start-1"), "sceneId": .string("A"), "projectId": .string("project"),
                    "sdp": .string("offer-sdp"), "language": .string("nl"), "voice": .string("cedar"),
                    "timeZone": .string("Europe/Amsterdam"), "viewId": .string("canvas-1"),
                ]))
        #expect(setup.media.answer == "answer-sdp")
        #expect(setup.audio.owner == "A")
        #expect(setup.voice.sessionID == "session-1")
        #expect(setup.voice.phase == .connecting)
        #expect(setup.voice.isOwner("A"))
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        #expect(setup.voice.phase == .active)
    }

    @Test func eventsCountOnlyForTheOwnersSceneAndSessionAndInOrder() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.machine.emit("voice.status", Self.status("active", seq: 1, scene: "B"))
        setup.machine.emit("voice.status", Self.status("active", seq: 1, session: "session-2"))
        #expect(setup.voice.phase == .connecting)
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        setup.machine.emit("voice.status", Self.status("stopping", seq: 1))
        #expect(setup.voice.phase == .active, "An event the phone had already is dropped")
        setup.machine.emit("voice.activity", Self.activity("line-1", status: "running", seq: 2))
        setup.machine.emit("voice.activity", Self.activity("line-1", status: "completed", seq: 3))
        setup.machine.emit("voice.activity", Self.activity("line-2", status: "running", seq: 4, scene: "B"))
        #expect(setup.voice.activity.map(\.id) == ["line-1"])
        #expect(setup.voice.activity.first?.status == "completed")
        setup.machine.emit("voice.status", Self.status("closed", seq: 5))
        await Self.settle()
        #expect(setup.voice.phase == .idle)
        #expect(setup.voice.owner == nil)
        #expect(setup.audio.owner == nil)
        #expect(setup.media.closed)
        #expect(!setup.machine.sent("voice.stop"), "The machine ended it, so the phone asks nothing")
    }

    @Test func anEventBeforeTheStartAnsweredCountsOnceTheSessionIsKnown() async {
        let setup = Self.setup()
        setup.machine.holdStart = true
        let starting = Task { await setup.voice.start(scene: "A", target: Self.target, client: setup.machine) }
        await Self.settle()
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        setup.machine.answerStart()
        await starting.value
        #expect(setup.voice.phase == .active)
    }

    @Test func aStopWhileStartingCancelsTheStartAndAnyLateSession() async {
        let setup = Self.setup()
        setup.machine.holdStart = true
        let starting = Task { await setup.voice.start(scene: "A", target: Self.target, client: setup.machine) }
        await Self.settle()
        setup.voice.stop(scene: "A")
        await Self.settle()
        #expect(setup.machine.stops == [.object(["sceneId": .string("A"), "startId": .string("start-1")])])
        #expect(setup.voice.phase == .idle)
        setup.machine.answerStart()
        await starting.value
        await Self.settle()
        #expect(
            setup.machine.stops.last == .object(["sceneId": .string("A"), "sessionId": .string("session-1")]),
            "A session the start made after all is stopped too")
        #expect(setup.audio.activations.isEmpty, "The microphone never started")
        #expect(setup.media.closed)
        #expect(setup.voice.owner == nil)
    }

    @Test func aStopNamesTheSessionAndItsScene() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.voice.stop(scene: "A")
        await Self.settle()
        #expect(setup.machine.stops == [.object(["sceneId": .string("A"), "sessionId": .string("session-1")])])
        #expect(setup.audio.owner == nil)
    }

    @Test func aSecondSceneNeitherTakesVoiceOverNorStopsIt() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        await setup.voice.start(scene: "B", target: Self.target, client: setup.machine)
        #expect(setup.machine.requests.filter { $0.0 == "voice.start" }.count == 1)
        #expect(setup.voice.isOwner("A"))
        #expect(setup.voice.runsElsewhere(than: "B"))
        #expect(!setup.voice.runsElsewhere(than: "A"))
        setup.voice.stop(scene: "B")
        setup.voice.scene("B", background: true)
        setup.voice.sceneClosed("B")
        #expect(setup.voice.isOwner("A"))
    }

    @Test func theOwnerGoingToTheBackgroundStopsVoice() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.voice.scene("A", background: false)
        #expect(setup.voice.isOwner("A"))
        setup.voice.scene("A", background: true)
        await Self.settle()
        #expect(setup.voice.phase == .idle)
        #expect(setup.machine.sent("voice.stop"))
        #expect(setup.voice.problem(in: "A") != nil)
        #expect(setup.voice.problem(in: "B") == nil, "Only the scene it ran in says why it ended")
    }

    @Test func aLockedScreenEndsVoice() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.voice.deviceLocked()
        await Self.settle()
        #expect(setup.voice.phase == .idle)
        #expect(setup.machine.sent("voice.stop"))
    }

    @Test func aRefusedMicrophoneAsksTheMachineNothing() async {
        let setup = Self.setup()
        setup.audio.permission = .undetermined
        setup.audio.grants = false
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        #expect(setup.voice.problem(in: "A") == .microphoneDenied)
        #expect(setup.voice.phase == .idle)
        #expect(setup.machine.requests.isEmpty)
        #expect(setup.voice.owner == nil)
    }

    @Test func aCallEndsVoiceAndARouteChangeOnlyRenamesTheOutput() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.audio.onChange?(.route("AirPods"))
        #expect(setup.voice.route == "AirPods")
        #expect(setup.voice.isOwner("A"))
        setup.audio.onChange?(.interrupted)
        await Self.settle()
        #expect(setup.voice.phase == .idle)
        #expect(setup.machine.sent("voice.stop"))
        if case .message = setup.voice.problem(in: "A") {} else { Issue.record("An interruption says why Voice ended") }
    }

    @Test func anotherCategorySetInTheAppEndsVoiceInsteadOfListeningDeaf() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.audio.onChange?(.taken)
        await Self.settle()
        #expect(setup.voice.phase == .idle)
        #expect(setup.machine.stops.last == .object(["sceneId": .string("A"), "sessionId": .string("session-1")]))
        #expect(setup.voice.problem(in: "A") == .message("Something else in Ruimte took the audio, so Voice stopped."))
    }

    @Test func aDroppedMachineLinkEndsVoiceWithoutAStop() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.machine.drop()
        await Self.settle()
        #expect(setup.voice.phase == .idle)
        #expect(!setup.machine.sent("voice.stop"))
        #expect(setup.media.closed)
    }

    @Test func aLinkThatIsDownWhenTheStartListensEndsItAndLeavesNothingBehind() async {
        let setup = Self.setup()
        setup.machine.connected = false
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        #expect(setup.voice.phase == .idle)
        #expect(setup.voice.owner == nil)
        #expect(!setup.machine.sent("voice.start"), "No offer is made for a link that went")
        #expect(setup.media.offers == 0, "No peer with a microphone track is made")
        #expect(setup.machine.listeners == 0, "Every subscription is cancelled")
        #expect(setup.scheduler.pending == 0, "No deadline is left")
        #expect(setup.voice.problem(in: "A") == .message("The connection to the machine dropped, so Voice stopped."))
        setup.machine.connected = true
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        #expect(setup.voice.sessionID == "session-1", "The next start runs as any other")
    }

    @Test func droppedMediaEndsVoiceAndStopsTheSession() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.media.onEvent?(.lost)
        await Self.settle()
        #expect(setup.voice.phase == .idle)
        #expect(setup.machine.stops.last == .object(["sceneId": .string("A"), "sessionId": .string("session-1")]))
    }

    @Test func aStartTheMachineDoesNotAnswerInTimeIsCancelled() async {
        let setup = Self.setup()
        setup.machine.holdStart = true
        let starting = Task { await setup.voice.start(scene: "A", target: Self.target, client: setup.machine) }
        await Self.settle()
        setup.scheduler.fire()
        await Self.settle()
        #expect(setup.voice.phase == .idle)
        #expect(setup.machine.stops == [.object(["sceneId": .string("A"), "startId": .string("start-1")])])
        #expect(setup.voice.problem(in: "A") == .message("The machine did not start Voice in time."))
        setup.machine.answerStart()
        await starting.value
    }

    @Test func aFailureOnTheMachineShowsWhatItSaid() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        var failed = Self.status("failed", seq: 1)
        failed = failed.setting("error", .object(["code": .string("no-key"), "message": .string("No OpenAI key")]))
        setup.machine.emit("voice.status", failed)
        #expect(setup.voice.problem(in: "A") == .message("No OpenAI key"))
        #expect(setup.voice.phase == .idle)
    }

    @Test func captionsFromTheMediaMakeTheTranscript() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.media.onEvent?(.caption(LiveCaption(speaker: .person, delta: "What does", startMs: 0, endMs: 100)))
        setup.media.onEvent?(.caption(LiveCaption(speaker: .person, delta: " the chat say", startMs: 100, endMs: 300)))
        setup.media.onEvent?(.caption(LiveCaption(speaker: .model, delta: "It finished.", startMs: 500, endMs: 900)))
        #expect(setup.voice.transcript.lines.map(\.text) == ["What does the chat say", "It finished."])
        #expect(setup.voice.transcript.current?.speaker == .model)
    }

    @Test func aConfirmationNamesTheSceneAndSession() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        #expect(await setup.voice.confirm(scene: "A", token: "token-1", decision: "confirm"))
        #expect(
            setup.machine.requests.last?.1
                == .object([
                    "sceneId": .string("A"), "sessionId": .string("session-1"), "token": .string("token-1"),
                    "decision": .string("confirm"),
                ]))
        #expect(!(await setup.voice.confirm(scene: "B", token: "token-1", decision: "confirm")))
    }

    // MARK: Whether the mic shows

    @Test func theMicShowsOnlyWithTheRequestAndAKey() async {
        let setup = Self.setup()
        #expect(!setup.voice.offers(machineID: "machine", client: setup.machine), "Nothing read yet")
        await setup.voice.refreshKey(machineID: "machine", client: setup.machine)
        #expect(setup.voice.offers(machineID: "machine", client: setup.machine))
        setup.machine.keyPresent = false
        await setup.voice.refreshKey(machineID: "machine", client: setup.machine)
        #expect(!setup.voice.offers(machineID: "machine", client: setup.machine))
    }

    @Test func aMachineWithoutVoiceNeverShowsTheMic() async {
        let setup = Self.setup()
        setup.machine.features = []
        await setup.voice.refreshKey(machineID: "machine", client: setup.machine)
        #expect(setup.machine.requests.isEmpty, "An older machine is never asked")
        #expect(!setup.voice.offers(machineID: "machine", client: setup.machine))
    }

    @Test func aBuildWithoutTheMicrophoneNeverShowsTheMic() async {
        let setup = Self.setup(declaresMicrophone: false)
        await setup.voice.refreshKey(machineID: "machine", client: setup.machine)
        #expect(setup.machine.requests.isEmpty)
        #expect(!setup.voice.offers(machineID: "machine", client: setup.machine))
    }

    @Test func aMachineClientAnswersWhatItsEndpointNames() {
        let setup = Self.setup()
        let client = MachineClient(send: { _ in }, connected: true)
        #expect(!setup.voice.offers(machineID: "machine", client: client))
        client.setFeatures(["voice.start", "voice.keyStatus"])
        #expect((client as MachineFeatures).answers(.voiceStart))
        #expect(!(client as MachineFeatures).answers(.voiceConfirm))
    }

    // MARK: A scene

    @Test func aSceneWithoutAProjectAsksForOneAndTheOwnerStops() async {
        let setup = Self.setup()
        let scene = VoiceScene(id: "A")
        scene.toggle(setup.voice)
        #expect(scene.picking)
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        scene.toggle(setup.voice)
        #expect(setup.voice.phase == .idle)
        let other = VoiceScene(id: "B")
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        other.toggle(setup.voice)
        #expect(other.showsPanel, "Another scene shows where Voice runs")
        #expect(!other.picking)
        #expect(setup.voice.isOwner("A"))
    }

    @Test func theIPadKeepsVoiceInTheInspectorBesideAnyPage() {
        let router = PadRouter()
        router.inspector = .voice
        #expect(router.showsInspector, "Voice stands beside Now too")
        router.closeProject()
        #expect(router.inspector == .voice)
    }

    @Test func aNodeOpenedOnItsOwnNamesTheCanvasItStandsOn() {
        let node: (String) -> JSONValue = { .object(["id": .string($0), "kind": .string("chat")]) }
        let views: [JSONValue] = [
            .object(["id": .string("first"), "kind": .string("canvas"), "nodes": .array([node("a")])]),
            .object(["id": .string("second"), "kind": .string("canvas"), "nodes": .array([node("b")])]),
            .object(["id": .string("notes"), "kind": .string("chat")]),
        ]
        #expect(VoiceTarget.canvas(shown: "second", views: views) == "second")
        #expect(VoiceTarget.canvas(shown: "b", views: views) == "second", "Not the first canvas of the project")
        #expect(VoiceTarget.canvas(shown: "notes", views: views) == nil, "A chat view stands on no canvas")
        #expect(VoiceTarget.canvas(shown: nil, views: views) == nil)
    }

    // MARK: Preferences

    @Test func theLanguagesAndVoicesAreTheOnesTheRequestTakes() {
        #expect(VoicePreferences.languages.contains("nl"))
        #expect(VoicePreferences.languages.contains("en"))
        #expect(VoicePreferences.languages.count == 29)
        #expect(VoicePreferences.voices == ["marin", "cedar"])
        for language in VoicePreferences.languages {
            let payload: JSONValue = .object([
                "startId": .string("s"), "sceneId": .string("A"), "projectId": .string("p"), "sdp": .string("v=0"),
                "language": .string(language), "voice": .string("marin"), "timeZone": .string("UTC"),
            ])
            #expect(throws: Never.self) { try WireRequest.voiceStart.validatePayload(payload) }
        }
    }

    @Test func theLanguageFollowsTheDeviceWhereVoiceSpeaksIt() throws {
        #expect(VoicePreferences.defaultLanguage(preferred: ["nl-NL", "en-US"]) == "nl")
        #expect(VoicePreferences.defaultLanguage(preferred: ["tlh"]) == "en")
        let defaults = try #require(UserDefaults(suiteName: "voice-preferences-test"))
        defaults.removePersistentDomain(forName: "voice-preferences-test")
        defaults.set("xx", forKey: VoicePreferences.languageKey)
        defaults.set("cedar", forKey: VoicePreferences.voiceKey)
        let current = VoicePreferences.current(defaults)
        #expect(VoicePreferences.languages.contains(current.language))
        #expect(current.voice == "cedar")
        #expect(VoicePreferences.languageName("nl") == "Nederlands")
    }
}

@MainActor private final class VoiceMachine: MachineRequesting, MachineFeatures {
    var features: Set<WireRequest> = [.voiceStart, .voiceStop, .voiceConfirm, .voiceKeyStatus]
    var requests: [(String, JSONValue)] = []
    var keyPresent = true
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
        case "voice.confirm": return .object(["accepted": .bool(true)])
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

@MainActor private final class FakeMedia: VoiceMedia {
    var onEvent: (@MainActor (VoiceMediaEvent) -> Void)?
    var answer: String?
    var closed = false
    var offers = 0

    func offer() async throws -> String {
        offers += 1
        return "offer-sdp"
    }
    func accept(answer: String) async throws { self.answer = answer }
    func close() { closed = true }
}

@MainActor private final class FakeAudio: VoiceAudio {
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

@MainActor private final class ManualScheduler: TransportScheduling {
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
