import RuimtePulsar
import RuimteShared
import SwiftUI

/// The one card of the app: a group of content straight on the page, without a ground or an edge, held apart by the
/// lines between its rows. Rows inside one pass `padding: 0` and pad themselves. A filled card, for what waits on an
/// answer, is a panel with a radius of 20 and a hairline whose edge stands on the page's margin.
struct MobileCardSurface: ViewModifier {
    var padding: CGFloat = MobileSpacing.cardPadding
    var filled = false

    func body(content: Content) -> some View {
        if filled {
            content
                .padding(padding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(MobileStyle.panel, in: .rect(cornerRadius: MobileMetrics.cardRadius))
                .overlay(RoundedRectangle(cornerRadius: MobileMetrics.cardRadius).strokeBorder(MobileStyle.hairline))
                .padding(.horizontal, MobileSpacing.cardPadding)
        } else {
            content
                .padding(padding)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension View {
    func mobileCard(padding: CGFloat = MobileSpacing.cardPadding, filled: Bool = false) -> some View {
        modifier(MobileCardSurface(padding: padding, filled: filled))
    }
}

/// Stacked content in a card, with the design's gap between its parts.
struct MobileCard<Content: View>: View {
    var spacing: CGFloat = MobileSpacing.medium
    var filled = false
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }.mobileCard(filled: filled)
    }
}

/// The line between two rows of a card, starting where the row's text does: after the glyph column, or at the row's
/// edge for rows without a glyph, such as a setting.
struct MobileRowDivider: View {
    var glyphs = true
    @Environment(\.displayScale) private var displayScale
    @ScaledMetric(relativeTo: .subheadline) private var column = MobileMetrics.statusColumn

    var body: some View {
        MobileStyle.hairline.frame(height: 1 / displayScale)
            .padding(.leading, MobileSpacing.cardPadding + (glyphs ? column + MobileSpacing.medium : 0))
            .accessibilityHidden(true)
    }
}

/// The rows of one group, with a line between two. Each is a row of its own in a list, so a long press lifts only that
/// row into its menu.
struct MobileRowGroup<Item: Identifiable, Row: View>: View {
    let items: [Item]
    var glyphs = true
    @ViewBuilder var row: (Item) -> Row

    var body: some View {
        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
            VStack(spacing: 0) {
                if index > 0 { MobileRowDivider(glyphs: glyphs) }
                row(item)
            }
            .mobileCard(padding: 0)
            .listRowInsets(
                EdgeInsets(
                    top: 0, leading: MobileSpacing.margin - MobileSpacing.cardPadding, bottom: 0,
                    trailing: MobileSpacing.margin - MobileSpacing.cardPadding))
        }
    }
}

/// A row of a card: the status glyph on the title's line, a title with a muted second line, and a trailing value or
/// control. At least `MobileMetrics.rowHeight` high, and taller once Dynamic Type asks for it.
struct MobileStatusRow<Trailing: View>: View {
    let tone: MobileTone
    var symbol: String?
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        MobileCardRow {
            MobileStatusGlyph(tone: tone, symbol: symbol).centeredOnFirstLine(of: .subheadline)
        } text: {
            MobileRowText(title: title, subtitle: subtitle)
        } trailing: {
            trailing
        }
    }
}

/// The frame of a card row: a glyph and a text block on the first baseline, then a trailing part, at least
/// `MobileMetrics.rowHeight` high.
struct MobileCardRow<Glyph: View, Text: View, Trailing: View>: View {
    @ViewBuilder var glyph: Glyph
    @ViewBuilder var text: Text
    @ViewBuilder var trailing: Trailing
    @ScaledMetric(relativeTo: .subheadline) private var height = MobileMetrics.rowHeight

    var body: some View {
        HStack(spacing: MobileSpacing.medium) {
            HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.medium) {
                glyph
                text
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.horizontal, MobileSpacing.cardPadding)
        .padding(.vertical, MobileSpacing.small)
        .frame(maxWidth: .infinity, minHeight: height, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

extension MobileStatusRow where Trailing == MobileRowValue {
    /// A row whose trailing part is a value such as a time or a duration, in tabular digits.
    init(tone: MobileTone, symbol: String? = nil, title: String, subtitle: String? = nil, value: String) {
        self.init(tone: tone, symbol: symbol, title: title, subtitle: subtitle) { MobileRowValue(text: value) }
    }
}

extension MobileStatusRow where Trailing == EmptyView {
    init(tone: MobileTone, symbol: String? = nil, title: String, subtitle: String? = nil) {
        self.init(tone: tone, symbol: symbol, title: title, subtitle: subtitle) { EmptyView() }
    }
}

/// The glyph, title and second line of a `MobileStatusRow` for a row in a list that pads and sizes its rows itself.
/// The glyph is the subject's and says no state, so it stays out of what VoiceOver reads.
struct MobileGlyphLabel: View {
    var tone = MobileTone.idle
    let title: String
    let subtitle: String
    let symbol: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.medium) {
            MobileStatusGlyph(tone: tone, symbol: symbol).centeredOnFirstLine(of: .subheadline)
                .accessibilityHidden(true)
            MobileRowText(title: title, subtitle: subtitle, subtitleTruncation: .middle)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A row's title over its muted second line, each kept to one line.
private struct MobileRowText: View {
    let title: String
    let subtitle: String?
    var subtitleTruncation = Text.TruncationMode.tail

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: title).font(.subheadline).foregroundStyle(MobileStyle.text).lineLimit(1)
            if let subtitle, !subtitle.isEmpty {
                Text(verbatim: subtitle).font(.caption).foregroundStyle(MobileStyle.muted)
                    .lineLimit(1).truncationMode(subtitleTruncation)
            }
        }
    }
}

/// The trailing value of a row: muted, small, and in digits that keep their width while they count.
struct MobileRowValue: View {
    let text: String

    var body: some View {
        Text(verbatim: text).font(.caption).monospacedDigit().foregroundStyle(MobileStyle.muted).lineLimit(1)
    }
}

/// The title of a group with how many it holds, as in "Needs you 2".
struct MobileSectionHeader: View {
    let title: String
    var count: Int?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.small) {
            Text(verbatim: title).font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.text)
            if let count {
                Text(verbatim: Format.number(Double(count))).font(.subheadline).monospacedDigit().foregroundStyle(
                    MobileStyle.muted)
            }
            Spacer(minLength: 0)
        }
        .textCase(nil)
        .listRowInsets(
            EdgeInsets(
                top: MobileSpacing.small, leading: MobileSpacing.margin, bottom: MobileSpacing.xSmall,
                trailing: MobileSpacing.margin)
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
