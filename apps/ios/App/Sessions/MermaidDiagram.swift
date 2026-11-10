import RuimtePulsar
import RuimteShared
import SwiftUI
import UIKit
import WebKit

/// A diagram as Pele laid it out, at the size it was laid out at.
struct MermaidDrawing: Equatable {
    let svg: String
    let width: Double
    let height: Double
}

/// What a diagram is laid out in: the font of the reply and Dynamic Type's size for it.
struct MermaidFont: Hashable {
    static let family = "-apple-system, system-ui, sans-serif"
    static let mono = "ui-monospace, Menlo, monospace"

    let size: Double
}

/// The colors of a diagram, as the desktop's chat fills Pele's variables from its theme (`mermaid.ts`).
enum MermaidTheme {
    /// Pele's variables with the app's tokens in them. Each value is an opaque `#rrggbb`, a border over the ground,
    /// since the drawing is an image that does not see what stands under it.
    static func colors(dark: Bool) -> [(name: String, value: String)] {
        let pick = { (token: RuimteColorToken) in dark ? token.dark : token.light }
        let ground = pick(RuimteColors.panel)
        // `--border-strong`: black at 20% on a light ground, white at 13% on a dark one.
        let border = dark ? over(ground, color: 0xffffff, alpha: 0.13) : over(ground, color: 0x000000, alpha: 0.2)
        let values: [(String, UInt32)] = [
            ("--pele-bg", ground),
            ("--pele-fg", pick(RuimteColors.text)),
            ("--pele-muted", pick(RuimteColors.muted)),
            ("--pele-line", pick(RuimteColors.muted)),
            ("--pele-surface", pick(RuimteColors.panel)),
            ("--pele-surface-alt", pick(RuimteColors.surface)),
            ("--pele-border", border),
            ("--pele-accent", pick(RuimteColors.accent)),
            ("--pele-critical", pick(RuimteColors.statusError)),
            ("--pele-series-1", pick(RuimteColors.accent)),
            ("--pele-series-2", pick(RuimteColors.chart2)),
            ("--pele-series-3", pick(RuimteColors.chart3)),
            ("--pele-series-4", pick(RuimteColors.chart4)),
            ("--pele-series-5", pick(RuimteColors.chart5)),
            ("--pele-series-6", pick(RuimteColors.chart6)),
        ]
        return values.map { ($0.0, String(format: "#%06x", $0.1)) }
    }

    static func over(_ ground: UInt32, color: UInt32, alpha: Double) -> UInt32 {
        [16, 8, 0].reduce(UInt32(0)) { mixed, shift in
            let below = Double((ground >> shift) & 0xff)
            let above = Double((color >> shift) & 0xff)
            return mixed | (UInt32((below + (above - below) * alpha).rounded()) << shift)
        }
    }

    /// The drawing with the colors set on its root, as `themedSvg` writes them.
    static func themed(_ svg: String, colors: [(name: String, value: String)]) -> String {
        guard let root = svg.range(of: #"<svg\b[^>]*>"#, options: .regularExpression) else { return svg }
        let variables = attributeText(colors.map { "\($0.name):\($0.value);" }.joined())
        let tag = String(svg[root])
        let themedTag =
            if let style = tag.range(of: #"\sstyle=""#, options: .regularExpression) {
                tag.replacingCharacters(in: style, with: tag[style] + variables)
            } else {
                "<svg style=\"\(variables)\"" + tag.dropFirst(4)
            }
        return svg.replacingCharacters(in: root, with: themedTag)
    }

    private static func attributeText(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
    }

    /// `encodeURIComponent` of the drawing, as `svgDataUrl` writes it.
    static func dataURL(_ svg: String) -> String {
        "data:image/svg+xml;charset=utf-8," + (svg.addingPercentEncoding(withAllowedCharacters: .uriComponent) ?? "")
    }

    /// The page a drawing is shown on: the drawing as an image, which never runs script and loads nothing.
    static func page(_ drawing: MermaidDrawing, dark: Bool) -> String {
        let source = dataURL(themed(drawing.svg, colors: colors(dark: dark)))
        return """
            <!doctype html><html><head><meta charset="utf-8">\
            <meta http-equiv="Content-Security-Policy" content="\(policy)">\
            <meta name="viewport" content="width=device-width, initial-scale=1"></head>\
            <body style="margin:0;background:transparent">\
            <img src="\(source)" width="\(Int(drawing.width))" height="\(Int(drawing.height))" alt="" \
            style="display:block;max-width:none"></body></html>
            """
    }

    static let policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'"
}

/// Lays diagrams out with the Pele the desktop draws them with, in one web view the app keeps for it. Pele runs in a
/// world of the app's own on an empty page that runs no script, and the text of a diagram only ever reaches it as an
/// argument. What it laid out is kept, so a row that comes back on screen draws at once.
@MainActor final class MermaidLayout: NSObject, WKNavigationDelegate {
    struct Key: Hashable {
        let source: String
        let font: MermaidFont
    }

