import Observation
import SwiftUI
import UIKit
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
    /// An edit left without going anywhere gives the bar back the page's own address.
    func restoreAddress() {
        if let url = webView?.url { address = url.absoluteString }
    }
}


struct BrowserPage: View {
    @State private var state: BrowserState
    @State private var editing = false
    @FocusState private var addressFocused: Bool
    init(url: String) { _state = State(initialValue: BrowserState(url)) }
    private var url: URL? {
        URL(string: state.address).flatMap { ["http", "https"].contains($0.scheme?.lowercased() ?? "") ? $0 : nil }
    }
    var body: some View {
        MobileScrollViewport { insets in
            BrowserContent(state: state, viewportInsets: insets)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                if let problem = state.problem {
                    Text(problem).font(.footnote).multilineTextAlignment(.center)
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .glassEffect(.regular, in: .capsule)
                }
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        if !editing {
                            Button {
                                state.webView?.goBack()
                            } label: {
                                Image(lucide: "chevron-left", size: 18).frame(width: 48, height: 48)
                            }
                            .disabled(!state.back)
                            .glassEffect(.regular.interactive(), in: .circle)
                            .accessibilityLabel("Back")
                        }
                        address
                        if !editing {
                            moreMenu
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
    }

    /// The address as Safari shows it: the host while browsing, the whole address to edit after a tap.
    private var address: some View {
        HStack(spacing: 8) {
            Image(lucide: url?.scheme == "https" ? "lock" : "globe", size: 14).foregroundStyle(MobileStyle.muted)
            if editing {
                TextField("Address", text: $state.address)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($addressFocused)
                    .onSubmit {
                        state.navigate()
                        editing = false
                    }
                Button("Cancel") {
                    editing = false
                    state.restoreAddress()
                }
                .font(.subheadline)
            } else {
                Button {
                    editing = true
                    addressFocused = true
                } label: {
                    Text(url?.host() ?? state.address).lineLimit(1).truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                }
                .accessibilityLabel("Address, \(state.address)")
                Button {
                    if state.loading { state.webView?.stopLoading() } else { state.webView?.reload() }
                } label: {
                    Image(lucide: state.loading ? "x" : "rotate-cw", size: 15).frame(width: 32, height: 44)
                }
                .accessibilityLabel(state.loading ? "Stop" : "Reload")
            }
        }
        .font(.subheadline)
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .glassEffect(.regular.interactive(), in: .capsule)
        .onChange(of: addressFocused) { _, focused in
            if !focused && editing {
                editing = false
                state.restoreAddress()
            }
        }
    }

    private var moreMenu: some View {
        Menu {
            Button("Forward", lucideIcon: "chevron-right") { state.webView?.goForward() }.disabled(!state.forward)
            if let url {
                ShareLink(item: url) { Label("Share", lucideIcon: "share") }
                Button("Copy link", lucideIcon: "copy") { UIPasteboard.general.url = url }
                Button("Open in Safari", lucideIcon: "compass") { UIApplication.shared.open(url) }
            }
        } label: {
            Image(lucide: "ellipsis", size: 18).frame(width: 48, height: 48)
        }
        .glassEffect(.regular.interactive(), in: .circle)
        .accessibilityLabel("Page actions")
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
            report(error, webView)
        }
        func webView(
            _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
        ) {
            report(error, webView)
        }
        /// Tapping a second link while the first page is still loading fails the first one as cancelled. Nobody
        /// walked into an error there, so the address bar says nothing about it.
        private func report(_ error: Error, _ webView: WKWebView) {
            if (error as? URLError)?.code != .cancelled {
                state.problem = error.localizedDescription
            }
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
