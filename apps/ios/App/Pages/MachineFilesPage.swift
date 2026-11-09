import AVKit
import PDFKit
import RuimtePulsar
import RuimteShared
import RuimteTransport
import RuimteVoice
import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct MachineFilesPage: View {
    let client: any MachineRequesting
    let path: String
    /// The project these files are in, which adds mentions, views of their own and deleting; nil on a machine's files.
    var project: FilesProject?
    var marks: GitRepositories?
    @State private var state = RemotePageState()
    @State private var listing: FsListResult?
    @AppStorage(Settings.showHiddenFiles) private var hidden
    @State private var search = ""
    @State private var selectedEntry: FileDestination?
    @State private var finding = false
    @State private var deleting: String?
    @State private var note: String?
    private struct FileDestination: Hashable {
        let path: String
        let directory: Bool
    }
    private var entries: [FsEntry] {
        listing?.entries.filter {
            search.isEmpty || $0.name.localizedCaseInsensitiveContains(search)
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
                    Label(String(localized: "Find in files"), lucideIcon: "file-search").modifier(
                        MobileSidebarLabel(disclosure: true))
                }
                .modifier(MobileSidebarRow())
            }
            ForEach(entries, id: \.path) { entry in
                let directory = entry.kind == .directory
                let mark = fileMarks.mark(path: entry.path, directory: directory)
                Button {
                    if !directory, let openFile = project?.openFile {
                        openFile(entry.path, nil)
                    } else {
                        selectedEntry = FileDestination(path: entry.path, directory: directory)
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(lucide: FileKinds.icon(name: entry.name, kind: entry.kind.rawValue), size: 20)
                            .foregroundStyle(MobileStyle.muted)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(entry.name).lineLimit(1).truncationMode(.tail)
                            if let size = entry.size {
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
                .modifier(MobileSidebarRow(selected: !directory && entry.path == project?.shownFile))
                .contextMenu { if let project { entryMenu(entry, directory: directory, project: project) } }
            }
            if listing != nil && entries.isEmpty {
                ContentUnavailableView(
                    search.isEmpty ? String(localized: "Empty folder") : String(localized: "No matching files"),
                    lucideIcon: "folder")
            }
            if listing?.truncated == true {
                Text("This folder has more entries than the machine can list at once.").font(.footnote).foregroundStyle(
                    MobileStyle.muted)
            }
        }
        .navigationTitle(path == "~" ? String(localized: "Files") : MachinePath(inferring: path).name(path))
        .navigationDestination(item: $selectedEntry) { entry in
            if entry.directory {
                MachineFilesPage(client: client, path: entry.path, project: project, marks: marks)
            } else {
                FileContentPage(client: client, path: entry.path, project: project)
            }
        }
        .navigationDestination(isPresented: $finding) {
            FileGrepPage(client: client, cwd: listing?.path ?? path, project: project)
        }
        .modifier(FileDeleteConfirmation(client: client, path: $deleting) { Task { await load() } })
        .searchable(text: $search, prompt: "Filter this folder")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Toggle("Show hidden and ignored files", isOn: $hidden)
                } label: {
                    Label(String(localized: "File options"), lucideIcon: "ellipsis")
                }
            }
        }
        .task(id: "\(path):\(hidden)") {
            await RemotePageLifecycle.run(
                client: client, events: [.fsChanged],
                matches: RemotePageLifecycle.typed(FsChangedEvent.self) { event in
                    let resolved = listing?.path ?? path
                    return MachinePath(inferring: resolved).isBelow(resolved, root: event.root)
                },
                watch: { fsWatch(path: listing?.path ?? path) },
                start: { if path == "~" { await load() } }, load: load)
        }
        .refreshable { await load() }
    }
    @ViewBuilder private func entryMenu(_ entry: FsEntry, directory: Bool, project: FilesProject) -> some View {
        let entryPath = entry.path
        if !directory {
            Button(String(localized: "Open as view"), lucideIcon: "columns-2") {
                Task { await project.openAsView(entryPath) }
            }
        }
        FileMentionMenu(project: project, path: entryPath, onMentioned: { note = $0 }) {
            Label(String(localized: "Mention in chat"), lucideIcon: "at-sign")
        }
        Button(String(localized: "Copy path"), lucideIcon: "copy") { UIPasteboard.general.string = entryPath }
        Divider()
        Button(String(localized: "Delete"), lucideIcon: "trash", role: .destructive) { deleting = entryPath }
    }

    private func load() async {
        await state.read(loaded: listing != nil) { stillTheLatest in
            let resolved = path == "~" ? try await MachinePath.startFolder(client: client) : path
            let result = try await client.request(
                .fsList, payload: .object(["path": .string(resolved), "depth": .number(1), "hidden": .bool(hidden)])
            ).decoded(as: FsListResult.self)
            try stillTheLatest()
            listing = result
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
    @State private var file: FsReadResult?
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
                } else if isHTML, !showSource, initialLine == nil, let value = file,
                    value.isText
                {
                    underStatus {
                        MobileScrollViewport { insets in
                            HTMLFilePreview(html: value.text, viewportInsets: insets)
                        }
                    }
                } else if let value = file, isMedia(value) {
                    underStatus { mediaContents(value) }
                        .task(id: versionKey(value)) {
                            await startPlayer(for: versionKey(value), audio: value.mime.hasPrefix("audio/"))
                        }
                } else if let value = file, let image = shown.image {
                    underStatus {
                        FileImageView(image: image.image, name: name)
                        FileFooter(items: [
                            "\(image.pixelWidth) × \(image.pixelHeight)", mobileByteCount(value.size),
                            value.mime,
                        ])
                    }
                } else if let value = file, let pdf = shown.pdf {
                    underStatus {
                        FilePDFView(document: pdf, page: $pdfPage)
                        FileFooter(items: [
                            String(
                                localized:
                                    "Page \(Format.number(Double(pdfPage))) of \(Format.number(Double(pdf.pageCount)))"),
                            mobileByteCount(value.size), value.mime,
                        ])
                    }
                } else if let value = file, value.isBinary, shown.svg == nil {
                    underStatus {
                        FileFallbackView(
                            client: client, path: path, mime: value.mime, size: value.size,
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
                    if initialLine == nil, isHTML || isMarkdown {
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
                if let project, !edit.editing, file != nil {
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
                Text("Your edits are still here. Saving now overwrites the change on the machine.")
            }
            .task(id: file.map(versionKey)) {
                guard project != nil, file != nil else { return }
                await changes.load(client: client, path: path)
            }
            .task(id: path) {
                let style = MachinePath(inferring: path)
                let parent = style.parent(path)
                await RemotePageLifecycle.run(
                    client: client, events: [.fsChanged],
                    matches: RemotePageLifecycle.typed(FsChangedEvent.self) { style.isBelow(parent, root: $0.root) },
                    watch: { fsWatch(path: parent) }, load: load)
            }
            // Only a pause, and not on the way into full screen: the page comes back without reading the file again.
            .onDisappear { if !fullScreen { player?.pause() } }
            .onChange(of: file) { _, _ in
                if let initialLine { reader.scrollTo(initialLine, anchor: .center) }
            }
        }
    }
    private var name: String { MachinePath(inferring: path).name(path) }
    private var fileExtension: String { MachinePath(inferring: path).fileExtension(path) }
    private var isHTML: Bool { ["html", "htm"].contains(fileExtension) }
    private var isMarkdown: Bool { ["md", "markdown"].contains(fileExtension) }

    private func underStatus(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(spacing: 0) {
            RemotePageStatus(state: state) { Task { await load() } }
            content()
        }
    }

    private var fileContents: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                RemotePageStatus(state: state) { Task { await load() } }
                if let value = file {
                    if value.isText {
                        if isMarkdown && !showSource && initialLine == nil {
                            MarkdownMessage(text: value.text).frame(maxWidth: .infinity, alignment: .leading)
                        } else if initialLine != nil || !changes.isEmpty {
                            FileLinesView(
                                text: value.text, language: value.language,
                                changes: changes, highlight: initialLine)
                        } else {
                            CodeMessage(
                                text: value.text,
                                language: FileKinds.highlightLanguage(value.language))
                        }
                    } else if let svg = shown.svg {
                        SafeSVGPreview(data: svg).frame(minHeight: 360)
                    } else if value.isTooLarge {
                        ContentUnavailableView(
                            String(localized: "File too large"), lucideIcon: "file-text",
                            description: Text(
                                "This text file is \(mobileByteCount(value.size)). Open it on the machine."
                            ))
                    }
                }
            }.padding()
        }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let problem = edit.problem, !edit.stale {
                Label(problem, lucideIcon: "triangle-alert").font(.caption).foregroundStyle(MobileStyle.statusError)
                    .padding()
            }
            if edit.saving {
                HStack(spacing: 10) {
                    Spinner(size: 14, label: String(localized: "Saving")).foregroundStyle(MobileStyle.statusRunning)
                    Text("Saving").font(.caption).foregroundStyle(MobileStyle.muted)
                }.padding(.horizontal).padding(.top, 8)
            }
            TextEditor(text: $edit.text)
                .disabled(edit.saving)
                .font(.system(.footnote, design: .monospaced))
                .autocorrectionDisabled().textInputAutocapitalization(.never)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 12)
        }
    }

    private var canEdit: Bool {
        file?.isText == true && !(isHTML && !showSource && initialLine == nil)
    }

    private func fileMenu(_ project: FilesProject) -> some View {
        Menu {
            if canEdit, let value = file {
                Button(String(localized: "Edit"), lucideIcon: "square-pen") {
                    edit.begin(text: value.text, mtime: value.mtime ?? 0)
                }
            }
            if !isView {
                Button(String(localized: "Open as view"), lucideIcon: "columns-2") {
                    Task { await project.openAsView(path) }
                }
            }
            FileMentionMenu(project: project, path: path, onMentioned: { note = $0 }) {
                Label(String(localized: "Mention in chat"), lucideIcon: "at-sign")
            }
            if let target = changes.diff {
                Button(String(localized: "Show changes"), lucideIcon: "file-diff") { diff = target }
            }
            Button(String(localized: "Copy path"), lucideIcon: "copy") { UIPasteboard.general.string = path }
            Divider()
            Button(String(localized: "Delete"), lucideIcon: "trash", role: .destructive) { deleting = path }
        } label: {
            Label(String(localized: "File actions"), lucideIcon: "ellipsis")
        }
    }

    private func actionBar(_ project: FilesProject) -> some View {
        VStack(spacing: 6) {
            if let note {
                Text(note).font(.caption).foregroundStyle(MobileStyle.muted).frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
            }
            GitBottomBar {
                FileMentionMenu(project: project, path: path, onMentioned: { note = $0 }) {
                    Text("Mention").frame(maxWidth: .infinity)
                }
                .buttonStyle(.mobileGlass)
                GitBarButton(title: String(localized: "Diff"), prominent: false) { diff = changes.diff }
                    .disabled(changes.diff == nil)
                GitBarButton(title: String(localized: "Copy"), prominent: false) {
                    UIPasteboard.general.string =
                        file?.isText == true ? file?.text : path
                }
            }
        }
    }

    private func save() async {
        if await edit.save(client: client, path: path) {
            note = String(localized: "Saved.")
            await load()
        }
    }

    private func isMedia(_ value: FsReadResult) -> Bool {
        let mime = value.mime
        return value.isBinary && (mime.hasPrefix("video/") || mime.hasPrefix("audio/"))
    }

    private func unsupportedReason(_ value: FsReadResult) -> String {
        if !FileKinds.machineServes(mime: value.mime) {
            return String(localized: "The machine only sends images, video, sound and PDFs to this app.")
        }
        if !FileKinds.fitsInMemory(size: value.size) {
            return String(localized: "This app opens files up to \(mobileByteCount(WireConstants.bytesReadMaxBytes)).")
        }
        return String(localized: "This app has no preview for this file.")
    }

    @ViewBuilder private func mediaContents(_ value: FsReadResult) -> some View {
        if let player {
            if let audio {
                FileAudioPlayer(player: player, name: name, info: audio)
                FileFooter(items: [mobileByteCount(value.size), value.mime])
            } else {
                FilePlayerView(player: player, fullScreen: $fullScreen)
            }
        } else if let mediaProblem {
            FileFallbackView(
                client: client, path: path, mime: value.mime, size: value.size,
                reason: mediaProblem)
        } else {
            MobileLoadingRow(String(localized: "Loading")).frame(maxHeight: .infinity)
        }
    }

    private func versionKey(_ value: FsReadResult) -> String {
        "\(value.mtime ?? 0)-\(value.size)"
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
                // Sound through the silent switch, as a video or a song does anywhere else on the phone. While Voice
                // holds the audio the file plays in its session, since playback alone would turn its microphone off.
                if AudioSessionController.shared.owner == nil {
                    try? AVAudioSession.sharedInstance()
                        .setCategory(.playback, mode: isAudio ? .default : .moviePlayback)
                }
                player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            } else {
                mediaProblem = String(localized: "This device cannot play this file.")
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
        await state.read(loaded: file != nil) { stillTheLatest in
            let result = try await readFile()
            try stillTheLatest()
            file = result
        }
    }

    private func readFile() async throws -> FsReadResult {
        var result = try await client.request(.fsRead, payload: .object(["path": .string(path)]))
            .decoded(as: FsReadResult.self)
        // Text past one frame comes as bytes, up to what a phone draws; bytes that are not UTF-8 stay too large.
        if result.isTooLarge, result.size <= largeTextMaxBytes {
            let resource = try await client.readResource(.object(["kind": .string("file"), "path": .string(path)]))
            if let text = String(data: resource.data, encoding: .utf8) {
                result = .text(FsTextRead(text: text, size: result.size, mtime: result.mtime ?? 0))
            }
        }
        // A player starts with its page and keeps playing through a change elsewhere in the folder.
        if isMedia(result) { return result }
        let binary = result.isBinary
        let key = versionKey(result)
        if binary, key == shown.version { return result }
        // What is on screen stays until its successor is ready, so a reread never flashes the fallback.
        let next = FileShown()
        let mime = result.mime
        if binary, mime.hasPrefix("image/") || mime == "application/pdf", FileKinds.fitsInMemory(size: result.size) {
            let resource = try await client.readResource(.object(["kind": .string("file"), "path": .string(path)]))
            if mime == "image/svg+xml" {
                next.svg = resource.data
            } else if mime == "application/pdf" {
                next.pdf = PDFDocument(data: resource.data)
                if next.pdf == nil { next.unreadable = String(localized: "This PDF cannot be opened.") }
            } else {
                let data = resource.data
                next.image = await Task.detached(priority: .userInitiated) { FileImage.decode(data) }.value
                if next.image == nil {
                    next.unreadable = String(localized: "This device cannot show this picture.")
                }
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

private extension FsReadResult {
    var isText: Bool { if case .text = self { true } else { false } }
    var isBinary: Bool { if case .binary = self { true } else { false } }
    var isTooLarge: Bool { if case .tooLarge = self { true } else { false } }

    /// Empty for what is not text, as the views that draw text only ask after they know it is.
    var text: String { if case .text(let read) = self { read.text } else { "" } }
    var language: String? { if case .text(let read) = self { read.language } else { nil } }
    var mime: String { if case .binary(let read) = self { read.mime } else { "" } }

    var size: Double {
        switch self {
        case .text(let read): read.size
        case .binary(let read): read.size
        case .tooLarge(let read): read.size
        }
    }

    var mtime: Double? {
        switch self {
        case .text(let read): read.mtime
        case .binary(let read): read.mtime
        case .tooLarge(let read): read.mtime
        }
    }
}

private let largeTextMaxBytes: Double = 8 * 1024 * 1024

func fsWatch(path: String) -> LiveWatch {
    .area(.fsWatch, payload: .object(["path": .string(path)]))
}

/// What a file page shows beside the read itself. Observable like `RemotePageState`, so a read and the picture it
/// brought land in one update: kept in `@State` fields instead, the page drew the fallback for a frame in between.
@MainActor @Observable private final class FileShown {
    var image: FileImage?
    var pdf: PDFDocument?
    var svg: Data?
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
            willBeginFullScreenPresentationWithAnimationCoordinator coordinator:
                any UIViewControllerTransitionCoordinator
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

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.websiteDataStore = .nonPersistent()
        return WKWebView(frame: .zero, configuration: config)
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loaded != data else { return }
        context.coordinator.loaded = data
        // SVG is an image inside an isolated document; links and embedded scripts cannot run.
        let base64 = data.base64EncodedString()
        view.loadHTMLString(
            "<meta name='viewport' content='width=device-width,initial-scale=1'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\"><style>body{margin:0}img{width:100%;height:auto}</style><img alt='File preview' src='data:image/svg+xml;base64,\(base64)'>",
            baseURL: nil)
    }

    final class Coordinator {
        var loaded: Data?
    }
}
