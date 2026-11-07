import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class DesignPlaceTests: XCTestCase {
    private let view: JSONValue = .object([
        "id": .string("site"), "kind": .string("design"), "name": .string("Site"), "path": .string("site"),
        "node": .object(["provider": .string("claude")]),
        "chats": .array([
            .object(["id": .string("later"), "name": .string("Codex 2"), "node": .object(["provider": .string("codex")])]),
            .object(["id": .string("broken")]),
        ]),
    ])

    func testADesignViewHoldsItsOwnChatAndTheLaterOnesItCanRead() throws {
        let design = try XCTUnwrap(DesignPlace(view))
        XCTAssertEqual(design.chats.map(\.id), ["site", "later"])
        XCTAssertEqual(design.activeChat(picked: nil).id, "later")
        XCTAssertEqual(design.activeChat(picked: "site").id, "site")
        XCTAssertEqual(design.activeChat(picked: "gone").id, "later")
        XCTAssertEqual(DesignPlace.sessionItem(design.chats[0])["node"]?["provider"]?.stringValue, "claude")
    }

    func testTheFolderMovesUnderTheTeamsDesignsOnceShared() throws {
        let design = try XCTUnwrap(DesignPlace(view))
        XCTAssertEqual(design.location(shared: []), ".ruimte/private/designs/site")
        XCTAssertEqual(design.location(shared: ["site"]), ".ruimte/designs/site")
        let node = view.setting("path", .string("web/mockups")).setting("title", .string("Board"))
        let onCanvas = try XCTUnwrap(DesignPlace(node, canvasID: "canvas"))
        XCTAssertEqual(onCanvas.name, "Board")
        XCTAssertEqual(onCanvas.location(shared: []), "web/mockups")
    }

    func testAPathThatLeavesItsFolderIsNoDesign() {
        for path in ["", ".hidden", "../up", "a//b", "/abs", "a/./b", "tick`"] {
            XCTAssertNil(DesignPlace(view.setting("path", .string(path))), path)
        }
    }

    func testANewDesignTakesAFreeNameAndAFolderNoneHas() {
        XCTAssertEqual(DesignFiles.freeName([view.setting("name", .string("Design"))]), "Design 2")
        XCTAssertEqual(DesignFiles.slug("Café Ünïcode!"), "cafe-unicode")
        XCTAssertEqual(DesignFiles.freeFolder([view], name: "Site", onDisk: ["site-2"]), "site-3")
    }

    func testANewChatGoesAfterTheLaterChatsOfANodeOnItsCanvas() throws {
        let node = view.setting("title", .string("Board")).setting("chats", .array([]))
        let document: JSONValue = .object([
            "views": .array([.object(["id": .string("canvas"), "kind": .string("canvas"), "nodes": .array([node])])])
        ])
        let design = try XCTUnwrap(DesignPlace.all(in: document.list("views")).first)
        let chat = DesignFiles.chat(agent: ("codex", "Codex"), count: design.chats.count)
        XCTAssertEqual(chat.text("name"), "Codex 2")
        let changed = DesignFiles.adding(chat, to: design, in: document)
        XCTAssertEqual(changed.list("views")[0].list("nodes")[0].list("chats").map(\.stableID), [chat.stableID])
    }

    func testPagesComeNewestFirstAndAChangeReachesTheFolder() {
        let entries: [JSONValue] = [
            .object(["name": .string("b.html"), "kind": .string("file"), "mtime": .number(1)]),
            .object(["name": .string("a.HTM"), "kind": .string("file"), "mtime": .number(2)]),
            .object(["name": .string("style.css"), "kind": .string("file"), "mtime": .number(3)]),
            .object(["name": .string("c.html"), "kind": .string("directory"), "mtime": .number(4)]),
        ]
        XCTAssertEqual(DesignFiles.pages(entries).map { $0.text("name") }, ["a.HTM", "b.html"])
        XCTAssertEqual(DesignFiles.pageName("a.HTM"), "a")
        XCTAssertTrue(DesignFiles.changeReaches("/p/.ruimte/private/designs/site/x", folder: "/p/.ruimte/private/designs/site", found: true))
        XCTAssertFalse(DesignFiles.changeReaches("/p/.ruimte/private", folder: "/p/.ruimte/private/designs/site", found: true))
        XCTAssertTrue(DesignFiles.changeReaches("/p/.ruimte/private", folder: "/p/.ruimte/private/designs/site", found: false))
    }

    func testAPageTakesTheFilesOfItsFolderAlongAndLeavesTheRestAlone() {
        let html = """
            <img src="img/logo.png"><a href="other.html">x</a><link href='https://x.dev/a.css'>\
            <div style="background: url(./bg%20one.jpg)"></div><img src="../outside.png">
            """
        XCTAssertEqual(DesignFiles.assetReferences(html), ["img/logo.png", "./bg%20one.jpg"])
        XCTAssertEqual(DesignFiles.assetPath("./bg%20one.jpg"), "bg one.jpg")
        XCTAssertNil(DesignFiles.assetPath("../outside.png"))
        let page = DesignFiles.withAssets(
            html, inline: ["img/logo.png": "data:image/png;base64,AA", "./bg%20one.jpg": "data:image/jpeg;base64,BB"])
        XCTAssertTrue(page.contains(#"<img src="data:image/png;base64,AA">"#))
        XCTAssertTrue(page.contains("url(data:image/jpeg;base64,BB)"))
        XCTAssertTrue(page.contains(#"href="other.html""#))
    }

    private let kept = DesignFiles.Listing(pages: [.object(["name": .string("a.html"), "kind": .string("file")])], found: true)
    private let dropped = MachineClientError.disconnected

    func testAMissingFolderIsADesignWithoutPages() {
        let missing = MachineClientError.server(code: "not-found", message: "That folder is not there")
        XCTAssertEqual(kept.after(.failure(missing)), DesignFiles.Listing(pages: [], found: false, problem: nil))
    }

    /// What `fs.list` answers for a folder that is there and refuses to be read (EACCES), pinned in `list.integration.test.ts`.
    func testAnUnreadableFolderIsAnErrorThatKeepsTheEarlierPages() {
        let unreadable = MachineClientError.server(code: "not-readable", message: "That folder cannot be read")
        let next = kept.after(.failure(unreadable))
        XCTAssertEqual(next.pages, kept.pages)
        XCTAssertTrue(next.found)
        XCTAssertEqual(next.problem, "That folder cannot be read")
    }

    func testAnotherErrorKeepsTheEarlierPagesAndSaysWhy() {
        let next = kept.after(.failure(dropped))
        XCTAssertEqual(next.pages, kept.pages)
        XCTAssertTrue(next.found)
        XCTAssertEqual(next.problem, dropped.localizedDescription)
    }

    func testAnotherErrorWithoutPagesIsNotTheEmptyState() {
        let denied = MachineClientError.server(code: "forbidden", message: "Not allowed")
        let next = DesignFiles.Listing().after(.failure(denied))
        XCTAssertNil(next.pages)
        XCTAssertEqual(next.problem, "Not allowed")
    }

    func testAReadThatWorksClearsTheError() {
        let failed = kept.after(.failure(dropped))
        let entries: [JSONValue] = [.object(["name": .string("b.html"), "kind": .string("file")])]
        let next = failed.after(.success(entries))
        XCTAssertEqual(next.pages?.map { $0.text("name") }, ["b.html"])
        XCTAssertTrue(next.found)
        XCTAssertNil(next.problem)
    }
}
