import RuimtePulsar
import RuimteShared
import XCTest

@testable import Ruimte

final class ProjectOverviewTests: XCTestCase {
    private func machine(_ id: String) -> Machine {
        Machine(id: id, name: id.capitalized, icon: nil, publicKey: "key-\(id)", brokerUrl: nil, lastSeenAt: nil)
    }

    private func row(_ machine: Machine, _ id: String, scratch: Bool = false, available: Bool = true)
        -> UnifiedProjectRow
    {
        UnifiedProjectRow(
            machine: machine,
            summary: ProjectRowWire.summary(id, name: id.capitalized, available: available, scratch: scratch)
                .projectSummary,
            connected: true)
    }

    private func view(_ id: String, kind: String, nodes: [String] = []) -> ProjectSidebarView {
        try! ProjectRowWire.sidebarView(
            id, kind: kind, nodes: nodes.map { ProjectRowWire.sidebarNode($0, kind: "chat", title: $0) }
        ).decoded(as: ProjectSidebarView.self)
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
        XCTAssertEqual(activity, ProjectActivity(views: 3, chats: 2, needsYou: 2, working: 1))
        XCTAssertEqual(activity.words, "2 waiting · 1 working")
        let quiet = ProjectOverview.activity(views: views, attention: NowAttention(), snoozed: [])
        XCTAssertEqual(quiet.working, 0)
        XCTAssertNil(quiet.words)
    }

    func testActivityCountsAParentWhoseChildWaitsOnceForTheWait() {
        let views = [view("lead", kind: "chat"), view("other", kind: "chat"), view("asks", kind: "chat")]
        let attention = NowAttention(
            statuses: ["lead": .idle, "other": .idle, "asks": .needsYou],
            waitingChildren: ["lead": "limited", "other": "asks"])
        let activity = ProjectOverview.activity(views: views, attention: attention, snoozed: [])
        XCTAssertEqual(activity.needsYou, 2)
        XCTAssertEqual(ProjectOverview.activity(views: views, attention: attention, snoozed: ["lead"]).needsYou, 1)
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
        XCTAssertEqual(groups[1].rows.first?.detail, "main · 1 waiting")
        XCTAssertTrue(groups[2].rows.first?.isChats == true)
    }

    func testDetailNamesWhatTheRowKnows() {
        let mac = machine("mac")
        XCTAssertNil(ProjectOverviewRow(row: row(mac, "app")).detail)
        XCTAssertEqual(ProjectOverviewRow(row: row(mac, "app"), activity: ProjectActivity(views: 1)).detail, "1 view")
        XCTAssertEqual(
            ProjectOverviewRow(row: row(mac, "app"), git: ProjectGitLine(branch: "ios-redesign", changed: 0)).detail,
            "ios-redesign")
        let changed = ProjectGitLine(branch: "redesign-hero", changed: 2, added: 8, deleted: 2)
        XCTAssertEqual(
            ProjectOverviewRow(row: row(mac, "app"), activity: ProjectActivity(views: 3), git: changed).detail,
            "redesign-hero · +8 \u{2212}2")
        XCTAssertEqual(
            ProjectOverviewRow(
                row: row(mac, "app"), activity: ProjectActivity(views: 3, needsYou: 2, working: 1), git: changed
            ).detail,
            "redesign-hero · 2 waiting · 1 working")
        let chats = row(mac, "chats", scratch: true)
        XCTAssertEqual(ProjectOverviewRow(row: chats).detail, "Earlier chats")
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
        XCTAssertNil(ProjectGitLine(status: GitWire.status(["repo": .bool(false)])))
        let file = { (path: String) -> JSONValue in
            .object([
                "path": .string(path), "state": .string("unstaged"), "status": .string("M"), "added": .number(1),
                "deleted": .number(0), "binary": .bool(false),
            ])
        }
        let line = ProjectGitLine(status: GitWire.status(["files": .array([file("a"), file("b")])]))
        XCTAssertEqual(line, ProjectGitLine(branch: "main", changed: 2, added: 2, deleted: 0))
        XCTAssertEqual(line?.changedText, "2 changed")
        XCTAssertEqual(line?.diff, "+2 \u{2212}0")
        XCTAssertEqual(ProjectGitLine(branch: nil, changed: 0).branchName, "Detached")
        XCTAssertNil(ProjectGitLine(branch: nil, changed: 0).changedText)
        XCTAssertNil(ProjectGitLine(branch: nil, changed: 0).diff)
    }

    func testTheMachineHeadingSaysTheRoundTripOrSinceWhenItIsGone() {
        XCTAssertEqual(ProjectMachineHeading.state(reach: .connected(relayed: false), latency: 12, lastSeen: nil), "12 ms")
        XCTAssertEqual(
            ProjectMachineHeading.state(reach: .connected(relayed: true), latency: 40, lastSeen: nil), "via relay · 40 ms")
        XCTAssertEqual(
            ProjectMachineHeading.state(reach: .connected(relayed: false), latency: nil, lastSeen: nil), "Connected")
        XCTAssertEqual(ProjectMachineHeading.state(reach: .offline, latency: nil, lastSeen: nil), "Offline")
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertEqual(
            ProjectMachineHeading.state(reach: .offline, latency: nil, lastSeen: now, now: now),
            "Offline since \(Format.moment(now, now: now))")
    }
}
