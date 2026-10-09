import RuimteIntelligentUI
import RuimtePulsar
import SwiftUI

/// The thread's own code view; the highlighter follows the text as it grows, so nothing jumps when the node closes.
struct UiCodeBlockView: View {
    let node: UiNode

    var body: some View {
        let code = node.nodeText.replacingOccurrences(of: #"^\n|\n$"#, with: "", options: .regularExpression)
        CodeMessage(text: code, language: node.complete ? node.string("language") ?? "" : "")
    }
}

/// An attachment of the chat, read through the chat's resources and never through a path or an address the model
/// wrote. An image of the latest generation stays a quiet square until the daemon resolved it to an attachment.
struct UiImageView: View {
    let node: UiNode
    @Environment(\.chatContent) private var chat

    var body: some View {
        let caption = node.label
        let name = node.string("alt") ?? (caption.isEmpty ? String(localized: "Image") : caption)
        VStack(alignment: .leading, spacing: 6) {
            if let attachment = node.string("attachment"), let chat {
                ChatInlineImage(
                    resource: .object([
                        "kind": .string("attachment"), "chatId": .string(chat.chatID),
                        "attachmentId": .string(attachment),
                    ]), name: name)
            } else {
                UiMissingImage(reason: String(localized: "The image is not available"), side: 120)
            }
            if !caption.isEmpty {
                Text(caption).font(.footnote).foregroundStyle(MobileStyle.muted).padding(.horizontal, 8)
            }
        }
        .padding(.horizontal, 8)
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
                .background(MobileStyle.hover, in: RoundedRectangle(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(reason)
        .popover(isPresented: $showing) {
            Text(reason).font(.footnote).padding(12).presentationCompactAdaptation(.popover)
        }
    }
}

struct UiSourcesView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let sources = node.children(of: "Source")
        VStack(alignment: .leading, spacing: 0) {
            Text("Sources").font(.footnote.weight(.medium)).foregroundStyle(MobileStyle.muted)
                .padding(.horizontal, 8).padding(.bottom, 2)
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
    }
}

/// A numbered source that opens only after a tap, through the host or an in-app browser, and loads nothing before.
struct UiSourceView: View {
    let node: UiNode
    let number: Int?
    let context: UiRenderContext
    @State private var browsing: URL?

    var body: some View {
        let address = node.string("url") ?? ""
        let url = UiLinkDestination.externalURL(address)
        Button {
            guard let url else { return }
            if let open = context.host.openURL { open(url) } else { browsing = url }
        } label: {
            HStack(spacing: 8) {
                if let number {
                    Text(verbatim: "\(number)").foregroundStyle(MobileStyle.faint).monospacedDigit()
                        .frame(minWidth: 18, alignment: .trailing)
                }
                Text(node.string("title") ?? address).foregroundStyle(MobileStyle.text).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(UiFormat.domain(address)).foregroundStyle(MobileStyle.faint).lineLimit(1)
                if url != nil { Image(lucide: "arrow-up-right", size: 12).foregroundStyle(MobileStyle.faint) }
            }
            .font(.footnote)
            .padding(.horizontal, 8).frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(url == nil)
        .accessibilityLabel(node.string("title") ?? address)
        .accessibilityValue(UiFormat.domain(address))
        .accessibilityAddTraits(.isLink)
        .modifier(UiBrowserSheet(url: $browsing))
    }
}
