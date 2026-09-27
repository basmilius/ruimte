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
    // The player's asset holds its loader weakly, so the page keeps it.
    @State private var media: MachineMediaLoader?
    @State private var player: AVPlayer?
    // The version of the file the player plays, as mtime and size.
    @State private var playerKey: String?
    @State private var mediaProblem: String?
    @State private var fullScreen = false
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
                } else if let value = state.value, isMedia(value) {
                    VStack(spacing: 0) {
                        RemotePageStatus(state: state) { Task { await load() } }
                        mediaContents
                    }
                    .task(id: mediaKey(value)) { await startPlayer(for: mediaKey(value)) }
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
            // Only a pause: the page may come back (from full screen too) without reading the file again.
            // Only a pause, and not on the way into full screen: the page comes back without reading the file again.
            .onDisappear { if !fullScreen { player?.pause() } }
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

    private func isMedia(_ value: JSONValue) -> Bool {
        let mime = value.text("mime")
        return value.text("kind") == "binary" && (mime.hasPrefix("video/") || mime.hasPrefix("audio/"))
    }

    @ViewBuilder private var mediaContents: some View {
        if let player {
            FilePlayerView(player: player, fullScreen: $fullScreen)
        } else if let mediaProblem {
            ContentUnavailableView("Cannot play this file", lucideIcon: "file-play", description: Text(mediaProblem))
        } else {
            MobileLoadingRow("Loading").frame(maxHeight: .infinity)
        }
    }

    private func mediaKey(_ value: JSONValue) -> String {
        "\(value["mtime"]?.numberValue ?? 0)-\(value["size"]?.numberValue ?? 0)"
    }

    /// In the ranges the player asks for, so it starts at once and a video of any size plays. The asset is loaded
    /// before AVKit sees it: given one still loading, AVKit left its play button without effect.
    private func startPlayer(for key: String) async {
        guard key != playerKey else { return }
        cleanMedia()
        playerKey = key
        let loader = MachineMediaLoader(client: client, path: path)
        media = loader
        let asset = loader.asset()
        do {
            let playable = try await asset.load(.isPlayable, .duration).0
            guard playerKey == key else { return }
            if playable {
                // Sound through the silent switch, as a video does anywhere else on the phone.
                try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
                player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            } else {
                mediaProblem = "This device cannot play this file."
            }
        } catch {
            guard playerKey == key else { return }
            if Task.isCancelled {
                // The page went before the video loaded; it starts over when the page is back.
                cleanMedia()
            } else {
                mediaProblem = (loader.failure ?? error).localizedDescription
            }
        }
    }

    private func cleanMedia() {
        player?.pause()
        player = nil
        media?.cancel()
        media = nil
        playerKey = nil
        mediaProblem = nil
        image = nil
        svg = nil
    }
    private func load() async {
        await state.load {
            let result = try await client.request("fs.read", payload: .object(["path": .string(path)]))
            // A player starts with its page and keeps playing through a change elsewhere in the folder.
            if isMedia(result) { return result }
            cleanMedia()
            let mime = result.text("mime")
            if result.text("kind") == "binary", mime.hasPrefix("image/") {
                let resource = try await client.readResource(.object(["kind": .string("file"), "path": .string(path)]))
                try Task.checkCancellation()
                if mime == "image/svg+xml" { svg = resource.data } else { image = UIImage(data: resource.data) }
            }
            return result
        }
    }
}

/// AVKit's own player, with full screen, AirPlay and the playback speed that SwiftUI's `VideoPlayer` leaves out.
private struct FilePlayerView: UIViewControllerRepresentable {
    let player: AVPlayer
    @Binding var fullScreen: Bool

    func makeCoordinator() -> Coordinator { Coordinator(fullScreen: $fullScreen) }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.delegate = context.coordinator
        // Picture in picture needs the audio background mode, which the app does not have.
        controller.allowsPictureInPicturePlayback = false
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
        context.coordinator.fullScreen = $fullScreen
    }

    @MainActor final class Coordinator: NSObject, @preconcurrency AVPlayerViewControllerDelegate {
        var fullScreen: Binding<Bool>
        init(fullScreen: Binding<Bool>) { self.fullScreen = fullScreen }

        func playerViewController(
            _ controller: AVPlayerViewController,
            willBeginFullScreenPresentationWithAnimationCoordinator coordinator: any UIViewControllerTransitionCoordinator
        ) {
            fullScreen.wrappedValue = true
        }

        func playerViewController(
            _ controller: AVPlayerViewController,
            willEndFullScreenPresentationWithAnimationCoordinator coordinator: any UIViewControllerTransitionCoordinator
        ) {
            coordinator.animate(alongsideTransition: nil) { context in
                if !context.isCancelled { self.fullScreen.wrappedValue = false }
            }
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
