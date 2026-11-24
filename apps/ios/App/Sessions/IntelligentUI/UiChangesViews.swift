import SwiftUI

struct UiChangesView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(node.children.filter { !$0.isText }) { child in
                UiNodeView(node: child, parent: node.type, context: context)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .uiTile(flat: true, horizontal: 6, vertical: 6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(String(localized: "\(node.children(of: "Change").count) changed files"))
    }
}

/// The share of added against removed lines, drawn only; the two numbers beside it say it in words.
private struct UiChangeBar: View {
    let added: Int
    let removed: Int

    private static let width: CGFloat = 40

    var body: some View {
        let total = added + removed
        HStack(spacing: 0) {
            if total > 0 {
                MobileStyle.positive.frame(width: Self.width * CGFloat(added) / CGFloat(total))
                MobileStyle.statusError.frame(width: Self.width * CGFloat(removed) / CGFloat(total))
            }
        }
        .frame(width: Self.width, height: 6, alignment: .leading)
        .background(MobileStyle.text.opacity(0.1))
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }
}

/// One changed file as a row that opens its diff the way a Diff chip does, once the machine says it can. Until then,
/// and for a file it cannot open, the row is text with the reason a tap away. The note stands under the row,
/// outside the button, since its prose may hold a link of its own.
struct UiChangeView: View {
    let node: UiNode
    let context: UiRenderContext
    @State private var reason: String?

    var body: some View {
        let path = node.string("path") ?? ""
        let added = node.number("added").flatMap { Int(exactly: $0) }
        let removed = node.number("removed").flatMap { Int(exactly: $0) }
        let state = node.string("state").flatMap(Self.word)
        let link = UiLinkState.of(node, context: context)
        let openable = link.isChip && context.host.open != nil
        VStack(alignment: .leading, spacing: 0) {
            Button {
                if openable {
                    Task { reason = await UiLinkOpening.open(node, context: context) }
                } else {
                    reason = link.reason
                }
            } label: {
                row(path: path, state: state, added: added, removed: removed, plain: link.reason != nil)
            }
            .buttonStyle(.plain)
            // Not disabled, which would dim every row until the machine checked it.
            .allowsHitTesting(openable || link.reason != nil)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.said(path: path, state: state, added: added, removed: removed))
            .accessibilityHint(openable ? String(localized: "Opens in the project") : link.reason ?? "")
            .accessibilityAddTraits(openable ? .isLink : [])
            if !node.label.isEmpty {
                UiNodesView(nodes: node.children, parent: node.type, context: context)
                    .font(.caption).foregroundStyle(MobileStyle.muted)
                    .padding(.leading, 30).padding(.trailing, 6).padding(.bottom, 6)
            }
        }
        .popover(isPresented: $reason.isPresent()) {
            Text(reason ?? "").font(.footnote).padding(12).presentationCompactAdaptation(.popover)
        }
    }

    private func row(path: String, state: String?, added: Int?, removed: Int?, plain: Bool) -> some View {
        HStack(spacing: 10) {
            Image(lucide: "file", size: 14).foregroundStyle(MobileStyle.muted)
            Text(path).font(.system(.footnote, design: .monospaced))
                .foregroundStyle(plain ? MobileStyle.muted : MobileStyle.text)
                .lineLimit(1).truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let state { Text(state).foregroundStyle(MobileStyle.muted).fixedSize() }
            if added != nil || removed != nil {
                Text(verbatim: "+" + UiFormat.number(Double(added ?? 0))).foregroundStyle(MobileStyle.positive)
                    .fixedSize()
                Text(verbatim: "-" + UiFormat.number(Double(removed ?? 0))).foregroundStyle(MobileStyle.statusError)
                    .fixedSize()
                UiChangeBar(added: added ?? 0, removed: removed ?? 0)
            }
        }
        .font(.caption).monospacedDigit()
        .padding(.horizontal, 6).frame(minHeight: 44).contentShape(Rectangle())
    }

    private static func said(path: String, state: String?, added: Int?, removed: Int?) -> String {
        var parts = [path]
        if let state { parts.append(state) }
        if let added { parts.append(String(localized: "\(added) lines added")) }
        if let removed { parts.append(String(localized: "\(removed) lines removed")) }
        return parts.joined(separator: ", ")
    }

    private static func word(_ state: String) -> String? {
        switch state {
        case "added": String(localized: "New")
        case "modified": String(localized: "Changed")
        case "deleted": String(localized: "Deleted")
        case "renamed": String(localized: "Renamed")
        default: nil
        }
    }
}
