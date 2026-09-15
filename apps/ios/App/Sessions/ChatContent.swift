import Foundation
import ImageIO
import QuickLook
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UniformTypeIdentifiers

struct ChatContentContext {
    let client: any MachineRequesting
    let chatID: String
    let cwd: String
}

extension EnvironmentValues {
    @Entry var chatContent: ChatContentContext?
    @Entry var chatMentions: [String] = []
    @Entry var chatSkills: [String] = []
    @Entry var markdownReferences = ""
}

struct ChatFileReference: Identifiable, Equatable {
    var id: String { "\(path):\(line ?? 0)" }
    let path: String
    let line: Int?

    static func parse(_ text: String, cwd: String, explicit: Bool = false) -> Self? {
        var path = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let internalLink = path.hasPrefix("ruimte-file:")
        let encodedLink = explicit || path.hasPrefix("file://")
        if internalLink {
            guard let components = URLComponents(string: path),
                let value = components.queryItems?.first(where: { $0.name == "path" })?.value
            else { return nil }
            path = value
        }
        if path.hasPrefix("file://") { path = String(path.dropFirst(7)) }
        guard !path.isEmpty, !path.hasPrefix("~"), !path.hasPrefix("//"), !path.hasPrefix("#"),
            path.range(of: #"^[a-zA-Z][a-zA-Z0-9+.-]*://"#, options: .regularExpression) == nil
        else { return nil }
        if encodedLink && !internalLink { path = path.removingPercentEncoding ?? path }
        var line: Int?
        if let range = path.range(of: #"(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$"#, options: .regularExpression) {
            let suffix = String(path[range])
            line = Int(suffix.drop(while: { !$0.isNumber }).prefix(while: \.isNumber))
            path = String(path[..<range.lowerBound])
        }
        guard !path.isEmpty, path != ".", path != "..", !path.contains("\n") else { return nil }
        let name = (path as NSString).lastPathComponent
        let ext = (name as NSString).pathExtension.lowercased()
        let extensions = [
            "swift", "ts", "tsx", "js", "jsx", "json", "md", "txt", "py", "rs", "go", "css", "html", "vue", "yml",
            "yaml", "toml", "sh", "sql", "xml", "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "c", "h", "cpp",
            "kt", "java",
        ]
        guard
            explicit || path.hasPrefix("/") || extensions.contains(ext) || name.hasPrefix(".")
                || ["Dockerfile", "Makefile", "LICENSE", "README"].contains(name)
        else { return nil }
        guard path.hasPrefix("/") || !cwd.isEmpty else { return nil }
        let absolute = path.hasPrefix("/") ? path : (cwd as NSString).appendingPathComponent(path)
        return Self(path: (absolute as NSString).standardizingPath, line: line.flatMap { $0 > 0 ? $0 : nil })
    }

    static func url(_ text: String) -> URL? {
        var components = URLComponents()
        components.scheme = "ruimte-file"
        components.host = "open"
        components.queryItems = [URLQueryItem(name: "path", value: text)]
        return components.url
    }
}

struct ChatLinkRouting: ViewModifier {
    let context: ChatContentContext
    @State private var target: ChatFileReference?
    func body(content: Content) -> some View {
        content
            .environment(\.chatContent, context)
            .environment(
                \.openURL,
                OpenURLAction { url in
                    if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") { return .systemAction }
                    if let scheme = url.scheme, !["file", "ruimte-file"].contains(scheme) { return .discarded }
                    if let reference = ChatFileReference.parse(url.absoluteString, cwd: context.cwd, explicit: true) {
                        target = reference
                        return .handled
                    }
                    return .discarded
                }
            )
            .mobileSheet(isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } })) {
                if let target {
                    NavigationStack {
                        FileContentPage(client: context.client, path: target.path, initialLine: target.line)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) { Button("Done") { self.target = nil } }
                            }
                    }
                }
            }
    }
}

struct ChatInlineText: View {
    let text: String
    var streaming = false
    @Environment(\.chatContent) private var context
    @Environment(\.chatMentions) private var mentions
    @Environment(\.chatSkills) private var skills
    @Environment(\.markdownReferences) private var references

