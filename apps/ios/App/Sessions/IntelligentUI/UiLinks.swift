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
        return .plain(reason: UiReason.text(reading) ?? String(localized: "Outside the project, shown as text"))
    }

    var isChip: Bool {
        if case .chip = self { return true }
        return false
    }

    var reason: String? {
        if case .plain(let reason) = self { return reason }
        return nil
    }
}

/// What a node is doing, which its chip shows as a dot in the color the rest of the app gives that state. A word a
/// newer machine sends reads as none.
enum UiNodeStatus: String {
    case running, needsYou, done

    @MainActor static func of(_ node: UiNode, context: UiRenderContext) -> Self? {
        guard node.type == "Node" else { return nil }
        return context.model.resolvedLinks[node.id]?["status"]?.stringValue.flatMap(Self.init(rawValue:))
    }

    var color: Color {
        switch self {
        case .running: MobileStyle.statusRunning
        case .needsYou: MobileStyle.statusNeedsYou
        case .done: MobileStyle.statusIdle
        }
    }

    var word: String {
        switch self {
        case .running: String(localized: "Running")
        case .needsYou: String(localized: "Needs you")
        case .done: String(localized: "Done")
        }
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
        // A CodeBlock links as a File by its `file` and `start`, and a Leaf by its `path`.
        case "File", "CodeBlock", "Leaf":
            let path = node.string(node.type == "CodeBlock" ? "file" : "path") ?? ""
            let line = node.number(node.type == "CodeBlock" ? "start" : "line").map { ":\(Int($0))" }
            icon = "file"
            name = UiFormat.baseName(path)
            suffix = line
            full = path + (line ?? "")
            mono = false
        case "Diff", "Change":
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
            return UiReason.text(reading) ?? String(localized: "Outside the project, shown as text")
        } catch is CancellationError {
            return nil
        } catch {
            return String(localized: "Not available right now")
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
                    } else if node.type == "Keys" {
                        UiKeysView(node: node)
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
                .popover(isPresented: $reason.isPresent()) {
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
            } else if node.type == "Keys" {
                value += keys(node)
            } else {
                value += link(node)
            }
        }
        return value
    }

    /// The caps of a shortcut in the sentence that names it, each on a ground of its own.
    private func keys(_ node: UiNode) -> AttributedString {
        var value = AttributedString()
        for cap in UiKeyCaps.caps(node.label) {
            var key = AttributedString("\u{2009}\(cap)\u{2009}")
            key.backgroundColor = MobileStyle.inset
            key.font = .footnote.weight(.medium)
            value += key + AttributedString("\u{200A}")
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
            if let status = UiNodeStatus.of(node, context: context) {
                var dot = AttributedString(" ●")
                dot.foregroundColor = status.color
                dot.font = .caption2
                chip += dot
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
    /// Why the link stays text whatever the machine says of its target, such as an open Diff it would not read.
    var refused: String? = nil
    @State private var reason: String?

    var body: some View {
        let state = refused.map { UiLinkState.plain(reason: $0) } ?? UiLinkState.of(node, context: context)
        Group {
            switch state {
            case .chip(let label):
                let face = UiLinkFace(node, label: label)
                let status = UiNodeStatus.of(node, context: context)
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
                        if let status { Circle().fill(status.color).frame(width: 6, height: 6) }
                    }
                    .foregroundStyle(MobileStyle.text)
                    .padding(.horizontal, 9).frame(minHeight: 28)
                    .background(MobileStyle.inset, in: Capsule())
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(context.host.open == nil)
                .accessibilityLabel(face.full)
                // The dot says the state by its color alone, so the chip says it in words too.
                .accessibilityValue(status?.word ?? "")
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
        .popover(isPresented: $reason.isPresent()) {
            Text(reason ?? "").font(.footnote).padding(12).presentationCompactAdaptation(.popover)
        }
    }
}

/// A link as a row: the chip and, where it has children, what the agent says about it.
struct UiLinkRow: View {
    let node: UiNode
    let context: UiRenderContext
    /// Set while the machine reads what the row is about to show, which puts a spinner behind the chip.
    var reading = false
    var refused: String? = nil

    var body: some View {
        if node.children.isEmpty && !reading {
            UiLinkChip(node: node, context: context, refused: refused)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                UiLinkChip(node: node, context: context, refused: refused).fixedSize()
                if reading {
                    Spinner(size: 12, label: String(localized: "Loading diff")).foregroundStyle(MobileStyle.faint)
                }
                UiNodesView(nodes: node.children, parent: node.type, context: context)
                    .font(.subheadline).foregroundStyle(MobileStyle.muted)
            }
        }
    }
}

/// An address the agent wrote, in an in-app browser when the host has no way of its own to open it. Nothing loads
/// before the tap.
struct UiBrowserSheet: ViewModifier {
    @Binding var url: URL?

    func body(content: Content) -> some View {
        content.sheet(isPresented: $url.isPresent()) {
            if let url { UiSafariView(url: url).ignoresSafeArea() }
        }
    }
}

private struct UiSafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
