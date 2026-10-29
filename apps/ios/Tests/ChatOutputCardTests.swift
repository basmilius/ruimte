import RuimtePulsar
import XCTest

@testable import Ruimte

@MainActor final class ChatOutputCardTests: XCTestCase {
    private func item(
        _ id: String, _ kind: String, turn: String = "t1", at createdAt: Double, _ extra: [String: JSONValue] = [:]
    ) -> JSONValue {
        ChatWire.item(
            [
                "id": .string(id), "kind": .string(kind), "turnId": .string(turn), "createdAt": .number(createdAt),
            ].merging(extra) { _, extra in extra })
    }

    private var settledTurn: [JSONValue] {
        [
            item("u1", "user", at: 1000, ["text": .string("make a cut")]),
            item("t1", "turn", at: 1000, ["state": .string("done"), "endedAt": .number(9000)]),
            item("b1", "tool", at: 2000, ["state": .string("done"), "name": .string("Bash")]),
            item("n1", "assistant", at: 3000, ["text": .string("Rendering.")]),
            item("b2", "tool", at: 4000, ["state": .string("done"), "name": .string("Bash")]),
            item("a1", "assistant", at: 8000, ["text": .string("Done.")]),
        ]
    }

    private func saved(
        _ id: String, at: Double, turn: String? = nil, chat: String = "chat", number: Int = 1, latest: Bool = true
    ) -> ChatSavedVersion {
        var provenance: [String: JSONValue] = ["maker": .string("agent"), "chatId": .string(chat)]
        if let turn { provenance["turnId"] = .string(turn) }
        let version = OutputVersion(
            json: .object([
                "versionId": .string(id), "number": .number(Double(number)), "createdAt": .number(at),
                "files": .array([]), "bytes": .number(0), "provenance": .object(provenance),
            ]))
        return ChatSavedVersion(artifactID: "art-\(id)", title: id, kind: "report", version: version, latest: latest)
    }

    private func names(_ groups: [[ChatSavedVersion]]) -> [[String]] { groups.map { $0.map(\.version.id) } }

    func testVersionsOfOneTurnStayOneGroupAlsoWithACommandBegunBetweenThem() {
        XCTAssertEqual(
            names(
                ChatOutputCards.groups(
                    [saved("v2", at: 30, turn: "t1"), saved("v1", at: 10, turn: "t1")], itemTimes: [20])),
            [["v1", "v2"]])
    }

    func testVersionsOfTwoTurnsSplitWhereARowOfTheThreadBeganBetweenThem() {
        XCTAssertEqual(
            names(
                ChatOutputCards.groups(
                    [saved("v1", at: 10, turn: "t1"), saved("v2", at: 30, turn: "t2")], itemTimes: [20])),
            [["v1"], ["v2"]])
    }

    func testVersionsWithoutATurnStandTogetherWhileNothingBeganBetweenThem() {
        XCTAssertEqual(
            names(
                ChatOutputCards.groups([saved("a", at: 10), saved("b", at: 15), saved("c", at: 30)], itemTimes: [20])),
            [["a", "b"], ["c"]])
    }

    func testACardFromInsideAFoldedTurnWaitsUnderTheFoldAboveTheAnswer() {
        let presentation = ChatPresentation()
        presentation.replace(settledTurn.map(\.chatItem), info: nil)
        presentation.setSaved([saved("v1", at: 3500)])
        XCTAssertEqual(presentation.entries.map(\.id), ["u1", "fold-t1", "app-card-output:v1", "a1"])
        XCTAssertEqual(presentation.entries[2].kind, .output)
    }

    func testAnOpenTurnShowsTheCardBetweenTheCallsItCameBetween() {
        let presentation = ChatPresentation()
        presentation.replace(settledTurn.map(\.chatItem), info: nil)
        presentation.toggleTurn("t1")
        presentation.setSaved([saved("v1", at: 3500)])
        XCTAssertEqual(
            presentation.entries.map(\.id), ["u1", "fold-t1", "tools-b1", "n1", "app-card-output:v1", "tools-b2", "a1"])
    }

