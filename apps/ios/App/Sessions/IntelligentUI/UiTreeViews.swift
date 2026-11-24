import SwiftUI

private enum UiTreeRow {
    /// Lower than the 44 points a lone control gets, so a tree of thirty files stays one screen.
    static let height: CGFloat = 36
    static let indent: CGFloat = 16
    static let font = Font.system(.footnote, design: .monospaced)
}

struct UiTreeView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        UiNodesView(nodes: node.children, parent: node.type, context: context, spacing: 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .uiTile(flat: true, vertical: 6)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(String(localized: "Tree"))
    }
}

/// Open unless it arrives closed; what a person folds stays folded while the block is kept.
struct UiBranchView: View {
    let node: UiNode
    let context: UiRenderContext
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let key = "branch:\(node.id)"
        let open = context.local.flag(key) ?? (node.bool("open") != false)
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) { context.local.setFlag(key, !open) }
            } label: {
                HStack(spacing: 8) {
                    Image(lucide: open ? "folder-open" : "folder", size: 14).foregroundStyle(MobileStyle.muted)
                        .accessibilityHidden(true)
                    Text(node.string("label") ?? "").font(UiTreeRow.font).foregroundStyle(MobileStyle.text)
                        .lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: UiTreeRow.height).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(open ? String(localized: "Expanded") : String(localized: "Collapsed"))
            if open {
                UiNodesView(nodes: node.children, parent: node.type, context: context, spacing: 0)
                    .padding(.leading, UiTreeRow.indent)
            }
        }
    }
}

/// Named by its children, or by its file without them. With a path the machine can open, the row opens it as a File
/// link does; one it cannot stays the same text, since a tree shows a structure before it links.
struct UiLeafView: View {
    let node: UiNode
    let context: UiRenderContext
    @State private var reason: String?

    var body: some View {
        let path = node.string("path")
        let openable = path != nil && context.host.open != nil && UiLinkState.of(node, context: context).isChip
        Group {
            if openable {
                Button {
                    Task { reason = await UiLinkOpening.open(node, context: context) }
                } label: {
                    row(path: path).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint(String(localized: "Opens in the project"))
            } else {
                row(path: path)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(UiToneStyle.word(node.tone))
        .popover(isPresented: $reason.isPresent()) {
            Text(reason ?? "").font(.footnote).padding(12).presentationCompactAdaptation(.popover)
        }
    }

    private func row(path: String?) -> some View {
        let written = node.label
        return HStack(spacing: 8) {
            Group {
                if path == nil {
                    Circle().fill(MobileStyle.faint).frame(width: 4, height: 4)
                } else {
                    Image(lucide: "file", size: 14).foregroundStyle(MobileStyle.muted)
                }
            }
            .frame(width: 14, height: 14).accessibilityHidden(true)
            Text(written.isEmpty ? path.map(UiFormat.baseName) ?? "" : written).font(UiTreeRow.font)
                .foregroundStyle(node.tone.map(UiToneStyle.color) ?? MobileStyle.text)
                .lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 8)
            if let detail = node.string("detail"), !detail.isEmpty {
                Text(detail).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
            }
        }
        .frame(minHeight: UiTreeRow.height)
    }
}
