import AVKit
import PDFKit
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct MachineFilesPage: View {
    let client: any MachineRequesting
    let path: String
    /// The project these files are in, which adds mentions, views of their own and deleting; nil on a machine's files.
    var project: FilesProject?
    /// The project's repositories, for the git status each row carries.
    var marks: GitRepositories?
    @State private var state = RemotePageState()
    @AppStorage("ruimte.ios.showHiddenFiles") private var hidden = false
    @State private var search = ""
    @State private var selectedEntry: FileDestination?
    @State private var finding = false
    @State private var deleting: String?
    @State private var note: String?
    private struct FileDestination: Hashable {
        let path: String
        let directory: Bool
    }
    private var entries: [JSONValue] {
        state.value?.list("entries").filter {
            search.isEmpty || $0.text("name").localizedCaseInsensitiveContains(search)
        } ?? []
    }
    var body: some View {
        let fileMarks = GitFileMarks(marks?.checkouts ?? [])
        MobileList {
            RemotePageStatus(state: state) { Task { await load() } }
            if let note {
                Text(note).font(.caption).foregroundStyle(MobileStyle.muted)
            }
            if project != nil {
                Button {
                    finding = true
                } label: {
                    Label("Find in files", lucideIcon: "text-search").modifier(MobileSidebarLabel(disclosure: true))
                }
                .modifier(MobileSidebarRow())
            }
            ForEach(entries, id: \.stableID) { entry in
                let directory = entry.text("kind") == "directory"
                let mark = fileMarks.mark(path: entry.text("path"), directory: directory)
                Button {
                    if !directory, let openFile = project?.openFile {
                        openFile(entry.text("path"), nil)
                    } else {
                        selectedEntry = FileDestination(path: entry.text("path"), directory: directory)
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(lucide: FileKinds.icon(name: entry.text("name"), kind: entry.text("kind")), size: 20)
                            .foregroundStyle(MobileStyle.muted)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(entry.text("name")).lineLimit(1).truncationMode(.tail)
                            if let size = entry["size"]?.numberValue {
                                Text(mobileByteCount(size)).font(.caption).foregroundStyle(MobileStyle.muted)
                            }
                        }
                        if let mark {
                            Spacer(minLength: 8)
                            Text(mark).font(.caption.monospaced().weight(.semibold))
                                .foregroundStyle(mark == "!" ? MobileStyle.statusNeedsYou : gitStatusColor(mark))
                                .accessibilityLabel(GitFileMarks.spoken(mark))
                        }
                    }
                    .modifier(MobileSidebarLabel(disclosure: true))
                }
                .modifier(MobileSidebarRow(selected: !directory && entry.text("path") == project?.shownFile))
                .contextMenu { if let project { entryMenu(entry, directory: directory, project: project) } }
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
                MachineFilesPage(client: client, path: entry.path, project: project, marks: marks)
            } else {
                FileContentPage(client: client, path: entry.path, project: project)
            }
        }
        .navigationDestination(isPresented: $finding) {
            FileGrepPage(client: client, cwd: state.value?.text("path") ?? path, project: project)
        }
        .modifier(FileDeleteConfirmation(client: client, path: $deleting) { Task { await load() } })
        .searchable(text: $search, prompt: "Filter this folder")
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
    @ViewBuilder private func entryMenu(_ entry: JSONValue, directory: Bool, project: FilesProject) -> some View {
        let entryPath = entry.text("path")
        if !directory {
            Button("Open as view", lucideIcon: "columns-2") { Task { await project.openAsView(entryPath) } }
        }
        FileMentionMenu(project: project, path: entryPath, onMentioned: { note = $0 }) {
            Label("Mention in chat", lucideIcon: "at-sign")
        }
        Button("Copy path", lucideIcon: "copy") { UIPasteboard.general.string = entryPath }
        Divider()
        Button("Delete", lucideIcon: "trash", role: .destructive) { deleting = entryPath }
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
    /// The project the file is in, which adds the bar under it and editing; nil for a file of the machine's own.
    var project: FilesProject? = nil
    /// Whether this page is the file's own view, which then does not offer to open one.
    var isView = false
    @State private var state = RemotePageState()
    @State private var edit = FileEditModel()
    @State private var changes = FileChangeMarksModel()
    @State private var deleting: String?
    @State private var note: String?
    @State private var diff: GitDiffTarget?
    @Environment(\.dismiss) private var dismiss
    @State private var shown = FileShown()
    @State private var pdfPage = 1
    // The player's asset holds its loader weakly, so the page keeps it.
    @State private var media: MachineMediaLoader?
    @State private var player: AVPlayer?
    @State private var audio: FileAudioInfo?
    // The version of the file the player plays, as mtime and size.
    @State private var playerKey: String?
    @State private var mediaProblem: String?
    @State private var fullScreen = false
    @State private var showSource = false
    var body: some View {
        ScrollViewReader { reader in
            Group {
                if edit.editing {
                    editor
                } else if isHTML, !showSource, initialLine == nil, let value = state.value,
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
                        mediaContents(value)
                    }
                    .task(id: versionKey(value)) { await startPlayer(for: versionKey(value), audio: isAudio(value)) }
                } else if let value = state.value, let image = shown.image {
                    VStack(spacing: 0) {
                        RemotePageStatus(state: state) { Task { await load() } }
                        FileImageView(image: image.image, name: name)
                        FileFooter(items: [
                            "\(image.pixelWidth) × \(image.pixelHeight)", mobileByteCount(value["size"]?.numberValue),
                            value.text("mime"),
                        ])
                    }
                } else if let value = state.value, let pdf = shown.pdf {
                    VStack(spacing: 0) {
                        RemotePageStatus(state: state) { Task { await load() } }
                        FilePDFView(document: pdf, page: $pdfPage)
                        FileFooter(items: [
                            "Page \(pdfPage.formatted()) of \(pdf.pageCount.formatted())",
                            mobileByteCount(value["size"]?.numberValue), value.text("mime"),
                        ])
                    }
                } else if let value = state.value, value.text("kind") == "binary", shown.svg == nil {
                    VStack(spacing: 0) {
                        RemotePageStatus(state: state) { Task { await load() } }
                        FileFallbackView(
                            client: client, path: path, mime: value.text("mime"), size: value["size"]?.numberValue,
                            reason: shown.unreadable ?? unsupportedReason(value))
                    }
                } else {
                    fileContents
                }
            }
            .modifier(MobilePageSurface())
            .navigationTitle(name)
            .navigationBarBackButtonHidden(edit.editing)
            .interactiveDismissDisabled(edit.editing && edit.changed)
            .toolbar {
                if edit.editing {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { edit.cancel() }.disabled(edit.saving)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { Task { await save() } }.disabled(edit.saving || !edit.changed)
                    }
                } else {
                    if initialLine == nil,
                        isHTML || ["md", "markdown"].contains(URL(fileURLWithPath: path).pathExtension.lowercased())
                    {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button(showSource ? "Preview" : "Source") { showSource.toggle() }
                        }
                    }
                    if let project {
                        ToolbarItem(placement: .topBarTrailing) { fileMenu(project) }
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let project, !edit.editing, state.value != nil {
                    actionBar(project)
                }
            }
            .navigationDestination(item: $diff) { target in GitDiffPage(client: client, target: target) }
            .modifier(FileDeleteConfirmation(client: client, path: $deleting) { dismiss() })
            .alert("This file changed on the machine", isPresented: $edit.stale) {
                Button("Reload and drop my edits", role: .destructive) {
                    edit.cancel()
                    Task { await load() }
                }
                Button("Copy my edits") { UIPasteboard.general.string = edit.text }
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("Your edits are still here. Saving over a file that moved would lose what changed it.")
            }
            .task(id: state.value.map(versionKey)) {
                guard project != nil, state.value != nil else { return }
                await changes.load(client: client, path: path)
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
            // Only a pause, and not on the way into full screen: the page comes back without reading the file again.
            .onDisappear { if !fullScreen { player?.pause() } }
            .onChange(of: state.value) { _, _ in
                if let initialLine { reader.scrollTo(initialLine, anchor: .center) }
            }
        }
    }
    private var name: String { URL(fileURLWithPath: path).lastPathComponent }

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
                        } else if initialLine != nil || !changes.isEmpty {
                            FileLinesView(
                                text: value.text("text"), language: value["language"]?.stringValue,
                                changes: changes, highlight: initialLine)
                        } else {
                            CodeMessage(
                                text: value.text("text"),
                                language: FileKinds.highlightLanguage(value["language"]?.stringValue))
                        }
                    } else if let svg = shown.svg {
                        SafeSVGPreview(data: svg).frame(minHeight: 360)
                    } else if value.text("kind") == "too-large" {
                        ContentUnavailableView(
                            "File too large", lucideIcon: "file-text",
                            description: Text(
                                "This text file is \(mobileByteCount(value["size"]?.numberValue)). Open it on the machine."
                            ))
                    }
                }
            }.padding()
        }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let problem = edit.problem, !edit.stale {
                Label(problem, lucideIcon: "triangle-alert").font(.caption).foregroundStyle(.red).padding()
            }
            if edit.saving {
                HStack(spacing: 10) {
                    Spinner(size: 14, label: "Saving").foregroundStyle(MobileStyle.statusRunning)
                    Text("Saving").font(.caption).foregroundStyle(MobileStyle.muted)
                }.padding(.horizontal).padding(.top, 8)
            }
            TextEditor(text: $edit.text)
                .font(.system(.footnote, design: .monospaced))
                .autocorrectionDisabled().textInputAutocapitalization(.never)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 12)
        }
    }

    private var canEdit: Bool {
        state.value?.text("kind") == "text" && !(isHTML && !showSource && initialLine == nil)
    }

    /// The file's own menu: edit it, give it a view, mention it, and delete it.
    private func fileMenu(_ project: FilesProject) -> some View {
        Menu {
            if canEdit, let value = state.value {
                Button("Edit", lucideIcon: "square-pen") {
                    edit.begin(text: value.text("text"), mtime: value.number("mtime"))
                }
            }
            if !isView {
                Button("Open as view", lucideIcon: "columns-2") { Task { await project.openAsView(path) } }
            }
            FileMentionMenu(project: project, path: path, onMentioned: { note = $0 }) {
                Label("Mention in chat", lucideIcon: "at-sign")
            }
            if let target = changes.diff {
                Button("Show changes", lucideIcon: "file-diff") { diff = target }
            }
            Button("Copy path", lucideIcon: "copy") { UIPasteboard.general.string = path }
            Divider()
            Button("Delete", lucideIcon: "trash", role: .destructive) { deleting = path }
        } label: {
            Label("File actions", lucideIcon: "ellipsis")
        }
    }

    /// The bar under a file: mention it in a chat, its diff against the last commit, and copying it.
    private func actionBar(_ project: FilesProject) -> some View {
        VStack(spacing: 6) {
            if let note {
                Text(note).font(.caption).foregroundStyle(MobileStyle.muted).frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
            }
            GitBottomBar {
                FileMentionMenu(project: project, path: path, onMentioned: { note = $0 }) {
                    Text("Mention").font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.glass)
                GitBarButton(title: "Diff", prominent: false) { diff = changes.diff }
                    .disabled(changes.diff == nil)
                GitBarButton(title: "Copy", prominent: false) {
                    UIPasteboard.general.string =
                        state.value?.text("kind") == "text" ? state.value?.text("text") : path
                }
            }
        }
    }

    private func save() async {
        if await edit.save(client: client, path: path) {
            note = "Saved."
            await load()
        }
    }

    private func isMedia(_ value: JSONValue) -> Bool {
        let mime = value.text("mime")
        return value.text("kind") == "binary" && (mime.hasPrefix("video/") || mime.hasPrefix("audio/"))
    }

    private func isAudio(_ value: JSONValue) -> Bool {
        value.text("mime").hasPrefix("audio/")
    }

    private func unsupportedReason(_ value: JSONValue) -> String {
        if !FileKinds.machineServes(mime: value.text("mime")) {
            return "The machine only sends images, video, sound and PDFs to this app."
        }
        if !FileKinds.fitsInMemory(size: value["size"]?.numberValue) {
            return "This app opens files up to \(mobileByteCount(WireConstants.bytesReadMaxBytes))."
        }
        return "This app has no preview for this file."
    }

    @ViewBuilder private func mediaContents(_ value: JSONValue) -> some View {
        if let player {
            if let audio {
                FileAudioPlayer(player: player, name: name, info: audio)
                FileFooter(items: [mobileByteCount(value["size"]?.numberValue), value.text("mime")])
            } else {
                FilePlayerView(player: player, fullScreen: $fullScreen)
            }
        } else if let mediaProblem {
            FileFallbackView(
                client: client, path: path, mime: value.text("mime"), size: value["size"]?.numberValue,
                reason: mediaProblem)
        } else {
            MobileLoadingRow("Loading").frame(maxHeight: .infinity)
        }
    }

    private func versionKey(_ value: JSONValue) -> String {
        "\(value["mtime"]?.numberValue ?? 0)-\(value["size"]?.numberValue ?? 0)"
    }

    /// In the ranges the player asks for, so it starts at once and a file of any size plays. The asset is loaded
    /// before AVKit sees it: given one still loading, AVKit left its play button without effect.
    private func startPlayer(for key: String, audio isAudio: Bool) async {
        guard key != playerKey else { return }
        cleanMedia()
        playerKey = key
        let loader = MachineMediaLoader(client: client, path: path)
        media = loader
        let asset = loader.asset()
        do {
            let (playable, duration) = try await asset.load(.isPlayable, .duration)
            guard playerKey == key else { return }
            if playable {
                if isAudio {
                    let info = await FileAudioInfo.load(from: asset, duration: duration)
                    guard playerKey == key else { return }
                    audio = info
                }
                // Sound through the silent switch, as a video or a song does anywhere else on the phone.
                try? AVAudioSession.sharedInstance().setCategory(.playback, mode: isAudio ? .default : .moviePlayback)
                player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            } else {
                mediaProblem = "This device cannot play this file."
            }
        } catch {
            guard playerKey == key else { return }
            if Task.isCancelled {
                // The page went before the file loaded; it starts over when the page is back.
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
        audio = nil
    }

    private func load() async {
        await state.load {
            let result = try await client.request("fs.read", payload: .object(["path": .string(path)]))
            // A player starts with its page and keeps playing through a change elsewhere in the folder.
            if isMedia(result) { return result }
            let binary = result.text("kind") == "binary"
            let key = versionKey(result)
            if binary, key == shown.version { return result }
            // What is on screen stays until its successor is ready, so a reread never flashes the fallback.
            let next = FileShown()
            let mime = result.text("mime")
            if binary, mime.hasPrefix("image/") || mime == "application/pdf",
                FileKinds.fitsInMemory(size: result["size"]?.numberValue)
            {
                let resource = try await client.readResource(.object(["kind": .string("file"), "path": .string(path)]))
                if mime == "image/svg+xml" {
                    next.svg = resource.data
                } else if mime == "application/pdf" {
                    next.pdf = PDFDocument(data: resource.data)
                    if next.pdf == nil { next.unreadable = "This PDF cannot be opened." }
                } else {
                    let data = resource.data
                    next.image = await Task.detached(priority: .userInitiated) { FileImage.decode(data) }.value
                    if next.image == nil { next.unreadable = "This device cannot show this picture." }
                }
                try Task.checkCancellation()
            }
            next.version = binary ? key : nil
            cleanMedia()
            shown.replace(with: next)
            pdfPage = 1
            return result
        }
    }
}

/// What a file page shows beside the read itself. Observable like `RemotePageState`, so a read and the picture it
/// brought land in one update: kept in `@State` fields instead, the page drew the fallback for a frame in between.
@MainActor @Observable private final class FileShown {
    var image: FileImage?
    var pdf: PDFDocument?
    var svg: Data?
    /// Why a file whose bytes arrived still has no view of its own.
    var unreadable: String?
    /// The version on screen, as mtime and size, so a change elsewhere in the folder does not read the file again.
    var version: String?

    func replace(with next: FileShown) {
        image = next.image
        pdf = next.pdf
        svg = next.svg
        unreadable = next.unreadable
        version = next.version
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