    var body: some View { ChatFadingText(text: attributed, streaming: streaming) }

    private var attributed: AttributedString {
        var value = MarkdownInline.parse(text, references: references)
        let runs = value.runs.map {
            (range: $0.range, code: $0.inlinePresentationIntent?.contains(.code) == true, link: $0.link)
        }
        for run in runs where run.code {
            value[run.range].swiftUI.font = .system(.body, design: .monospaced)
            value[run.range].swiftUI.backgroundColor = MobileStyle.inset
            let token = String(value[run.range].characters)
            if let context, ChatFileReference.parse(token, cwd: context.cwd) != nil {
                value[run.range].link = ChatFileReference.url(token)
            }
        }
        for token in mentions.map({ "@" + $0 }) + skills.map({ "$" + $0 }) {
            var start = value.startIndex
            while start < value.endIndex, let range = value[start...].range(of: token) {
                value[range].swiftUI.font = .system(.body, design: .monospaced)
                value[range].swiftUI.backgroundColor = MobileStyle.inset
                value[range].swiftUI.foregroundColor = MobileStyle.accent
                start = range.upperBound
            }
        }
        return value
    }
}

struct ChatInlineImage: View {
    let resource: JSONValue
    let name: String
    @Environment(\.chatContent) private var context
    @Environment(\.colorScheme) private var colorScheme
    @State private var image: UIImage?
    @State private var failure = false
    @State private var preview: URL?
    @State private var downloaded: URL?
    @State private var previewLoading = false
    @State private var previewError: String?

    var body: some View {
        Group {
            if let image {
                Button {
                    Task { await openPreview() }
                } label: {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: 320, maxHeight: 200)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10).strokeBorder(
                                (colorScheme == .dark ? Color.white : Color.black).opacity(0.1))
                        }
                }.buttonStyle(.plain).disabled(previewLoading).accessibilityLabel("Preview \(name)")
            } else if failure {
                Label("Image preview unavailable", lucideIcon: "image", iconSize: 14).font(.caption).foregroundStyle(
                    MobileStyle.muted)
            } else {
                ProgressView().frame(width: 120, height: 80).accessibilityLabel("Loading image")
            }
        }
        .task(id: resource) {
            guard let context else {
                failure = true
                return
            }
            do {
                let bytes = try await context.client.readResource(resource)
                try Task.checkCancellation()
                let thumbnail = await Task.detached(priority: .utility) {
                    guard let source = CGImageSourceCreateWithData(bytes.data as CFData, nil) else {
                        return nil as CGImage?
                    }
                    return CGImageSourceCreateThumbnailAtIndex(
                        source, 0,
                        [
                            kCGImageSourceCreateThumbnailFromImageAlways: true,
                            kCGImageSourceThumbnailMaxPixelSize: 640, kCGImageSourceCreateThumbnailWithTransform: true,
                        ] as CFDictionary)
                }.value
                try Task.checkCancellation()
                image = thumbnail.map { UIImage(cgImage: $0) }
                failure = image == nil
            } catch is CancellationError {} catch { failure = true }
        }
        .quickLookPreview($preview)
        .alert(
            "Image preview unavailable",
            isPresented: Binding(get: { previewError != nil }, set: { if !$0 { previewError = nil } })
        ) {
            Button("OK") { previewError = nil }
        } message: {
            Text(previewError ?? "")
        }
        .onChange(of: preview) { _, url in
            if url == nil, let downloaded {
                try? FileManager.default.removeItem(at: downloaded)
                self.downloaded = nil
            }
        }
    }

    private func openPreview() async {
        guard let context, !previewLoading else { return }
        previewLoading = true
        defer { previewLoading = false }
        do {
            let bytes = try await context.client.readResource(resource)
            try Task.checkCancellation()
            let ext = UTType(mimeType: bytes.mime)?.preferredFilenameExtension ?? "png"
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("ruimte-image-\(UUID().uuidString)")
                .appendingPathExtension(ext)
            try bytes.data.write(to: url, options: [.atomic, .completeFileProtection])
            downloaded = url
            preview = url
        } catch is CancellationError {} catch { previewError = error.localizedDescription }
    }
}
