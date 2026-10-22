import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import RuimteVoice

/// Where Voice works: a machine, the project on it Voice works in now, and the canvas on screen when there is one.
/// A start names the project on screen, or none to let the machine choose; from then on the project is what
/// `voice.status` names, since Voice moves between the projects of its machine.
struct VoiceTarget: Equatable {
    let machineID: String
    var projectID: String?
    var projectName: String?
    var viewID: String?
    var machineName: String?
}

/// The requests a machine names in `endpoint.info`. `MachineClient` reads them; a test machine says what it answers.
@MainActor protocol MachineFeatures: AnyObject {
    func answers(_ type: WireRequest) -> Bool
}

extension MachineClient: MachineFeatures {}

/// A line of what Voice did on the machine, as `voice.activity` reports it.
struct VoiceActivityLine: Identifiable, Equatable {
    let id: String
    let kind: String
    let status: String
    let label: String
    let detail: String
    /// What Voice asks before the action runs, while it waits on the person's answer.
    var question: VoiceQuestion?
    /// The transcript line that was the last one when the phone first heard of this entry, which places it in the
    /// timeline. The entry's own `at` is on the machine's clock and the captions on this phone's, so arrival orders
    /// them instead.
    var after: Int?
}

/// The question of an action that asks first, answered with `voice.confirm` and its token.
struct VoiceQuestion: Equatable {
    let token: String
    let title: String
    let consequences: [String]

    init?(_ value: JSONValue?) {
        guard let value, let token = value["token"]?.stringValue, !token.isEmpty else { return nil }
        self.token = token
        title = value.text("title")
        consequences = value["consequences"]?.arrayValue?.compactMap(\.stringValue) ?? []
    }
}

/// Shows Voice's Live Activity. The coordinator says what it shows; the presenter starts, updates and ends it.
@MainActor protocol VoiceLivePresenting: AnyObject {
    func show(_ content: VoiceLiveContent, machine: String)
    func end(_ content: VoiceLiveContent)
}

/// Voice on this phone: one session per app process, owned by the scene that started it. The machine mints the
/// session, runs every tool and reports; the phone carries the microphone, the reply and the captions over a peer of
/// its own (`VoiceMedia`), and holds the app's one audio session (`VoiceAudio`) while it runs.
///
/// Every request after `voice.start` names the scene, and the events are taken only for the owner's scene and
/// session, since the scenes of an iPad share one link. A second scene sees where Voice runs and does not take the
/// microphone over. Voice keeps running in the background and on a locked screen, holding the machine links open
/// meanwhile; a call, the machine link or the media dropping end the session, and there is no resume.
@MainActor @Observable
final class VoiceCoordinator {
    enum Phase: Equatable {
        case idle
        /// Asking for the microphone, making the offer and waiting for the machine to mint and attach.
        case connecting
        case active
        case stopping
    }

    enum Problem: Equatable {
        case microphoneDenied
        case message(String)
    }

    /// How long the phone waits for `voice.start` before it cancels the start; the machine gives up after 20 s.
    static let startDeadlineMs: Double = 60_000
    static let keptActivity = 60
    /// Events that come before the start answered, which name a session the phone does not know yet.
    static let keptEarlyEvents = 32
    /// How long after the last caption of the reply Voice still counts as speaking. The captions come in pieces as the
    /// reply plays, with gaps between them.
    static let speakingHoldMs: Double = 1_200
    /// The scene that keeps the machine links open while Voice runs, also with every scene of the app in the
    /// background.
    static let linkScene = "voice"

