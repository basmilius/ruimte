import SwiftUI
import UIKit
import WebKit

/// Serves one visual's page from memory under a scheme of the app's own, with the policy the desktop's host page of a
/// visual has, so the page never gets a `file:` origin, reaches no local file and runs on an opaque origin.
@MainActor final class ChatVisualPageScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "ruimte-visual"
    let pageURL: URL
    private let page: Data

    init(visualID: String, page: Data) {
        pageURL = Self.url(visualID)
        self.page = page
    }

    static func url(_ visualID: String) -> URL {
        let path = visualID.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return URL(string: "\(scheme)://page/\(path)")!
    }

    /// The page for its own address, whatever fragment that carries, and nothing for any other.
    func answer(_ url: URL?) -> (response: HTTPURLResponse, data: Data)? {
        guard let url, ChatVisualNavigation.samePage(url, pageURL),
            let response = HTTPURLResponse(
                url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ChatVisualContract.pageHeaders)
        else { return nil }
        return (response, page)
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let answer = answer(task.request.url) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        task.didReceive(answer.response)
        task.didReceive(answer.data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}

/// Where a visual's page may go: its main frame stays on the page, and a frame inside it loads the web as the page's
/// policy lets it, as the desktop's guard has it.
enum ChatVisualNavigation {
    enum Verdict: Equatable { case allow, cancel }

    static func verdict(_ url: URL?, mainFrame: Bool, page: URL) -> Verdict {
        guard let url else { return .cancel }
        if mainFrame { return samePage(url, page) ? .allow : .cancel }
        if ["about:blank", "about:srcdoc"].contains(url.absoluteString.lowercased()) { return .allow }
        return ["https", "data", "blob"].contains(url.scheme?.lowercased() ?? "") ? .allow : .cancel
    }

    /// The address a window the page asks for opens outside the app: only a link a person followed to the web. A
    /// window a script opens goes nowhere.
    static func link(_ url: URL?, type: WKNavigationType) -> URL? {
        type == .linkActivated ? web(url) : nil
    }

    static func web(_ url: URL?) -> URL? {
        guard let url, ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host() != nil else { return nil }
        return url
    }

    static func samePage(_ url: URL, _ page: URL) -> Bool {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.fragment = nil
        return components?.url == page
    }

    static let assetHandler = "designAssets"

    /// What a design page's script finds as `window.ruimteHost`: the page is the document of the web view, with no
    /// window above it to ask for a file of its folder, so it asks the app, which answers the bytes or null. It is
    /// the desktop's runtime script that asks (`runtimeAssetsScript`).
    static let assetHost = """
        (function () {
        var handler = window.webkit.messageHandlers.\(assetHandler);
        function blobOf(reply) {
            if (!reply || typeof reply.data !== 'string') { return null; }
            var binary = atob(reply.data);
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
            return new Blob([bytes], { type: String(reply.mime) });
        }
        Object.defineProperty(window, 'ruimteHost', { value: Object.freeze({
            asset: function (path) {
                return handler.postMessage(String(path)).then(blobOf, function () { return null; });
            }
        }) });
        })();
        """

    /// Runs in a world of the app's own before the page, so the page can neither see nor spoof it. As the top document
    /// the page's bootstrap reports no size and opens links in a new window, which its policy forbids, so this measures
    /// the root as the bootstrap does in a frame and hands over the links a person follows.
    static let bridge = """
        (function () {
        var handler = window.webkit.messageHandlers.visual;
        var root = document.documentElement;
        var reported = '';
        var scheduled = false;
        function measure() {
            scheduled = false;
            var box = root.getBoundingClientRect();
            var width = Math.ceil(box.width);
            var height = Math.ceil(box.height);
            if (width + 'x' + height === reported) { return; }
            reported = width + 'x' + height;
            handler.postMessage({ kind: 'size', width: width, height: height });
        }
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(function () {
                if (!scheduled) { scheduled = true; requestAnimationFrame(measure); }
            }).observe(root);
        }
        function hrefOf(node) {
            if (!node || typeof node.tagName !== 'string' || node.tagName.toLowerCase() !== 'a') { return null; }
            var href = node.getAttribute('href');
            return href === null ? node.getAttribute('xlink:href') : href;
        }
        window.addEventListener('click', function (event) {
            if (!event.isTrusted) { return; }
            var path = event.composedPath();
            for (var i = 0; i < path.length; i++) {
                var href = hrefOf(path[i]);
                if (href === null) { continue; }
                var url;
                try { url = new URL(href, document.baseURI); } catch (e) { return; }
                if (url.protocol !== 'http:' && url.protocol !== 'https:') { return; }
                event.preventDefault();
                handler.postMessage({ kind: 'link', url: url.href });
                return;
            }
        }, true);
        })();
        """
}

/// A visual's page in a web view on the ground of what stands behind it. It reports the height the page takes, keeps
/// the page in the app's theme without loading it again, and opens a link a person follows in Safari.
struct ChatVisualFrame: UIViewRepresentable {
    let visual: ChatVisual
    let page: Data
    let theme: ChatVisualTheme
    /// Large, where the page always scrolls inside rather than taking its height.
    var fill = false
    /// The height the page takes in points, at the width in points it was drawn at.
    var onHeight: (Double, Double) -> Void = { _, _ in }
    var onShown: () -> Void = {}
    var onFailure: () -> Void = {}
    /// The files a design page's script names while it runs. Only a design has them.
    var assets: DesignFiles.RuntimeAssets?
    /// Where a design page that is a board stands. Only a design has one.
    var board: DesignBoardCamera?
    /// The board's `fits` as this was drawn, so a new count fits the board again.
    var fits = 0

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> ChatVisualWebView {
        context.coordinator.parent = self
        return Self.webView(self, coordinator: context.coordinator)
    }

    /// The app's own world in the page, where the page can neither see nor reach what runs.
    static var world: WKContentWorld { .world(name: "ruimte-visual") }

    /// The web view of a frame, loading its page with the theme in the address.
    static func webView(_ frame: ChatVisualFrame, coordinator: Coordinator) -> ChatVisualWebView {
        let world = Self.world
        let scheme = ChatVisualPageScheme(visualID: frame.visual.id, page: frame.page)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(scheme, forURLScheme: ChatVisualPageScheme.scheme)
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.dataDetectorTypes = []
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: ChatVisualNavigation.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true,
                in: world))
        configuration.userContentController.add(ChatVisualMessages(coordinator), contentWorld: world, name: "visual")
        if let assets = frame.assets {
            // The page's own world, since it is the page's script that asks. The handler answers the page itself only.
            configuration.userContentController.addUserScript(
                WKUserScript(
                    source: ChatVisualNavigation.assetHost, injectionTime: .atDocumentStart, forMainFrameOnly: true,
                    in: .page))
            configuration.userContentController.addScriptMessageHandler(
                ChatVisualAssetReplies(assets), contentWorld: .page, name: ChatVisualNavigation.assetHandler)
        }
        let isBoard = frame.board?.isBoard == true
        if isBoard {
            configuration.userContentController.addUserScript(
                WKUserScript(
                    source: DesignBoard.script, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: world))
        }
        let view = ChatVisualWebView(frame: .zero, configuration: configuration)
        view.fill = frame.fill
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.contentInsetAdjustmentBehavior = frame.fill ? .automatic : .never
        view.scrollView.bounces = frame.fill
        view.allowsLinkPreview = false
        view.navigationDelegate = coordinator
        view.uiDelegate = coordinator
        view.accessibilityLabel = frame.visual.title
        coordinator.page = scheme.pageURL
        coordinator.shownTheme = frame.theme
        coordinator.fits = frame.fits
        if isBoard { coordinator.follow(view.scrollView) }
        view.load(URLRequest(url: address(scheme.pageURL, theme: frame.theme)))
        return view
    }

    /// The page's address with a theme it applies before its first paint.
    static func address(_ page: URL, theme: ChatVisualTheme) -> URL {
        URL(string: page.absoluteString + theme.fragment) ?? page
    }

    func updateUIView(_ view: ChatVisualWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.show(theme, in: view)
        if fits != context.coordinator.fits {
            context.coordinator.fits = fits
            context.coordinator.fitBoard(in: view)
        }
    }

    static func dismantleUIView(_ view: ChatVisualWebView, coordinator: Coordinator) {
        view.stopLoading()
        view.navigationDelegate = nil
        view.uiDelegate = nil
        view.configuration.userContentController.removeAllScriptMessageHandlers()
    }

    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: ChatVisualFrame?
        var page: URL?
        var shownTheme: ChatVisualTheme?
        var fits = 0
        private var loaded = false
        private var shown = false
        /// The board's size and the frame's, in the page's pixels, as the page last reported them.
        private var measured: (board: CGSize, frame: CGSize)?
        /// Whether the view's zoom and scroll are the person's here, which the board's camera then keeps.
        private var tracking = false
        private var pinchFollowed = false
        private var observations: [NSKeyValueObservation] = []

        func show(_ theme: ChatVisualTheme, in view: WKWebView) {
            guard loaded, theme != shownTheme else { return }
            shownTheme = theme
            // In the page's own world, where its bootstrap takes a message only from its own window.
            view.evaluateJavaScript("window.postMessage(\(theme.hostContextMessage), '*');", in: nil, in: .page)
        }

        func received(_ body: Any, in view: WKWebView?) {
            guard let message = body as? [String: Any] else { return }
            switch message["kind"] as? String {
            case "size":
                guard let parent, let width = message["width"] as? Double, let height = message["height"] as? Double,
                    width > 0, let view
                else { return }
                markShown()
                // A page that sets a viewport of its own is drawn scaled to the view's width.
                let drawn = Double(view.bounds.width)
                if !parent.fill { parent.onHeight(height * drawn / width, drawn) }
            case "link":
                if let url = ChatVisualNavigation.web((message["url"] as? String).flatMap(URL.init(string:))) {
                    UIApplication.shared.open(url)
                }
            case "board":
                if let view { measuredBoard(message, in: view) }
            default: break
            }
        }

        /// Takes a person's pan and pinch of a board as theirs from the first one on.
        func follow(_ scrollView: UIScrollView) {
            scrollView.panGestureRecognizer.addTarget(self, action: #selector(moved(_:)))
            followPinch(scrollView)
            let keep: (UIScrollView) -> Void = { [weak self] scrollView in
                MainActor.assumeIsolated { self?.keep(scrollView) }
            }
            observations = [
                scrollView.observe(\.contentOffset) { scrollView, _ in keep(scrollView) },
                scrollView.observe(\.zoomScale) { scrollView, _ in keep(scrollView) },
            ]
        }

        // The web view makes its pinch only once the page says it may zoom.
        private func followPinch(_ scrollView: UIScrollView) {
            guard !pinchFollowed, let pinch = scrollView.pinchGestureRecognizer else { return }
            pinchFollowed = true
            pinch.addTarget(self, action: #selector(moved(_:)))
        }

        @objc private func moved(_ recognizer: UIGestureRecognizer) {
            guard recognizer.state == .began, let board = parent?.board else { return }
            board.touched = true
            tracking = true
        }

        private func keep(_ scrollView: UIScrollView) {
            guard tracking, let board = parent?.board else { return }
            board.view = (scrollView.zoomScale, scrollView.contentOffset)
        }

        private func measuredBoard(_ message: [String: Any], in view: WKWebView) {
            guard let board = parent?.board, let width = message["width"] as? Double,
                let height = message["height"] as? Double, let frameWidth = message["frameWidth"] as? Double,
                let frameHeight = message["frameHeight"] as? Double, frameWidth > 0, frameHeight > 0
            else { return }
            let first = measured == nil
            let size = CGSize(width: width, height: height)
            let frame = CGSize(width: frameWidth, height: frameHeight)
            measured = (size, frame)
            markShown()
            followPinch(view.scrollView)
            guard board.touched, let kept = board.world else {
                place(DesignBoard.fit(board: size, frame: frame), in: view)
                return
            }
            let restored = first ? board.view : nil
            place(kept, in: view) { [weak self, weak view] in
                guard let view else { return }
                if let restored {
                    view.scrollView.setZoomScale(restored.zoom, animated: false)
                    view.scrollView.setContentOffset(restored.offset, animated: false)
                }
                self?.tracking = true
            }
        }

        /// The whole board again, at the view's own zoom of one and scrolled to its start.
        func fitBoard(in view: WKWebView) {
            guard let board = parent?.board, let measured else { return }
            board.touched = false
            board.view = nil
            tracking = false
            let scrollView = view.scrollView
            scrollView.setZoomScale(scrollView.minimumZoomScale, animated: false)
            scrollView.setContentOffset(
                CGPoint(x: -scrollView.adjustedContentInset.left, y: -scrollView.adjustedContentInset.top),
                animated: false)
            place(DesignBoard.fit(board: measured.board, frame: measured.frame), in: view)
        }

        private func place(_ camera: DesignBoard.Camera, in view: WKWebView, then: (() -> Void)? = nil) {
            guard let measured else { return }
            parent?.board?.world = camera
            let extent = DesignBoard.extent(board: measured.board, camera: camera)
            let call =
                "window.__ruimteBoard.place(\(camera.x), \(camera.y), \(camera.zoom), \(extent.width), \(extent.height)); true;"
            Task {
                _ = try? await view.evaluateJavaScript(call, contentWorld: ChatVisualFrame.world)
                then?()
            }
        }

        private func markShown() {
            guard !shown else { return }
            shown = true
            parent?.onShown()
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy
        {
            guard let page else { return .cancel }
            let verdict = ChatVisualNavigation.verdict(
                action.request.url, mainFrame: action.targetFrame?.isMainFrame ?? true, page: page)
            return verdict == .allow ? .allow : .cancel
        }

        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async
            -> WKNavigationResponsePolicy
        {
            response.canShowMIMEType ? .allow : .cancel
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loaded = true
            markShown()
            if let theme = parent?.theme { show(theme, in: webView) }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        func webView(
            _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
        ) {
            failed(error)
        }

        /// Loads the page again with the theme in its address, which the page took off when it first ran.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            guard let page, let theme = parent?.theme else { return }
            parent?.assets?.reopen()
            loaded = false
            measured = nil
            tracking = false
            shownTheme = theme
            webView.load(URLRequest(url: ChatVisualFrame.address(page, theme: theme)))
        }

        func webView(
            _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
            for action: WKNavigationAction, windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = ChatVisualNavigation.link(action.request.url, type: action.navigationType) {
                UIApplication.shared.open(url)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo
        ) async {}

        func webView(
            _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo
        ) async -> Bool { false }

        func webView(
            _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
            initiatedByFrame frame: WKFrameInfo
        ) async -> String? { nil }

        /// Only the page itself can fail the card: every later navigation is one the policy cancelled, which leaves
        /// the page standing.
        private func failed(_ error: Error) {
            let error = error as NSError
            let cancelled =
                (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled)
                // WebKit's "frame load interrupted", which a cancelled navigation ends in.
                || (error.domain == "WebKitErrorDomain" && error.code == 102)
            guard !loaded, !cancelled else { return }
            parent?.onFailure()
        }
    }
}

/// Hands the bridge's messages to the coordinator without the web view's content controller keeping it alive.
@MainActor private final class ChatVisualMessages: NSObject, WKScriptMessageHandler {
    private weak var coordinator: ChatVisualFrame.Coordinator?

    init(_ coordinator: ChatVisualFrame.Coordinator) {
        self.coordinator = coordinator
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        coordinator?.received(message.body, in: message.webView)
    }
}

/// Answers a design page's request for a file of its folder with the bytes, or nothing. A frame the page holds has no
/// say: a page of the web in it must not read the folder.
@MainActor private final class ChatVisualAssetReplies: NSObject, WKScriptMessageHandlerWithReply {
    private let assets: DesignFiles.RuntimeAssets

    init(_ assets: DesignFiles.RuntimeAssets) {
        self.assets = assets
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (
        Any?, String?
    ) {
        guard message.frameInfo.isMainFrame, let path = message.body as? String, let file = await assets.bytes(path)
        else { return (NSNull(), nil) }
        return (["mime": file.mime, "data": file.data.base64EncodedString()], nil)
    }
}

/// Scrolls inside only while its page overflows, so a card that fits never takes the thread's scroll gesture.
final class ChatVisualWebView: WKWebView {
    var fill = false
    private var contentSize: NSKeyValueObservation?

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        contentSize = scrollView.observe(\.contentSize) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.updateScrolling() }
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func layoutSubviews() {
        super.layoutSubviews()
        updateScrolling()
    }

    private func updateScrolling() {
        scrollView.isScrollEnabled = Self.scrolls(content: scrollView.contentSize, in: bounds.size, fill: fill)
    }

    static func scrolls(content: CGSize, in bounds: CGSize, fill: Bool) -> Bool {
        fill || content.height > bounds.height + 1 || content.width > bounds.width + 1
    }
}
