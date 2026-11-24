import SwiftUI

/// Words from somewhere else, read as written: a line of a log keeps its stars and underscores, and with `mono` its
/// line breaks too. The bar at the leading edge wears the tone, which VoiceOver hears as a word.
struct UiQuoteView: View {
    let node: UiNode

    var body: some View {
        let tone = node.tone ?? .neutral
        let mono = node.bool("mono") == true
        HStack(alignment: .top, spacing: 12) {
            Capsule().fill(UiToneStyle.color(tone)).frame(width: 3).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(mono ? node.nodeText.trimmingCharacters(in: .whitespacesAndNewlines) : node.label)
                    .font(mono ? .system(.footnote, design: .monospaced) : .subheadline)
                    .foregroundStyle(MobileStyle.text).textSelection(.enabled)
                if let source = node.string("source"), !source.isEmpty {
                    Text(source).font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // The bar takes the height of the words, not all the height it is offered.
        .fixedSize(horizontal: false, vertical: true)
        .uiTile(vertical: 10)
        .accessibilityElement(children: .combine)
        .accessibilityValue(UiToneStyle.word(tone))
    }
}

/// The caps of a shortcut that stands alone. In a sentence the same caps are part of its text (`UiInlineRun`).
struct UiKeysView: View {
    let node: UiNode

    var body: some View {
        let caps = UiKeyCaps.caps(node.label)
        HStack(spacing: 2) {
            ForEach(Array(caps.enumerated()), id: \.offset) { _, cap in
                Text(cap).font(.caption.weight(.medium)).foregroundStyle(MobileStyle.text)
                    .padding(.horizontal, 5).frame(minWidth: 22, minHeight: 22)
                    .background(MobileStyle.inset, in: RoundedRectangle(cornerRadius: 5))
                    .overlay { RoundedRectangle(cornerRadius: 5).strokeBorder(MobileStyle.border) }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(UiKeyCaps.spoken(caps))
    }
}