    private(set) var phase = Phase.idle
    /// The scene that holds Voice, while a session starts or runs.
    private(set) var owner: String?
    /// The scene the last session ran in, which shows how it ended.
    private(set) var lastScene: String?
    private(set) var problem: Problem?
    private(set) var target: VoiceTarget?
    private(set) var sessionID: String?
    private(set) var transcript = VoiceTranscript()
    private(set) var activity: [VoiceActivityLine] = []
    /// The tokens of questions whose answer is on its way to the machine.
    private(set) var answering: Set<String> = []
    /// The last conversation of `lastScene` ended, and its timeline stays until the next start.
    private(set) var ended = false
    /// The microphone is off while the session goes on.
    private(set) var muted = false
    /// The reply plays now, as its captions come in.
    private(set) var speaking = false
    /// When the session went active.
    private(set) var startedAt: Date?
    /// The band while Voice listens, measured from both sides' samples as the desktop measures them.
    private(set) var bands = VoiceWaveformBands.silent
    @ObservationIgnored private var personMeter = VoiceWaveformMeter()
    @ObservationIgnored private var voiceMeter = VoiceWaveformMeter()
    /// Where the reply plays, as iOS names the route.
    private(set) var route: String?
    /// Per machine, whether it holds an OpenAI key for Voice, as `voice.keyStatus` last said.
    private(set) var keys: [String: Bool] = [:]
    /// Per machine, how Voice talks there as the machine last said; absent while it stores none or was not read.
    private(set) var stored: [String: VoicePreferences] = [:]

    @ObservationIgnored private let makeMedia: @MainActor () -> any VoiceMedia
    @ObservationIgnored private let makeAudio: @MainActor () -> any VoiceAudio
    @ObservationIgnored private lazy var audio: any VoiceAudio = {
        let audio = makeAudio()
        audio.onChange = { [weak self] change in self?.audioChanged(change) }
        return audio
    }()
    @ObservationIgnored private let scheduler: any TransportScheduling
    @ObservationIgnored private let deviceLanguage: () -> String
    @ObservationIgnored private let makeID: () -> String
    @ObservationIgnored private let timeZone: () -> String
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let live: any VoiceLivePresenting
    @ObservationIgnored private let holdLinks: @MainActor (Bool) -> Void
    @ObservationIgnored let declaresMicrophone: Bool

    @ObservationIgnored private var client: (any MachineRequesting)?
    @ObservationIgnored private var media: (any VoiceMedia)?
    @ObservationIgnored private var startID: String?
    @ObservationIgnored private var seq = -1
    @ObservationIgnored private var early: [JSONValue] = []
    @ObservationIgnored private var subscriptions: [() -> Void] = []
    @ObservationIgnored private var cancelDeadline: (() -> Void)?
    @ObservationIgnored private var cancelSpeaking: (() -> Void)?
    /// What the Live Activity shows now; nil while there is none.
    @ObservationIgnored private var shown: VoiceLiveContent?
    /// Per machine, the `voice.preferences` event this phone follows.
    @ObservationIgnored private var preferenceWatches: [String: () -> Void] = [:]
    /// Moves with every start and every end, so what a start awaited finds out it no longer counts.
    @ObservationIgnored private var attempt = 0

    init(
        media: @escaping @MainActor () -> any VoiceMedia, audio: @escaping @MainActor () -> any VoiceAudio,
        scheduler: any TransportScheduling = TaskTransportScheduler(),
        deviceLanguage: @escaping () -> String = { VoicePreferences.defaultLanguage() },
        makeID: @escaping () -> String = { UUID().uuidString },
        timeZone: @escaping () -> String = { TimeZone.current.identifier },
        now: @escaping () -> Date = { Date() },
        live: any VoiceLivePresenting,
        holdLinks: @escaping @MainActor (Bool) -> Void = { _ in },
        declaresMicrophone: Bool = VoiceCoordinator.appDeclaresMicrophone
    ) {
        makeMedia = media
        makeAudio = audio
        self.scheduler = scheduler
        self.deviceLanguage = deviceLanguage
        self.makeID = makeID
        self.timeZone = timeZone
        self.now = now
        self.live = live
        self.holdLinks = holdLinks
        self.declaresMicrophone = declaresMicrophone
    }

    /// Only a Debug build asks for the microphone until its use is decided, and asking without the declaration would
    /// end the app, so a build without it never offers Voice.
    static var appDeclaresMicrophone: Bool {
        Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") != nil
    }

    // MARK: Whether Voice is offered

    /// Whether the mic button shows for a project on this machine: the app may use the microphone, the machine
    /// answers `voice.start`, and `voice.keyStatus` last said it holds a key. A machine without one offers no mic.
    func offers(machineID: String, client: any MachineRequesting) -> Bool {
        declaresMicrophone && (client as? MachineFeatures)?.answers(.voiceStart) == true && keys[machineID] == true
    }

