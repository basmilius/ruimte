import ImageIO
import RuimteIntelligentUI
import RuimtePulsar
import RuimteShared
import SwiftUI

/// The thread's own code view; the highlighter follows the text as it grows, so nothing jumps when the node closes.
struct UiCodeBlockView: View {
    let node: UiNode

    var body: some View {
        let code = node.nodeText.replacingOccurrences(of: #"^\n|\n$"#, with: "", options: .regularExpression)
        CodeMessage(text: code, language: node.complete ? node.string("language") ?? "" : "")
            .uiTile(flat: true, horizontal: 6, vertical: 6)
    }
}

/// An attachment of the chat, read through the chat's resources and never through a path or an address the model
/// wrote. An image of the latest generation stays a quiet square until the daemon resolved it to an attachment.
struct UiImageView: View {
    let node: UiNode
    @Environment(\.chatContent) private var chat

    var body: some View {
        let caption = node.label
        let name = node.altLabel(fallback: String(localized: "Image"))
        VStack(alignment: .leading, spacing: 6) {
            if let attachment = node.string("attachment"), let chat {
                ChatInlineImage(resource: .chatAttachment(chatID: chat.chatID, id: attachment), name: name)
            } else {
                UiMissingImage(reason: String(localized: "The image is not available"), side: 120)
            }
            if !caption.isEmpty {
                Text(caption).font(.caption).foregroundStyle(MobileStyle.muted).padding(.horizontal, 2)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(name)
    }
}

/// The quiet square for an image whose bytes are not there, with the reason a tap away.
struct UiMissingImage: View {
    let reason: String
    var side: CGFloat = 120
    @State private var showing = false

    var body: some View {
        Button {
            showing = true
        } label: {
            Image(lucide: "image-off", size: 20).foregroundStyle(MobileStyle.faint)
                .frame(width: side, height: side)
                .background(UiTileStyle.tile, in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(reason)
        .popover(isPresented: $showing) {
            Text(reason).font(.footnote).padding(12).presentationCompactAdaptation(.popover)
        }
    }
}

/// A square on the ground of a surface for a picture that is loading (no text) or cannot be shown (what it was).
struct UiQuietSquare: View {
    let text: String?

    var body: some View {
        Color.clear.aspectRatio(1, contentMode: .fit)
            .overlay {
                VStack(spacing: 4) {
                    if text == nil {
                        Spinner(size: 14).foregroundStyle(MobileStyle.faint)
                    } else {
                        Image(lucide: "image-off", size: 20).foregroundStyle(MobileStyle.faint)
                    }
                    if let text {
                        Text(verbatim: text).font(.caption).foregroundStyle(MobileStyle.faint).lineLimit(3)
                            .multilineTextAlignment(.center).padding(.horizontal, 6)
                    }
                }
            }
            .background(UiTileStyle.tile, in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
    }
}

/// Images of the chat in a grid of two columns, three once the card is wide enough for them.
struct UiGalleryView: View {
    let node: UiNode
    let context: UiRenderContext
    @Environment(\.chatContent) private var chat
    @State private var wide = false

    private static let wideFrom: CGFloat = 420

    /// The pictures a swipe in the lightbox walks, in the order of the grid.
    private var images: [ChatLightboxImage] {
        guard let chat else { return [] }
        return node.children(of: "Image").compactMap { child in
            guard child.error == nil, let attachment = child.string("attachment") else { return nil }
            return ChatLightboxImage(
                resource: .chatAttachment(chatID: chat.chatID, id: attachment),
                name: child.altLabel(fallback: String(localized: "Image")))
        }
    }

    var body: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: wide ? 3 : 2)
        ChatImageGroupScope(images: images) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                ForEach(node.children.filter { !$0.isText }) { child in
                    if child.type == "Image" && child.error == nil {
                        UiGalleryCell(node: child)
                    } else {
                        UiNodeView(node: child, parent: node.type, context: context)
                    }
                }
            }
        }
        .onGeometryChange(for: Bool.self, of: { $0.size.width >= Self.wideFrom }) { wide = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(String(localized: "\(node.children(of: "Image").count) images"))
    }
}

/// One image of a gallery. A cell that cannot show its picture says what it was, since the square alone tells nothing.
private struct UiGalleryCell: View {
    let node: UiNode
    @Environment(\.chatContent) private var chat

    var body: some View {
        let caption = node.label
        VStack(alignment: .leading, spacing: 4) {
            if let attachment = node.string("attachment"), let chat {
                ChatInlineImage(
                    resource: .chatAttachment(chatID: chat.chatID, id: attachment),
                    name: node.altLabel(fallback: String(localized: "Image")), square: true)
            } else {
                UiQuietSquare(text: node.string("alt") ?? String(localized: "The image is not available"))
            }
            if !caption.isEmpty {
                Text(caption).font(.caption).foregroundStyle(MobileStyle.muted)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// Two attachments in one frame shaped like the first, with the second wiped in from the right of a handle. The
/// split is only this view's state. With one picture gone the other stands alone with the reason.
struct UiCompareView: View {
    let node: UiNode
    @Environment(\.chatContent) private var chat
    @State private var split = 0.5
    @State private var before: UiPicture = .loading
    @State private var after: UiPicture = .loading

    private static let tallest: CGFloat = 384
    private static let loadingShape: CGFloat = 4 / 3

    var body: some View {
        let beforeLabel = node.string("beforeLabel").flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "Before")
        let afterLabel = node.string("afterLabel").flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "After")
        let caption = node.label
        VStack(alignment: .leading, spacing: 6) {
            switch (before, after) {
            case (.image(let first), .image(let second)):
                frame(first, second, beforeLabel: beforeLabel, afterLabel: afterLabel)
            case (.failed, .failed):
                UiMissingImage(reason: String(localized: "The image is not available"), side: 120)
            case (.image(let shown), .failed), (.failed, .image(let shown)):
                Image(uiImage: shown).resizable().scaledToFit().frame(maxWidth: 320, maxHeight: 200)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                Text("One image missing").font(.caption).foregroundStyle(MobileStyle.faint)
            default:
                Color.clear.aspectRatio(Self.loadingShape, contentMode: .fit).frame(maxWidth: 320)
                    .overlay { Spinner(size: 14).foregroundStyle(MobileStyle.faint) }
                    .background(UiTileStyle.tile, in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
                    .accessibilityLabel(String(localized: "Loading image"))
            }
            if !caption.isEmpty {
                Text(caption).font(.caption).foregroundStyle(MobileStyle.muted).padding(.horizontal, 2)
            }
        }
        .task(id: node.string("before")) {
            before = .loading
            let loaded = await load(node.string("before"))
            if !Task.isCancelled { before = loaded }
        }
        .task(id: node.string("after")) {
            after = .loading
            let loaded = await load(node.string("after"))
            if !Task.isCancelled { after = loaded }
        }
    }

    private func frame(_ first: UIImage, _ second: UIImage, beforeLabel: String, afterLabel: String) -> some View {
        let shape = first.size.height > 0 ? max(0.1, min(10, first.size.width / first.size.height)) : Self.loadingShape
        return Color.clear.aspectRatio(shape, contentMode: .fit).frame(maxWidth: Self.tallest * shape)
            .overlay {
                GeometryReader { geometry in
                    let edge = geometry.size.width * split
                    ZStack(alignment: .leading) {
                        // Both sides are cut, since a picture with transparency would show the other one through it.
                        Image(uiImage: second).resizable().scaledToFit().frame(
                            maxWidth: .infinity, maxHeight: .infinity
                        )
                        .mask(alignment: .trailing) { Rectangle().frame(width: max(0, geometry.size.width - edge)) }
                        Image(uiImage: first).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
                            .mask(alignment: .leading) { Rectangle().frame(width: edge) }
                        handle.frame(width: 44).offset(x: edge - 22)
                            .gesture(
                                DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
                                    .onChanged { value in
                                        guard geometry.size.width > 0 else { return }
                                        split = min(1, max(0, value.location.x / geometry.size.width))
                                    })
                    }
                    .coordinateSpace(name: Self.space)
                }
            }
            .overlay(alignment: .top) {
                HStack(alignment: .top) {
                    chip(beforeLabel)
                    Spacer(minLength: 8)
                    chip(afterLabel)
                }
                .padding(8).allowsHitTesting(false).accessibilityHidden(true)
            }
            .background(UiTileStyle.tile)
            .clipShape(RoundedRectangle(cornerRadius: UiTileStyle.radius))
            .accessibilityRepresentation {
                Slider(value: $split, in: 0...1, step: 0.05)
                    .accessibilityLabel(String(localized: "Compare \(beforeLabel) and \(afterLabel)"))
                    .accessibilityValue(Format.percent(split * 100))
            }
    }

    private static let space = "compare"

    private var handle: some View {
        ZStack {
            Rectangle().fill(MobileStyle.text).frame(width: 2).shadow(color: .black.opacity(0.35), radius: 1)
            Image(lucide: "chevrons-left-right", size: 14).foregroundStyle(MobileStyle.panel)
                .frame(width: 28, height: 28).background(MobileStyle.text, in: Circle())
                .shadow(color: .black.opacity(0.35), radius: 3)
        }
        .contentShape(Rectangle())
    }

    /// A chip on the picture gets a ground of its own, since a translucent one would vanish over the image.
    private func chip(_ text: String) -> some View {
        Text(text).font(.caption.weight(.medium)).foregroundStyle(MobileStyle.muted).lineLimit(1)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 6))
    }

    private func load(_ attachment: String?) async -> UiPicture {
        guard let chat, let attachment else { return .failed }
        return await UiPicture.load(attachment: attachment, chat: chat)
    }
}

/// An attachment of the chat as a picture, read through the chat's resources.
enum UiPicture {
    case loading
    case image(UIImage)
    case failed

    @MainActor static func load(attachment: String, chat: ChatContentContext, maxPixel: Int = 1600) async -> Self {
        guard let bytes = try? await chat.client.readResource(.chatAttachment(chatID: chat.chatID, id: attachment))
        else { return .failed }
        let thumbnail = await Task.detached(priority: .utility) {
            ChatThumbnail.image(bytes.data, maxPixel: maxPixel)
        }.value
        return thumbnail.map { .image(UIImage(cgImage: $0)) } ?? .failed
    }
}

/// A picture decoded at most `maxPixel` on its longest side, turned upright; a caller runs it off the main actor.
enum ChatThumbnail {
    static func image(_ data: Data, maxPixel: Int) -> CGImage? {
        CGImageSourceCreateWithData(data as CFData, nil).flatMap { image($0, maxPixel: maxPixel) }
    }

    static func image(at url: URL, maxPixel: Int) -> CGImage? {
        CGImageSourceCreateWithURL(url as CFURL, nil).flatMap { image($0, maxPixel: maxPixel) }
    }

    private static func image(_ source: CGImageSource, maxPixel: Int) -> CGImage? {
        CGImageSourceCreateThumbnailAtIndex(
            source, 0,
            [
                kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: maxPixel,
                kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true,
            ] as CFDictionary)
    }
}

struct UiSourcesView: View {
    let node: UiNode
    let context: UiRenderContext
    @Environment(\.uiInSection) private var inSection

    var body: some View {
        let sources = node.children(of: "Source")
        VStack(alignment: .leading, spacing: 0) {
            Text("Sources").font(.caption.weight(.medium)).foregroundStyle(MobileStyle.muted)
                .padding(.horizontal, inSection ? 0 : 6).padding(.top, 2).padding(.bottom, 4)
                .accessibilityAddTraits(.isHeader)
            ForEach(node.children.filter { !$0.isText }) { child in
                if child.type == "Source" && child.error == nil {
                    UiSourceView(
                        node: child, number: (sources.firstIndex { $0.id == child.id } ?? 0) + 1, context: context)
                } else {
                    UiNodeView(node: child, parent: node.type, context: context)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .uiTile(flat: true, horizontal: 6, vertical: 6)
    }
}

/// A numbered source that opens only after a tap, through the host or an in-app browser, and loads nothing before.
struct UiSourceView: View {
    let node: UiNode
    let number: Int?
    let context: UiRenderContext
    @State private var browsing: URL?
    @Environment(\.uiInSection) private var inSection

    var body: some View {
        let address = node.string("url") ?? ""
        let url = UiLinkDestination.externalURL(address)
        Button {
            guard let url else { return }
            if let open = context.host.openURL { open(url) } else { browsing = url }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                if let number {
                    Text(verbatim: "\(number)").font(.caption.weight(.semibold)).foregroundStyle(MobileStyle.text)
                        .monospacedDigit()
                        .frame(width: 20, height: 20)
                        .background(UiTileStyle.inset, in: RoundedRectangle(cornerRadius: 6))
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text(node.string("title") ?? address).fontWeight(.medium).foregroundStyle(MobileStyle.text)
                    Text(UiFormat.domain(address)).foregroundStyle(MobileStyle.muted).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(.footnote)
            .padding(.horizontal, inSection ? 0 : 6).padding(.vertical, 6).frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(url == nil)
        .accessibilityLabel(node.string("title") ?? address)
        .accessibilityValue(UiFormat.domain(address))
        .accessibilityAddTraits(.isLink)
        .modifier(UiBrowserSheet(url: $browsing))
    }
}