    func testACardFromBeforeTheConversationStaysOutAndOneFromAfterClosesIt() {
        let presentation = ChatPresentation()
        presentation.replace(settledTurn.map(\.chatItem), info: nil)
        presentation.setSaved([saved("late", at: 20_000), saved("early", at: 10)])
        XCTAssertEqual(
            presentation.entries.map(\.id),
            ["u1", "fold-t1", "a1", "app-card-output:late"])
    }

    func testClearedOutputCardsStayGoneAfterARefreshNewMessageAndReopening() {
        let old = saved("old", at: 3500)
        let presentation = ChatPresentation()
        presentation.replace(settledTurn.map(\.chatItem), info: nil)
        presentation.setSaved([old])
        XCTAssertEqual(presentation.entries.compactMap(\.output).map(\.id), ["output:old"])

        presentation.replace([], info: nil)
        XCTAssertTrue(presentation.entries.isEmpty)
        presentation.setSaved([old])
        XCTAssertTrue(presentation.entries.isEmpty)

        let next = item("u2", "user", turn: "t2", at: 10_000, ["text": .string("again")]).chatItem
        presentation.upsert(next)
        XCTAssertEqual(presentation.entries.map(\.id), ["u2"])

        let reopened = ChatPresentation()
        reopened.setSaved([old])
        reopened.replace([next], info: nil)
        XCTAssertEqual(reopened.entries.map(\.id), ["u2"])

        reopened.setSaved([old, saved("new", at: 11_000)])
        XCTAssertEqual(reopened.entries.map(\.id), ["u2", "app-card-output:new"])
        XCTAssertEqual(reopened.saved.map(\.version.id), ["old", "new"])
    }

    func testAnEarlierOutputCardAppearsWhenItsHistoryPageLoads() {
        let presentation = ChatPresentation()
        presentation.earlierPageWaits = true
        presentation.replace(settledTurn.map(\.chatItem), info: nil)
        presentation.setSaved([saved("early", at: 10)])
        XCTAssertTrue(presentation.entries.compactMap(\.output).isEmpty)

        presentation.prepend([item("u0", "user", turn: "t0", at: 1, ["text": .string("first")]).chatItem])
        XCTAssertEqual(presentation.entries.compactMap(\.output).map(\.id), ["output:early"])
    }

    func testARunningTurnKeepsItsWorkingRowLastUnderEveryCard() {
        let presentation = ChatPresentation()
        presentation.replace(
            [
                item("u2", "user", turn: "t2", at: 1000, ["text": .string("again")]),
                item("t2", "turn", turn: "t2", at: 1000, ["state": .string("running")]),
                item("b3", "tool", turn: "t2", at: 2000, ["state": .string("running"), "name": .string("Bash")]),
            ].map(\.chatItem), info: ChatWire.info(["activeTurnId": .string("t2")]).chatInfo)
        presentation.setSaved([saved("v2", at: 50_000)])
        XCTAssertEqual(presentation.entries.map(\.id), ["u2", "b3", "app-card-output:v2", "working-t2"])
    }

    func testAVisualComesBeforeACardOfTheSameMoment() {
        let rows = [ChatTimelineEntry(id: "working-t1", kind: .activity)]
        let card = ChatOutputCard(saved: [saved("v1", at: 100)])
        let placed = ChatVisuals.placed(
            rows, visuals: [ChatVisual(id: "chart", title: "Chart", at: 100)], cards: [card], heldFrom: nil)
        XCTAssertEqual(placed.map(\.id), ["visual-chart", "app-card-output:v1", "working-t1"])
    }

