import RuimtePulsar
import RuimteTransport
import WebKit
import XCTest

@testable import Ruimte

@MainActor final class ChatVisualTests: XCTestCase {
    private func item(
        _ id: String, _ kind: String, turn: String = "t1", at createdAt: Double, _ extra: [String: JSONValue] = [:]
    ) -> JSONValue {
        .object(
            [
                "id": .string(id), "kind": .string(kind), "turnId": .string(turn), "createdAt": .number(createdAt),
            ].merging(extra) { _, extra in extra })
    }

    /// A turn that ended: what the person asked, a call that folds away and the answer that closed it.
    private var settledTurn: [JSONValue] {
        [
            item("u1", "user", at: 1000, ["text": .string("Show me")]),
            item("t1", "turn", at: 1001, ["state": .string("done"), "endedAt": .number(1400)]),
            item("x1", "tool", at: 1100, ["state": .string("done"), "name": .string("Bash")]),
            item("a1", "assistant", at: 1300, ["text": .string("Here it is")]),
        ]
    }

    /// A turn still running: a call, a word between calls and a call that runs.
    private var runningTurn: [JSONValue] {
        [
            item("u2", "user", turn: "t2", at: 3000, ["text": .string("And now")]),
            item("t2", "turn", turn: "t2", at: 3001, ["state": .string("running")]),
            item("x2", "tool", turn: "t2", at: 3100, ["state": .string("done"), "name": .string("Read")]),
            item("a2", "assistant", turn: "t2", at: 3150, ["text": .string("Drawing it")]),
            item("x3", "tool", turn: "t2", at: 3300, ["state": .string("running"), "name": .string("Bash")]),
        ]
    }

    private func visual(_ id: String, at: Double, heights: [[Double]] = [], maxHeight: Double = 2000) -> ChatVisual {
        ChatVisual(
            id: id, title: "Chart \(id)", at: at, maxHeight: maxHeight,
            heights: heights.map { ChatVisual.Measure(width: $0[0], height: $0[1]) })
    }

    private static func fixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "visuals", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    func testAVisualReadsTheWireAndNeedsAnIdAndAMoment() {
        let value: JSONValue = .object([
            "id": .string("v1"), "title": .string("Revenue"), "at": .number(1200), "maxHeight": .number(600),
            "heights": .array([.array([.number(320), .number(400)]), .array([.number(480)])]),
            "size": .number(2048), "turnId": .string("t1"),
        ])
        let visual = ChatVisual(value)
        XCTAssertEqual(visual?.title, "Revenue")
        XCTAssertEqual(visual?.maxHeight, 600)
        XCTAssertEqual(visual?.heights, [ChatVisual.Measure(width: 320, height: 400)])
        XCTAssertEqual(visual?.turnID, "t1")
        XCTAssertNil(ChatVisual(.object(["id": .string("v1"), "title": .string("No moment")])))
        XCTAssertNil(ChatVisual(.object(["id": .string(""), "at": .number(1)])))
    }

    func testInASettledTurnAVisualStandsUnderTheFoldAndAboveTheAnswer() {
        let presentation = ChatPresentation()
        presentation.replace(settledTurn, info: .object([:]))
        presentation.setVisuals([visual("v1", at: 1200)])
        XCTAssertEqual(presentation.entries.map(\.id), ["u1", "fold-t1", "visual-v1", "a1"])
        XCTAssertEqual(presentation.entries[2].kind, .visual)
        XCTAssertEqual(presentation.entries[2].visual?.title, "Chart v1")
    }

    func testInARunningTurnAVisualStandsBetweenTheCallsAroundIt() {
        let presentation = ChatPresentation()
        presentation.replace(settledTurn + runningTurn, info: .object(["activeTurnId": .string("t2")]))
        presentation.setVisuals([visual("v2", at: 3200)])
        XCTAssertEqual(
            presentation.entries.map(\.id),
            ["u1", "fold-t1", "a1", "u2", "tools-x2", "a2", "visual-v2", "x3", "working-t2"])
    }

    func testAVisualAlwaysStandsAboveTheWorkingRow() {
        let presentation = ChatPresentation()
        presentation.replace(settledTurn + runningTurn, info: .object(["activeTurnId": .string("t2")]))
        presentation.setVisuals([visual("late", at: 9000), visual("between", at: 2000)])
        XCTAssertEqual(
            presentation.entries.map(\.id),
            ["u1", "fold-t1", "a1", "visual-between", "u2", "tools-x2", "a2", "x3", "visual-late", "working-t2"])
    }

