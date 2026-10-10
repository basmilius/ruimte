import CoreTransferable
import ImageIO
import QuickLook
import RuimteIntelligentUI
import RuimtePulsar
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The row of an `ImageGeneration` tool item: a result a person wants to see, so it never folds. The image takes the
/// shape its metadata gives before the bytes arrive, so the row never jumps, and the prompt stays in the image's menu
/// as Copy prompt. Bytes come only from the chat's attachment, never from a path in the tool's output.
struct GeneratedImageRow: View {
    let item: JSONValue
    /// Saves the attachment into the project through the host's own picker and returns the path it chose, or nil
    /// when the person canceled. Left out, Save to project is not offered.
    var saveToProject: (@MainActor (_ attachment: JSONValue) async throws -> String?)?

    var body: some View {
        switch UiGeneratedImage.parse(item) {
        case .generating:
            GeneratedImageHeader(icon: "image", title: String(localized: "Generating image"), detail: nil, live: true)
        case .failed(let failure):
            GeneratedImageFailure(reason: Self.reason(failure))
        case .ready(let attachment, let prompt, let transparent):
            GeneratedImageReady(
                attachment: attachment, prompt: prompt, transparent: transparent, saveToProject: saveToProject)
        }
    }

    private static func reason(_ failure: UiGeneratedImage.Failure) -> String? {
        switch failure {
        case .provider(let message): message
        case .empty: String(localized: "The image came back empty")
        case .notImage: String(localized: "The result is not an image")
        case .tooLarge:
            String(
                localized: "The image is larger than \(mobileByteCount(Double(UiGeneratedImage.maxBytes), whole: true))"
            )
        }
    }
}

private struct GeneratedImageHeader: View {
    let icon: String
    let title: String
    let detail: String?
    var live = false
    var failed = false

    var body: some View {
        HStack(spacing: 8) {
            Image(lucide: icon, size: 14)
                .foregroundStyle(failed ? MobileStyle.statusError : live ? MobileStyle.accent : MobileStyle.muted)
            ChatLiveLabel(text: title, active: live)
                .foregroundStyle(failed ? MobileStyle.statusError : MobileStyle.muted)
                .layoutPriority(1)
            if let detail {
                Text(detail).foregroundStyle(MobileStyle.faint).monospacedDigit().lineLimit(1)
            }
        }
        .font(.footnote)
        .frame(minHeight: 32, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// A failed generation reads like a failed tool line, with the reason under it that a tap unfolds.
private struct GeneratedImageFailure: View {
    let reason: String?
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            GeneratedImageHeader(
                icon: "circle-alert", title: String(localized: "Image generation failed"), detail: nil, failed: true)
            if let reason {
                Button {
                    open.toggle()
                } label: {
                    Text(reason).font(.footnote).foregroundStyle(MobileStyle.muted).lineLimit(open ? nil : 2)
                        .multilineTextAlignment(.leading).padding(.leading, 22)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityValue(open ? String(localized: "Expanded") : String(localized: "Collapsed"))
            }
        }
    }
}

private struct GeneratedImageReady: View {
    let attachment: JSONValue
    let prompt: String?
    let transparent: Bool
    let saveToProject: (@MainActor (JSONValue) async throws -> String?)?
    @Environment(\.chatContent) private var chat
    /// Only the picture the row draws; the bytes are read again for Open large, Share and Save, so a long thread
    /// does not hold every image whole.
    @State private var thumbnail: UIImage?
    @State private var missing: String?
    @State private var preview: URL?
    @State private var previewFolder: URL?
    @State private var opening = false
    @State private var saving = false
    @State private var savedFlash = false
    @State private var savedPath: String?
    @State private var problem: String?

    private var name: String {
        let raw = URL(fileURLWithPath: attachment["name"]?.stringValue ?? "").lastPathComponent
        return raw.isEmpty || raw == "." || raw == ".." ? "generated-image.png" : raw
    }

    private var details: String {
        var parts: [String] = []
        if let width = attachment["width"]?.numberValue, let height = attachment["height"]?.numberValue {
            parts.append("\(Int(width)) × \(Int(height))")
        }
        if let size = attachment["size"]?.numberValue { parts.append(mobileAttachmentSize(size)) }
        if transparent { parts.append(String(localized: "transparent")) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeneratedImageHeader(icon: "image", title: String(localized: "Generated image"), detail: details)
            picture
                .overlay(alignment: .topTrailing) { controls }
                .contextMenu { actions }
            if savedFlash {
                Label(String(localized: "Saved"), lucideIcon: "check", iconSize: 12)
                    .font(.footnote).foregroundStyle(MobileStyle.statusIdle)
            } else if let savedPath {
                Text("Saved to \(savedPath)").font(.footnote).foregroundStyle(MobileStyle.muted).lineLimit(2)
                    .truncationMode(.middle)
            }
            if let problem { Text(problem).font(.footnote).foregroundStyle(MobileStyle.statusError) }
        }
        .quickLookPreview($preview)
        .onChange(of: preview) { _, url in
            if url == nil { removePreviewFolder() }
        }
        .onDisappear {
            preview = nil
            removePreviewFolder()
        }
        .task(id: attachment["id"]) { await load() }
    }

    @ViewBuilder private var picture: some View {
        let aspect = UiGeneratedImage.aspect(attachment) ?? 1
        Button {
            Task { await openLarge() }
        } label: {
            ZStack {
                if transparent { UiCheckerboard() } else { MobileStyle.hover }
                if let thumbnail {
                    Image(uiImage: thumbnail).resizable().aspectRatio(contentMode: .fit)
                } else if missing != nil {
                    Image(lucide: "image-off", size: 20).foregroundStyle(MobileStyle.faint)
                } else {
                    ProgressView()
                }
            }
            .aspectRatio(aspect, contentMode: .fit)
            .frame(maxWidth: 360, alignment: .leading)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14).strokeBorder(MobileStyle.border)
            }
        }
        .buttonStyle(.plain)
        .disabled(thumbnail == nil)
        .accessibilityLabel(prompt ?? String(localized: "Generated image"))
        .accessibilityHint(missing ?? String(localized: "Open large"))
        .accessibilityAddTraits(.isImage)
    }

