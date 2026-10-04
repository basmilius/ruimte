import RuimtePulsar
import XCTest

@testable import Ruimte

final class ProjectOverviewTests: XCTestCase {
    private func machine(_ id: String) -> Machine {
        Machine(id: id, name: id.capitalized, icon: nil, publicKey: "key-\(id)", brokerUrl: nil, lastSeenAt: nil)
    }

    private func row(_ machine: Machine, _ id: String, scratch: Bool = false, available: Bool = true)
        -> UnifiedProjectRow
    {
        var summary: [String: JSONValue] = [
            "projectId": .string(id), "name": .string(id.capitalized), "available": .bool(available),
        ]
        if scratch { summary["scratch"] = .bool(true) }
        return UnifiedProjectRow(machine: machine, summary: .object(summary), connected: true)
    }

    private func view(_ id: String, kind: String, nodes: [String] = []) -> JSONValue {
        .object([
            "id": .string(id), "kind": .string(kind),
            "nodes": .array(nodes.map { .object(["id": .string($0), "kind": .string("chat")]) }),
        ])
    }

    func testActivityCountsViewsAndWhatWaitsOutsideTheDividers() {
        let views = [
            view("chat-a", kind: "chat"), view("line", kind: "separator"),
            view("canvas", kind: "canvas", nodes: ["node-a", "node-b"]), view("heading", kind: "subheader"),
            view("chat-b", kind: "chat"),
        ]
        let attention = NowAttention(
            statuses: ["chat-a": .needsYou, "node-a": .needsYou, "node-b": .needsYou, "chat-b": .idle],
            delegating: ["chat-b"])
        let activity = ProjectOverview.activity(views: views, attention: attention, snoozed: ["node-b"])
        XCTAssertEqual(activity, ProjectActivity(views: 3, chats: 2, needsYou: 2, working: true))
        XCTAssertFalse(ProjectOverview.activity(views: views, attention: NowAttention(), snoozed: []).working)
    }

    func testGroupsFollowTheProjectOpenedLastAndPutChatsAfterTheProjects() {
        let mac = machine("mac")
        let studio = machine("studio")
        let mini = machine("mini")
        let groups = ProjectOverview.groups(
            open: [row(studio, "portfolio"), row(mac, "recept"), row(studio, "notes")],
            chats: [row(mac, "mac-chats", scratch: true), row(mini, "mini-chats", scratch: true)],
            reach: { $0.id == "studio" ? .connected(relayed: true) : .offline },
            activity: { $0.projectID == "recept" ? ProjectActivity(views: 7, chats: 2, needsYou: 1) : nil },
            git: { $0.projectID == "recept" ? ProjectGitLine(branch: "main", changed: 2) : nil })
        XCTAssertEqual(groups.map(\.machine.id), ["studio", "mac", "mini"])
        XCTAssertEqual(groups[0].rows.map(\.id.projectID), ["portfolio", "notes"])
        XCTAssertEqual(groups[1].rows.map(\.id.projectID), ["recept", "mac-chats"])
        XCTAssertEqual(groups[0].reach, .connected(relayed: true))
        XCTAssertEqual(groups[1].rows.first?.activity?.needsYou, 1)
        XCTAssertEqual(groups[1].rows.first?.detail, "main · 7 views")
        XCTAssertTrue(groups[2].rows.first?.isChats == true)
    }

    func testDetailNamesWhatTheRowKnows() {
        let mac = machine("mac")
        XCTAssertNil(ProjectOverviewRow(row: row(mac, "app")).detail)
        XCTAssertEqual(ProjectOverviewRow(row: row(mac, "app"), activity: ProjectActivity(views: 1)).detail, "1 view")
        XCTAssertEqual(
            ProjectOverviewRow(row: row(mac, "app"), git: ProjectGitLine(branch: "ios-redesign", changed: 0)).detail,
            "ios-redesign")
        XCTAssertEqual(
            ProjectOverviewRow(row: row(mac, "app", available: false), activity: ProjectActivity(views: 4)).detail,
            "Folder unavailable")
        let chats = row(mac, "chats", scratch: true)
        XCTAssertEqual(ProjectOverviewRow(row: chats).detail, "Your earlier chats")
        XCTAssertEqual(ProjectOverviewRow(row: chats, activity: ProjectActivity(views: 4, chats: 4)).detail, "4 chats")
        XCTAssertEqual(ProjectOverviewRow(row: chats, activity: ProjectActivity(views: 1, chats: 1)).detail, "1 chat")
    }

    func testReachSaysConnectingUntilATryFailed() {
        XCTAssertEqual(
            MachineLinkState(connected: true, route: nil, failedAttempts: 0, problem: nil), .connected(relayed: false))
        XCTAssertEqual(
            MachineLinkState(connected: true, route: .localNetwork, failedAttempts: 0, problem: nil),
            .connected(relayed: false))
        XCTAssertEqual(
            MachineLinkState(connected: true, route: .relayed, failedAttempts: 0, problem: nil),
            .connected(relayed: true))
        XCTAssertEqual(MachineLinkState(connected: false, route: nil, failedAttempts: 0, problem: nil), .connecting)
        XCTAssertEqual(MachineLinkState(connected: false, route: nil, failedAttempts: 1, problem: nil), .offline)
        XCTAssertEqual(MachineLinkState(connected: false, route: nil, failedAttempts: 0, problem: "Gone"), .offline)
    }

    func testGitLineReadsTheBranchAndTheChangedFiles() {
        XCTAssertNil(ProjectGitLine(status: .object(["repo": .bool(false)])))
        let line = ProjectGitLine(
            status: .object([
                "repo": .bool(true), "branch": .string("main"),
                "files": .array([.object(["path": .string("a")]), .object(["path": .string("b")])]),
            ]))
        XCTAssertEqual(line, ProjectGitLine(branch: "main", changed: 2))
        XCTAssertEqual(line?.text, "main · 2 changed")
        XCTAssertEqual(ProjectGitLine(branch: nil, changed: 0).text, "Detached")
    }
}
