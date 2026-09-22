import AVKit
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct MachineFilesPage: View {
    let client: any MachineRequesting
    let path: String
    @State private var state = RemotePageState()
    @AppStorage("ruimte.ios.showHiddenFiles") private var hidden = false
    @State private var search = ""
    @State private var selectedEntry: FileDestination?
    private struct FileDestination: Hashable {
        let path: String
        let directory: Bool
    }
    @Environment(\.inProjectSidebar) private var inProjectSidebar
    private var entries: [JSONValue] {
        state.value?.list("entries").filter {
            search.isEmpty || $0.text("name").localizedCaseInsensitiveContains(search)
        } ?? []
    }
    var body: some View {
        MobileList {
            RemotePageStatus(state: state) { Task { await load() } }
            ForEach(entries, id: \.stableID) { entry in
                Button {
                    selectedEntry = FileDestination(
                        path: entry.text("path"), directory: entry.text("kind") == "directory")
                } label: {
                    HStack(spacing: 10) {
                        Image(lucide: entry.text("kind") == "directory" ? "folder" : "file-text", size: 20)
                            .foregroundStyle(MobileStyle.muted)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(entry.text("name")).lineLimit(1).truncationMode(.tail)
                            if let size = entry["size"]?.numberValue {
                                Text(mobileByteCount(size)).font(.caption).foregroundStyle(MobileStyle.muted)
                            }
                        }
                    }
                    .modifier(MobileSidebarLabel(disclosure: true))
                }
                .modifier(MobileSidebarRow())
            }
            if state.value != nil && entries.isEmpty {
                ContentUnavailableView(search.isEmpty ? "Empty folder" : "No matching files", lucideIcon: "folder")
            }
            if state.value?["truncated"] == .bool(true) {
                Text("This folder has more entries than the machine can list at once.").font(.footnote).foregroundStyle(
                    .secondary)
            }
        }
        .navigationTitle(path == "~" ? "Files" : URL(fileURLWithPath: path).lastPathComponent)
        .navigationDestination(item: $selectedEntry) { entry in
            if entry.directory {
                MachineFilesPage(client: client, path: entry.path)
            } else {
                FileContentPage(client: client, path: entry.path)
            }
        }
        .modifier(FolderSearch(text: $search, inSidebar: inProjectSidebar))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Toggle("Show hidden and ignored files", isOn: $hidden)
                } label: {
                    Label("File options", lucideIcon: "ellipsis")
                }
            }
        }
        .task(id: "\(path):\(hidden)") {
            await RemotePageLifecycle.run(
                client: client, events: ["fs.changed"],
                matches: { event in
                    let resolved = state.value?.text("path") ?? path
                    let root = event.text("root")
                    return resolved == root || resolved.hasPrefix(root + "/")
                },
                subscription: {
                    let payload: JSONValue = .object(["path": .string(state.value?.text("path") ?? path)])
                    return client.acquireSubscription(
                        start: "fs.watch", stop: "fs.unwatch", payload: payload, stopPayload: payload)
                }, start: { if path == "~" { await load() } }, load: load)
        }
        .refreshable { await load() }
    }
    private func load() async {
        await state.load {
            let resolved = path == "~" ? try await client.request("server.hello").text("home") : path
            return try await client.request(
                "fs.list", payload: .object(["path": .string(resolved), "depth": .number(1), "hidden": .bool(hidden)]))
        }
    }
}

struct FileContentPage: View {
    let client: any MachineRequesting
    let path: String
    var initialLine: Int? = nil
    @State private var state = RemotePageState()
    @State private var image: UIImage?
    @State private var movie: URL?
    @State private var player: AVPlayer?
    @State private var showSource = false
    @State private var svg: Data?
    var body: some View {
        ScrollViewReader { reader in
            Group {
                if isHTML, !showSource, initialLine == nil, let value = state.value,
                    value.text("kind") == "text"
                {
                    VStack(spacing: 0) {
                        RemotePageStatus(state: state) { Task { await load() } }
                        MobileScrollViewport { insets in
                            HTMLFilePreview(html: value.text("text"), viewportInsets: insets)
                        }
                    }
                } else {
                    fileContents
                }
            }
            .modifier(MobilePageSurface())
            .navigationTitle(URL(fileURLWithPath: path).lastPathComponent)
            .toolbar {
                if initialLine == nil,
                    isHTML || ["md", "markdown"].contains(URL(fileURLWithPath: path).pathExtension.lowercased())
                {
                    Button(showSource ? "Preview" : "Source") { showSource.toggle() }
                }
            }
            .task(id: path) {
                let parent = URL(fileURLWithPath: path).deletingLastPathComponent().path
                await RemotePageLifecycle.run(
                    client: client, events: ["fs.changed"],
                    matches: { parent == $0.text("root") || parent.hasPrefix($0.text("root") + "/") },
                    subscription: {
                        let payload: JSONValue = .object(["path": .string(parent)])
                        return client.acquireSubscription(
                            start: "fs.watch", stop: "fs.unwatch", payload: payload, stopPayload: payload)
                    }, load: load)
            }
            .onDisappear { cleanMedia() }
            .onChange(of: state.value) { _, _ in
                if let initialLine { reader.scrollTo(initialLine, anchor: .center) }
            }
        }
    }
    private var isHTML: Bool {
        ["html", "htm"].contains(URL(fileURLWithPath: path).pathExtension.lowercased())
    }

