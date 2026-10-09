import RuimteIntelligentUI
import RuimtePulsar
import SafariServices
import SwiftUI
import UIKit

/// How a File, Diff, Commit or Node reads: a chip the daemon found in the project, or mono text with the reason it
/// is not one. Until the daemon checked it, a link is text without a reason.
enum UiLinkState: Equatable {
    case chip(label: String?)
    case plain(reason: String?)

    @MainActor static func of(_ node: UiNode, context: UiRenderContext) -> Self {
        guard context.model.complete, let reading = context.model.resolvedLinks[node.id] else {
            return .plain(reason: nil)
        }
        if reading["state"] == .string("chip") { return .chip(label: reading["label"]?.stringValue) }
        return .plain(reason: reading["reason"]?.stringValue ?? String(localized: "Outside the project, shown as text"))
    }
}

/// What a link shows: an icon, its short name and the full name a long press offers.
struct UiLinkFace {
    let icon: String
    let name: String
    /// The line of a File, drawn lighter after its name.
    let suffix: String?
    let full: String
    let mono: Bool

    init(_ node: UiNode, label: String?) {
        switch node.type {
        case "File":
            let path = node.string("path") ?? ""
            let line = node.number("line").map { ":\(Int($0))" }
            icon = "file"
            name = UiFormat.baseName(path)
            suffix = line
            full = path + (line ?? "")
            mono = false
        case "Diff":
            let path = node.string("path") ?? ""
            icon = "file-diff"
            name = UiFormat.baseName(path)
            suffix = nil
            full = path
            mono = false
        case "Commit":
            let sha = node.string("sha") ?? ""
            icon = "git-commit-horizontal"
            name = String(sha.prefix(7))
            suffix = nil
            full = label ?? sha
            mono = true
        default:
            let id = node.string("id") ?? ""
            icon = "square-dashed"
            name = label ?? id
            suffix = nil
            full = label ?? id
            mono = false
        }
    }

    /// The whole target as text, for a link that is not a chip.
    var plain: String { mono ? name : full }
}

/// Opens a link the way the daemon resolves it at the tap: the view never hands over a target of its own, and a
/// reading outside this project only says why.
@MainActor enum UiLinkOpening {
    static func open(_ node: UiNode, context: UiRenderContext) async -> String? {
        do {
            let reading = try await context.model.link(nodeID: node.id)
            if let destination = UiLinkDestination.parse(reading, projectID: context.host.projectID) {
                context.host.open?(destination)
                return nil
            }
            return reading["reason"]?.stringValue ?? String(localized: "Outside the project, shown as text")
        } catch {
            return nil
        }
    }

    static func url(_ action: String, node: UiNode) -> URL? {
        var components = URLComponents()
        components.scheme = "ruimte-ui"
        components.host = action
        components.queryItems = [URLQueryItem(name: "node", value: node.id)]
        return components.url
    }
}

/// A run of prose with the tags and links that stand in it, as one text that wraps like a paragraph. Links the agent
/// wrote open only HTTP(S), through the host; anything else stays text.
struct UiInlineRun: View {
    let nodes: [UiNode]
    let parent: String
    let context: UiRenderContext
    @State private var reason: String?
    @State private var browsing: URL?

    var body: some View {
        if nodes.allSatisfy({ !$0.isText || $0.isBlankText }) {
            UiFlowLayout(spacing: 6) {
                ForEach(nodes.filter { !$0.isText }) { node in
                    if node.type == "Tag" {
                        UiTagView(node: node)
                    } else {
                        UiLinkChip(node: node, context: context)
                    }
                }
            }
        } else {
            Text(attributed)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .environment(\.openURL, OpenURLAction(handler: handle))
                .popover(isPresented: Binding(get: { reason != nil }, set: { if !$0 { reason = nil } })) {
                    Text(reason ?? "").font(.footnote).padding(12).presentationCompactAdaptation(.popover)
                }
                .modifier(UiBrowserSheet(url: $browsing))
        }
    }

    private var attributed: AttributedString {
        var value = AttributedString()
        for node in nodes {
            if node.isText {
                let prose = context.written.contains(node.sourceID) && !UiCatalog.literalParents.contains(parent)
                value += prose ? UiProse.parse(node.text) : AttributedString(node.text)
            } else if node.type == "Tag" {
                var tag = AttributedString("\u{2009}\(node.label)\u{2009}")
                let color = UiToneStyle.color(node.tone ?? .neutral)
                tag.foregroundColor = color
                tag.backgroundColor = color.opacity(0.12)
                tag.font = .footnote.weight(.medium)
                value += tag
            } else {
                value += link(node)
            }
        }
        return value
    }

