import RuimteShared
import SwiftUI

/// A track with the value's share filled in the accent and, where one is given, a mark across it that stands out
/// above and below the track.
private struct UiMeterBar: View {
    let fraction: Double
    let mark: Double?

    private static let track: CGFloat = 6
    private static let height: CGFloat = 12

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(MobileStyle.text.opacity(0.1)).frame(height: Self.track)
                Capsule().fill(MobileStyle.accent).frame(width: geometry.size.width * fraction, height: Self.track)
                if let mark {
                    Capsule().fill(MobileStyle.text).frame(width: 2, height: Self.height)
                        .offset(x: max(0, geometry.size.width * mark - 1))
                }
            }
            .frame(height: Self.height)
        }
        .frame(height: Self.height)
    }
}

/// A value against its limit, unlike Progress no word on work that runs. The tone colors the reading and gives it
/// the tone's icon; the bar stays the accent. Without a max the value stands alone, as a percentage would.
struct UiMeterView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let value = node.number("value") ?? 0
        let limit = node.number("max")
        let unit = node.string("unit")
        let figure = UiFormat.withUnit(UiFormat.number(value), unit)
        let bound = limit.map { UiFormat.withUnit(UiFormat.number($0), unit) }
        let mark = node.number("mark")
        let tone = node.tone.flatMap { $0 == .neutral ? nil : $0 }
        let label = node.label
        let said = [
            bound.map { String(localized: "\(figure) of \($0)") } ?? figure,
            mark.map { String(localized: "mark at \(UiFormat.withUnit(UiFormat.number($0), unit))") } ?? "",
            UiToneStyle.word(tone),
        ]
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                UiNodesView(nodes: node.children, parent: node.type, context: context)
                    .font(.subheadline).foregroundStyle(MobileStyle.muted)
                Spacer(minLength: 0)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    if let tone { UiToneIcon(tone: tone) }
                    Text(figure).fontWeight(.semibold)
                        .foregroundStyle(tone.map(UiToneStyle.color) ?? MobileStyle.text)
                    if let bound {
                        Text("of \(bound)", comment: "After a meter's value: of its maximum")
                            .foregroundStyle(MobileStyle.muted)
                    }
                }
                .font(.subheadline).monospacedDigit().lineLimit(1)
                .accessibilityHidden(true)
            }
            UiMeterBar(fraction: Self.share(value, of: limit), mark: mark.map { Self.share($0, of: limit) })
                .accessibilityElement()
                .accessibilityLabel(label.isEmpty ? String(localized: "Meter") : label)
                .accessibilityValue(said.filter { !$0.isEmpty }.joined(separator: ", "))
            if let detail = node.string("detail"), !detail.isEmpty {
                Text(detail).font(.caption).foregroundStyle(MobileStyle.muted)
            }
        }
        .uiTile(flat: true)
    }

    private static func share(_ value: Double, of limit: Double?) -> Double {
        min(1, max(0, value / (limit ?? 100)))
    }
}

/// One bar divided by the values of its parts, and under it what each part is and its share. A part wears the next
/// color of the chart palette, or its tone. VoiceOver hears the parts as one list with every value in it.
struct UiPartsView: View {
    let node: UiNode
    let context: UiRenderContext

    private struct Slice: Identifiable {
        let id: String
        let name: String
        let share: String
        let value: Double
        let color: Color
        let said: String
    }

    private static let gap: CGFloat = 2

    var body: some View {
        let unit = node.string("unit")
        let parts = Array(node.children(of: "Part").prefix(UiChartPalette.colors.count))
        let total = parts.reduce(0) { $0 + max(0, $1.number("value") ?? 0) }
        let slices = parts.enumerated().map { index, part in
            let value = max(0, part.number("value") ?? 0)
            let share = Format.percent(total > 0 ? value / total * 100 : 0)
            let name = part.label
            return Slice(
                id: part.id, name: name, share: share, value: value,
                color: part.tone.map(UiToneStyle.color) ?? UiChartPalette.colors[index],
                said: "\(name): \(UiFormat.withUnit(UiFormat.number(value), unit)), \(share)")
        }
        VStack(alignment: .leading, spacing: 10) {
            bar(slices.filter { $0.value > 0 }, total: total)
            UiFlowLayout(spacing: 12) {
                ForEach(slices) { slice in
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 2).fill(slice.color).frame(width: 8, height: 8)
                        Text(slice.name).foregroundStyle(MobileStyle.muted).lineLimit(1)
                        Text(slice.share).fontWeight(.semibold).foregroundStyle(MobileStyle.text).monospacedDigit()
                    }
                    .font(.caption)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .uiTile(flat: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(localized: "Parts of the whole"))
        .accessibilityValue(slices.map(\.said).joined(separator: ". "))
    }

    private func bar(_ slices: [Slice], total: Double) -> some View {
        GeometryReader { geometry in
            let room = geometry.size.width - Self.gap * CGFloat(max(0, slices.count - 1))
            HStack(spacing: Self.gap) {
                if slices.isEmpty {
                    Capsule().fill(MobileStyle.text.opacity(0.1))
                } else {
                    ForEach(slices) { slice in
                        RoundedRectangle(cornerRadius: 3).fill(slice.color)
                            .frame(width: max(0, room * slice.value / total))
                    }
                }
            }
        }
        .frame(height: 8)
    }
}
