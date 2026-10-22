import Foundation
import RuimtePulsar
import RuimteTransport
import RuimteVoice
import Testing

@testable import Ruimte

@Suite @MainActor struct VoiceCoordinatorTests {
    private static let target = VoiceTarget(machineID: "machine", projectID: "project", projectName: "Ruimte")

    private static let clock = Date(timeIntervalSince1970: 1_800_000_000)

    private struct Setup {
        let voice: VoiceCoordinator
        let machine: VoiceMachine
        let media: FakeMedia
        let audio: FakeAudio
        let scheduler: ManualScheduler
        let live: FakeLive
        let links: LinkHolds
    }

    private static func setup(declaresMicrophone: Bool = true) -> Setup {
        let machine = VoiceMachine()
        let media = FakeMedia()
        let audio = FakeAudio()
        let scheduler = ManualScheduler()
        let live = FakeLive()
        let links = LinkHolds()
        let voice = VoiceCoordinator(
            media: { media }, audio: { audio }, scheduler: scheduler,
            deviceLanguage: { "nl" },
            makeID: { "start-1" }, timeZone: { "Europe/Amsterdam" }, now: { Self.clock }, live: live,
            holdLinks: { links.holds.append($0) }, declaresMicrophone: declaresMicrophone)
        return Setup(
            voice: voice, machine: machine, media: media, audio: audio, scheduler: scheduler, live: live, links: links)
    }

    private static func caption(_ speaker: VoiceSpeaker, _ text: String) -> VoiceMediaEvent {
        .caption(LiveCaption(speaker: speaker, delta: text, startMs: 0, endMs: 0))
    }

    private static func settle() async {
        for _ in 0..<20 { await Task.yield() }
    }

    private static func status(
        _ phase: String, seq: Int, scene: String = "A", session: String = "session-1", project: JSONValue? = nil
    ) -> JSONValue {
        var fields: [String: JSONValue] = [
            "sessionId": .string(session), "sceneId": .string(scene), "seq": .number(Double(seq)),
            "phase": .string(phase),
        ]
        if let project { fields["project"] = project }
        return .object(fields)
    }

    private static func project(_ id: String, _ name: String) -> JSONValue {
        .object(["id": .string(id), "name": .string(name)])
    }

    private static func activity(
        _ id: String, status: String, seq: Int, scene: String = "A", label: String = "Read the chat"
    ) -> JSONValue {
        .object([
            "sessionId": .string("session-1"), "sceneId": .string(scene), "seq": .number(Double(seq)),
            "entry": .object([
                "id": .string(id), "at": .number(1), "kind": .string("chat"), "status": .string(status),
                "label": .string(label), "detail": .string("Release notes"),
            ]),
        ])
    }

    @Test func aStartSendsTheOfferWithItsSceneAndPlaysTheAnswer() async {
        let setup = Self.setup()
        setup.machine.preferences = .object(["language": .string("nl"), "voice": .string("cedar")])
        await setup.voice.refreshPreferences(machineID: "machine", client: setup.machine)
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

    @Test func aStartWithoutAProjectLetsTheMachineChooseOne() async throws {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: VoiceTarget(machineID: "machine"), client: setup.machine)
        let start = try #require(setup.machine.requests.first { $0.0 == "voice.start" }?.1)
        #expect(start["projectId"] == nil)
        #expect(start["viewId"] == nil)
        #expect(throws: Never.self) { try WireRequest.voiceStart.validatePayload(start) }
        #expect(setup.voice.sessionID == "session-1")
    }

    @Test func thePlaceFollowsTheProjectTheMachineNames() async {
        let setup = Self.setup()
        var target = Self.target
        target.viewID = "canvas-1"
        await setup.voice.start(scene: "A", target: target, client: setup.machine)
        setup.machine.emit("voice.status", Self.status("active", seq: 1, project: Self.project("project", "Ruimte")))
        #expect(setup.voice.target == target, "The project it started in keeps the canvas on screen")
        setup.machine.emit("voice.status", Self.status("active", seq: 2, project: Self.project("site", "Site")))
        #expect(setup.voice.target == VoiceTarget(machineID: "machine", projectID: "site", projectName: "Site"))
        let elsewhere = Self.status("active", seq: 3, scene: "B", project: Self.project("old", "Old"))
        setup.machine.emit("voice.status", elsewhere)
        #expect(setup.voice.target?.projectID == "site", "Another scene's session moves nothing here")
        setup.machine.emit("voice.status", Self.status("active", seq: 4, project: .null))
        #expect(setup.voice.target == VoiceTarget(machineID: "machine"))
        setup.machine.emit("voice.status", Self.status("active", seq: 5, project: Self.project("site", "Site")))
        setup.machine.emit("voice.status", Self.status("active", seq: 6))
        #expect(setup.voice.target?.projectName == "Site", "A status without the field leaves the place as it was")
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
        setup.voice.setMuted(true, scene: "B")
        setup.voice.sceneClosed("B")
        #expect(setup.voice.isOwner("A"))
        #expect(!setup.voice.muted)
    }

