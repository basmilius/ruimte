import RuimtePulsar
import XCTest

@testable import Ruimte

final class ProjectListLogicTests: XCTestCase {
    private func node(_ id: String, kind: String = "chat") -> JSONValue {
        .object(["id": .string(id), "kind": .string(kind), "title": .string(id)])
    }

    private let canvas = JSONValue.object([
        "id": .string("canvas"), "kind": .string("canvas"), "name": .string("Main canvas"),
        "nodes": .array([
            .object(["id": .string("api"), "kind": .string("chat"), "title": .string("API design")]),
            .object(["id": .string("logs"), "kind": .string("terminal"), "title": .string("logs")]),
            .object(["id": .string("note"), "kind": .string("note"), "title": .string("Note")]),
        ]),
    ])

    func testACanvasListsOnlyTheNodesThatRun() {
        XCTAssertEqual(ProjectListLogic.nodes(of: canvas).map(\.stableID), ["api", "logs"])
        XCTAssertTrue(ProjectListLogic.nodes(of: node("chat")).isEmpty)
    }

    func testACanvasSpeaksForItsNodesAndKeepsTheirDraftsAndSnoozesOnTheirOwnRows() {
        let sources = ProjectMarkSources(
            statuses: ["api": .needsYou, "logs": .running], unseen: ["logs"], drafts: ["api"], warnings: ["logs"],
            shared: ["canvas"], snoozes: ["api": .distantFuture])
        let marks = ProjectListLogic.marks(view: canvas, sources: sources)
        XCTAssertEqual(marks.status, .running)
        XCTAssertTrue(marks.working)
        XCTAssertTrue(marks.warning)
        XCTAssertTrue(marks.shared)
        XCTAssertFalse(marks.draft)
        XCTAssertNil(marks.snoozedUntil)

        let api = ProjectListLogic.marks(node: node("api"), sources: sources)
        XCTAssertTrue(api.draft)
        XCTAssertEqual(api.snoozedUntil, .distantFuture)
        XCTAssertFalse(api.needsYou)
    }

    func testAStandaloneChatCarriesItsOwnMarks() {
        let chat = JSONValue.object(["id": .string("chat"), "kind": .string("chat"), "node": .object([:])])
        let marks = ProjectListLogic.marks(
            view: chat, sources: ProjectMarkSources(statuses: ["chat": .needsYou], drafts: ["chat"], shared: ["chat"]))
        XCTAssertTrue(marks.needsYou)
        XCTAssertFalse(marks.working)
        XCTAssertTrue(marks.draft)
        XCTAssertTrue(marks.shared)
        XCTAssertEqual(ProjectListLogic.heaviest([.idle, .running, nil, .exited]), .exited)
    }

    func testALongPressOffersWhatAppliesToTheRow() {
        let claude = JSONValue.object([
            "id": .string("c"), "kind": .string("chat"), "node": .object(["provider": .string("claude")]),
        ])
        XCTAssertEqual(
            ProjectListLogic.actions(for: claude, isView: true, status: .running, canFork: true),
            [.rename, .icon, .settings, .fork, .snooze, .stopTurn, .delete])
        XCTAssertEqual(
            ProjectListLogic.actions(for: claude, isView: true, status: .idle, canFork: true),
            [.rename, .icon, .settings, .fork, .snooze, .delete])
        let gemini = JSONValue.object(["id": .string("g"), "kind": .string("chat"), "provider": .string("gemini")])
        XCTAssertEqual(
            ProjectListLogic.actions(for: gemini, isView: false, status: .running, canFork: false),
            [.snooze, .stopTurn])
        XCTAssertEqual(
            ProjectListLogic.actions(for: canvas, isView: true, status: nil, canFork: false),
            [.rename, .icon, .settings, .delete])
        XCTAssertEqual(
            ProjectListLogic.actions(
                for: .object(["id": .string("u"), "kind": .string("unknown")]), isView: true, status: nil,
                canFork: false),
            [.delete])
    }

}

final class NewViewTests: XCTestCase {
    func testANewViewTakesTheFirstFreeName() {
        let views: [JSONValue] = [
            .object(["name": .string("Canvas")]), .object(["name": .string("Canvas 2")]), .object([:]),
        ]
        XCTAssertEqual(NewViewFactory.freeName(views, base: "Canvas"), "Canvas 3")
        XCTAssertEqual(NewViewFactory.freeName(views, base: "Terminal"), "Terminal")
    }

    func testEachKindIsMadeTheWayTheDesktopMakesIt() {
        let chat = NewViewFactory.view(kind: "chat", agent: (kind: "claude", name: "Claude Code"))
        XCTAssertEqual(chat.text("name"), "Claude Code")
        XCTAssertEqual(chat["node"], .object(["provider": .string("claude"), "providerFixed": .bool(true)]))
        XCTAssertNil(chat["titleSource"])
        XCTAssertEqual(NewViewFactory.view(kind: "canvas").list("nodes"), [])
        XCTAssertEqual(NewViewFactory.view(kind: "terminal")["node"], .object([:]))
        XCTAssertEqual(NewViewFactory.view(kind: "browser")["url"], .string(""))
        XCTAssertNil(NewViewFactory.view(kind: "separator")["name"])
        XCTAssertEqual(NewViewFactory.view(kind: "subheader").text("name"), "Section")
    }

    func testWhatHappensOnceAViewIsMade() {
        let browser = NewViewFactory.view(kind: "browser")
        XCTAssertEqual(NewViewFactory.result(for: browser), .ask(browser))
        let heading = NewViewFactory.view(kind: "subheader")
        XCTAssertEqual(NewViewFactory.result(for: heading), .heading(heading))
        let drawing = NewViewFactory.view(kind: "drawing")
        XCTAssertEqual(NewViewFactory.result(for: drawing), .view(drawing.stableID))
        XCTAssertNil(NewViewFactory.result(for: NewViewFactory.view(kind: "separator")))
    }

