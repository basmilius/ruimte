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
        let entries = [
            Self.entry("b.html", mtime: 1), Self.entry("a.HTM", mtime: 2), Self.entry("style.css", mtime: 3),
            Self.entry("c.html", kind: .directory, mtime: 4),
        ]
        XCTAssertEqual(DesignFiles.pages(entries).map(\.name), ["a.HTM", "b.html"])
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
        XCTAssertEqual(DesignFiles.assetReferences(html), ["img/logo.png", "other.html", "./bg%20one.jpg"])
        XCTAssertEqual(DesignFiles.assetPath("./bg%20one.jpg"), "bg one.jpg")
        XCTAssertNil(DesignFiles.assetPath("../outside.png"))
        let page = DesignFiles.withAssets(
            html, inline: ["img/logo.png": "data:image/png;base64,AA", "./bg%20one.jpg": "data:image/jpeg;base64,BB"])
        XCTAssertTrue(page.contains(#"<img src="data:image/png;base64,AA">"#))
        XCTAssertTrue(page.contains("url(data:image/jpeg;base64,BB)"))
        XCTAssertTrue(page.contains(#"href="other.html""#))
    }

    private static func entry(_ name: String, kind: FsEntryKind = .file, mtime: Double = 0) -> FsEntry {
        FsEntry(name: name, path: "/p/" + name, kind: kind, size: nil, mtime: mtime, hidden: false, ignored: false)
    }

    private let kept = DesignFiles.Listing(pages: [DesignPlaceTests.entry("a.html")], found: true)
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
        let next = failed.after(.success([Self.entry("b.html")]))
        XCTAssertEqual(next.pages?.map(\.name), ["b.html"])
        XCTAssertTrue(next.found)
        XCTAssertNil(next.problem)
    }

    @MainActor func testAMachineThatAnswersDesignPageBuildsThePageAndHandsItOutOnce() async throws {
        let html = "<p>" + String(repeating: "x", count: Int(WireConstants.bytesChunkMax)) + "</p>"
        let machine = DesignMachine(answersPage: true)
        machine.built = .object([
            "kind": .string("page"), "pageId": .string("held-1"), "size": .number(Double(html.utf8.count)),
        ])
        machine.page = Data(html.utf8)
        let page = try await Self.page(machine)
        XCTAssertEqual(page, Data(html.utf8))
        let asked: JSONValue = .object([
            "projectId": .string("project-1"), "designId": .string("site"), "file": .string("index.html"),
            "bootstrap": .bool(true),
        ])
        XCTAssertEqual(machine.asked, [asked])
        let held: JSONValue = .object(["kind": .string("designPage"), "pageId": .string("held-1")])
        XCTAssertEqual(machine.reads.map(\.resource), [held, held])
        // Each piece once: the machine drops the page after its last byte went out.
        XCTAssertEqual(machine.reads.map(\.offset), [0, Int(WireConstants.bytesChunkMax)])
    }

    @MainActor func testAnOlderMachineHandsOutTheFilesAndThePageIsBuiltHere() async throws {
        let machine = DesignMachine(answersPage: false)
        machine.files["/p/site/index.html"] = Data("<p>hi</p>".utf8)
        let page = try await Self.page(machine)
        XCTAssertEqual(String(decoding: page, as: UTF8.self), "<p>hi</p>")
        XCTAssertTrue(machine.asked.isEmpty)
        XCTAssertEqual(machine.reads.map { $0.resource.text("kind") }, ["file"])
    }

    @MainActor func testEachPageAMachineCannotBuildIsWordedAsTheAppWordsIt() async {
        let failures: [(JSONValue, String)] = [
            (.object(["kind": .string("missing"), "name": .string("index.html")]), "index.html is not in the design."),
            (
                .object([
                    "kind": .string("too-large"), "name": .string("index.html"), "size": .number(20),
                    "limit": .number(10),
                ]), "This page is too large to show."
            ),
            (.object(["kind": .string("not-text"), "name": .string("index.html")]), "index.html is not a text file."),
        ]
        for (built, words) in failures {
            let machine = DesignMachine(answersPage: true)
            machine.built = built
            do {
                _ = try await Self.page(machine)
                XCTFail("\(built) built a page")
            } catch {
                XCTAssertEqual(error.localizedDescription, words)
            }
            XCTAssertTrue(machine.reads.isEmpty)
        }
    }

    @MainActor private static func page(_ machine: DesignMachine) async throws -> Data {
        try await DesignFiles.page(
            "index.html", folder: "/p/site", design: "site", project: "project-1", client: machine,
            read: { path, maxBytes in
                try await machine.readResource(
                    .object(["kind": .string("file"), "path": .string(path)]), maxBytes: maxBytes)
            })
    }
}

/// A machine that builds a design page or, before `design.page`, hands out the files of the folder.
@MainActor private final class DesignMachine: MachineRequesting, MachineFeatures {
    let answersPage: Bool
    var built: JSONValue = .null
    var page = Data()
    var files: [String: Data] = [:]
    private(set) var asked: [JSONValue] = []
    private(set) var reads: [(resource: JSONValue, offset: Int)] = []

    init(answersPage: Bool) { self.answersPage = answersPage }

    func answers(_ type: WireRequest) -> Bool { answersPage && type == .designPage }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        guard type == .designPage else { throw MachineClientError.invalid(type.rawValue) }
        asked.append(payload)
        return built
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        {}
    }

    func readBytes(_ payload: JSONValue) async throws -> BytesPiece {
        let resource = payload["resource"] ?? .null
        let offset = Int(payload["offset"]?.numberValue ?? 0)
        let length = Int(payload["length"]?.numberValue ?? 0)
        reads.append((resource, offset))
        let held = resource.text("kind") == "designPage" ? page : files[resource.text("path")]
        guard let held else { throw MachineClientError.server(code: "not-found", message: "That file is not there") }
        return BytesPiece(
            mime: "text/html", size: held.count, version: "1", offset: offset,
            data: held.subdata(in: offset..<min(held.count, offset + length)))
    }
}