    enum Failure: Error, Equatable {
        /// Pele could not read or draw the text, which another try would not change.
        case unreadable
        case unavailable
    }

    static let shared = MermaidLayout()
    private static let world = WKContentWorld.world(name: "ruimte-mermaid")
    private static let limit = 48

    private var view: WKWebView?
    private var loaded = false
    private var waiting: [CheckedContinuation<WKWebView, Error>] = []
    private var drawings: [Key: Result<MermaidDrawing, Failure>] = [:]
    private var order: [Key] = []

    func cached(_ key: Key) -> Result<MermaidDrawing, Failure>? { drawings[key] }

    func drawing(_ key: Key) async -> Result<MermaidDrawing, Failure> {
        if let cached = drawings[key] { return cached }
        let result: Result<MermaidDrawing, Failure>
        do {
            let view = try await ready()
            let value = try await view.callAsyncJavaScript(
                "return ruimteMermaid(source, family, mono, size);",
                arguments: [
                    "source": key.source, "family": MermaidFont.family, "mono": MermaidFont.mono,
                    "size": key.font.size,
                ], in: nil, contentWorld: Self.world)
            guard let laid = value as? [String: Any], let svg = laid["svg"] as? String,
                let width = (laid["width"] as? NSNumber)?.doubleValue,
                let height = (laid["height"] as? NSNumber)?.doubleValue, width > 0, height > 0
            else {
                return keep(.failure(.unreadable), for: key)
            }
            result = .success(MermaidDrawing(svg: svg, width: width, height: height))
        } catch let error as WKError where error.code == .javaScriptExceptionOccurred {
            result = .failure(.unreadable)
        } catch {
            return .failure(.unavailable)
        }
        return keep(result, for: key)
    }

    private func keep(_ result: Result<MermaidDrawing, Failure>, for key: Key) -> Result<MermaidDrawing, Failure> {
        if drawings.updateValue(result, forKey: key) == nil { order.append(key) }
        while order.count > Self.limit { drawings.removeValue(forKey: order.removeFirst()) }
        return result
    }

    private func ready() async throws -> WKWebView {
        if let view, loaded { return view }
        if view == nil { view = try makeView() }
        return try await withCheckedThrowingContinuation { waiting.append($0) }
    }

    private func makeView() throws -> WKWebView {
        guard let url = Bundle.main.url(forResource: "pele", withExtension: "js"),
            let pele = try? String(contentsOf: url, encoding: .utf8)
        else { throw Failure.unavailable }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: pele + "\n" + Self.entry, injectionTime: .atDocumentStart, forMainFrameOnly: true,
                in: Self.world))
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
        view.navigationDelegate = self
        loaded = false
        view.loadHTMLString(
            #"<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body></body></html>"#,
            baseURL: nil)
        return view
    }

    /// At the size it was laid out at, linking to nothing and loading nothing, with no math or icon resolver, as the
    /// desktop's `renderOptions` has it.
    private static let entry = """
        function ruimteMermaid(source, family, mono, size) {
            var drawn = pele.render(source, {
                responsive: false, idPrefix: 'mermaid', fontFamily: family, fontFamilyMono: mono, fontSize: size,
                links: false, images: false
            });
            return { svg: drawn.svg, width: Math.ceil(drawn.width), height: Math.ceil(drawn.height) };
        }
        """

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        let resumed = waiting
        waiting = []
        resumed.forEach { $0.resume(returning: webView) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        reset(error)
    }

    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
    ) {
        reset(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        reset(Failure.unavailable)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        action.request.url?.scheme == "about" ? .allow : .cancel
    }

    private func reset(_ error: Error) {
        view = nil
        loaded = false
        let failed = waiting
        waiting = []
        failed.forEach { $0.resume(throwing: error) }
    }
}

