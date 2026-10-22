import Foundation
import RuimtePulsar
import RuimteVoice
import SwiftUI
import Testing
import UIKit

@testable import Ruimte

/// Renders the Voice sheet in its states and the Live Activity's lock screen card to PNG files for review. Runs only
/// when `RUIMTE_VOICE_SNAPSHOTS` names a folder (`TEST_RUNNER_RUIMTE_VOICE_SNAPSHOTS` through `xcodebuild`), since it
/// waits on presentation and animation.
@Suite(.serialized) @MainActor struct VoiceSheetSnapshots {
    private nonisolated static let folder = ProcessInfo.processInfo.environment["RUIMTE_VOICE_SNAPSHOTS"]
    private static let place = VoiceTarget(
        machineID: "machine", projectID: "php", projectName: "PHP", machineName: "MacBook Pro")

    private struct Stage {
        let voice: VoiceCoordinator
        let machine: VoiceMachine
        let media: FakeMedia
        let audio: FakeAudio
    }

    private static func stage() -> Stage {
        let machine = VoiceMachine()
        let media = FakeMedia()
        let audio = FakeAudio()
        let voice = VoiceCoordinator(
            media: { media }, audio: { audio }, scheduler: ManualScheduler(), deviceLanguage: { "en" },
            makeID: { "start-1" }, timeZone: { "Europe/Amsterdam" }, now: { Date().addingTimeInterval(-134) },
            live: FakeLive(), declaresMicrophone: true)
        return Stage(voice: voice, machine: machine, media: media, audio: audio)
    }

    private static func conversation() async -> Stage {
        let stage = stage()
        await stage.voice.start(scene: "A", target: place, client: stage.machine)
        stage.machine.emit(
            "voice.status",
            .object([
                "sessionId": .string("session-1"), "sceneId": .string("A"), "seq": .number(1),
                "phase": .string("active"),
            ]))
        stage.audio.onChange?(.route("iPhone speaker"))
        var clock = 0.0
        let say: (VoiceSpeaker, String) -> Void = { speaker, text in
            clock += 4_000
            stage.media.onEvent?(.caption(LiveCaption(speaker: speaker, delta: text, startMs: clock, endMs: clock + 2_000)))
        }
        let did: (String, Int, String, String, String) -> Void = { id, seq, status, label, detail in
            stage.machine.emit(
                "voice.activity",
                .object([
                    "sessionId": .string("session-1"), "sceneId": .string("A"), "seq": .number(Double(seq)),
                    "entry": .object([
                        "id": .string(id), "at": .number(1), "kind": .string("chat"), "status": .string(status),
                        "label": .string(label), "detail": .string(detail),
                    ]),
                ]))
        }
        say(.person, "What is the release chat doing?")
        say(.model, "It finished its turn two minutes ago and wrote the changelog.")
        did("read", 2, "completed", "Read the chat", "Release")
        say(.person, "Ask it to open a pull request for it.")
        say(.model, "Asking the release chat now. Anything else you want me to")
        did("prompt", 3, "running", "Prompting the chat", "Release")
        // The person trails off while Voice starts its answer; the sheet goes on measuring the last window.
        for frame in 0..<22 {
            let time = 0.4 + Double(frame) * 0.032
            stage.media.reading = VoiceSamples(
                person: Self.voice(at: time, pitch: 150, loudness: frame < 14 ? 0.16 : 0.03),
                voice: frame < 10 ? nil : Self.voice(at: time, pitch: 210, loudness: 0.12))
            stage.voice.measureBands()
        }
        return stage
    }

    /// A voice of `pitch` Hz with two overtones and four syllables a second: the window of samples at 48 kHz that
    /// ends `time` seconds in.
    private static func voice(at time: Double, pitch: Double, loudness: Double) -> [Float] {
        (0..<VoiceSampleWindow.size).map { index in
            let moment = time - Double(VoiceSampleWindow.size - index) / 48_000
            let syllable = max(0.15, sin(2 * .pi * 4 * moment))
            let turn = 2 * Double.pi * pitch * moment
            return Float(loudness * syllable * (sin(turn) + 0.5 * sin(2 * turn + 0.4) + 0.3 * sin(3 * turn + 1.1)))
        }
    }

