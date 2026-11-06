import Foundation
import RuimtePulsar
import SwiftUI
import Testing
import UIKit

@testable import Ruimte

/// Renders Now (something waits, nothing waits) and Scheduled from fixtures to PNG files for review, in light and dark.
/// Runs only when `RUIMTE_NOW_SNAPSHOTS` names a folder (`TEST_RUNNER_RUIMTE_NOW_SNAPSHOTS` through `xcodebuild`),
/// since it waits on layout.
@Suite(.serialized) @MainActor struct NowScheduledSnapshots {
    private nonisolated static let folder = ProcessInfo.processInfo.environment["RUIMTE_NOW_SNAPSHOTS"]
    private static let date = Calendar.current.date(bySettingHour: 8, minute: 24, second: 0, of: .now) ?? .now
    private static var milliseconds: Double { date.timeIntervalSince1970 * 1000 }

    @Test(.enabled(if: folder != nil)) func nowWithSomethingWaiting() async throws {
        let board = NowBoard.build([
            NowMachineInput(
                machineID: "mac", machineName: "MacBook Pro",
                projects: [
                    project(
                        "score", name: "score-engine",
                        views: [
                            view("first", kind: "chat", name: "First draft"),
                            view("stems", kind: "chat", name: "Export stems"),
                            view("sync", kind: "chat", name: "Sync warnings"),
                            view("cache", kind: "chat", name: "Composer cache"),
                            view("dev", kind: "terminal", name: "bun dev"),
                        ])
                ],
                attention: NowAttention(
                    statuses: [
                        "first": .needsYou, "stems": .needsYou, "sync": .running, "cache": .idle, "dev": .running,
                    ],
                    requests: [
                        "first": [Self.command(at: Self.milliseconds - 2 * 60_000)],
                        "stems": [Self.question(at: Self.milliseconds - 6 * 60_000)],
                    ],
                    delegating: ["cache"],
                    activity: [
                        "cache": ChatActivity(
                            background: [
                                .init(description: "Running sync tests", startedAt: Self.milliseconds - 400_000)
                            ])
                    ]))
        ])
        try await render(now(board), name: "now-waiting")
    }

    @Test(.enabled(if: folder != nil)) func nowWithNothingWaiting() async throws {
        let board = NowBoard.build([
            NowMachineInput(
                machineID: "mac", machineName: "MacBook Pro",
                projects: [
                    project(
                        "score", name: "score-engine",
                        views: [
                            view("sync", kind: "chat", name: "Sync warnings"),
                            view("dev", kind: "terminal", name: "bun dev"),
                            view("first", kind: "chat", name: "First draft"),
                            view("stems", kind: "chat", name: "Export stems"),
                            view("notes", kind: "chat", name: "Release notes 0.9"),
                        ])
                ],
                attention: NowAttention(
                    statuses: ["sync": .running, "dev": .running, "notes": .needsYou],
                    unseen: ["first", "stems"],
                    finishedAt: ["first": Self.milliseconds - 54 * 60_000, "stems": Self.milliseconds - 20 * 60_000]),
                snoozes: ["notes": Self.date.addingTimeInterval(5.6 * 3_600)])
        ])
        var scheduled = ScheduledBoard()
        scheduled.today = [
            ScheduledItem(machineID: "mac", machineName: "MacBook Pro", entry: Self.routine("Render check"))
        ]
        try await render(
            now(board, comingUp: NowComingUp.build(snoozed: board.snoozed, scheduled: scheduled)), name: "now-empty")
    }

    @Test(.enabled(if: folder != nil)) func scheduled() async throws {
        let waiting = Self.routine(
            "Dependency check", hours: 22.6,
            runs: [
                RoutineWire.run(
                    "run", state: "needs-you", due: Self.milliseconds - 84 * 60_000, chat: "run-chat")
            ])
        let board = ScheduledBoard.build(
            [
                ScheduledMachineInput(
                    machineID: "mac", machineName: "MacBook Pro", answers: true,
                    entries: [
                        waiting, Self.routine("Render check", hours: 3.6),
                        Self.routine("Update the changelog", hours: 9.1), Self.routine("Nightly tests", hours: 17.6),
                        Self.routine("Site screenshots", paused: true),
                    ])
            ], now: Self.date)
        let model = NowModel()
        let sections = MobileList {
            ScheduledSections(
                now: model, board: board, date: Self.date, namesMachines: false, resuming: [],
                connected: { _ in true },
                entry: { wait in
                    ProjectViewEntry(
                        target: ProjectViewTarget(
                            machineID: "mac", projectID: "p", viewID: "run-chat", itemID: "run-chat"),
                        machineName: "MacBook Pro", projectName: wait.item.entry.projectName,
                        title: wait.item.entry.title, kind: "chat", iconName: "workflow", status: .needsYou,
                        requests: [Self.pullRequest()], repliesWithMessage: true)
                }, timeZone: { _ in nil }, open: { _ in }, resume: { _ in })
        }
        try await render(sections.navigationTitle("Routines"), name: "scheduled")
    }