    /// Asks the machine whether it holds a key, once it answers the request.
    func refreshKey(machineID: String, client: any MachineRequesting) async {
        guard declaresMicrophone, (client as? MachineFeatures)?.answers(.voiceKeyStatus) == true else {
            keys[machineID] = nil
            return
        }
        do {
            let result = try WireRequest.voiceKeyStatus.validateResult(try await client.request(.voiceKeyStatus))
            keys[machineID] = result["present"]?.boolValue == true
        } catch {
            keys[machineID] = nil
        }
    }

    // MARK: How Voice talks

    /// How Voice talks on a machine: what it stores, else the device's language with the default voice, which the
    /// next start then sends.
    func preferences(machineID: String) -> VoicePreferences {
        stored[machineID] ?? VoicePreferences(language: deviceLanguage(), voice: VoicePreferences.defaultVoice)
    }

    /// Whether the machine keeps how Voice talks, so the phone can show and change it there.
    func keepsPreferences(client: any MachineRequesting) -> Bool {
        (client as? MachineFeatures)?.answers(.voicePreferences) == true
    }

    /// Reads what the machine stores and follows every change any client makes, once it answers the request.
    func refreshPreferences(machineID: String, client: any MachineRequesting) async {
        preferenceWatches.removeValue(forKey: machineID)?()
        guard keepsPreferences(client: client) else {
            stored[machineID] = nil
            return
        }
        preferenceWatches[machineID] = client.subscribe(.voicePreferences) { [weak self] state in
            self?.adopt(state, machineID: machineID)
        }
        do {
            adopt(try WireRequest.voicePreferences.validateResult(try await client.request(.voicePreferences)), machineID: machineID)
        } catch {
            // What the machine stores stays unknown until the next read or event.
        }
    }

    /// Stores a choice on the machine, shown at once and taken back when the machine refuses it.
    func setPreferences(_ chosen: VoicePreferences, machineID: String, client: any MachineRequesting) async {
        let before = stored[machineID]
        stored[machineID] = chosen
        let payload: JSONValue = .object(["language": .string(chosen.language), "voice": .string(chosen.voice)])
        do {
            adopt(
                try WireRequest.voiceSetPreferences.validateResult(
                    try await client.request(.voiceSetPreferences, payload: payload)), machineID: machineID)
        } catch {
            stored[machineID] = before
        }
    }

    private func adopt(_ state: JSONValue, machineID: String) {
        guard let language = state["preferences"]?["language"]?.stringValue,
            let voice = state["preferences"]?["voice"]?.stringValue
        else {
            stored[machineID] = nil
            return
        }
        stored[machineID] = VoicePreferences(language: language, voice: voice)
    }

    // MARK: Who holds it

    func isOwner(_ scene: String) -> Bool { owner == scene }

    /// Voice runs, in a scene other than this one.
    func runsElsewhere(than scene: String) -> Bool { owner != nil && owner != scene }

    /// What a scene shows of the last session that ran in it.
    func problem(in scene: String) -> Problem? { lastScene == scene ? problem : nil }

    /// The timeline a scene shows: the conversation that runs in it, or the last one that ended there.
    func timeline(in scene: String) -> [VoiceTimelineItem] {
        guard lastScene == scene, owner == scene || ended else { return [] }
        return VoiceTimeline.items(lines: transcript.lines, activity: activity, ended: owner == nil && ended)
    }

    // MARK: Starting and stopping

