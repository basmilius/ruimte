import RuimtePulsar
import RuimteTransport
import UIKit
import WebKit
import XCTest

@testable import Ruimte

/// A design page standing on its own, after `apps/client/src/design` (`design-inline.test.ts`, `design-page.test.ts`,
/// `design-runtime.test.ts`), so the two stay in step. `designs.json` holds what the desktop makes of the same folders.
@MainActor final class DesignInliningTests: XCTestCase {
    /// A design folder in memory that counts how often each file is read and refuses what is larger than the read allows.
    @MainActor private final class Folder {
        var pages: [String: Data] = [:]
        var assets: [String: MachineResource] = [:]
        var reads: [String: Int] = [:]

        init(pages: [String: String] = [:], assets: [String: MachineResource] = [:]) {
            self.pages = pages.mapValues { Data($0.utf8) }
            self.assets = assets
        }

        func read(_ path: String, _ maxBytes: Int) async throws -> MachineResource {
            reads[path, default: 0] += 1
            let name = String(path.dropFirst("d/".count))
            let resource = pages[name].map { MachineResource(data: $0, mime: "text/html") } ?? assets[name]
            guard let resource, resource.data.count <= maxBytes else { throw MachineClientError.disconnected }
            return resource
        }

        func page(_ file: String) async throws -> String {
            String(
                decoding: try await DesignFiles.standalonePage(file, folder: "d") { try await self.read($0, $1) },
                as: UTF8.self)
        }
    }

    private static let png = MachineResource(data: Data([1, 2, 3, 4]), mime: "image/png")
    private let pngURL = "data:image/png;base64,AQIDBA=="