    /// Every tone on the shared row and the glyph label of a machine, at the default size and at the largest, where the
    /// glyph has to stay on the title's line.
    @Test(.enabled(if: folder != nil)) func statusRows() async throws {
        for (name, typeSize) in [("rows", DynamicTypeSize.large), ("rows-large-type", .accessibility2)] {
            let rows = MobileList {
                MobileRowGroup(items: MobileTone.allCases.map { SnapshotTone(tone: $0) }) { item in
                    MobileStatusRow(
                        tone: item.tone, title: item.tone.label, subtitle: "score-engine · MacBook Pro", value: "2 min")
                }
                MobileGlyphLabel(title: "MacBook Pro", subtitle: "Connected via relay", symbol: "laptop")
                MobileGlyphLabel(title: "Mac Studio", subtitle: "Offline", symbol: "server")
            }
            try await render(rows.navigationTitle("Rows").dynamicTypeSize(typeSize), name: name)
        }
    }

    private func now(_ board: NowBoard, comingUp: [NowComingUp] = []) -> some View {
        MobileList {
            NowSections(
                now: NowModel(), board: board, comingUp: comingUp, notifies: true, date: Self.date,
                connected: { _ in true }, open: { _ in }, openProject: { _ in }, openRoutine: { _ in })
        }
        .navigationTitle("Now")
    }

    private func render(_ view: some View, name: String) async throws {
        for dark in [false, true] {
            let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            window.overrideUserInterfaceStyle = dark ? .dark : .light
            window.rootViewController = UIHostingController(
                rootView: NavigationStack { view.modifier(MobilePageSurface()) }
                    .foregroundStyle(MobileStyle.text).tint(MobileStyle.accent))
            window.isHidden = false
            try await Task.sleep(for: .milliseconds(800))
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            window.isHidden = true
            let folder = URL(fileURLWithPath: try #require(Self.folder), isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try #require(image.pngData())
                .write(to: folder.appendingPathComponent("\(name)-\(dark ? "dark" : "light").png"))
        }
    }

    private func project(_ id: String, name: String, views: [JSONValue]) -> JSONValue {
        .object([
            "summary": .object(["projectId": .string(id), "name": .string(name), "lastOpenedAt": .number(1)]),
            "views": .array(views),
        ])
    }

    private func view(_ id: String, kind: String, name: String) -> JSONValue {
        .object(["id": .string(id), "kind": .string(kind), "name": .string(name), "nodes": .array([])])
    }

    private static func command(at createdAt: Double) -> NowRequest {
        NowRequest(
            .object([
                "requestId": .string("command"), "kind": .string("approval"), "createdAt": .number(createdAt),
                "approval": .object([
                    "toolName": .string("Bash"), "subject": .string("bun test packages/runtime --bail"),
                    "description": .string("Run the runtime tests"),
                    "command": .string("bun test packages/runtime --bail"), "canAllowAlways": .bool(false),
                ]),
            ]))!
    }

    private static func pullRequest() -> NowRequest {
        NowRequest(
            .object([
                "requestId": .string("pull"), "kind": .string("approval"), "createdAt": .number(milliseconds),
                "approval": .object([
                    "toolName": .string("Bash"), "subject": .string("gh pr create"),
                    "description": .string("Open a pull request for 4 updates"),
                    "command": .string("gh pr create --fill"), "canAllowAlways": .bool(false),
                ]),
            ]))!
    }

    private static func question(at createdAt: Double) -> NowRequest {
        NowRequest(
            .object([
                "requestId": .string("question"), "kind": .string("question"), "createdAt": .number(createdAt),
                "question": .object([
                    "questions": .array([
                        .object([
                            "id": .string("depth"), "header": .string("Bit depth"),
                            "question": .string("Which bit depth do you want for the stems?"),
                            "choices": .array(
                                ["16-bit", "24-bit", "32-bit float"].map {
                                    JSONValue.object(["label": .string($0), "description": .string("")])
                                }),
                            "multiSelect": .bool(false),
                        ])
                    ])
                ]),
            ]))!
    }

    private static func routine(
        _ title: String, hours: Double = 3.6, paused: Bool = false, runs: [JSONValue] = []
    ) -> RoutineEntry {
        RoutineWire.entry(
            title, project: "p", projectName: "score-engine", schedule: RoutineWire.weekly(Array(1...5), time: "17:30"),
            pausedAt: paused ? milliseconds - 86_400_000 : nil, next: paused ? nil : milliseconds + hours * 3_600_000,
            runs: runs
        ).routineEntry
    }
}

private struct SnapshotTone: Identifiable {
    let tone: MobileTone
    var id: String { tone.label }
}