    /// Starts Voice for `scene`. Nothing happens while Voice runs or starts, in this scene or another.
    func start(scene: String, target: VoiceTarget, client: any MachineRequesting) async {
        guard phase == .idle, owner == nil else { return }
        attempt += 1
        let current = attempt
        // An end leaves nothing behind, but a start never builds on what an earlier one might have.
        for cancel in subscriptions { cancel() }
        subscriptions = []
        media?.close()
        media = nil
        owner = scene
        lastScene = scene
        self.target = target
        self.client = client
        problem = nil
        route = nil
        transcript.clear()
        activity = []
        answering = []
        ended = false
        muted = false
        speaking = false
        startedAt = nil
        personMeter.clear()
        voiceMeter.clear()
        bands = .silent
        phase = .connecting
        holdLinks(true)
        if audio.permission == .undetermined {
            _ = await audio.requestPermission()
            guard current == attempt else { return }
        }
        guard audio.permission == .granted else {
            end(.microphoneDenied, tellMachine: false)
            return
        }
        let startID = makeID()
        self.startID = startID
        listen(to: client, attempt: current)
        // The link may be down already, which ends the start inside `listen`, before any peer or deadline is made.
        guard current == attempt else { return }
        let media = makeMedia()
        self.media = media
        media.muted = muted
        media.onEvent = { [weak self] event in self?.mediaEvent(event, attempt: current) }
        cancelDeadline = scheduler.after(milliseconds: Self.startDeadlineMs) { [weak self] in
            guard let self, current == attempt, sessionID == nil else { return }
            end(.message(String(localized: "The machine did not start Voice in time.")), tellMachine: true)
        }
        do {
            let offer = try await media.offer()
            guard current == attempt else { return }
            let chosen = preferences(machineID: target.machineID)
            var payload: [String: JSONValue] = [
                "startId": .string(startID), "sceneId": .string(scene), "sdp": .string(offer),
                "language": .string(chosen.language), "voice": .string(chosen.voice), "timeZone": .string(timeZone()),
            ]
            if let projectID = target.projectID { payload["projectId"] = .string(projectID) }
            if let viewID = target.viewID { payload["viewId"] = .string(viewID) }
            let result = try WireRequest.voiceStart.validateResult(
                try await client.request(.voiceStart, payload: .object(payload)))
            let sessionID = result.text("sessionId")
            guard current == attempt else {
                // Stopped while the machine started it: the stop by start id may have come too late for this one.
                Self.stop(client: client, scene: scene, field: "sessionId", id: sessionID)
                return
            }
            self.sessionID = sessionID
            cancelDeadline?()
            cancelDeadline = nil
            if let status = result["status"] { apply(status: status) }
            for event in early where event.text("sessionId") == sessionID { received(event) }
            early = []
            guard current == attempt else { return }
            try await media.accept(answer: result.text("sdp"))
            guard current == attempt else { return }
            try audio.activate(owner: scene)
            route = (audio as? AudioRouteNaming)?.route
        } catch is CancellationError {
            if current == attempt { end(nil, tellMachine: true) }
        } catch {
            guard current == attempt else { return }
            end(.message(Self.describe(error)), tellMachine: true)
        }
    }

    /// Stops the session `scene` started, or the start it has on its way.
    func stop(scene: String) {
        guard owner == scene else { return }
        end(nil, tellMachine: true)
    }

    func sceneClosed(_ scene: String) {
        guard owner == scene else { return }
        end(nil, tellMachine: true)
    }

    /// Turns the microphone off or on again; the session and the reply go on either way.
    func setMuted(_ muted: Bool, scene: String) {
        guard owner == scene else { return }
        self.muted = muted
        media?.muted = muted
        publishLive()
    }

    /// A button of the Live Activity, which acts on the session whichever scene holds it.
    func perform(_ command: VoiceLiveCommands.Command) {
        guard let owner else { return }
        switch command {
        case .stop: stop(scene: owner)
        case .toggleMute: setMuted(!muted, scene: owner)
        }
    }

    /// Measures the band once from the newest samples; the sheet asks every 32 ms while its band shows, as the
    /// desktop's monitor measures. A muted microphone measures as silence.
    func measureBands() {
        guard let media, owner != nil else { return }
        let samples = media.samples()
        personMeter.measure(muted ? nil : samples.person)
        voiceMeter.measure(samples.voice)
        bands = VoiceWaveformBands(input: personMeter.bands, output: voiceMeter.bands)
    }

    /// The person's answer from the timeline. The machine's next line of that action says what became of it; a question
    /// the machine no longer holds (answered through Voice already, or void) leaves the timeline at once.
    func answer(_ question: VoiceQuestion, confirm: Bool, scene: String) async {
        guard !answering.contains(question.token) else { return }
        answering.insert(question.token)
        let accepted = await self.confirm(scene: scene, token: question.token, decision: confirm ? "confirm" : "cancel")
        answering.remove(question.token)
        if !accepted, let index = activity.firstIndex(where: { $0.question?.token == question.token }) {
            activity[index].question = nil
        }
    }

