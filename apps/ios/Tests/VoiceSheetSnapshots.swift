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
        for index in 0..<VoiceLevelHistory.kept {
            let step = Double(index)
            let person = index < 22 ? 0.01 + 0.18 * abs(sin(step * 0.7)) : 0.002
            let voice = index > 20 ? 0.02 + 0.1 * abs(sin(step * 0.9)) : 0
            stage.media.reading = VoiceLevels(person: person, voice: voice)
            await stage.voice.sampleLevels()
        }
        // The band holds still from here, so the picture shows the levels above.
        stage.media.reading = nil
        return stage
    }

    @Test(.enabled(if: folder != nil)) func theSheetInEachState() async throws {
        let idle = Self.stage()
        try await Self.render(sheet(idle.voice), name: "1-idle-dark")
        try await Self.render(sheet(idle.voice), name: "2-idle-light", dark: false)

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
        _ voice: VoiceCoordinator, scene: String = "A", place: VoiceTarget? = VoiceSheetSnapshots.place
    ) -> some View {
        VoiceSheet(voice: voice, scene: scene, place: place, start: {}, pickPlace: {}, close: {})
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
                    NavigationStack { view.toolbar(.hidden, for: .navigationBar) }.modifier(VoiceSheetSurface())
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
