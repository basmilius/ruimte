import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor final class ChatMenuActionTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Amsterdam")!
        return calendar
    }

    private func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    func testTomorrowIsTheNextNineOClockStillAhead() {
        XCTAssertEqual(ChatSnooze.until(.tomorrow, now: date(3, 14), calendar: calendar), date(4, 9))
        XCTAssertEqual(ChatSnooze.until(.tomorrow, now: date(3, 2), calendar: calendar), date(3, 9))
        XCTAssertEqual(ChatSnooze.until(.tomorrow, now: date(3, 9), calendar: calendar), date(4, 9))
    }

    func testShortSnoozesCountFromNow() {
        XCTAssertEqual(ChatSnooze.until(.tenMinutes, now: date(3, 14), calendar: calendar), date(3, 14, 10))
        XCTAssertEqual(ChatSnooze.until(.hour, now: date(3, 14), calendar: calendar), date(3, 15))
    }

    func testTheSnoozePayloadCarriesAnAbsoluteMomentInMilliseconds() {
        let until = Date(timeIntervalSince1970: 1_800_000_000.5)
        XCTAssertEqual(
            ChatSnooze.payload(nodeID: "chat-1", until: until),
            .object(["nodeId": .string("chat-1"), "until": .number(1_800_000_000_500)]))
    }

    func testAChatReadsItsOwnSnoozeFromTheList() {
        let list = JSONValue.object([
            "snoozes": .array([
                .object(["projectId": .string("p"), "nodeId": .string("other"), "until": .number(5)]),
                .object(["projectId": .string("p"), "nodeId": .string("chat-1"), "until": .number(9)]),
            ])
        ])
        XCTAssertEqual(ChatSnooze.until(of: "chat-1", in: list), 9)
        XCTAssertNil(ChatSnooze.until(of: "chat-2", in: list))
    }

    func testRenamingAChatViewSetsItsNameAndANodeItsTitle() throws {
        let views: [JSONValue] = [
            .object(["id": .string("chat-view"), "kind": .string("chat"), "name": .string("Old")]),
            .object([
                "id": .string("canvas"), "kind": .string("canvas"), "name": .string("Main"),
                "nodes": .array([
                    .object(["id": .string("chat-node"), "kind": .string("chat"), "title": .string("Old node")])
                ]),
            ]),
        ]
        let view = try XCTUnwrap(ChatRename.renamed(views, chatID: "chat-view", to: " New "))
        XCTAssertEqual(view[0].text("name"), "New")
        XCTAssertEqual(view[0].text("titleSource"), "user")
        XCTAssertEqual(view[1], views[1])

        let node = try XCTUnwrap(ChatRename.renamed(views, chatID: "chat-node", to: "Node"))
        XCTAssertEqual(node[1].list("nodes")[0].text("title"), "Node")
        XCTAssertEqual(node[1].text("name"), "Main")
    }

    func testRenamingNeedsANameAndAChatTheProjectHolds() {
        let views: [JSONValue] = [.object(["id": .string("chat"), "kind": .string("chat"), "name": .string("A")])]
        XCTAssertNil(ChatRename.renamed(views, chatID: "chat", to: "   "))
        XCTAssertNil(ChatRename.renamed(views, chatID: "missing", to: "B"))
    }
}