    func testViewSettingsWriteTheNameAndTheAddress() {
        XCTAssertEqual(ViewSettings.address(" example.com/a "), "https://example.com/a")
        XCTAssertEqual(ViewSettings.address("http://localhost:5173"), "http://localhost:5173")
        XCTAssertNil(ViewSettings.address("ftp://example.com"))
        XCTAssertNil(ViewSettings.address(""))

        let browser = NewViewFactory.view(kind: "browser")
        let named = ViewSettings.applying(name: "Browser", address: "https://example.com", to: browser)
        XCTAssertEqual(named.text("url"), "https://example.com")
        XCTAssertEqual(named.text("name"), "https://example.com")
        let chosen = ViewSettings.applying(name: "Docs", address: "https://example.com", to: browser)
        XCTAssertEqual(chosen.text("name"), "Docs")
        XCTAssertEqual(chosen.text("titleSource"), "user")

        let terminal = NewViewFactory.view(kind: "terminal")
        XCTAssertEqual(ViewSettings.applying(name: "  ", address: nil, to: terminal), terminal)
    }
}

final class ProjectSettingsTests: XCTestCase {
    func testClosingSaysWhatEndsAndWhoKeepsItOpen() {
        XCTAssertEqual(
            ProjectSettingsLogic.closing(sessions: 0, otherClients: 0),
            "Nothing is running. It moves to Recent as you left it.")
        XCTAssertEqual(
            ProjectSettingsLogic.closing(sessions: 1, otherClients: 0),
            "Closing ends its running session. Terminals lose scrollback and agents stop.")
        XCTAssertEqual(
            ProjectSettingsLogic.closing(sessions: 3, otherClients: 0),
            "Closing ends its 3 running sessions. Terminals lose scrollback and agents stop.")
        XCTAssertEqual(
            ProjectSettingsLogic.closing(sessions: 3, otherClients: 2),
            "This project is still open on 2 other devices, so nothing stops. It moves to Recent here only.")
    }

    func testRenamingSendsOnlyANewName() {
        XCTAssertNil(ProjectSettingsLogic.rename("  ", current: "App"))
        XCTAssertNil(ProjectSettingsLogic.rename(" App ", current: "App"))
        XCTAssertEqual(ProjectSettingsLogic.rename(" Recept Maker ", current: "App"), "Recept Maker")
    }

    func testTheMarkFollowsTheIcon() {
        XCTAssertEqual(ProjectSettingsLogic.mark(of: .object([:])), .initial)
        XCTAssertEqual(
            ProjectSettingsLogic.mark(of: .object(["icon": .object(["kind": .string("lucide")])])), .icon)
        XCTAssertEqual(
            ProjectSettingsLogic.mark(of: .object(["icon": .object(["kind": .string("image")])])), .image)
        XCTAssertTrue(ProjectSettingsLogic.sameColor("#C4573A", "#c4573a"))
    }

    func testAMachineIsLostOnlyOnceATryFailed() {
        XCTAssertFalse(MachineLost.isLost(connected: false, failedAttempts: 0, problem: nil))
        XCTAssertTrue(MachineLost.isLost(connected: false, failedAttempts: 1, problem: nil))
        XCTAssertFalse(MachineLost.isLost(connected: true, failedAttempts: 2, problem: "x"))
        XCTAssertTrue(MachineLost.retrying(failedAttempts: 2))
        XCTAssertFalse(MachineLost.retrying(failedAttempts: 3))
        let now = Date(timeIntervalSince1970: 10_000)
        XCTAssertNil(MachineLost.lastConnected(nil, now: now))
        XCTAssertEqual(MachineLost.lastConnected(now.addingTimeInterval(-20), now: now), "Last connected just now")
        XCTAssertEqual(
            MachineLost.lastConnected(now.addingTimeInterval(-240), now: now), "Last connected 4m ago")
    }
}

final class LaunchListTests: XCTestCase {
    private func view(_ phase: LaunchPhase, port: Int? = nil, ended: Double? = nil, exit: Int? = nil) -> LaunchView {
        let status = LaunchWire.status(
            "dev", project: "p", state: ended == nil ? "running" : "exited", exit: exit, endedAt: ended
        ).launchStatus
        return LaunchView(
            launch: LaunchWire.entry("dev").launchEntry, phase: phase, live: phase == .running, status: status,
            exitCode: exit, port: port)
    }

    func testTheStateLineSaysWhatTheLaunchDoes() {
        let now = 600_000.0
        XCTAssertEqual(LaunchLogic.stateLine(view(.running, port: 5173), now: now), "Running · :5173")
        XCTAssertEqual(LaunchLogic.stateLine(view(.held), now: now), "Needs approval")
        XCTAssertEqual(LaunchLogic.stateLine(view(.passed, ended: 480_000), now: now), "Passed 2m ago")
        XCTAssertEqual(LaunchLogic.stateLine(view(.failed, ended: 590_000, exit: 1), now: now), "Failed · exit 1")
        XCTAssertEqual(LaunchLogic.stateLine(view(.idle, ended: 590_000), now: now), "Stopped now")
    }

    func testFoundRowsCountPerFile() {
        let suggestions = [
            ("package-json", "package.json"), ("package-json", "package.json"), ("package-json", "package.json"),
            ("run-xml", ".run/Docker.run.xml"),
        ].map { source, path in
            LaunchWire.suggestion(LaunchWire.entry("dev"), source: source, path: path).launchSuggestion
        }
        XCTAssertEqual(
            LaunchEditing.foundRows(suggestions).map(\.text),
            ["3 scripts in package.json", "1 run configuration in .run"])
    }
}