    func testAChatShowsOnlyWhatItSavedItselfEveryVersionOfAnItemReadWhole() {
        let items = [
            OutputItem(
                json: .object([
                    "artifactId": .string("many"), "title": .string("Cut"), "kind": .string("recording"),
                    "versionCount": .number(2), "latest": .object([:]),
                ]))
        ]
        let versions = [
            "many": [
                saved("v2", at: 20, number: 2).version, saved("v1", at: 10, chat: "other").version,
            ]
        ]
        let shown = ChatOutputCards.saved(chatID: "chat", items: items, versions: versions)
        XCTAssertEqual(shown.map(\.version.id), ["v2"])
        XCTAssertEqual(shown.first?.latest, true)
        XCTAssertEqual(ChatOutputCardView.what(shown[0].version), "Version 2 saved to Output")
    }

    private func version(_ maker: String, _ files: [(name: String, mime: String, size: Double)]) -> OutputVersion {
        OutputVersion(
            json: .object([
                "versionId": .string("v1"), "number": .number(1), "createdAt": .number(1),
                "files": .array(
                    files.map {
                        .object(["name": .string($0.name), "mime": .string($0.mime), "size": .number($0.size)])
                    }),
                "bytes": .number(10),
                "provenance": .object(["maker": .string(maker), "machineId": .string("mac"), "chatId": .string("chat")]),
            ]))
    }

    func testAPageADocumentTextAnImageAndAPdfAnAgentOrARoutinePublishedDrawInline() {
        XCTAssertEqual(ChatSavedPreview.of(version("agent", [("summary.md", "text/markdown", 10)])), .markdown(file: 0))
        XCTAssertEqual(ChatSavedPreview.of(version("routine", [("summary.txt", "text/plain", 10)])), .code(file: 0))
        XCTAssertEqual(ChatSavedPreview.of(version("routine", [("rapport.html", "text/html", 10)])), .page(file: 0))
        XCTAssertEqual(ChatSavedPreview.of(version("agent", [("report.pdf", "application/pdf", 10)])), .pdf(file: 0))
        XCTAssertEqual(
            ChatSavedPreview.of(version("agent", [("app.zip", "application/zip", 10), ("chart.png", "image/png", 10)])),
            .image(file: 1))
    }

    func testWhatAPersonSavedFromTheThreadIsAlreadyInIt() {
        XCTAssertNil(ChatSavedPreview.of(version("person", [("summary.md", "text/markdown", 10)])))
        XCTAssertNil(ChatSavedPreview.of(version("person", [("shot.png", "image/png", 10)])))
    }

    func testAFileWithNothingToShowALongFileOrAModelStaysARow() {
        let over = ChatSavedPreview.maxBytes + 1
        XCTAssertNil(ChatSavedPreview.of(version("agent", [("app.zip", "application/zip", 10)])))
        XCTAssertNil(ChatSavedPreview.of(version("agent", [("scene.glb", "model/gltf-binary", 10)])))
        XCTAssertNil(ChatSavedPreview.of(version("agent", [("big.md", "text/markdown", over)])))
        XCTAssertNil(ChatSavedPreview.of(version("agent", [("big.pdf", "application/pdf", over)])))
    }

    func testOnlyTheLastVersionOfAnItemInTheBlockDrawsWhatItHolds() {
        let first = ChatSavedVersion(
            artifactID: "a", title: "Report", kind: "report", version: version("agent", [("a.md", "text/markdown", 10)]),
            latest: false)
        let other = ChatSavedVersion(
            artifactID: "b", title: "Notes", kind: "report", version: version("agent", [("b.md", "text/markdown", 10)]),
            latest: true)
        let last = ChatSavedVersion(
            artifactID: "a", title: "Report", kind: "report", version: version("agent", [("a.md", "text/markdown", 10)]),
            latest: true)
        let saved = [first, other, last]
        XCTAssertNil(ChatOutputCardView.preview(saved, at: 0))
        XCTAssertEqual(ChatOutputCardView.preview(saved, at: 1), .markdown(file: 0))
        XCTAssertEqual(ChatOutputCardView.preview(saved, at: 2), .markdown(file: 0))
    }
}
