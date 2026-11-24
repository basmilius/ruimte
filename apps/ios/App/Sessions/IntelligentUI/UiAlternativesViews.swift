import SwiftUI

/// Cards stacked in a narrow block and side by side in a wider one; three stand in one row only where the block is
/// wide enough for them.
struct UiAlternativesView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let count = node.children(of: "Alternative").count
        UiColumnsLayout(columns: { width in
            count == 3 && width >= UiBlockWidth.three ? 3 : width >= UiBlockWidth.two ? 2 : 1
        }) {
            ForEach(node.children.filter { !$0.isText }) { child in
                UiNodeView(node: child, parent: node.type, context: context)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(String(localized: "\(count) options"))
    }
}

/// It only shows: a person chooses with a Choice under it. The description and the points come in the order they
/// were written.
struct UiAlternativeView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let title = node.string("title") ?? ""
        let recommended = node.bool("recommended") == true
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                if recommended { UiPill(text: String(localized: "Recommended"), pill: .accent) }
            }
            UiNodesView(nodes: node.children, parent: node.type, context: context, spacing: 6)
                .font(.subheadline).foregroundStyle(MobileStyle.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .uiTile()
        .overlay {
            if recommended {
                RoundedRectangle(cornerRadius: UiTileStyle.radius).strokeBorder(MobileStyle.accent, lineWidth: 2)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// A point for or against an Alternative. The sign says which, and VoiceOver hears it as a word.
struct UiPointView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let pro = node.type == "Pro"
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(lucide: pro ? "plus" : "minus", size: 12)
                .foregroundStyle(pro ? MobileStyle.positive : MobileStyle.statusError)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                .accessibilityLabel(pro ? String(localized: "For:") : String(localized: "Against:"))
            UiNodesView(nodes: node.children, parent: node.type, context: context)
                .font(.footnote).foregroundStyle(MobileStyle.text)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}
