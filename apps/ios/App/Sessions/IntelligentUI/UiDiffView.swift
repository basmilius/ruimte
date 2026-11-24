import SwiftUI

/// A changed file as a chip. With `open` it shows the change itself once the machine read it from git: the chip
/// waits beside a spinner until then, and stays text with the reason where the machine would not read it. A machine
/// that reads no diffs, a block that still streams and a Diff past the few a block may open leave the chip as it is.
struct UiDiffView: View {
    let node: UiNode
    let context: UiRenderContext
    @State private var contentHeight: CGFloat = 0
    @State private var reason: String?

    /// The tallest the patch stands in its tile, past which it scrolls.
    private static let tallest: CGFloat = 320

    var body: some View {
        switch UiOpenDiff.of(wanted: context.openDiffs.contains(node.id), reading: context.model.diffs[node.id]) {
        case .chip: UiLinkRow(node: node, context: context)
        case .reading: UiLinkRow(node: node, context: context, reading: true)
        case .refused(let reason): UiLinkRow(node: node, context: context, refused: reason)
        case .patch(let patch, let partial): change(patch, partial: partial)
        }
    }

    private func change(_ patch: String, partial: Bool) -> some View {
        let openable = context.host.open != nil && UiLinkState.of(node, context: context).isChip
        return VStack(alignment: .leading, spacing: 8) {
            UiLinkRow(node: node, context: context).padding(.horizontal, 4)
            if patch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("No changes").font(.footnote).foregroundStyle(MobileStyle.muted)
                    .padding(.horizontal, 4).padding(.bottom, 2)
            } else {
                ScrollView(.vertical) {
                    ChatDiffView(diff: patch)
                        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { contentHeight = $0 }
                }
                .scrollBounceBehavior(.basedOnSize, axes: .vertical)
                .frame(height: min(Self.tallest, max(36, contentHeight)))
                .background(UiTileStyle.inset)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            if partial {
                UiFlowLayout(spacing: 8) {
                    Text("Only the first lines are shown.").font(.caption).foregroundStyle(MobileStyle.muted)
                    if openable {
                        Button(String(localized: "Open the whole diff")) {
                            Task { reason = await UiLinkOpening.open(node, context: context) }
                        }
                        .buttonStyle(.mobileCapsuleSmall)
                        .frame(minHeight: 44)
                    }
                }
                .padding(.horizontal, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .uiTile(flat: true, horizontal: 8, vertical: 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(String(localized: "Changes in \(node.string("path") ?? "")"))
        .popover(isPresented: $reason.isPresent()) {
            Text(reason ?? "").font(.footnote).padding(12).presentationCompactAdaptation(.popover)
        }
    }
}