    private static func fixture() throws -> [[String: Any]] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "designs", withExtension: "json"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        return try XCTUnwrap(json["cases"] as? [[String: Any]])
    }

    func testEveryFolderBecomesTheSamePageAsOnTheDesktop() async throws {
        let cases = try Self.fixture()
        XCTAssertFalse(cases.isEmpty)
        for sample in cases {
            let name = try XCTUnwrap(sample["name"] as? String)
            let assets = try XCTUnwrap(sample["assets"] as? [String: [String: String]]).mapValues {
                MachineResource(data: Data(base64Encoded: $0["base64"] ?? "") ?? Data(), mime: $0["mime"] ?? "")
            }
            let folder = Folder(pages: try XCTUnwrap(sample["pages"] as? [String: String]), assets: assets)
            let page = try await folder.page(try XCTUnwrap(sample["file"] as? String))
            XCTAssertEqual(page, sample["html"] as? String, name)
        }
    }

    // MARK: A reference stands beside the page that makes it

    func testAReferenceIsRelativeToTheFolderOfThePageThatMakesItAndNeverLeavesTheDesignFolder() {
        XCTAssertEqual(DesignFiles.assetPath("../assets/logo.svg", from: "flows"), "assets/logo.svg")
        XCTAssertEqual(DesignFiles.assetPath("step.html", from: "flows/signup"), "flows/signup/step.html")
        XCTAssertNil(DesignFiles.assetPath("../../secret.txt", from: "flows"))
        XCTAssertEqual(DesignFiles.assetPath("assets/my%20photo.jpg"), "assets/my photo.jpg")
        XCTAssertEqual(DesignFiles.assetPath("img/100%.png"), "img/100%.png")
        XCTAssertNil(DesignFiles.assetPath("/etc/passwd", from: "flows"))
        XCTAssertEqual(DesignFiles.assetReferences(#"<img src="../logo.svg">"#, from: "flows"), ["../logo.svg"])
    }

    /// The cases of `design-page.test.ts`: a backslash separates like a slash, and a path that the machine holding the
    /// folder could read as leaving it, by a separator, a drive or an escape, names nothing.
    func testABackslashSeparatesLikeASlashAndEveryShapeThatLeavesTheFolderNamesNothing() {
        XCTAssertEqual(DesignFiles.assetPath("assets\\logo.svg"), "assets/logo.svg")
        XCTAssertEqual(DesignFiles.assetPath("..\\assets\\logo.svg", from: "flows"), "assets/logo.svg")
        XCTAssertEqual(DesignFiles.assetPath("assets/a%20b.png"), "assets/a b.png")
        let leaving = [
            "..\\private.txt", "a\\..\\..\\x", "C:\\x", "\\\\server\\share\\x", "\\x", "%2e%2e/x", "%2e%2e%2fx",
            "a%2f..%2f..%2fx", "%5c..%5cx", "%5c%5cserver%5cshare", "%2fetc/x", "%43:/x", "/etc/x", "a%00b.png",
            "a/.../x", "a/.. /x",
        ]
        for reference in leaving {
            XCTAssertNil(DesignFiles.assetPath(reference), reference)
        }
        XCTAssertNil(DesignFiles.assetPath("..\\..\\x", from: "flows"))
    }

    func testAPageInAFolderTakesItsFilesFromBesideItself() async throws {
        let folder = Folder(
            pages: ["flows/index.html": #"<img src="../assets/logo.svg"><img src="pic.png"><img src="../../outside.png">"#],
            assets: ["assets/logo.svg": Self.png, "flows/pic.png": Self.png])
        let page = try await folder.page("flows/index.html")
        XCTAssertEqual(page, #"<img src="\#(pngURL)"><img src="\#(pngURL)"><img src="../../outside.png">"#)
    }

    func testAPageNamesPagesAndFilesAlike() {
        let html = #"<a href="two.html">2</a><iframe src="two.html"></iframe><img src="a.png"><link href="https://x.dev/a.css">"#
        XCTAssertEqual(DesignFiles.assetReferences(html), ["two.html", "a.png"])
        XCTAssertTrue(DesignFiles.isPage("Overview.HTM"))
        XCTAssertFalse(DesignFiles.isPage("assets/logo.svg"))
        XCTAssertEqual(
            DesignFiles.pageMentions(#"<iframe src="bas.dev.html"></iframe><script>frame.src = `bas.dev.html?theme=${theme}`; open("flows/step-2.html");</script>"#),
            ["bas.dev.html", "flows/step-2.html"])
        XCTAssertEqual(DesignFiles.pageMentions("a backup in notes.html.bak"), [])
    }

    // MARK: A page that frames another page

    func testAFramedPageStandsOnItsOwnWithItsFilesAndTheQueryAndFragmentItWasGiven() async throws {
        let folder = Folder(
            pages: [
                "Overview.html": #"<iframe src="site.html?theme=dark#/work"></iframe>"#,
                "site.html": #"<img src="assets/me.png">"#,
            ], assets: ["assets/me.png": Self.png])
        let page = try await folder.page("Overview.html")
        let site = DesignFiles.pageDataURL(#"<img src="\#(pngURL)">"#)
        XCTAssertTrue(page.contains(#"<iframe src="\#(site)?theme=dark#/work"></iframe>"#))
        XCTAssertTrue(page.contains("<script data-ruimte-pages>"))
    }

    func testAFramedPageIsReadOnceHoweverOftenItIsNamedAndNeverAPageItIsFramedIn() async throws {
        let folder = Folder(pages: [
            "Overview.html": #"<iframe src="site.html"></iframe><iframe src="site.html"></iframe><script>frame.src = "site.html?x=1";</script>"#,
            "site.html": #"<a href="Overview.html">back</a><iframe src="site.html"></iframe>"#,
        ])
        let page = try await folder.page("Overview.html")
        XCTAssertEqual(folder.reads["d/site.html"], 1)
        XCTAssertEqual(folder.reads["d/Overview.html"], 1)
        XCTAssertTrue(
            page.contains(DesignFiles.pageDataURL(#"<a href="Overview.html">back</a><iframe src="site.html"></iframe>"#)))
    }

    func testAPageFramingItselfThroughAnotherStopsAtTheCycle() async throws {
        let folder = Folder(pages: [
            "a.html": #"<iframe src="b.html"></iframe>"#, "b.html": #"<iframe src="a.html"></iframe><p>b</p>"#,
        ])
        let page = try await folder.page("a.html")
        XCTAssertTrue(page.contains(DesignFiles.pageDataURL(#"<iframe src="a.html"></iframe><p>b</p>"#)))
        XCTAssertEqual(folder.reads["d/a.html"], 1)
    }

    func testAPageThatIsNotThereOrPastTheBoundsOfAVisualStaysThePathItWas() async throws {
        let folder = Folder(pages: [
            "Overview.html": #"<iframe src="gone.html"></iframe><iframe src="big.html"></iframe>"#,
            "big.html": String(repeating: "x", count: DesignFiles.pageMaxBytes),
        ])
        let page = try await folder.page("Overview.html")
        XCTAssertEqual(page, #"<iframe src="gone.html"></iframe><iframe src="big.html"></iframe>"#)
    }

    func testAllTheFilesOfAPageTogetherStayWithinTheBoundsOfAVisual() async throws {
        let ten = MachineResource(data: Data(count: DesignFiles.assetMaxBytes), mime: "image/png")
        let six = MachineResource(data: Data(count: 6 * 1024 * 1024), mime: "image/png")
        let folder = Folder(
            pages: [
                "index.html": #"<img src="ten.png"><img src="six.png"><img src="a.png"><iframe src="two.html"></iframe>"#,
                "two.html": "<p>2</p>",
            ], assets: ["ten.png": ten, "six.png": six, "a.png": Self.png])
        let page = try await folder.page("index.html")
        // The first file that does not fit ends the files; a page that fits still rides along.
        XCTAssertTrue(page.contains(#"<img src="data:image/png;base64,AAAA"#))
        XCTAssertTrue(page.contains(#"<img src="six.png"><img src="a.png">"#))
        XCTAssertTrue(page.contains(DesignFiles.pageDataURL("<p>2</p>")))
    }

    func testALinkKeepsItsPathAndWhatAStylesheetNamesStaysUnresolved() async throws {
        let css = MachineResource(data: Data("a{background:url(x.png)}@import 'y.css';".utf8), mime: "text/css")
        let folder = Folder(
            pages: ["index.html": #"<link rel="stylesheet" href="styles.css"><a href="two.html">2</a><iframe src="two.html"></iframe>"#, "two.html": "<p>2</p>"],
            assets: ["styles.css": css])
        let page = try await folder.page("index.html")
        let two = DesignFiles.pageDataURL("<p>2</p>")
        XCTAssertTrue(page.contains(#"<a href="two.html">2</a><iframe src="\#(two)"></iframe>"#))
        XCTAssertTrue(page.contains("href=\"data:text/css;base64,"))
        XCTAssertEqual(folder.reads["d/x.png"], nil)
        XCTAssertEqual(folder.reads["d/y.css"], nil)
    }

    // MARK: A file a page names only while it runs

    func testAPageWithAScriptOrAFrameCarriesWhatShowsTheFilesItNamesWhileItRuns() async throws {
        let folder = Folder(pages: [
            "Overview.html": "<head></head><iframe src=\"site.html\"></iframe>",
            "site.html": "<head></head><script>image.src = `assets/${name}.png`;</script>",
            "still.html": "<p>still</p>",
        ])
        let overview = try await folder.page("Overview.html")
        let site = try await folder.page("site.html")
        let still = try await folder.page("still.html")
        XCTAssertTrue(overview.hasPrefix("<head><script data-ruimte-assets>"))
        XCTAssertTrue(site.hasPrefix("<head><script data-ruimte-assets>"))
        XCTAssertEqual(still, "<p>still</p>")
        XCTAssertTrue(overview.contains(#"from = "";"#))
    }

    func testAFramedPageAsksForItsFilesFromItsOwnFolder() async throws {
        let folder = Folder(pages: [
            "flows/index.html": "<head></head><script>go()</script>"
        ])
        let page = try await folder.page("flows/index.html")
        XCTAssertTrue(page.contains(#"from = "flows";"#))
    }

    private func runtime(_ folder: Folder) -> DesignFiles.RuntimeAssets {
        DesignFiles.RuntimeAssets(folder: "d") { try await folder.read($0, $1) }
    }

    func testARuntimeFileIsReadOnceHoweverOftenItIsAskedAndNotWhenItCannotBeRead() async {
        let folder = Folder(assets: ["a.png": Self.png])
        let assets = runtime(folder)
        async let first = assets.bytes("a.png")
        async let again = assets.bytes("a.png")
        let (one, two) = await (first, again)
        XCTAssertEqual(one, Self.png)
        XCTAssertEqual(two, Self.png)
        let gone = await assets.bytes("gone.png")
        XCTAssertNil(gone)
        _ = await assets.bytes("gone.png")
        XCTAssertEqual(folder.reads, ["d/a.png": 1, "d/gone.png": 1])
    }

    func testRuntimeFilesTogetherStayWithinTheBoundsOfAVisualAndOpeningThePageAgainStartsOver() async {
        let ten = MachineResource(data: Data(count: DesignFiles.assetMaxBytes), mime: "image/png")
        let big = MachineResource(data: Data(count: DesignFiles.assetMaxBytes + 1), mime: "image/png")
        let folder = Folder(assets: ["one.png": ten, "two.png": ten, "big.png": big])
        let assets = runtime(folder)
        let first = await assets.bytes("one.png")
        let second = await assets.bytes("two.png")
        let past = await assets.bytes("big.png")
        XCTAssertEqual(first, ten)
        XCTAssertNil(second)
        XCTAssertNil(past)
        assets.reopen()
        let again = await assets.bytes("two.png")
        XCTAssertEqual(again, ten)
    }

    func testARuntimeFileIsOnlyAFileInsideTheFolderByThePathTheFolderHoldsItAtAndNeverAPage() async {
        let folder = Folder(assets: ["assets/work/apple.png": Self.png, "a.png": Self.png])
        let assets = runtime(folder)
        let apple = await assets.bytes("assets/work/apple.png")
        XCTAssertEqual(apple, Self.png)
        let refused = [
            "../secret.png", "assets/../../secret.png", "assets/./a.png", "/etc/hosts", "https://example.com/a.png",
            "a.png?v=1", "next.html", "", String(repeating: "a/", count: 600) + "a.png",
        ]
        for path in refused {
            let bytes = await assets.bytes(path)
            XCTAssertNil(bytes, path)
        }
        XCTAssertEqual(folder.reads, ["d/assets/work/apple.png": 1])
    }

    func testARuntimePathThatLeavesTheFolderOnWindowsIsNeverRead() async {
        var requested: [String] = []
        let assets = DesignFiles.RuntimeAssets(folder: "C:\\work\\design") { path, _ in
            requested.append(path)
            return MachineResource(data: Data("outside".utf8), mime: "text/plain")
        }
        for path in [
            "..\\private.txt", "a\\..\\..\\x", "C:\\x", "\\\\server\\share\\x", "%2e%2e/x", "/etc/x", "assets\\logo.svg",
            "a/..\\..\\x",
        ] {
            let bytes = await assets.bytes(path)
            XCTAssertNil(bytes, path)
        }
        XCTAssertEqual(requested, [])
        let logo = await assets.bytes("assets/logo.svg")
        XCTAssertNotNil(logo)
        XCTAssertEqual(requested, ["C:\\work\\design/assets/logo.svg"])
    }

    // MARK: In the web view

    func testAPageInTheWebViewShowsTheFilesItsScriptNamesAndHandsThemToTheFramesItHolds() async throws {
        let folder = Folder(
            pages: [
                "index.html": #"<!doctype html><head><meta charset="utf-8"></head><body><iframe id="f" src="two.html"></iframe><script>var image = new Image(); image.id = 'runtime'; image.setAttribute('src', 'assets/me.png'); document.body.appendChild(image); addEventListener('message', function (e) { if (e.data && e.data.framed) { window.framedSrc = e.data.framed; } });</script></body>"#,
                "two.html": #"<!doctype html><body><script>var image = new Image(); image.id = 'framed'; image.setAttribute('src', 'assets/me.png'); document.body.appendChild(image); var timer = setInterval(function () { if (image.src.indexOf('blob:') === 0) { clearInterval(timer); parent.postMessage({ framed: image.src }, '*'); } }, 20);</script></body>"#,
            ], assets: ["assets/me.png": Self.png])
        let page = try await folder.page("index.html")
        let assets = runtime(folder)
        let frame = ChatVisualFrame(
            visual: ChatVisual(id: "design-page", title: "Page", at: 0), page: Data(page.utf8), theme: .light, fill: true,
            assets: assets)
        let coordinator = ChatVisualFrame.Coordinator()
        coordinator.parent = frame
        let view = ChatVisualFrame.webView(frame, coordinator: coordinator)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 360, height: 800)
        view.frame = window.frame
        window.addSubview(view)
        window.isHidden = false
        defer { window.isHidden = true }
        await fulfillment(
            of: [expectation(for: NSPredicate(format: "loading == NO"), evaluatedWith: view)], timeout: 30)

        let shown = try await view.callAsyncJavaScript(
            """
            for (let i = 0; i < 200 && !document.getElementById('runtime').src.startsWith('blob:'); i++) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return document.getElementById('runtime').src.startsWith('blob:');
            """, contentWorld: .page)
        XCTAssertEqual(shown as? Bool, true)
        let framed = try await view.callAsyncJavaScript(
            """
            for (let i = 0; i < 200 && !window.framedSrc; i++) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return String(window.framedSrc).startsWith('blob:');
            """, contentWorld: .page)
        XCTAssertEqual(framed as? Bool, true)
        // The frame asked the page above, which asked the app once for both.
        XCTAssertEqual(folder.reads["d/assets/me.png"], 1)
    }
}
