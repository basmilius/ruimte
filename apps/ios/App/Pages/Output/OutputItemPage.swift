import CoreTransferable
import QuickLook
import RuimtePulsar
import RuimteShared
import RuimteTransport
import SwiftUI
import UniformTypeIdentifiers

/// One item of Output: the version on screen as its kind draws it, a button with its versions, and where it came from.
/// A report reads as Markdown, a page in the sandbox a chat's visual runs in, images in Quick Look, and anything else
/// as its files to share.
struct OutputItemPage: View {
    @State private var model: OutputItemModel
    @State private var showingOrigin = false
    private let context: OutputContext
    private let title: String

    init(context: OutputContext, artifactID: String, title: String, pinned: String? = nil) {
        _model = State(initialValue: OutputItemModel(client: context.client, artifactID: artifactID, pinned: pinned))
        self.context = context
        self.title = title
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .modifier(MobilePageSurface())
            .overlay(alignment: .bottom) {
                if model.reachable, !model.gone, model.versions.count > 1 { versionsButton }
            }
            .navigationTitle(Text(verbatim: model.title ?? title))
            .navigationSubtitle(model.version.map { Format.dayClock($0.date) } ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingOrigin = true
                    } label: {
                        Image(lucide: "info").accessibilityLabel("Origin")
                    }
                    .disabled(model.version == nil)
                }
            }
            .mobileSheet(isPresented: $showingOrigin) {
                if let version = model.version {
                    NavigationStack {
                        OutputOriginPage(model: model, version: version, context: context)
                            .toolbar {
                                ToolbarItem(placement: .confirmationAction) {
                                    Button(role: .close) { showingOrigin = false }
                                }
                            }
                    }
                }
            }
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    @ViewBuilder private var content: some View {
        if !model.reachable {
            OutputUnreachableView(machineName: context.machineName) {
                context.reconnect()
                Task { await model.load() }
            }
        } else if model.gone {
            ContentUnavailableView(String(localized: "No longer in Output."), lucideIcon: "package")
        } else if let version = model.version {
            OutputVersionBody(model: model, version: version, title: model.title ?? title).id(version.id)
        } else if model.loaded {
            ContentUnavailableView {
                Label(String(localized: "This version was removed."), lucideIcon: "package", iconSize: 48)
            } actions: {
                Button("Show the latest") { model.selectedID = nil }
            }
        } else if let problem = model.problem {
            ContentUnavailableView {
                Label(String(localized: "Could not show this"), lucideIcon: "triangle-alert", iconSize: 48)
            } description: {
                Text(problem)
            } actions: {
                Button("Try again") { Task { await model.load() } }
            }
        } else {
            MobileLoadingRow(String(localized: "Loading"))
        }
    }

    /// Every version, newest first. Picking the newest follows the latest again, as the desktop does.
    private var versionsButton: some View {
        Menu {
            ForEach(model.versions) { version in
                Button {
                    model.selectedID = version.id == model.latest?.id ? nil : version.id
                } label: {
                    if version.id == model.version?.id {
                        Label(version.label, lucideIcon: "check")
                    } else {
                        Text(verbatim: version.label)
                    }
                    if version.id == model.latest?.id { Text("Latest") }
                }
            }
        } label: {
            Label("\(model.versions.count) versions", lucideIcon: "history", iconSize: 16)
        }
        .buttonStyle(.mobileGlass)
        .padding(.bottom, 12)
        .accessibilityIdentifier("output.versions")
    }
}

/// A version as its kind draws it; a kind whose files do not fit how it draws falls back to the list of files.
private struct OutputVersionBody: View {
    let model: OutputItemModel
    let version: OutputVersion
    let title: String

    var body: some View {
        let kind = OutputKind.drawn(model.kind)
        let first = version.files.first
        if kind == "report", let first, first.isText {
            OutputReportBody(model: model, version: version, file: first)
        } else if kind == "page", let first, first.mime == "text/html" {
            OutputPageBody(model: model, version: version, title: title)
        } else if kind == "image", version.files.contains(where: \.isImage) {
            OutputImagesBody(model: model, version: version)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("No preview.").font(.callout).foregroundStyle(MobileStyle.muted)
                    OutputFileRows(model: model, version: version)
                }
                .padding(20)
            }
        }
    }
}

private struct OutputReportBody: View {
    let model: OutputItemModel
    let version: OutputVersion
    let file: OutputFile
    @State private var text: String?
    @State private var failed = false

    var body: some View {
        Group {
            if let text {
                ScrollView {
                    Group {
                        if file.mime == "text/markdown" {
                            MarkdownMessage(text: text)
                        } else {
                            Text(verbatim: text).font(.callout.monospaced()).textSelection(.enabled)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 72)
                }
            } else if failed || !file.readable {
                ContentUnavailableView(String(localized: "Could not read this file"), lucideIcon: "circle-alert")
            } else {
                MobileLoadingRow(String(localized: "Loading"))
            }
        }
        .task {
            guard file.readable else { return }
            do {
                text = String(decoding: try await model.read(version, file: 0), as: UTF8.self)
            } catch is CancellationError {
            } catch {
                failed = true
            }
        }
    }
}

/// A page in the same sandboxed web view a chat draws a visual in, never as a file the system opens.
private struct OutputPageBody: View {
    let model: OutputItemModel
    let version: OutputVersion
    let title: String
    @State private var failed = false

    var body: some View {
        ChatVisualContent(
            visual: ChatVisual(id: "output-\(version.id)", title: title, at: version.created), failed: $failed,
            read: { [model, version] in try await model.read(version, file: 0) }, fill: true)
    }
}

/// The images of a version, each opening Quick Look with every image of that version beside it. The files live in a
/// folder of their own while the page shows and go with it.
private struct OutputImagesBody: View {
    let model: OutputItemModel
    let version: OutputVersion
    @State private var files: [URL] = []
    @State private var folder: URL?
    @State private var preview: URL?
    @State private var failed = false