    func testVisualsOfTheSameMomentKeepTheirOrder() {
        let rows = [ChatTimelineEntry(id: "working-t1", kind: .activity)]
        let placed = ChatVisuals.placed(
            rows, visuals: [visual("b", at: 5), visual("a", at: 5), visual("first", at: 1)], heldFrom: nil)
        XCTAssertEqual(placed.map(\.id), ["visual-first", "visual-b", "visual-a", "working-t1"])
    }

    func testAVisualFromBeforeTheFirstPageWaitsForThatPage() {
        let model = ChatModel(client: VisualMachine(), chatID: "chat")
        let snapshot: JSONValue = .object([
            "items": .array(settledTurn), "history": .object(["cursor": .string("older")]),
            "visuals": .array([
                .object(["id": .string("old"), "title": .string("Old"), "at": .number(500)]),
                .object(["id": .string("new"), "title": .string("New"), "at": .number(1200)]),
            ]),
        ])
        model.replace(snapshot)
        XCTAssertEqual(model.presentation.visuals.map(\.id), ["old", "new"])
        XCTAssertEqual(model.presentation.entries.map(\.id), ["u1", "fold-t1", "visual-new", "a1"])
        let complete = ChatVisuals.placed(
            model.presentation.entries, visuals: model.presentation.visuals, heldFrom: nil)
        XCTAssertEqual(complete.first?.id, "visual-old")
    }

    func testTheListOfAnotherClientArrivesAsAnEventAndRemovingAsksTheMachine() async {
        let machine = VisualMachine()
        machine.visuals = [
            .object(["id": .string("v1"), "title": .string("One"), "at": .number(1)]),
            .object(["id": .string("v2"), "title": .string("Two"), "at": .number(2)]),
        ]
        let model = ChatModel(client: machine, chatID: "chat")
        model.start()
        defer { model.stop() }
        machine.emit("chat.visuals", .object(["chatId": .string("other"), "visuals": .array(machine.visuals)]))
        XCTAssertTrue(model.presentation.visuals.isEmpty)
        machine.emit("chat.visuals", .object(["chatId": .string("chat"), "visuals": .array(machine.visuals)]))
        XCTAssertEqual(model.presentation.visuals.map(\.id), ["v1", "v2"])
        await model.removeVisual("v1")
        XCTAssertEqual(model.presentation.visuals.map(\.id), ["v2"])
        let removal = machine.requests.first { $0.0 == "chat.removeVisual" }
        XCTAssertEqual(removal?.1["chatId"], .string("chat"))
        XCTAssertEqual(removal?.1["visualId"], .string("v1"))
    }

    func testAMachineWithoutVisualsSaysItNeedsAnUpdate() async {
        let machine = VisualMachine()
        machine.unknown = true
        let model = ChatModel(client: machine, chatID: "chat")
        await model.removeVisual("v1")
        XCTAssertEqual(model.error, "Update Ruimte on this machine to remove visuals.")
    }

