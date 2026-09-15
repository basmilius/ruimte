import UIKit
import WebKit

@MainActor
final class ProjectSVGRasterizer {
    private var queue: Task<UIImage, Error>?
    private var identifier: UUID?

    func render(_ data: Data) async throws -> UIImage {
        guard !data.isEmpty, data.count <= ProjectArtworkLoader.maximumBytes else {
            throw ProjectArtworkError.invalidImage
        }
        let previous = queue
        let id = UUID()
        identifier = id
        let task = Task {
            _ = await previous?.result
            try Task.checkCancellation()
            let renderer = SVGSnapshotOperation()
            return try await renderer.render(data)
        }
        queue = task
        defer {
            if identifier == id {
                queue = nil
                identifier = nil
            }
        }
        return try await task.value
    }

    static func document(_ data: Data) -> String {
        // SVG is loaded as an image, where WebKit disables scripts and external resource references.
        """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
        <style>html,body{margin:0;width:100%;height:100%;background:transparent}img{display:block;width:100%;height:100%;object-fit:contain}</style>
        </head><body><img src="data:image/svg+xml;base64,\(data.base64EncodedString())"></body></html>
        """
    }
}

@MainActor
private final class SVGSnapshotOperation: NSObject, WKNavigationDelegate {
    private var view: WKWebView?
    private var pending: CheckedContinuation<UIImage, Error>?
    private var timeout: Task<Void, Never>?
    private var finished = false

    func render(_ data: Data) async throws -> UIImage {
        guard
            let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows).first(where: \.isKeyWindow)
        else { throw ProjectArtworkError.unavailable }
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation
                let configuration = WKWebViewConfiguration()
                configuration.websiteDataStore = .nonPersistent()
                configuration.defaultWebpagePreferences.allowsContentJavaScript = false
                let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 128, height: 128), configuration: configuration)
                self.view = view
                view.navigationDelegate = self
                view.isOpaque = false
                view.backgroundColor = .clear
                view.scrollView.backgroundColor = .clear
                view.isUserInteractionEnabled = false
                view.accessibilityElementsHidden = true
                // A real window keeps WebKit painting; the app's root view covers this temporary renderer.
                window.insertSubview(view, at: 0)
                view.loadHTMLString(ProjectSVGRasterizer.document(data), baseURL: nil)
                timeout = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(8)) } catch { return }
                    self?.finish(.failure(ProjectArtworkError.timedOut))
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish(.failure(CancellationError())) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async
        -> WKNavigationActionPolicy
    {
        navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task {
            do {
                let configuration = WKSnapshotConfiguration()
                configuration.rect = CGRect(x: 0, y: 0, width: 128, height: 128)
                configuration.snapshotWidth = 128
                configuration.afterScreenUpdates = true
                let image = try await webView.takeSnapshot(configuration: configuration)
                finish(.success(image))
            } catch { finish(.failure(error)) }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(.failure(error))
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(.failure(error))
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        finish(.failure(ProjectArtworkError.unavailable))
    }

    private func finish(_ result: Result<UIImage, Error>) {
        guard !finished else { return }
        finished = true
        timeout?.cancel()
        timeout = nil
        view?.navigationDelegate = nil
        view?.stopLoading()
        view?.removeFromSuperview()
        view = nil
        let continuation = pending
        pending = nil
        continuation?.resume(with: result)
    }
}