    var body: some View {
        Group {
            if !files.isEmpty {
                ScrollView {
                    LazyVStack(spacing: 16) {
                        ForEach(files, id: \.self) { url in
                            Button {
                                preview = url
                            } label: {
                                OutputImageThumbnail(url: url)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(verbatim: url.lastPathComponent))
                        }
                    }
                    .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 72)
                }
            } else if failed {
                ContentUnavailableView(String(localized: "Could not read this file"), lucideIcon: "circle-alert")
            } else {
                MobileLoadingRow(String(localized: "Loading"))
            }
        }
        .quickLookPreview($preview, in: files)
        .task { await download() }
        // A full-screen Quick Look takes the page off screen too, and still reads the files.
        .onDisappear { if preview == nil { remove() } }
    }

    private func download() async {
        guard files.isEmpty else { return }
        do {
            let folder = FileManager.default.temporaryDirectory.appending(
                path: "ruimte-output-\(UUID().uuidString)", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            self.folder = folder
            var urls: [URL] = []
            for (index, file) in version.files.enumerated() where file.isImage && file.readable {
                let data = try await model.read(version, file: index)
                try Task.checkCancellation()
                // Every file gets a folder of its own, so two of one name never meet.
                let place = folder.appending(path: "\(index)", directoryHint: .isDirectory)
                try FileManager.default.createDirectory(at: place, withIntermediateDirectories: true)
                let url = place.appending(path: OutputFiles.safeName(file.shortName))
                try data.write(to: url, options: [.atomic, .completeFileProtection])
                urls.append(url)
            }
            files = urls
            failed = urls.isEmpty
        } catch is CancellationError {
        } catch {
            failed = true
        }
    }

    private func remove() {
        if let folder { try? FileManager.default.removeItem(at: folder) }
        folder = nil
        files = []
    }
}

private struct OutputImageThumbnail: View {
    let url: URL

    var body: some View {
        if let image = UIImage(contentsOfFile: url.path(percentEncoded: false)) {
            Image(uiImage: image).resizable().scaledToFit()
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        } else {
            Label(url.lastPathComponent, lucideIcon: "image-off", iconSize: 14)
                .font(.caption).foregroundStyle(MobileStyle.muted)
                .frame(maxWidth: .infinity, minHeight: 120)
        }
    }
}

enum OutputFiles {
    /// A name a file on the phone can take: the label's last part, never empty, `.` or `..`.
    static func safeName(_ name: String) -> String {
        let last = URL(fileURLWithPath: name).lastPathComponent
        return last.isEmpty || last == "." || last == ".." || last == "/" ? String(localized: "File") : last
    }
}

/// The files of a version with their sizes; Share reads a file only once a person picks where it goes, and only one
/// the machine hands over whole.
struct OutputFileRows: View {
    let model: OutputItemModel
    let version: OutputVersion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(version.files.enumerated()), id: \.offset) { index, file in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: file.name).lineLimit(1).truncationMode(.middle)
                        Text(Format.bytes(file.bytes)).font(.caption).monospacedDigit()
                            .foregroundStyle(MobileStyle.muted)
                    }
                    Spacer(minLength: 8)
                    if file.readable {
                        let name = OutputFiles.safeName(file.shortName)
                        ShareLink(
                            item: OutputSharedFile(name: name) { [model, version] in
                                try await model.read(version, file: index)
                            },
                            preview: SharePreview(name)
                        ) {
                            Image(lucide: "share", size: 18).accessibilityLabel("Share")
                        }
                        .frame(minWidth: 44, minHeight: 44)
                    } else {
                        Text("Too large for this phone").font(.caption).foregroundStyle(MobileStyle.faint)
                    }
                }
                .frame(minHeight: 52)
            }
        }
    }
}

private struct OutputSharedFile: Transferable {
    let name: String
    let data: @Sendable @MainActor () async throws -> Data

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .data) { try await $0.data() }
            .suggestedFileName { $0.name }
    }
}

private struct OutputOriginPage: View {
    let model: OutputItemModel
    let version: OutputVersion
    let context: OutputContext

    var body: some View {
        MobileList {
            Section("Origin") {
                LabeledContent(String(localized: "Made by")) {
                    HStack(spacing: 6) {
                        if version.provenance.maker == .agent && version.provenance.agent != nil {
                            OutputMakerIcon(provenance: version.provenance)
                        }
                        Text(verbatim: model.maker(version.provenance)).lineLimit(1)
                    }
                }
                if let chatID = version.provenance.chatId {
                    LabeledContent(String(localized: "Chat")) {
                        chat(chatID)
                    }
                }
                LabeledContent(String(localized: "Machine")) {
                    Text(verbatim: context.machineName).lineLimit(1)
                }
                Label(String(localized: "Recorded by Ruimte. Agents cannot change it."), lucideIcon: "lock", iconSize: 14)
                    .font(.caption).foregroundStyle(MobileStyle.muted)
            }
            Section("Files") {
                OutputFileRows(model: model, version: version)
            }
        }
        .navigationTitle(Text(verbatim: version.label))
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private func chat(_ chatID: String) -> some View {
        if let name = context.chatName(chatID) {
            Text(verbatim: name.isEmpty ? String(localized: "Another chat") : name).lineLimit(1)
        } else if model.chatPresent && chatID == model.latest?.provenance.chatId {
            Text("Another chat")
        } else {
            Text("Chat removed").foregroundStyle(MobileStyle.muted)
        }
    }
}