    func testTheMeasuredHeightIsTheContractsOwn() throws {
        let cases = try XCTUnwrap(Self.fixture()["heights"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for sample in cases {
            let source = try XCTUnwrap(sample["visual"] as? [String: Any])
            let pairs = (source["heights"] as? [[Double]]) ?? []
            let measured = visual(
                "v", at: 0, heights: pairs, maxHeight: try XCTUnwrap(source["maxHeight"] as? Double))
            let width = try XCTUnwrap(sample["width"] as? Double)
            XCTAssertEqual(
                ChatVisualHeights.measured(measured, width: width), sample["height"] as? Double,
                "\(pairs) at \(width)")
        }
    }

    func testACardStartsAtWhatItReportedThenWhatWasMeasuredThenADefault() {
        let measured = visual("measured", at: 0, heights: [[320, 500], [480, 700]])
        XCTAssertEqual(ChatVisualHeights.initial(measured, width: 400, remembered: [:]), 700)
        XCTAssertEqual(ChatVisualHeights.initial(measured, width: 400, remembered: [400: 432]), 432)
        XCTAssertEqual(ChatVisualHeights.initial(measured, width: 400, remembered: [360: 432]), 700)
        XCTAssertEqual(ChatVisualHeights.initial(visual("bare", at: 0), width: 400, remembered: [:]), 240)
        XCTAssertEqual(
            ChatVisualHeights.initial(visual("low", at: 0, maxHeight: 120), width: 400, remembered: [:]), 120)
        ChatVisualHeights.remember("remembered", width: 359.6, height: 512)
        XCTAssertEqual(ChatVisualHeights.remembered("remembered"), [360: 512])
        XCTAssertEqual(ChatVisualHeights.remembered("unknown"), [:])
    }

    func testAReportedHeightKeepsToTheVisualsMaximumAndTheLimits() {
        XCTAssertEqual(ChatVisualHeights.clamp(300.2, maxHeight: 2000), 301)
        XCTAssertEqual(ChatVisualHeights.clamp(900, maxHeight: 600), 600)
        XCTAssertEqual(ChatVisualHeights.clamp(12, maxHeight: 2000), 80)
        XCTAssertEqual(ChatVisualHeights.clamp(5000, maxHeight: 9000), 2000)
    }

    func testTheThemeGivesThePageTheAppsTokensUnderTheContractsNames() {
        for (theme, appearance) in [(ChatVisualTheme.light, ChatVisualAppearance.light), (.dark, .dark)] {
            let hex = { (token: RuimteColorToken) in
                String(format: "#%06x", appearance == .dark ? token.dark : token.light)
            }
            let values = Dictionary(uniqueKeysWithValues: theme.variables.map { ($0.name, $0.value) })
            let names = theme.variables.map(\.name)
            XCTAssertEqual(theme.appearance, appearance)
            XCTAssertEqual(names, ChatVisualContract.themeVariables.filter(Set(names).contains))
            XCTAssertEqual(values["--background"], hex(RuimteColors.surface))
            XCTAssertEqual(values["--foreground"], hex(RuimteColors.text))
            XCTAssertEqual(values["--muted-foreground"], hex(RuimteColors.muted))
            XCTAssertEqual(values["--card"], hex(RuimteColors.panel))
            XCTAssertEqual(values["--border"], hex(RuimteColors.border))
            XCTAssertEqual(values["--primary"], hex(RuimteColors.accent))
            XCTAssertEqual(values["--chart-1"], hex(RuimteColors.accent))
            XCTAssertEqual(values["--destructive"], hex(RuimteColors.statusError))
            XCTAssertEqual(values["--warning"], hex(RuimteColors.statusNeedsYou))
            XCTAssertEqual(values["--success"], hex(RuimteColors.positive))
            for chart in 2...6 { XCTAssertNotNil(values["--chart-\(chart)"]) }
            XCTAssertEqual(values["--radius"], "12px")
            XCTAssertNotNil(values["--font-sans"])
            XCTAssertNotNil(values["--font-mono"])
            // Without a token of the app's own these keep the page's default for the appearance.
            XCTAssertNil(values["--input"])
            XCTAssertNil(values["--warning-foreground"])
            for variable in theme.variables {
                XCTAssertNotNil(variable.name.range(of: "^--[a-z0-9-]{1,64}$", options: .regularExpression))
                XCTAssertFalse(variable.value.isEmpty)
                XCTAssertNil(variable.value.range(of: #"[;{}<>\\\r\n]|/\*|\*/"#, options: .regularExpression))
            }
        }
        XCTAssertNotEqual(ChatVisualTheme.light, ChatVisualTheme.dark)
    }

    func testTheAddressAndTheMessageCarryTheThemeAsTheContractsWriteThem() throws {
        let fixture = try Self.fixture()
        let source = try XCTUnwrap(fixture["theme"] as? [String: Any])
        let pairs = try XCTUnwrap(source["variables"] as? [[String]])
        let theme = ChatVisualTheme(
            appearance: try XCTUnwrap(ChatVisualAppearance(rawValue: source["appearance"] as? String ?? "")),
            variables: pairs.map { ChatVisualTheme.Variable(name: $0[0], value: $0[1]) })
        XCTAssertEqual(theme.fragment, fixture["fragment"] as? String)
        let message = try JSONSerialization.jsonObject(with: Data(theme.hostContextMessage.utf8)) as? NSDictionary
        XCTAssertEqual(message, fixture["hostContext"] as? NSDictionary)
    }

    func testTheMainFrameStaysOnThePage() {
        let page = ChatVisualPageScheme.url("v1")
        let verdict = { (address: String) in
            ChatVisualNavigation.verdict(URL(string: address), mainFrame: true, page: page)
        }
        XCTAssertEqual(verdict(page.absoluteString), .allow)
        XCTAssertEqual(verdict(page.absoluteString + "#section"), .allow)
        XCTAssertEqual(verdict("ruimte-visual://page/v2"), .cancel)
        XCTAssertEqual(verdict(page.absoluteString + "?again"), .cancel)
        XCTAssertEqual(verdict("https://example.com/"), .cancel)
        XCTAssertEqual(verdict("about:blank"), .cancel)
        XCTAssertEqual(verdict("file:///etc/hosts"), .cancel)
        XCTAssertEqual(ChatVisualNavigation.verdict(nil, mainFrame: true, page: page), .cancel)
    }

    func testAFrameInsideThePageLoadsWhatThePolicyLets() {
        let page = ChatVisualPageScheme.url("v1")
        let verdict = { (address: String) in
            ChatVisualNavigation.verdict(URL(string: address), mainFrame: false, page: page)
        }
        for allowed in [
            "https://example.com/embed", "data:text/html,hi", "blob:null/1234", "about:blank", "about:srcdoc",
        ] {
            XCTAssertEqual(verdict(allowed), .allow, allowed)
        }
        for refused in ["http://example.com/", "file:///etc/hosts", page.absoluteString, "javascript:alert(1)"] {
            XCTAssertEqual(verdict(refused), .cancel, refused)
        }
    }

    func testOnlyALinkAPersonFollowsToTheWebOpensOutside() {
        let web = URL(string: "https://example.com/docs")
        XCTAssertEqual(ChatVisualNavigation.link(web, type: .linkActivated), web)
        XCTAssertEqual(
            ChatVisualNavigation.link(URL(string: "http://example.com/"), type: .linkActivated)?.absoluteString,
            "http://example.com/")
        XCTAssertNil(ChatVisualNavigation.link(web, type: .other))
        XCTAssertNil(ChatVisualNavigation.link(URL(string: "javascript:alert(1)"), type: .linkActivated))
        XCTAssertNil(ChatVisualNavigation.link(URL(string: "file:///etc/hosts"), type: .linkActivated))
        XCTAssertNil(ChatVisualNavigation.link(URL(string: "ruimte://node"), type: .linkActivated))
    }

    func testTheSchemeAnswersOnlyItsOwnPageWithTheHostPolicy() throws {
        let page = Data("<p>Chart</p>".utf8)
        let scheme = ChatVisualPageScheme(visualID: "v 1/2", page: page)
        XCTAssertEqual(scheme.pageURL.scheme, ChatVisualPageScheme.scheme)
        XCTAssertEqual(scheme.pageURL.host(), "page")
        let answer = try XCTUnwrap(scheme.answer(URL(string: scheme.pageURL.absoluteString + "#visual-theme=x")))
        XCTAssertEqual(answer.data, page)
        XCTAssertEqual(answer.response.statusCode, 200)
        XCTAssertEqual(
            answer.response.value(forHTTPHeaderField: "Content-Security-Policy"),
            ChatVisualContract.pageHeaders["content-security-policy"])
        XCTAssertEqual(answer.response.value(forHTTPHeaderField: "Content-Type"), "text/html; charset=utf-8")
        XCTAssertTrue(
            ChatVisualContract.pageHeaders["content-security-policy"]?.contains("sandbox allow-scripts") == true)
        XCTAssertNil(scheme.answer(ChatVisualPageScheme.url("v2")))
        XCTAssertNil(scheme.answer(URL(string: "ruimte-visual://other/v%201%2F2")))
        XCTAssertNil(scheme.answer(URL(string: "https://example.com/")))
        XCTAssertNil(scheme.answer(nil))

        let webView = WKWebView(frame: .zero)
        let served = SchemeTask(scheme.pageURL)
        scheme.webView(webView, start: served)
        XCTAssertEqual(served.data, page)
        XCTAssertTrue(served.finished)
        XCTAssertNil(served.error)
        let refused = SchemeTask(URL(string: "ruimte-visual://page/elsewhere")!)
        scheme.webView(webView, start: refused)
        XCTAssertNil(refused.response)
        XCTAssertNotNil(refused.error)
    }

    func testThePageTakesTheThemeFromItsAddressReportsItsHeightAndFollowsTheApp() async throws {
        let html = try XCTUnwrap(Self.fixture()["page"] as? String)
        let sized = expectation(description: "The page reports its height")
        sized.assertForOverFulfill = false
        var heights: [Double] = []
        let frame = ChatVisualFrame(
            visual: visual("page", at: 0), page: Data(html.utf8), theme: .dark,
            onHeight: { height, _ in
                heights.append(height)
                sized.fulfill()
            })
        let coordinator = ChatVisualFrame.Coordinator()
        coordinator.parent = frame
        let view = ChatVisualFrame.webView(frame, coordinator: coordinator)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 360, height: 800)
        view.frame = CGRect(x: 0, y: 0, width: 360, height: 240)
        window.addSubview(view)
        window.isHidden = false
        defer { window.isHidden = true }
        await fulfillment(of: [sized], timeout: 30)
        XCTAssertEqual(heights.first ?? 0, 320, accuracy: 1)
        // The theme goes over a message only once the page finished loading.
        await fulfillment(
            of: [expectation(for: NSPredicate(format: "loading == NO"), evaluatedWith: view)], timeout: 30)

        func read(_ script: String) async throws -> String? {
            try await view.callAsyncJavaScript(script, contentWorld: .page) as? String
        }
        let background = "return getComputedStyle(document.documentElement).getPropertyValue('--background').trim();"
        let dark = try await read(background)
        XCTAssertEqual(dark, "#131316")
        // The page took the theme off its address, so its own hash routing never sees it.
        let hash = try await read("return location.hash;")
        XCTAssertEqual(hash, "")
        // The policy's sandbox holds: the page runs on an opaque origin and cannot reach the app's bridge.
        let origin = try await read("return self.origin;")
        XCTAssertEqual(origin, "null")
        let bridged = try await read("return String(Boolean(window.webkit && window.webkit.messageHandlers.visual));")
        XCTAssertEqual(bridged, "false")

        _ = try await view.callAsyncJavaScript(
            "window.nextMessage = new Promise((resolve) => addEventListener('message', () => setTimeout(resolve)));",
            contentWorld: .page)
        coordinator.show(.light, in: view)
        let light = try await read("await window.nextMessage; " + background)
        XCTAssertEqual(light, "#ffffff")
        XCTAssertEqual(view.url?.absoluteString, ChatVisualPageScheme.url("page").absoluteString)
    }

    func testACardScrollsInsideOnlyWhileItsPageOverflows() {
        let card = CGSize(width: 360, height: 240)
        XCTAssertFalse(ChatVisualWebView.scrolls(content: CGSize(width: 360, height: 240), in: card, fill: false))
        XCTAssertTrue(ChatVisualWebView.scrolls(content: CGSize(width: 360, height: 900), in: card, fill: false))
        XCTAssertTrue(ChatVisualWebView.scrolls(content: CGSize(width: 720, height: 240), in: card, fill: false))
        XCTAssertTrue(ChatVisualWebView.scrolls(content: CGSize(width: 360, height: 240), in: card, fill: true))
    }
}

@MainActor private final class VisualMachine: MachineRequesting {
    var requests: [(String, JSONValue)] = []
    var unknown = false
    var visuals: [JSONValue] = []
    private var handlers: [String: [@MainActor @Sendable (JSONValue) -> Void]] = [:]

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if unknown { throw MachineClientError.server(code: "unknown-request", message: "Unknown request") }
        if type == "chat.removeVisual" { visuals.removeAll { $0["id"] == payload["visualId"] } }
        return .object(["visuals": .array(visuals)])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        handlers[event, default: []].append(handler)
        return {}
    }

    func emit(_ event: String, _ payload: JSONValue) {
        for handler in handlers[event] ?? [] { handler(payload) }
    }
}

private final class SchemeTask: NSObject, WKURLSchemeTask {
    let request: URLRequest
    var response: URLResponse?
    var data = Data()
    var finished = false
    var error: Error?

    init(_ url: URL) {
        request = URLRequest(url: url)
    }

    func didReceive(_ response: URLResponse) { self.response = response }
    func didReceive(_ data: Data) { self.data.append(data) }
    func didFinish() { finished = true }
    func didFailWithError(_ error: Error) { self.error = error }
}