/// A drawing on a page that runs no script, at the size it was laid out at. It takes no touch, so the reply around
/// it scrolls as it would anyway.
struct MermaidImage: UIViewRepresentable {
    let drawing: MermaidDrawing
    let dark: Bool

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.dataDetectorTypes = []
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isUserInteractionEnabled = false
        view.navigationDelegate = context.coordinator
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let page = MermaidTheme.page(drawing, dark: dark)
        guard page != context.coordinator.shown else { return }
        context.coordinator.shown = page
        view.loadHTMLString(page, baseURL: nil)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.stopLoading()
        view.navigationDelegate = nil
    }

    @MainActor final class Coordinator: NSObject, WKNavigationDelegate {
        var shown: String?

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async
            -> WKNavigationActionPolicy
        {
            action.request.url?.scheme == "about" ? .allow : .cancel
        }
    }
}

/// A ```mermaid fence, drawn as its diagram once the fence closed, beside Copy a switch between the diagram and its
/// source. While the fence grows, while it is laid out the first time, and when Pele cannot draw it, it is the code
/// block it would otherwise be, the last with a note under it.
struct MermaidMessage: View {
    let text: String
    var closed = true
    @ScaledMetric(relativeTo: .subheadline) private var fontSize: CGFloat = 15
    @Environment(\.colorScheme) private var colorScheme
    @State private var laidOut: (key: MermaidLayout.Key, result: Result<MermaidDrawing, MermaidLayout.Failure>)?
    @State private var showsSource = false

    private var key: MermaidLayout.Key {
        MermaidLayout.Key(source: text, font: MermaidFont(size: Double(fontSize.rounded())))
    }

    var body: some View {
        let key = key
        let result = closed ? (laidOut?.key == key ? laidOut?.result : MermaidLayout.shared.cached(key)) : nil
        Group {
            switch result {
            case .success(let drawing):
                CodeMessage(
                    text: text, language: "mermaid", closed: closed,
                    replacement: showsSource ? nil : AnyView(diagram(drawing)),
                    action: AnyView(toggle))
            case .failure(.unreadable):
                VStack(alignment: .leading, spacing: 4) {
                    CodeMessage(text: text, language: "mermaid", closed: closed)
                    Text("Could not show diagram. Showing its source.")
                        .font(.caption).foregroundStyle(MobileStyle.faint)
                }
            case .failure(.unavailable), nil:
                CodeMessage(text: text, language: "mermaid", closed: closed)
            }
        }
        .task(id: closed ? key : nil) {
            guard closed, MermaidLayout.shared.cached(key) == nil else { return }
            let result = await MermaidLayout.shared.drawing(key)
            guard !Task.isCancelled else { return }
            laidOut = (key, result)
        }
    }

    private func diagram(_ drawing: MermaidDrawing) -> some View {
        ScrollView(.horizontal) {
            MermaidImage(drawing: drawing, dark: colorScheme == .dark)
                .frame(width: drawing.width, height: drawing.height)
                .padding(12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: drawing.height + 24)
        .accessibilityElement()
        .accessibilityLabel("Diagram")
        .accessibilityAddTraits(.isImage)
    }

    private var toggle: some View {
        Button {
            showsSource.toggle()
        } label: {
            Image(lucide: showsSource ? "workflow" : "code").frame(width: 44, height: 44)
        }
        .accessibilityLabel(showsSource ? "Show diagram" : "Show source")
    }
}
