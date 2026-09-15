import Observation
import SwiftUI
import WebKit

@MainActor @Observable
private final class BrowserState {
    var address: String
    var loading = false
    var back = false
    var forward = false
    var problem: String?
    var webView: WKWebView?
    init(_ address: String) { self.address = address }
    func navigate() {
        let text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text.contains("://") ? text : "https://" + text),
            ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil
        else {
            problem = "Enter an HTTP or HTTPS address."
            return
        }
        problem = nil
        webView?.load(URLRequest(url: url))
    }
}

struct BrowserPage: View {
    @State private var state: BrowserState
    init(url: String) { _state = State(initialValue: BrowserState(url)) }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TextField("Address", text: $state.address).keyboardType(.URL).textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go).onSubmit { state.navigate() }
                Button(state.loading ? "Stop" : "Reload", systemImage: state.loading ? "xmark" : "arrow.clockwise") {
                    if state.loading { state.webView?.stopLoading() } else { state.navigate() }
                }.labelStyle(.iconOnly)
            }.padding(12).background(.bar)
            if let problem = state.problem { Text(problem).font(.caption).foregroundStyle(.red).padding() }
            MobileScrollViewport(edges: .bottom) { insets in
                BrowserContent(state: state, viewportInsets: insets)
            }
        }.toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                Button("Back", systemImage: "chevron.left") { state.webView?.goBack() }.disabled(!state.back)
                Button("Forward", systemImage: "chevron.right") { state.webView?.goForward() }.disabled(!state.forward)
                Spacer()
                if let url = URL(string: state.address), ["http", "https"].contains(url.scheme ?? "") {
                    ShareLink(item: url)
                }
            }
        }
    }
}

private struct BrowserContent: UIViewRepresentable {
    let state: BrowserState
    let viewportInsets: UIEdgeInsets
    func makeCoordinator() -> Coordinator { Coordinator(state) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Browser pages have no bridge into the machine or the app's credentials.
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.scrollView.contentInsetAdjustmentBehavior = .never
        state.webView = view
        state.navigate()
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        view.scrollView.contentInset = viewportInsets
        view.scrollView.scrollIndicatorInsets = viewportInsets
    }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.stopLoading()
        view.navigationDelegate = nil
        view.uiDelegate = nil
        coordinator.state.webView = nil
    }
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let state: BrowserState
        init(_ state: BrowserState) { self.state = state }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy
        {
            guard let url = action.request.url, ["http", "https", "about"].contains(url.scheme?.lowercased() ?? "")
            else { return .cancel }
            return .allow
        }
        func webView(
            _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
            for action: WKNavigationAction, windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if action.targetFrame == nil, let url = action.request.url, ["http", "https"].contains(url.scheme ?? "") {
                webView.load(action.request)
            }
            return nil
        }
        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            state.loading = true
            state.problem = nil
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { update(webView) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            state.problem = error.localizedDescription
            update(webView)
        }
        func webView(
            _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
        ) {
            state.problem = error.localizedDescription
            update(webView)
        }
        private func update(_ webView: WKWebView) {
            state.loading = false
            state.back = webView.canGoBack
            state.forward = webView.canGoForward
            if let url = webView.url { state.address = url.absoluteString }
        }
    }
}