    /// The person's answer to an action that asked first.
    func confirm(scene: String, token: String, decision: String) async -> Bool {
        guard owner == scene, let sessionID, let client else { return false }
        let payload: JSONValue = .object([
            "sceneId": .string(scene), "sessionId": .string(sessionID), "token": .string(token),
            "decision": .string(decision),
        ])
        guard let result = try? await client.request(.voiceConfirm, payload: payload),
            let checked = try? WireRequest.voiceConfirm.validateResult(result)
        else { return false }
        return checked["accepted"]?.boolValue == true
    }

    // MARK: What comes in

    /// `observeConnection` answers at once with where the link stands, so a link that is down ends the start inside
    /// this call. Each subscription is kept as soon as it is made, so that end cancels it, and the one made after the
    /// end is cancelled here.
    private func listen(to client: any MachineRequesting, attempt current: Int) {
        subscriptions.append(client.subscribe(.voiceStatus) { [weak self] in self?.received($0) })
        subscriptions.append(client.subscribe(.voiceActivity) { [weak self] in self?.received($0) })
        let connection = client.observeConnection { [weak self] connected in
            guard let self, !connected, owner != nil else { return }
            let message = String(localized: "The connection to the machine dropped, so Voice stopped.")
            end(.message(message), tellMachine: false)
        }
        if current == attempt {
            subscriptions.append(connection)
        } else {
            connection()
        }
    }

    /// A `voice.status` or `voice.activity` event, taken only for the owner's scene and session, in `seq` order.
    private func received(_ event: JSONValue) {
        guard let owner, event.text("sceneId") == owner else { return }
        guard let sessionID else {
            if early.count < Self.keptEarlyEvents { early.append(event) }
            return
        }
        guard event.text("sessionId") == sessionID, let seq = event["seq"]?.numberValue.map(Int.init),
            seq > self.seq
        else { return }
        if let entry = event["entry"] {
            self.seq = seq
            note(entry)
        } else {
            apply(status: event)
        }
    }

    private func apply(status: JSONValue) {
        guard let seq = status["seq"]?.numberValue.map(Int.init), seq > self.seq else { return }
        self.seq = seq
        if let project = status["project"] { follow(project) }
        switch status.text("phase") {
        case "starting": phase = .connecting
        case "active":
            phase = .active
            if startedAt == nil { startedAt = now() }
        case "stopping": phase = .stopping
        case "closed":
            end(nil, tellMachine: false)
            return
        case "failed":
            let said = status["error"]?.text("message") ?? ""
            let message = said.isEmpty ? String(localized: "Voice stopped on the machine.") : said
            end(.message(message), tellMachine: false)
            return
        default: break
        }
        publishLive()
    }

    /// The project the machine says Voice works in now; null for none. The canvas on screen belongs to the project
    /// the start named, so it goes once Voice moves on.
    private func follow(_ project: JSONValue) {
        guard let target else { return }
        let projectID = project["id"]?.stringValue
        let name = project["name"]?.stringValue
        if target.projectID == projectID {
            self.target?.projectName = name
        } else {
            self.target = VoiceTarget(
                machineID: target.machineID, projectID: projectID, projectName: name, machineName: target.machineName)
        }
    }

    private func note(_ entry: JSONValue) {
        var line = VoiceActivityLine(
            id: entry.text("id"), kind: entry.text("kind"), status: entry.text("status"), label: entry.text("label"),
            detail: entry.text("detail"), question: VoiceQuestion(entry["confirmation"]),
            after: transcript.lines.last?.id)
        if let index = activity.firstIndex(where: { $0.id == line.id }) {
            line.after = activity[index].after
            activity[index] = line
        } else {
            activity.append(line)
            if activity.count > Self.keptActivity { activity.removeFirst(activity.count - Self.keptActivity) }
        }
        publishLive()
    }

    private func mediaEvent(_ event: VoiceMediaEvent, attempt current: Int) {
        guard current == attempt else { return }
        switch event {
        case .caption(let caption):
            transcript.add(caption)
            heard(caption.speaker)
        case .started: break
        case .lost:
            let message = String(localized: "The audio connection to OpenAI dropped, so Voice stopped.")
            end(.message(message), tellMachine: true)
        }
    }

