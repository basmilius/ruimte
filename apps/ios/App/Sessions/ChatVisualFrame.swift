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

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> ChatVisualWebView {
        context.coordinator.parent = self
        return Self.webView(self, coordinator: context.coordinator)
    }

    /// The web view of a frame, loading its page with the theme in the address.
    static func webView(_ frame: ChatVisualFrame, coordinator: Coordinator) -> ChatVisualWebView {
        let scheme = ChatVisualPageScheme(visualID: frame.visual.id, page: frame.page)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(scheme, forURLScheme: ChatVisualPageScheme.scheme)
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.dataDetectorTypes = []
        configuration.allowsInlineMediaPlayback = true
        let world = WKContentWorld.world(name: "ruimte-visual")
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: ChatVisualNavigation.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true,
                in: world))
        configuration.userContentController.add(ChatVisualMessages(coordinator), contentWorld: world, name: "visual")
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
        /// The theme the page was given last, by its address or by a message.
        var shownTheme: ChatVisualTheme?
        private var loaded = false
        private var shown = false

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
            default: break
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
            loaded = false
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