    /// Over the corner, always there on a touch screen: Open large and the menu of the image.
    private var controls: some View {
        GlassEffectContainer(spacing: 6) {
            HStack(spacing: 6) {
                Button {
                    Task { await openLarge() }
                } label: {
                    Image(lucide: "maximize-2", size: 14).frame(width: 44, height: 44)
                }
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel(String(localized: "Open large"))
                Menu {
                    actions
                } label: {
                    Image(lucide: "ellipsis", size: 14).frame(width: 44, height: 44)
                }
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel(String(localized: "Image actions"))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(MobileStyle.text)
        .padding(6)
        .disabled(thumbnail == nil)
        .opacity(thumbnail == nil ? 0 : 1)
    }

    @ViewBuilder private var actions: some View {
        Button(String(localized: "Open large"), lucideIcon: "maximize-2") { Task { await openLarge() } }
            .disabled(thumbnail == nil)
        if let thumbnail, let read = reader {
            ShareLink(
                item: GeneratedImageFile(
                    name: name, type: UTType(mimeType: attachment["mime"]?.stringValue ?? ""), data: read),
                preview: SharePreview(name, image: Image(uiImage: thumbnail))
            ) {
                Label(String(localized: "Share"), lucideIcon: "share")
            }
        }
        if saveToProject != nil {
            Button(String(localized: "Save to project…"), lucideIcon: "folder-down") { save() }
                .disabled(thumbnail == nil || saving)
        }
        if let prompt {
            Button(String(localized: "Copy prompt"), lucideIcon: "copy") { UIPasteboard.general.string = prompt }
        }
    }

    /// Reads the attachment's bytes from the machine; nil without a chat to read it from.
    private var reader: (@Sendable @MainActor () async throws -> Data)? {
        guard let chat, let id = attachment["id"]?.stringValue else { return nil }
        let client = chat.client
        let resource: JSONValue = .object([
            "kind": .string("attachment"), "chatId": .string(chat.chatID), "attachmentId": .string(id),
        ])
        return { try await client.readResource(resource).data }
    }

    private func load() async {
        guard thumbnail == nil, let read = reader else {
            if chat == nil { missing = String(localized: "The image is not available") }
            return
        }
        do {
            let data = try await read()
            try Task.checkCancellation()
            let image = await Task.detached(priority: .utility) { Self.downsample(data) }.value
            try Task.checkCancellation()
            guard let image else {
                missing = String(localized: "The image is not available")
                return
            }
            thumbnail = image
            missing = nil
        } catch is CancellationError {
        } catch {
            missing = error.localizedDescription
        }
    }

    private nonisolated static func downsample(_ data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let image = CGImageSourceCreateThumbnailAtIndex(
                source, 0,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 1200,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                ] as CFDictionary)
        else { return nil }
        return UIImage(cgImage: image)
    }

    /// Full screen with zoom and the system's share and save, from a copy that goes when the preview closes.
    private func openLarge() async {
        guard thumbnail != nil, preview == nil, !opening, let read = reader else { return }
        opening = true
        defer { opening = false }
        do {
            let bytes = try await read()
            let folder = FileManager.default.temporaryDirectory.appending(
                path: "ruimte-image-\(UUID().uuidString)", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            previewFolder = folder
            let url = folder.appendingPathComponent(name)
            try bytes.write(to: url, options: [.atomic, .completeFileProtection])
            preview = url
        } catch {
            removePreviewFolder()
            if !(error is CancellationError) { problem = error.localizedDescription }
        }
    }

    private func removePreviewFolder() {
        guard let previewFolder else { return }
        try? FileManager.default.removeItem(at: previewFolder)
        self.previewFolder = nil
    }

    private func save() {
        guard let saveToProject, !saving else { return }
        saving = true
        problem = nil
        Task {
            defer { saving = false }
            do {
                guard let path = try await saveToProject(attachment) else { return }
                savedPath = path
                savedFlash = true
                try? await Task.sleep(for: .seconds(2))
                savedFlash = false
            } catch {
                problem = error.localizedDescription
            }
        }
    }
}

/// The image as a file for the share sheet, in the type the attachment says it is, so Save Image and other apps
/// take it as that image.
private struct GeneratedImageFile: Transferable {
    let name: String
    let type: UTType?
    /// Read only once the person picks where the image goes.
    let data: @Sendable @MainActor () async throws -> Data

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { try await $0.data() }
            .exportingCondition { $0.type == .png || $0.type == nil }
            .suggestedFileName { $0.name }
        DataRepresentation(exportedContentType: .jpeg) { try await $0.data() }
            .exportingCondition { $0.type == .jpeg }
            .suggestedFileName { $0.name }
        DataRepresentation(exportedContentType: .webP) { try await $0.data() }
            .exportingCondition { $0.type == .webP }
            .suggestedFileName { $0.name }
        DataRepresentation(exportedContentType: .image) { try await $0.data() }
            .exportingCondition { ![UTType.png, .jpeg, .webP].contains($0.type ?? .png) }
            .suggestedFileName { $0.name }
    }
}

/// The ground under a transparent image: a board of two of the app's own surfaces.
struct UiCheckerboard: View {
    var body: some View {
        Canvas { graphics, size in
            let side: CGFloat = 8
            graphics.fill(Path(CGRect(origin: .zero, size: size)), with: .color(MobileStyle.panel))
            for row in 0..<Int((size.height / side).rounded(.up)) {
                for column in 0..<Int((size.width / side).rounded(.up)) where (row + column).isMultiple(of: 2) {
                    let square = CGRect(x: CGFloat(column) * side, y: CGFloat(row) * side, width: side, height: side)
                    graphics.fill(Path(square), with: .color(MobileStyle.hover))
                }
            }
        }
        .accessibilityHidden(true)
    }
}