    /// The reply speaks while its captions come in and a moment after; the person speaking ends it, as they speak over
    /// it.
    private func heard(_ speaker: VoiceSpeaker) {
        cancelSpeaking?()
        cancelSpeaking = nil
        guard speaker == .model else {
            setSpeaking(false)
            return
        }
        setSpeaking(true)
        cancelSpeaking = scheduler.after(milliseconds: Self.speakingHoldMs) { [weak self] in
            self?.cancelSpeaking = nil
            self?.setSpeaking(false)
        }
    }

    private func setSpeaking(_ speaking: Bool) {
        guard self.speaking != speaking else { return }
        self.speaking = speaking
        publishLive()
    }

    // MARK: The Live Activity

    /// What the Live Activity shows of the session now. It starts once the session went active, so a start that fails
    /// leaves none behind.
    var liveContent: VoiceLiveContent? {
        guard owner != nil, shown != nil || phase == .active else { return nil }
        let running = activity.last { $0.status == "running" }
        let livePhase: VoiceLiveContent.Phase =
            switch phase {
            case .idle, .connecting: .connecting
            case .stopping: .stopping
            case .active: running != nil ? .acting : speaking ? .speaking : .listening
            }
        return VoiceLiveContent(
            phase: livePhase, muted: muted, action: running?.label, project: target?.projectName,
            startedAt: startedAt)
    }

    private func publishLive() {
        guard let content = liveContent, content != shown else { return }
        shown = content
        live.show(content, machine: target?.machineName ?? "")
    }

    private func audioChanged(_ change: VoiceAudioChange) {
        guard owner != nil else { return }
        switch change {
        case .interrupted:
            let message = String(localized: "A call or another app took the audio, so Voice stopped.")
            end(.message(message), tellMachine: true)
        case .reset:
            let message = String(localized: "The audio of this device restarted, so Voice stopped.")
            end(.message(message), tellMachine: true)
        case .taken:
            let message = String(localized: "Something else in Ruimte took the audio, so Voice stopped.")
            end(.message(message), tellMachine: true)
        case .route(let name):
            route = name.isEmpty ? nil : name
        }
    }

    // MARK: The end

    /// Ends the session or start on this phone and, unless the machine ended it, asks the machine to stop it too.
    private func end(_ problem: Problem?, tellMachine: Bool) {
        guard let scene = owner else { return }
        attempt += 1
        if tellMachine, let client {
            if let sessionID {
                Self.stop(client: client, scene: scene, field: "sessionId", id: sessionID)
            } else if let startID {
                Self.stop(client: client, scene: scene, field: "startId", id: startID)
            }
        }
        cancelDeadline?()
        cancelDeadline = nil
        cancelSpeaking?()
        cancelSpeaking = nil
        for cancel in subscriptions { cancel() }
        subscriptions = []
        media?.onEvent = nil
        media?.close()
        media = nil
        audio.deactivate(owner: scene)
        ended = sessionID != nil || !transcript.lines.isEmpty || !activity.isEmpty
        owner = nil
        client = nil
        sessionID = nil
        startID = nil
        seq = -1
        early = []
        phase = .idle
        speaking = false
        muted = false
        self.problem = problem
        if let shown {
            var last = shown
            last.phase = .ended
            last.muted = false
            last.action = nil
            last.problem = problem.map(VoiceText.problem)
            live.end(last)
            self.shown = nil
        }
        holdLinks(false)
    }

    private static func stop(client: any MachineRequesting, scene: String, field: String, id: String) {
        guard !id.isEmpty else { return }
        let payload: JSONValue = .object(["sceneId": .string(scene), field: .string(id)])
        Task { _ = try? await client.request(.voiceStop, payload: payload) }
    }

    private static func describe(_ error: Error) -> String {
        if let failure = error as? VoiceAudioFailure {
            switch failure {
            case .busy: return String(localized: "Voice runs in another window.")
            case .microphoneDenied: return String(localized: "Ruimte may not use the microphone.")
            case .unavailable(let message): return message
            }
        }
        return error.localizedDescription
    }
}

/// An audio session that can say where the reply plays.
@MainActor protocol AudioRouteNaming {
    var route: String? { get }
}

extension AudioSessionController: AudioRouteNaming {}
