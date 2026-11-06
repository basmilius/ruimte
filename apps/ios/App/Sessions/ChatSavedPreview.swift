import PDFKit
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

/// What the thread draws of a version an agent or a routine saved, so its reply need not repeat it, as the desktop's
/// `savedPreviewOf` decides it.
enum ChatSavedPreview: Equatable {
    case page(file: Int)
    case markdown(file: Int)
    case code(file: Int)
    case image(file: Int)
    case pdf(file: Int)

    /// Past this a file read whole is read only when a person opens it, so a long thread never pulls megabytes.
    static let maxBytes: Double = 256 * 1024

    /// The images of a version the thread shows at most.
    static let maxImages = 4

    /// The first file there is something to show of, by what the file is, or nil when the version stays a row. What
    /// a person saved from the thread is already in it.
    static func of(_ version: OutputVersion) -> ChatSavedPreview? {
        guard version.provenance.maker != .person else { return nil }
        for (index, file) in version.files.enumerated() {
            let view = OutputFileView(file)
            guard view.inline else { continue }
            // An image is drawn lazily; everything else is read whole.
            if view != .image && file.bytes > maxBytes { return nil }
            switch view {
            case .page: return .page(file: index)
            case .markdown: return .markdown(file: index)
            case .code: return .code(file: index)
            case .image: return .image(file: index)
            case .pdf: return .pdf(file: index)
            default: continue
            }
        }
        return nil
    }
}

/// How a file of a version is drawn, decided by what the file is and never by the item's kind, as the desktop's
/// `fileViewOf`.
enum OutputFileView: Equatable {
    case page, markdown, code, image, video, audio, pdf, model, none

    private static let images: Set<String> = [
        "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/heic", "image/heif", "image/bmp",
        "image/x-icon", "image/tiff", "image/svg+xml",
    ]
    private static let videos: Set<String> = [
        "video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/ogg",
    ]
    private static let sounds: Set<String> = [
        "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/flac", "audio/ogg",
    ]
    private static let models: Set<String> = ["model/gltf-binary", "model/vnd.usdz+zip", "model/stl"]
    /// The text types the machine names from a file's extension once its bytes read as UTF-8.
    private static let texts: Set<String> = ["application/json", "application/xml", "application/yaml"]

    init(_ file: OutputFile) {
        let mime = file.mime
        let name = file.shortName.lowercased()
        let extensionName = name.contains(".") ? String(name[name.index(after: name.lastIndex(of: ".")!)...]) : ""
        if Self.images.contains(mime) {
            self = .image
        } else if Self.videos.contains(mime) {
            self = .video
        } else if Self.sounds.contains(mime) {
            self = .audio
        } else if mime == "application/pdf" {
            self = .pdf
        } else if Self.models.contains(mime) {
            self = .model
        } else if !(mime.hasPrefix("text/") || Self.texts.contains(mime)) || file.bytes > WireConstants.bytesReadMaxBytes {
            self = .none
        } else if mime == "text/html" || ["html", "htm"].contains(extensionName) {
            self = .page
        } else if mime == "text/markdown" || ["md", "mdx", "markdown"].contains(extensionName) {
            self = .markdown
        } else {
            self = .code
        }
    }

    var inline: Bool { [.page, .markdown, .code, .image, .pdf].contains(self) }
}

/// What a saved version holds, under its row in the thread. A text folds at 320 points with Show all, a PDF shows a
/// short window on its pages, a page runs in the sandboxed web view a visual does, and images open the item. A file
/// that cannot be read leaves only the row above it, which opens it in Output.
struct ChatSavedPreviewView: View {
    let entry: ChatSavedVersion
    let preview: ChatSavedPreview
    let client: any MachineRequesting
    let open: () -> Void

    var body: some View {
        Group {
            switch preview {
            case .markdown(let file): ChatSavedText(entry: entry, file: file, markdown: true, read: read)
            case .code(let file): ChatSavedText(entry: entry, file: file, markdown: false, read: read)
            case .page(let file): ChatSavedPage(entry: entry, file: file, read: read)
            case .pdf(let file): ChatSavedPDF(entry: entry, file: file, read: read)
            case .image: ChatSavedImages(entry: entry, read: read, open: open)
            }
        }
        .padding(.top, 4).padding(.bottom, 8)
    }

    private func read(_ file: Int) async throws -> Data {
        let resource: JSONValue = .object([
            "kind": .string("artifact"), "artifactId": .string(entry.artifactID),
            "versionId": .string(entry.version.id), "file": .number(Double(file)),
        ])
        return try await client.readResource(resource, maxBytes: max(Int(entry.version.files[file].size), 1)).data
    }
}