    @Test func voiceHoldsTheMachineLinksWhileItRunsSoTheBackgroundKeepsIt() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        #expect(setup.links.holds == [true], "The links stay open with every scene in the background")
        #expect(setup.voice.problem(in: "A") == nil)
        setup.voice.stop(scene: "A")
        #expect(setup.links.holds == [true, false])
    }

    @Test func aSceneThatClosesEndsWhatItStarted() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.voice.sceneClosed("A")
        await Self.settle()
        #expect(setup.voice.phase == .idle)
        #expect(setup.machine.sent("voice.stop"))
        #expect(setup.voice.problem(in: "A") == nil)
    }

    @Test func muteSilencesTheMicrophoneAndKeepsTheSession() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        setup.voice.setMuted(true, scene: "A")
        #expect(setup.media.muted)
        #expect(setup.voice.muted)
        #expect(setup.voice.phase == .active)
        #expect(setup.voice.isOwner("A"))
        #expect(!setup.machine.sent("voice.stop"))
        #expect(setup.audio.owner == "A", "The audio session stays, so the reply keeps playing")
        setup.voice.perform(.toggleMute)
        #expect(!setup.media.muted, "The Live Activity's button turns it on again")
        setup.voice.setMuted(true, scene: "A")
        setup.voice.stop(scene: "A")
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        #expect(!setup.voice.muted, "A new session starts with the microphone on")
        #expect(!setup.media.muted)
    }

    @Test func theBandMeasuresTheSamplesOfTheMediaAndAMutedMicrophoneFallsSilent() async throws {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        let window = (0..<VoiceSampleWindow.size).map { Float(sin(Double($0) * 0.2) * 0.1) }
        setup.media.reading = VoiceSamples(person: window, voice: window.map { $0 / 2 })
        setup.voice.measureBands()
        let person = try #require(setup.voice.bands.input.max())
        let voice = try #require(setup.voice.bands.output.max())
        #expect(person > voice, "The louder side draws taller")
        #expect(voice > 0)
        setup.voice.setMuted(true, scene: "A")
        setup.voice.measureBands()
        #expect(try #require(setup.voice.bands.input.max()) < person, "The muted microphone falls back")
        #expect(try #require(setup.voice.bands.output.max()) > voice, "The reply still plays")
        setup.voice.stop(scene: "A")
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        #expect(setup.voice.bands == .silent, "A new session starts with a quiet band")
    }

    // MARK: The Live Activity

    @Test func theLiveActivityStartsOnceVoiceIsActiveAndFollowsItsPhase() async {
        let setup = Self.setup()
        var target = Self.target
        target.machineName = "MacBook Pro"
        await setup.voice.start(scene: "A", target: target, client: setup.machine)
        #expect(setup.live.shown.isEmpty, "Nothing shows while it connects")
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        let listening = VoiceLiveContent(phase: .listening, project: "Ruimte", startedAt: Self.clock)
        #expect(setup.live.shown.last == listening)
        #expect(setup.live.machine == "MacBook Pro")
        setup.media.onEvent?(Self.caption(.model, "Here is"))
        setup.media.onEvent?(Self.caption(.model, " the build."))
        #expect(setup.live.shown.last?.phase == .speaking)
        #expect(setup.live.shown.count == 2, "Every caption of one reply is one update")
        setup.scheduler.fire()
        #expect(setup.live.shown.last?.phase == .listening, "A reply that went quiet is done speaking")
        setup.machine.emit("voice.activity", Self.activity("line-1", status: "running", seq: 2, label: "Prompting"))
        #expect(setup.live.shown.last?.phase == .acting)
        #expect(setup.live.shown.last?.action == "Prompting")
        setup.machine.emit("voice.activity", Self.activity("line-1", status: "completed", seq: 3))
        #expect(setup.live.shown.last == listening)
        setup.voice.setMuted(true, scene: "A")
        #expect(setup.live.shown.last?.muted == true)
        setup.machine.emit("voice.status", Self.status("active", seq: 4, project: Self.project("site", "Site")))
        #expect(setup.live.shown.last?.project == "Site")
        setup.machine.emit("voice.status", Self.status("stopping", seq: 5))
        #expect(setup.live.shown.last?.phase == .stopping)
        setup.machine.emit("voice.status", Self.status("closed", seq: 6))
        #expect(
            setup.live.ended
                == [VoiceLiveContent(phase: .ended, project: "Site", startedAt: Self.clock)])
    }

    @Test func aLiveActivityEndsSayingWhyVoiceStopped() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        setup.media.onEvent?(.lost)
        #expect(setup.live.ended.last?.phase == .ended)
        #expect(setup.live.ended.last?.problem == "The audio connection to OpenAI dropped, so Voice stopped.")
    }

    @Test func aStartThatNeverWentActiveLeavesNoLiveActivity() async {
        let setup = Self.setup()
        setup.machine.connected = false
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.machine.connected = true
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.voice.stop(scene: "A")
        #expect(setup.live.shown.isEmpty)
        #expect(setup.live.ended.isEmpty)
    }

    @Test func theStopOfTheLiveActivityStopsTheSession() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        setup.voice.perform(.stop)
        await Self.settle()
        #expect(setup.voice.phase == .idle)
        #expect(setup.machine.stops == [.object(["sceneId": .string("A"), "sessionId": .string("session-1")])])
        #expect(setup.live.ended.count == 1)
        setup.voice.perform(.stop)
        #expect(setup.machine.stops.count == 1, "Without a session the button does nothing")
    }

    // MARK: The timeline

    @Test func anActionStandsUnderTheVoiceSentenceThatLedToIt() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.media.onEvent?(Self.caption(.person, "Read the release chat"))
        setup.machine.emit("voice.activity", Self.activity("read", status: "running", seq: 1))
        setup.media.onEvent?(Self.caption(.model, "It shipped yesterday."))
        setup.media.onEvent?(Self.caption(.person, "Start a chat for the notes"))
        setup.media.onEvent?(Self.caption(.model, "Starting one."))
        setup.machine.emit("voice.activity", Self.activity("start", status: "running", seq: 2))
        setup.machine.emit("voice.activity", Self.activity("read", status: "completed", seq: 3))
        let rows = setup.voice.timeline(in: "A").map(\.id)
        #expect(
            rows == ["line:0", "line:1", "action:read", "line:2", "line:3", "action:start"],
            "An action that came after the person's line stands under Voice's answer")
        #expect(setup.voice.activity.first { $0.id == "read" }?.status == "completed")
        #expect(setup.voice.timeline(in: "B").isEmpty, "Another scene shows no timeline of this one")
    }

    @Test func aConversationThatEndedKeepsItsTimelineWithAnEndMarkerUntilTheNextStart() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        setup.media.onEvent?(Self.caption(.model, "Hello."))
        #expect(setup.voice.timeline(in: "A").last?.id == "line:0")
        setup.audio.onChange?(.interrupted)
        #expect(setup.voice.ended)
        #expect(setup.voice.timeline(in: "A").map(\.id) == ["line:0", "ended"])
        #expect(setup.voice.problem(in: "A") == .message("A call or another app took the audio, so Voice stopped."))
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        #expect(!setup.voice.ended)
        #expect(setup.voice.timeline(in: "A").isEmpty)
    }

    @Test func anActionWithoutAVoiceLineStandsAtTheTopOrUnderTheLineNobodyAnswered() {
        let action: (String, Int?) -> VoiceActivityLine = {
            VoiceActivityLine(id: $0, kind: "chat", status: "completed", label: "Read", detail: "", after: $1)
        }
        #expect(
            VoiceTimeline.items(lines: [], activity: [action("early", nil)], ended: true).map(\.id)
                == ["action:early", "ended"])
        var transcript = VoiceTranscript()
        transcript.add(LiveCaption(speaker: .person, delta: "Read it", startMs: 0, endMs: 0))
        let items = VoiceTimeline.items(
            lines: transcript.lines, activity: [action("early", nil), action("asked", 0), action("trimmed", -5)],
            ended: false)
        #expect(
            items.map(\.id) == ["action:early", "action:trimmed", "line:0", "action:asked"],
            "An action whose line is no longer kept stands at the top")
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
        #expect(!setup.voice.ended, "No conversation ran, so there is no timeline to keep")
        #expect(setup.links.holds == [true, false])
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

    private static func question(_ id: String, token: String, seq: Int) -> JSONValue {
        let event = Self.activity(id, status: "running", seq: seq, label: "Clear AI Chat")
        let confirmation: JSONValue = .object([
            "token": .string(token), "title": .string("Clear AI Chat “Builder”?"),
            "consequences": .array([.string("The conversation history will be deleted.")]),
        ])
        return event.setting("entry", event["entry"]?.setting("confirmation", confirmation))
    }

    @Test func aLineThatAsksFirstCarriesItsQuestionUntilTheMachineAnswers() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        setup.machine.emit("voice.activity", Self.question("call-1", token: "token-1", seq: 2))
        let question = setup.voice.activity.first?.question
        #expect(question?.title == "Clear AI Chat “Builder”?")
        #expect(question?.consequences == ["The conversation history will be deleted."])
        await setup.voice.answer(question!, confirm: true, scene: "A")
        #expect(
            setup.machine.requests.last?.1
                == .object([
                    "sceneId": .string("A"), "sessionId": .string("session-1"), "token": .string("token-1"),
                    "decision": .string("confirm"),
                ]))
        #expect(setup.voice.answering.isEmpty)
        #expect(setup.voice.activity.first?.question != nil, "The machine's next line says what became of it")
        setup.machine.emit(
            "voice.activity", Self.activity("call-1", status: "completed", seq: 3, label: "Clear AI Chat"))
        #expect(setup.voice.activity.map(\.id) == ["call-1"])
        #expect(setup.voice.activity.first?.question == nil)
    }

    @Test func aQuestionTheMachineNoLongerHoldsLeavesTheTimeline() async {
        let setup = Self.setup()
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        setup.machine.emit("voice.status", Self.status("active", seq: 1))
        setup.machine.emit("voice.activity", Self.question("call-1", token: "token-1", seq: 2))
        setup.machine.acceptConfirm = false
        await setup.voice.answer(setup.voice.activity.first!.question!, confirm: false, scene: "A")
        #expect(setup.machine.requests.last?.1.text("decision") == "cancel")
        #expect(setup.voice.activity.first?.question == nil)
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

    @Test func aMachineThatAnswersButHoldsNoKeyOffersNoMic() async {
        let setup = Self.setup()
        setup.machine.keyPresent = false
        await setup.voice.refreshKey(machineID: "machine", client: setup.machine)
        #expect(setup.machine.sent("voice.keyStatus"))
        #expect(setup.voice.keys["machine"] == false)
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

    @Test func theKeyboardOpensAndClosesTheSheetAndStartsNothing() async {
        let setup = Self.setup()
        let scene = VoiceScene(id: "A")
        scene.toggleSheet()
        #expect(scene.showsPanel)
        #expect(scene.proposal == nil)
        #expect(scene.place(setup.voice) == nil, "No machine offers Voice, so the sheet offers no start")
        #expect(setup.machine.requests.isEmpty)
        scene.toggleSheet()
        #expect(!scene.showsPanel)
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        scene.toggleSheet()
        #expect(setup.voice.isOwner("A"), "Opening the sheet stops nothing")
    }

    @Test func aStartGoesWhereTheMicProposedWhileItsMachineOffersVoiceElseToTheStartingPoint() async {
        let setup = Self.setup()
        await setup.voice.refreshKey(machineID: "machine", client: setup.machine)
        let runtime = AppRuntime(connections: MachineConnections(monitorPaths: false))
        defer { runtime.connections.shutdown() }
        let session: (String) -> SharedMachineSession = { id in
            SharedMachineSession(
                machine: Machine(
                    id: id, name: id, icon: nil, publicKey: String(repeating: "A", count: 43),
                    brokerUrl: "wss://broker.test", lastSeenAt: nil),
                runtime: runtime)
        }
        let offering = session("machine")
        offering.rpc.setFeatures(["voice.start", "voice.keyStatus"])
        let silent = session("other")
        let fallback = (target: VoiceTarget(machineID: "machine", machineName: "machine"), session: offering)
        let scene = VoiceScene(id: "A")
        scene.startingPoint = { fallback }

        scene.showPanel(proposing: (Self.target, offering))
        #expect(scene.place(setup.voice)?.target == Self.target)

        scene.showPanel(proposing: (VoiceTarget(machineID: "other", projectID: "p", projectName: "P"), silent))
        #expect(scene.place(setup.voice)?.target == fallback.target, "A machine without Voice is never proposed")

        scene.openTarget = { nil }
        scene.showPanel()
        #expect(scene.place(setup.voice)?.target.projectID == nil, "Without a project the machine picks one")
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
            let start: JSONValue = .object([
                "startId": .string("s"), "sceneId": .string("A"), "projectId": .string("p"), "sdp": .string("v=0"),
                "language": .string(language), "voice": .string("marin"), "timeZone": .string("UTC"),
            ])
            #expect(throws: Never.self) { try WireRequest.voiceStart.validatePayload(start) }
            let set: JSONValue = .object(["language": .string(language), "voice": .string("cedar")])
            #expect(throws: Never.self) { try WireRequest.voiceSetPreferences.validatePayload(set) }
        }
    }

    @Test func theLanguageFollowsTheDeviceWhereVoiceSpeaksIt() {
        #expect(VoicePreferences.defaultLanguage(preferred: ["nl-NL", "en-US"]) == "nl")
        #expect(VoicePreferences.defaultLanguage(preferred: ["tlh"]) == "en")
        #expect(VoicePreferences.languageName("nl") == "Nederlands")
    }

    @Test func aMachineThatStoresNoneOffersTheDeviceLanguageAndStartsWithIt() async {
        let setup = Self.setup()
        await setup.voice.refreshPreferences(machineID: "machine", client: setup.machine)
        #expect(setup.machine.sent("voice.preferences"))
        #expect(setup.voice.preferences(machineID: "machine") == VoicePreferences(language: "nl", voice: "marin"))
        await setup.voice.start(scene: "A", target: Self.target, client: setup.machine)
        let start = setup.machine.requests.first { $0.0 == "voice.start" }?.1
        #expect(start?["language"] == .string("nl"))
        #expect(start?["voice"] == .string("marin"))
    }

    @Test func eachMachineKeepsItsOwnPreferencesAndTheyFollowItsEvent() async {
        let setup = Self.setup()
        setup.machine.preferences = .object(["language": .string("de"), "voice": .string("cedar")])
        await setup.voice.refreshPreferences(machineID: "machine", client: setup.machine)
        #expect(setup.voice.preferences(machineID: "machine") == VoicePreferences(language: "de", voice: "cedar"))
        #expect(
            setup.voice.preferences(machineID: "other") == VoicePreferences(language: "nl", voice: "marin"),
            "Another machine stores nothing yet")
        setup.machine.emit(
            "voice.preferences",
            .object(["preferences": .object(["language": .string("ja"), "voice": .string("marin")])]))
        #expect(setup.voice.preferences(machineID: "machine") == VoicePreferences(language: "ja", voice: "marin"))
        await setup.voice.refreshPreferences(machineID: "machine", client: setup.machine)
        #expect(setup.machine.listeners == 1, "A second read follows the event once, not twice")
    }

    @Test func aChoiceIsStoredOnTheMachineAndTakenBackWhenItRefuses() async {
        let setup = Self.setup()
        let chosen = VoicePreferences(language: "fr", voice: "cedar")
        await setup.voice.setPreferences(chosen, machineID: "machine", client: setup.machine)
        #expect(
            setup.machine.requests.last?.1 == .object(["language": .string("fr"), "voice": .string("cedar")]))
        #expect(setup.voice.preferences(machineID: "machine") == chosen)
        setup.machine.refuseSet = true
        await setup.voice.setPreferences(
            VoicePreferences(language: "es", voice: "marin"), machineID: "machine", client: setup.machine)
        #expect(setup.voice.preferences(machineID: "machine") == chosen)
    }

    @Test func aMachineThatKeepsNoPreferencesIsNeverAskedForThem() async {
        let setup = Self.setup()
        setup.machine.features.remove(.voicePreferences)
        await setup.voice.refreshPreferences(machineID: "machine", client: setup.machine)
        #expect(!setup.voice.keepsPreferences(client: setup.machine))
        #expect(setup.machine.requests.isEmpty)
        #expect(setup.machine.listeners == 0)
        #expect(setup.voice.preferences(machineID: "machine") == VoicePreferences(language: "nl", voice: "marin"))
    }
}
