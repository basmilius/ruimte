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
            ProjectListLogic.actions(for: claude, isView: true, status: .running),
            [.rename, .icon, .settings, .fork, .snooze, .stopTurn, .delete])
        XCTAssertEqual(
            ProjectListLogic.actions(for: claude, isView: true, status: .idle),
            [.rename, .icon, .settings, .fork, .snooze, .delete])
        let gemini = JSONValue.object(["id": .string("g"), "kind": .string("chat"), "provider": .string("gemini")])
        XCTAssertEqual(ProjectListLogic.actions(for: gemini, isView: false, status: .running), [.snooze, .stopTurn])
        XCTAssertEqual(
            ProjectListLogic.actions(for: canvas, isView: true, status: nil), [.rename, .icon, .settings, .delete])
        XCTAssertEqual(
            ProjectListLogic.actions(for: .object(["id": .string("u"), "kind": .string("unknown")]), isView: true, status: nil),
            [.delete])
    }

    @MainActor func testFoldedCanvasesAreRememberedPerProject() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "ProjectListLogicTests.\(UUID().uuidString)"))
        let state = ProjectListState(machineID: "mac", projectID: "app", defaults: defaults)
        XCTAssertTrue(state.isExpanded("canvas"))
        state.toggle("canvas")
        XCTAssertFalse(ProjectListState(machineID: "mac", projectID: "app", defaults: defaults).isExpanded("canvas"))
        XCTAssertTrue(ProjectListState(machineID: "mac", projectID: "other", defaults: defaults).isExpanded("canvas"))
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
            "Nothing in it is running. It moves to Recently closed just as it was left.")
        XCTAssertEqual(
            ProjectSettingsLogic.closing(sessions: 1, otherClients: 0),
            "1 running session ends: a terminal loses its scrollback and an agent stops. The rest moves to Recently closed."
        )
        XCTAssertTrue(ProjectSettingsLogic.closing(sessions: 3, otherClients: 0).hasPrefix("3 running sessions end:"))
        XCTAssertEqual(
            ProjectSettingsLogic.closing(sessions: 3, otherClients: 2),
            "2 other clients still have it open, so nothing stops running. It moves to Recently closed on this phone only."
        )
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
            MachineLost.lastConnected(now.addingTimeInterval(-240), now: now), "Last connected 4 minutes ago")
    }
}

final class LaunchListTests: XCTestCase {
    private func view(_ phase: LaunchPhase, port: Int? = nil, ended: Double? = nil, exit: Int? = nil) -> LaunchView {
        let status = LaunchStatus(
            json: .object([
                "projectId": .string("p"), "launchId": .string("dev"), "sessionId": .string("launch:dev"),
                "kind": .string("service"), "state": .string(ended == nil ? "running" : "exited"),
                "exitCode": exit.map { .number(Double($0)) } ?? .null, "startedAt": .number(0),
                "endedAt": ended.map(JSONValue.number) ?? .null, "port": .null, "url": .null, "stopped": .bool(false),
            ]))
        return LaunchView(
            launch: LaunchEntry(raw: .object(["id": .string("dev"), "name": .string("dev")])), phase: phase,
            live: phase == .running, status: status, exitCode: exit, port: port)
    }

    func testTheStateLineSaysWhatTheLaunchDoes() {
        let now = 600_000.0
        XCTAssertEqual(LaunchLogic.stateLine(view(.running, port: 5173), now: now), "Running · :5173")
        XCTAssertEqual(LaunchLogic.stateLine(view(.held), now: now), "Needs approval")
        XCTAssertEqual(LaunchLogic.stateLine(view(.passed, ended: 480_000), now: now), "Passed 2 minutes ago")
        XCTAssertEqual(LaunchLogic.stateLine(view(.failed, ended: 590_000, exit: 1), now: now), "Failed · exit 1")
        XCTAssertEqual(LaunchLogic.stateLine(view(.idle, ended: 590_000), now: now), "Stopped just now")
    }

    func testFoundRowsCountPerFile() {
        let suggestions = [
            ("package-json", "package.json"), ("package-json", "package.json"), ("package-json", "package.json"),
            ("run-xml", ".run/Docker.run.xml"),
        ].map { source, path in
            LaunchSuggestion(json: .object(["launch": .object([:]), "source": .string(source), "path": .string(path)]))
        }
        XCTAssertEqual(
            LaunchEditing.foundRows(suggestions).map(\.text),
            ["3 scripts in package.json", "1 run configuration in .run"])
    }
}