/// Folds or unfolds a preview, under it.
private struct ChatSavedShowAll: View {
    @Binding var open: Bool

    var body: some View {
        Button {
            open.toggle()
        } label: {
            Label {
                Text(open ? "Show less" : "Show all")
            } icon: {
                Image(lucide: "chevron-down", size: 12).rotationEffect(.degrees(open ? 180 : 0))
            }
            .labelStyle(UiSmallIconLabel())
            .font(.footnote).foregroundStyle(MobileStyle.muted)
            .frame(minHeight: 32).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct ChatSavedText: View {
    let entry: ChatSavedVersion
    let file: Int
    let markdown: Bool
    let read: (Int) async throws -> Data
    @State private var text: String?
    @State private var open = false
    @State private var long = false

    private static let folded: CGFloat = 320

    var body: some View {
        if let text {
            VStack(alignment: .leading, spacing: 4) {
                content(text)
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: Bool.self, of: { $0.size.height > Self.folded + 1 }) { long = $0 }
                    .frame(maxHeight: open ? nil : Self.folded, alignment: .top)
                    .clipped()
                    // A folded text fades out at the bottom instead of cutting a line in half.
                    .mask {
                        LinearGradient(
                            stops: [.init(color: .black, location: 0.7), .init(color: long && !open ? .clear : .black, location: 1)],
                            startPoint: .top, endPoint: .bottom)
                    }
                    .background(MobileStyle.surface, in: RoundedRectangle(cornerRadius: 8))
                    .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(MobileStyle.border) }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text(verbatim: entry.title))
                if long { ChatSavedShowAll(open: $open) }
            }
        } else {
            Color.clear.frame(height: 0)
                .task(id: entry.version.id) {
                    guard let data = try? await read(file) else { return }
                    text = String(decoding: data, as: UTF8.self)
                }
        }
    }

    @ViewBuilder private func content(_ text: String) -> some View {
        if markdown {
            MarkdownMessage(text: text).font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16).padding(.vertical, 12)
        } else {
            ScrollView(.horizontal) {
                Text(verbatim: text).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                    .padding(.horizontal, 12).padding(.vertical, 8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A page saved to Output, at the height it takes, in the same sandboxed web view a visual reply runs in.
private struct ChatSavedPage: View {
    let entry: ChatSavedVersion
    let file: Int
    let read: (Int) async throws -> Data
    @State private var failed = false
    @State private var height: Double = ChatVisualContract.minHeight

    var body: some View {
        if !failed {
            ChatVisualContent(
                visual: ChatVisual(id: "saved-\(entry.version.id)", title: entry.title, at: entry.version.created),
                failed: $failed, read: { try await read(file) },
                onHeight: { measured, _ in
                    height = min(ChatVisualContract.maxHeight, max(ChatVisualContract.minHeight, measured))
                }
            )
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(MobileStyle.border) }
        }
    }
}

/// PDFKit scrolls its own pages, so folded is a shorter window on them and Show all a taller one.
private struct ChatSavedPDF: View {
    let entry: ChatSavedVersion
    let file: Int
    let read: (Int) async throws -> Data
    @State private var document: PDFDocument?
    @State private var open = false
    @State private var page = 1

    var body: some View {
        if let document {
            VStack(alignment: .leading, spacing: 4) {
                FilePDFView(document: document, page: $page)
                    .frame(height: open ? 720 : 320)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(MobileStyle.border) }
                    .accessibilityLabel(Text(verbatim: entry.title))
                ChatSavedShowAll(open: $open)
            }
        } else {
            Color.clear.frame(height: 0)
                .task(id: entry.version.id) {
                    guard let data = try? await read(file) else { return }
                    document = PDFDocument(data: data)
                }
        }
    }
}

/// Up to four images of the version side by side, each opening the item.
private struct ChatSavedImages: View {
    let entry: ChatSavedVersion
    let read: (Int) async throws -> Data
    let open: () -> Void
    @State private var images: [(index: Int, image: UIImage)] = []

    var body: some View {
        UiFlowLayout(spacing: 8) {
            ForEach(images, id: \.index) { shown in
                Button(action: open) {
                    Image(uiImage: shown.image).resizable().scaledToFit()
                        .frame(maxWidth: shown.image.size.width, maxHeight: 320)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: entry.version.files[shown.index].shortName))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: entry.version.id) {
            let indices = entry.version.files.indices.filter { entry.version.files[$0].isImage }
                .prefix(ChatSavedPreview.maxImages)
            for index in indices {
                guard let data = try? await read(index), let image = UIImage(data: data) else { continue }
                guard !Task.isCancelled else { return }
                images.append((index, image))
            }
        }
    }
}