    private var fileContents: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                RemotePageStatus(state: state) { Task { await load() } }
                if let value = state.value {
                    if value.text("kind") == "text" {
                        if ["md", "markdown"].contains(URL(fileURLWithPath: path).pathExtension.lowercased())
                            && !showSource && initialLine == nil
                        {
                            MarkdownMessage(text: value.text("text")).frame(
                                maxWidth: .infinity, alignment: .leading)
                        } else if let initialLine {
                            LazyVStack(alignment: .leading, spacing: 3) {
                                ForEach(
                                    Array(value.text("text").components(separatedBy: "\n").enumerated()),
                                    id: \.offset
                                ) { index, line in
                                    HStack(alignment: .top, spacing: 12) {
                                        Text("\(index + 1)").foregroundStyle(MobileStyle.muted).frame(
                                            width: 44, alignment: .trailing)
                                        Text(line.isEmpty ? " " : line).textSelection(.enabled).frame(
                                            maxWidth: .infinity, alignment: .leading)
                                    }.font(.system(.caption, design: .monospaced)).monospacedDigit()
                                        .background(index + 1 == initialLine ? MobileStyle.active : .clear).id(
                                            index + 1)
                                }
                            }
                        } else {
                            CodeMessage(text: value.text("text"), language: sourceLanguage)
                        }
                    } else if let image {
                        Image(uiImage: image).resizable().scaledToFit().accessibilityLabel(
                            URL(fileURLWithPath: path).lastPathComponent)
                    } else if let svg {
                        SafeSVGPreview(data: svg).frame(minHeight: 360)
                    } else if let player {
                        VideoPlayer(player: player).frame(minHeight: 300)
                    } else if value.text("kind") == "too-large" {
                        ContentUnavailableView(
                            "File too large", lucideIcon: "file-text",
                            description: Text(
                                "This text file is \(mobileByteCount(value["size"]?.numberValue)). Open it on the machine."
                            ))
                    } else if !state.loading {
                        ContentUnavailableView(
                            "Preview unavailable", lucideIcon: "file-text", description: Text(value.text("mime")))
                    }
                }
            }.padding()
        }
    }

    private var sourceLanguage: String {
        let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
        return [
            "ts": "typescript", "tsx": "typescript", "js": "javascript", "jsx": "javascript", "py": "python",
            "sh": "bash", "yml": "yaml", "md": "markdown", "vue": "xml", "html": "xml", "svg": "xml",
        ][ext] ?? ext
    }

    private func cleanMedia() {
        player?.pause()
        player = nil
        if let movie { try? FileManager.default.removeItem(at: movie) }
        movie = nil
        image = nil
        svg = nil
    }
    private func load() async {
        await state.load {
            let result = try await client.request("fs.read", payload: .object(["path": .string(path)]))
            cleanMedia()
            let mime = result.text("mime")
            if result.text("kind") == "binary", mime.hasPrefix("image/") || mime.hasPrefix("video/") {
                let resource = try await client.readResource(.object(["kind": .string("file"), "path": .string(path)]))
                try Task.checkCancellation()
                if mime.hasPrefix("image/") {
                    if mime == "image/svg+xml" { svg = resource.data } else { image = UIImage(data: resource.data) }
                } else {
                    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                        .appendingPathExtension(URL(fileURLWithPath: path).pathExtension)
                    try resource.data.write(to: url, options: [.atomic, .completeFileProtection])
                    movie = url
                    player = AVPlayer(url: url)
                }
            }
            return result
        }
    }
}

private struct HTMLFilePreview: UIViewRepresentable {
    let html: String
    let viewportInsets: UIEdgeInsets

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // File previews share neither browser cookies nor a bridge to the machine.
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.scrollView.contentInsetAdjustmentBehavior = .never
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        view.scrollView.contentInset = viewportInsets
        view.scrollView.scrollIndicatorInsets = viewportInsets
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        view.loadHTMLString(html, baseURL: nil)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.stopLoading()
    }

    final class Coordinator {
        var loadedHTML: String?
    }
}

private struct SafeSVGPreview: UIViewRepresentable {
    let data: Data
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.websiteDataStore = .nonPersistent()
        return WKWebView(frame: .zero, configuration: config)
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        // SVG is an image inside an isolated document; links and embedded scripts cannot run.
        let base64 = data.base64EncodedString()
        view.loadHTMLString(
            "<meta name='viewport' content='width=device-width,initial-scale=1'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\"><style>body{margin:0}img{width:100%;height:auto}</style><img alt='File preview' src='data:image/svg+xml;base64,\(base64)'>",
            baseURL: nil)
    }
}

private struct FolderSearch: ViewModifier {
    @Binding var text: String
    let inSidebar: Bool
    func body(content: Content) -> some View {
        if inSidebar { content } else { content.searchable(text: $text, prompt: "Filter this folder") }
    }
}
