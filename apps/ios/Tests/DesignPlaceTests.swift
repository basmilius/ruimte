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

    @MainActor func testAHeldPageTheMachineLetGoOfIsBuiltOnceMoreAndShown() async throws {
        let machine = DesignMachine(answersPage: true)
        machine.numbersBuilds = true
        machine.page = Data("<p>hi</p>".utf8)
        machine.heldFailures["held-1"] = .server(code: "not-found", message: "Not a design page this machine holds")
        let page = try await Self.page(machine)
        XCTAssertEqual(page, machine.page)
        XCTAssertEqual(machine.asked.count, 2)
        XCTAssertEqual(machine.reads.map { $0.resource.text("pageId") }, ["held-1", "held-2"])
    }

    @MainActor func testAHeldPageGoneTwiceIsTheFailure() async {
        let machine = DesignMachine(answersPage: true)
        machine.numbersBuilds = true
        let gone = MachineClientError.server(code: "not-found", message: "Not a design page this machine holds")
        machine.heldFailures = ["held-1": gone, "held-2": gone]
        do {
            _ = try await Self.page(machine)
            XCTFail("a page was shown")
        } catch {
            XCTAssertEqual(error as? MachineClientError, gone)
        }
        XCTAssertEqual(machine.asked.count, 2)
    }

    @MainActor func testAHeldPageThatFailsForAnotherReasonIsNotBuiltAgain() async {
        let machine = DesignMachine(answersPage: true)
        machine.numbersBuilds = true
        let failure = MachineClientError.server(code: "bad-offset", message: "Offset 9 is past the end")
        machine.heldFailures["held-1"] = failure
        do {
            _ = try await Self.page(machine)
            XCTFail("a page was shown")
        } catch {
            XCTAssertEqual(error as? MachineClientError, failure)
        }
        XCTAssertEqual(machine.asked.count, 1)
    }

    @MainActor func testAPageAtTheLimitIsReadWholeWithTheBootstrapTheMachineAdds() async throws {
        // The bootstrap of a visual weighs about 9 KiB.
        let html = String(repeating: "x", count: DesignFiles.pageMaxBytes) + String(repeating: "b", count: 9 * 1024)
        let machine = DesignMachine(answersPage: true)
        machine.built = .object([
            "kind": .string("page"), "pageId": .string("held-1"), "size": .number(Double(html.utf8.count)),
        ])
        machine.page = Data(html.utf8)
        let page = try await Self.page(machine)
        XCTAssertEqual(page.count, html.utf8.count)
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
        // As the app's reading of a reply marks a result of a newer machine, one that names a page too.
        let newer: [JSONValue] = [
            .object(["kind": .string("locked"), "name": .string("index.html"), WireSchema.unknownMark: .bool(true)]),
            .object([
                "kind": .string("page"), "pageId": .string("held-1"), "size": .string("large"),
                WireSchema.unknownMark: .bool(true),
            ]),
        ]
        for (built, words) in failures + newer.map({ ($0, "Update Ruimte to see this.") }) {
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
    /// What the read of a held page answers instead of its bytes, by its id.
    var heldFailures: [String: MachineClientError] = [:]
    /// Each `design.page` builds a page under a new id, `held-1` first, when set.
    var numbersBuilds = false
    private(set) var asked: [JSONValue] = []
    private(set) var reads: [(resource: JSONValue, offset: Int)] = []

    init(answersPage: Bool) { self.answersPage = answersPage }

    func answers(_ type: WireRequest) -> Bool { answersPage && type == .designPage }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        guard type == .designPage else { throw MachineClientError.invalid(type.rawValue) }
        asked.append(payload)
        guard numbersBuilds else { return built }
        return .object([
            "kind": .string("page"), "pageId": .string("held-\(asked.count)"), "size": .number(Double(page.count)),
        ])
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        {}
    }

    func readBytes(_ payload: JSONValue) async throws -> BytesPiece {
        let resource = payload["resource"] ?? .null
        let offset = Int(payload["offset"]?.numberValue ?? 0)
        let length = Int(payload["length"]?.numberValue ?? 0)
        reads.append((resource, offset))
        if let failure = heldFailures[resource.text("pageId")] { throw failure }
        let held = resource.text("kind") == "designPage" ? page : files[resource.text("path")]
        guard let held else { throw MachineClientError.server(code: "not-found", message: "That file is not there") }
        return BytesPiece(
            mime: "text/html", size: held.count, version: "1", offset: offset,
            data: held.subdata(in: offset..<min(held.count, offset + length)))
    }
}