    @Test(.enabled(if: folder != nil)) func theSheetInEachState() async throws {
        let idle = Self.stage()
        try await Self.render(sheet(idle.voice), name: "1-idle-dark")
        try await Self.render(sheet(idle.voice), name: "2-idle-light", dark: false)
        try await Self.render(sheet(idle.voice, namesMachine: true), name: "2b-idle-two-machines")

        let connecting = Self.stage()
        connecting.machine.holdStart = true
        let starting = Task { await connecting.voice.start(scene: "A", target: Self.place, client: connecting.machine) }
        for _ in 0..<20 { await Task.yield() }
        try await Self.render(sheet(connecting.voice), name: "3-connecting")
        connecting.machine.answerStart()
        await starting.value

        let talking = await Self.conversation()
        try await Self.render(sheet(talking.voice), name: "4-conversation")
        try await Self.render(sheet(talking.voice), name: "5-conversation-light", dark: false)
        talking.voice.setMuted(true, scene: "A")
        try await Self.render(sheet(talking.voice), name: "6-muted")

        talking.voice.stop(scene: "A")
        try await Self.render(sheet(talking.voice), name: "7-ended")

        let dropped = await Self.conversation()
        dropped.media.onEvent?(.lost)
        try await Self.render(sheet(dropped.voice), name: "8-ended-on-a-problem")

        let denied = Self.stage()
        denied.audio.permission = .denied
        await denied.voice.start(scene: "A", target: Self.place, client: denied.machine)
        try await Self.render(sheet(denied.voice), name: "9-microphone-denied")

        try await Self.render(sheet(Self.stage().voice, place: nil), name: "10-no-machine")

        let elsewhere = await Self.conversation()
        try await Self.render(sheet(elsewhere.voice, scene: "B"), name: "11-runs-in-another-window")
    }

    /// The band alone at the sheet's width, still, so a frame compares with the desktop's at the same moment. The live
    /// frames are generated voices measured through the coordinator, 32 ms apart, as the sheet measures them.
    @Test(.enabled(if: folder != nil)) func theBandFrames() async throws {
        let stage = Self.stage()
        await stage.voice.start(scene: "A", target: Self.place, client: stage.machine)
        var frames: [(String, VoiceWaveformBands)] = [("15-band-idle-19s", .idle(atMs: 19_000))]
        let kept: [Int: String] = [
            9: "16-band-live-person", 10: "17-band-live-person-next", 20: "18-band-live-both", 34: "19-band-live-voice",
        ]
        for frame in 0...34 {
            let time = 0.3 + Double(frame) * 0.032
            stage.media.reading = VoiceSamples(
                person: frame < 22 ? Self.voice(at: time, pitch: 150, loudness: 0.16) : nil,
                voice: frame > 14 ? Self.voice(at: time, pitch: 210, loudness: 0.12) : nil)
            stage.voice.measureBands()
            if let name = kept[frame] { frames.append((name, stage.voice.bands)) }
        }
        for (name, bands) in frames {
            for dark in [true, false] {
                let band = Canvas { context, size in VoiceWaveform.draw(bands, in: &context, size: size) }
                    .frame(width: 362, height: 56)
                    .padding(20)
                    .background(MobileStyle.canvas)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(MobileStyle.canvas)
                try await Self.render(band, name: "\(name)-\(dark ? "dark" : "light")", dark: dark, presented: false)
            }
        }
    }

    @Test(.enabled(if: folder != nil)) func theLiveActivityLockScreenCard() async throws {
        let started = Date().addingTimeInterval(-134)
        let states: [(String, VoiceLiveContent)] = [
            ("12-live-activity-speaking", VoiceLiveContent(phase: .speaking, project: "PHP", startedAt: started)),
            (
                "13-live-activity-acting-muted",
                VoiceLiveContent(
                    phase: .acting, muted: true, action: "Prompting the chat", project: "PHP", startedAt: started)
            ),
            (
                "14-live-activity-ended",
                VoiceLiveContent(
                    phase: .ended, project: "PHP", startedAt: started,
                    problem: "A call or another app took the audio, so Voice stopped.")
            ),
        ]
        for (name, content) in states {
            let card = VoiceLiveCard(content: content, machine: "MacBook Pro")
                .padding(.horizontal, 16).padding(.vertical, 14)
                .background(VoiceLiveColors.tint, in: RoundedRectangle(cornerRadius: 24))
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .padding(.top, 120)
                .background(LinearGradient(colors: [.indigo, .black], startPoint: .top, endPoint: .bottom))
            try await Self.render(card, name: name, presented: false)
        }
    }

    private func sheet(
        _ voice: VoiceCoordinator, scene: String = "A", place: VoiceTarget? = VoiceSheetSnapshots.place,
        namesMachine: Bool = false
    ) -> some View {
        VoiceSheet(voice: voice, scene: scene, place: place, namesMachine: namesMachine, start: {}, close: {})
    }

    /// Draws `view` in a window of its own over the app, presented as a sheet unless `presented` is false.
    private static func render(
        _ view: some View, name: String, dark: Bool = true, presented: Bool = true
    ) async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        if presented {
            window.rootViewController = UIHostingController(
                rootView: Color.black.ignoresSafeArea().sheet(isPresented: .constant(true)) {
                    view.modifier(VoiceSheetSurface())
                })
        } else {
            window.rootViewController = UIHostingController(rootView: view.ignoresSafeArea())
        }
        window.isHidden = false
        try await Task.sleep(for: .milliseconds(1_200))
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        window.isHidden = true
        let folder = URL(fileURLWithPath: try #require(Self.folder), isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try #require(image.pngData()).write(to: folder.appendingPathComponent("\(name).png"))
    }
}