    private func link(_ node: UiNode) -> AttributedString {
        let state = UiLinkState.of(node, context: context)
        switch state {
        case .chip(let label):
            let face = UiLinkFace(node, label: label)
            var chip = AttributedString("\u{2009}\(face.name)")
            chip.font = face.mono ? .system(.subheadline, design: .monospaced) : nil
            if let suffix = face.suffix {
                var line = AttributedString(suffix)
                line.foregroundColor = MobileStyle.muted
                chip += line
            }
            chip += AttributedString("\u{2009}")
            chip.backgroundColor = MobileStyle.inset
            if context.host.open != nil { chip.link = UiLinkOpening.url("link", node: node) }
            return chip
        case .plain(let reason):
            var text = AttributedString(UiLinkFace(node, label: nil).plain)
            text.font = .system(.subheadline, design: .monospaced)
            text.foregroundColor = MobileStyle.muted
            if reason != nil { text.link = UiLinkOpening.url("reason", node: node) }
            return text
        }
    }

    private func handle(_ url: URL) -> OpenURLAction.Result {
        if url.scheme == "ruimte-ui" {
            let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value
            guard let node = nodes.first(where: { $0.id == id }) else { return .discarded }
            if url.host() == "reason", case .plain(let reason) = UiLinkState.of(node, context: context) {
                self.reason = reason
            } else if url.host() == "link" {
                Task { reason = await UiLinkOpening.open(node, context: context) }
            }
            return .handled
        }
        guard let external = UiLinkDestination.externalURL(url.absoluteString) else { return .discarded }
        if let open = context.host.openURL {
            open(external)
        } else {
            browsing = external
        }
        return .handled
    }
}

/// Text an agent wrote in a block, as inline Markdown: emphasis, code and links, and a link only when it is HTTP(S).
enum UiProse {
    static func parse(_ text: String) -> AttributedString {
        var value =
            (try? AttributedString(
                markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
        let runs = value.runs.map {
            (range: $0.range, link: $0.link, code: $0.inlinePresentationIntent?.contains(.code))
        }
        for run in runs {
            if let link = run.link, UiLinkDestination.externalURL(link.absoluteString) == nil {
                value[run.range].link = nil
            }
            if run.code == true { value[run.range].backgroundColor = MobileStyle.inset }
        }
        return value
    }
}

/// A link as a capsule that opens what the daemon resolves at the tap, or mono text with its reason a tap away.
struct UiLinkChip: View {
    let node: UiNode
    let context: UiRenderContext
    @State private var reason: String?

    var body: some View {
        let state = UiLinkState.of(node, context: context)
        Group {
            switch state {
            case .chip(let label):
                let face = UiLinkFace(node, label: label)
                Button {
                    Task { reason = await UiLinkOpening.open(node, context: context) }
                } label: {
                    HStack(spacing: 5) {
                        Image(lucide: face.icon, size: 12).foregroundStyle(MobileStyle.muted)
                        Text(face.name).font(face.mono ? .system(.footnote, design: .monospaced) : .footnote)
                            .lineLimit(1).truncationMode(.middle)
                        if let suffix = face.suffix {
                            Text(suffix).font(.footnote).foregroundStyle(MobileStyle.muted).monospacedDigit()
                        }
                    }
                    .foregroundStyle(MobileStyle.text)
                    .padding(.horizontal, 9).frame(minHeight: 28)
                    .background(MobileStyle.inset, in: Capsule())
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(context.host.open == nil)
                .accessibilityLabel(face.full)
                .accessibilityHint(context.host.open == nil ? "" : String(localized: "Opens in the project"))
                .contextMenu {
                    Button(String(localized: "Copy path"), lucideIcon: "copy") {
                        UIPasteboard.general.string = face.full
                    }
                }
                .transition(.opacity.animation(.easeOut(duration: 0.12)))
            case .plain(let reason):
                let text = Text(UiLinkFace(node, label: nil).plain)
                    .font(.system(.footnote, design: .monospaced)).foregroundStyle(MobileStyle.muted)
                if let reason {
                    Button {
                        self.reason = reason
                    } label: {
                        text.frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(reason)
                } else {
                    text
                }
            }
        }
        .popover(isPresented: Binding(get: { reason != nil }, set: { if !$0 { reason = nil } })) {
            Text(reason ?? "").font(.footnote).padding(12).presentationCompactAdaptation(.popover)
        }
    }
}

/// A link with children is a row: the chip and what the agent says about it.
struct UiLinkRow: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        if node.children.isEmpty {
            UiLinkChip(node: node, context: context).padding(.horizontal, 8)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                UiLinkChip(node: node, context: context).fixedSize()
                UiNodesView(nodes: node.children, parent: node.type, context: context)
                    .font(.subheadline).foregroundStyle(MobileStyle.muted)
            }
            .padding(.horizontal, 8)
        }
    }
}

/// An address the agent wrote, in an in-app browser when the host has no way of its own to open it. Nothing loads
/// before the tap.
struct UiBrowserSheet: ViewModifier {
    @Binding var url: URL?

    func body(content: Content) -> some View {
        content.sheet(isPresented: Binding(get: { url != nil }, set: { if !$0 { url = nil } })) {
            if let url { UiSafariView(url: url).ignoresSafeArea() }
        }
    }
}

private struct UiSafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
