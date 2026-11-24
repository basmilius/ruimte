import RuimtePulsar
import RuimteShared
import SwiftUI

enum UiToneStyle {
    static func color(_ tone: UiTone) -> Color {
        switch tone {
        case .neutral: MobileStyle.muted
        case .info: MobileStyle.statusRunning
        case .success: MobileStyle.positive
        case .warning: MobileStyle.statusNeedsYou
        case .danger: MobileStyle.statusError
        }
    }

    /// The tone mixed over the ground, for a surface such as a callout.
    static func surface(_ tone: UiTone) -> Color {
        switch tone {
        case .neutral: MobileStyle.text.opacity(0.07)
        case .info: MobileStyle.statusRunning.opacity(0.1)
        case .success: MobileStyle.positive.opacity(0.1)
        case .warning: MobileStyle.statusNeedsYou.opacity(0.12)
        case .danger: MobileStyle.statusError.opacity(0.1)
        }
    }

    /// The tone in a word, for VoiceOver where only a color or an icon shows it. Neutral says nothing.
    static func word(_ tone: UiTone?) -> String {
        switch tone {
        case nil, .neutral: ""
        case .info: String(localized: "Info")
        case .success: String(localized: "Success")
        case .warning: String(localized: "Warning")
        case .danger: String(localized: "Danger")
        }
    }
}

/// A text longer than this reads as a sentence, which a tag cannot wrap, so it stands as a line of its own.
enum UiTagLimit {
    static let characters = 24

    static func fits(_ text: String) -> Bool { !text.isEmpty && text.count <= characters }
}

private struct UiIconSquare: View {
    static let side: CGFloat = 34

    let icon: String
    let ink: Color
    let ground: Color

    var body: some View {
        Image(lucide: icon, size: 16).foregroundStyle(ink)
            .frame(width: Self.side, height: Self.side)
            .background(ground, in: RoundedRectangle(cornerRadius: 8))
            .accessibilityHidden(true)
    }
}

/// A tile in its tone. A short badge is a tag at the end of the row and a longer one stands under the title. The
/// head of the block carries its icon in a square of its own, a Summary further down is a subheading without one.
/// The icon is the ground's ink, which is white on a light ground and keeps the dark theme's lighter tones readable.
struct UiSummaryView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let head = context.headID == node.id
        let tone = node.tone
        let badge = node.string("badge") ?? ""
        let tagged = UiTagLimit.fits(badge)
        let row = HStack(alignment: .top, spacing: 12) {
            if head {
                UiIconSquare(
                    icon: (tone ?? .neutral).icon, ink: MobileStyle.surface,
                    ground: UiToneStyle.color(tone ?? .neutral))
            }
            VStack(alignment: .leading, spacing: 2) {
                UiNodesView(nodes: node.children, parent: node.type, context: context)
                    .font(.callout.weight(.semibold)).foregroundStyle(MobileStyle.text)
                if let detail = node.string("detail"), !detail.isEmpty {
                    // Muted text does not reach 4.5 to 1 on the surface of a tone.
                    Text(detail).font(.subheadline)
                        .foregroundStyle(tone == nil ? MobileStyle.muted : MobileStyle.text)
                }
                if !badge.isEmpty && !tagged {
                    Text(badge).font(.caption.weight(.medium))
                        .foregroundStyle(tone.map(UiToneStyle.color) ?? MobileStyle.muted)
                }
            }
            .frame(maxWidth: .infinity, minHeight: UiIconSquare.side, alignment: .leading)
            if tagged { UiPill(text: badge, tone: tone ?? .neutral).padding(.top, 2) }
        }
        Group {
            if let tone {
                row.padding(UiTileStyle.padding)
                    .background(UiToneStyle.surface(tone), in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
            } else {
                row.uiTile()
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A quiet tile whose icon square wears the tone, never a colored edge on one side. A warning and a danger take the
/// surface of their tone for the whole tile, also inside a Section, and their words the full text color.
struct UiCalloutView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let tone = node.tone ?? .info
        let tinted = tone == .warning || tone == .danger
        let row = HStack(alignment: .top, spacing: 12) {
            UiIconSquare(icon: tone.icon, ink: UiToneStyle.color(tone), ground: UiToneStyle.surface(tone))
            VStack(alignment: .leading, spacing: 2) {
                if let title = node.string("title"), !title.isEmpty {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.text)
                }
                UiNodesView(nodes: node.children, parent: node.type, context: context, spacing: 6)
                    .font(.subheadline).foregroundStyle(tinted ? MobileStyle.text : MobileStyle.muted)
            }
            .frame(maxWidth: .infinity, minHeight: UiIconSquare.side, alignment: .leading)
        }
        Group {
            if tinted {
                row.padding(UiTileStyle.padding)
                    .background(UiToneStyle.surface(tone), in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
            } else {
                row.uiTile(flat: true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(UiToneStyle.word(tone))
    }
}

struct UiTagView: View {
    let node: UiNode

    var body: some View { UiPill(text: node.label, tone: node.tone ?? .neutral) }
}

/// The small label at the end of a line, as the desktop's tag: tighter than a pill and heavier.
struct UiPill: View {
    let text: String
    let tone: UiPillTone

    init(text: String, tone: UiTone) {
        self.text = text
        self.tone = UiPillTone(tone)
    }

    init(text: String, pill: UiPillTone) {
        self.text = text
        tone = pill
    }

    var body: some View {
        Text(text).font(.caption.weight(.medium)).lineLimit(1)
            .foregroundStyle(tone.text)
            .padding(.horizontal, 5).padding(.vertical, 2)
            .background(tone.ground, in: RoundedRectangle(cornerRadius: 6))
    }
}

/// The reading at the end of a Progress or a Meter line: the tone's icon and color on the figure, so the tone is
/// never its color alone.
struct UiToneIcon: View {
    let tone: UiTone

    var body: some View {
        Image(lucide: tone.icon, size: 12).foregroundStyle(UiToneStyle.color(tone)).accessibilityHidden(true)
    }
}

/// Without a value the progress is indeterminate; without a max the value is a percentage. The tone colors the
/// reading and gives it the tone's icon; the bar stays the accent.
struct UiProgressView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let value = node.number("value")
        let limit = node.number("max") ?? 100
        let tone = node.tone.flatMap { $0 == .neutral ? nil : $0 }
        let reading = value.map { value in
            limit == 100
                ? Format.percent(value)
                : String(localized: "\(UiFormat.number(value)) of \(UiFormat.number(limit))")
        }
        let label = node.label
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                UiNodesView(nodes: node.children, parent: node.type, context: context)
                    .font(.subheadline).foregroundStyle(MobileStyle.text)
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    if let tone { UiToneIcon(tone: tone) }
                    if let reading {
                        Text(reading).font(.subheadline)
                            .foregroundStyle(tone.map(UiToneStyle.color) ?? MobileStyle.muted).monospacedDigit()
                    } else if context.live {
                        Spinner(size: 12).foregroundStyle(MobileStyle.faint)
                    }
                }
                .accessibilityHidden(true)
            }
            Group {
                if let value {
                    ProgressView(value: min(max(0, value), limit), total: limit)
                } else {
                    ProgressView(value: nil as Double?, total: 1)
                }
            }
            .tint(MobileStyle.accent)
            .accessibilityLabel(label.isEmpty ? String(localized: "Progress") : label)
            .accessibilityValue(
                [reading ?? "", UiToneStyle.word(tone)].filter { !$0.isEmpty }.joined(separator: ", "))
            if let detail = node.string("detail"), !detail.isEmpty {
                Text(detail).font(.caption).foregroundStyle(MobileStyle.muted)
            }
        }
        .uiTile(flat: true)
    }
}

/// One tile for the sequence, its steps as rows on a rail that runs from each state to the next.
struct UiStepsView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let rows = node.children.filter { !$0.isText }
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
                if row.type == "Step" && UiFallbackProblem.of(row, catalogVersion: context.catalogVersion) == nil {
                    UiStepView(node: row, context: context, last: row.id == rows.last?.id)
                } else {
                    UiNodeView(node: row, parent: node.type, context: context)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .uiTile(flat: true)
        .accessibilityElement(children: .contain)
    }
}

/// A row of the sequence: the state as an icon on the rail, the label, and the detail at the end, or under the label
/// once it does not fit beside it. Only a failed step says its state in sight; VoiceOver hears every state. A
/// running step spins only while the block is live; in a still block it is a dot.
struct UiStepView: View {
    let node: UiNode
    let context: UiRenderContext
    var last = true

    private static let icon: CGFloat = 16
    private static let gap: CGFloat = 12

    private enum State: String {
        case done, running, pending, failed, skipped

        var icon: String {
            switch self {
            case .done: "circle-check"
            case .running: "circle-dot"
            case .pending: "circle"
            case .failed: "circle-x"
            case .skipped: "circle-minus"
            }
        }

        var color: Color {
            switch self {
            case .done: MobileStyle.statusIdle
            case .running: MobileStyle.accent
            case .pending, .skipped: MobileStyle.faint
            case .failed: MobileStyle.statusError
            }
        }

        var word: String {
            switch self {
            case .done: String(localized: "Done")
            case .running: String(localized: "Running")
            case .pending: String(localized: "Waiting")
            case .failed: String(localized: "Failed")
            case .skipped: String(localized: "Skipped")
            }
        }
    }

    var body: some View {
        let state = node.string("state").flatMap(State.init(rawValue:)) ?? .pending
        let quiet = state == .pending || state == .skipped
        HStack(alignment: .firstTextBaseline, spacing: Self.gap) {
            Group {
                if state == .running && context.live {
                    Spinner(size: 14)
                } else {
                    Image(lucide: state.icon, size: 14)
                }
            }
            .foregroundStyle(state.color).frame(width: Self.icon, height: Self.icon)
            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
            VStack(alignment: .leading, spacing: 2) {
                // A short detail ends the label's line; one that does not fit beside it takes the line under it.
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        title(quiet: quiet).fixedSize()
                        Spacer(minLength: 0)
                        detail
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        title(quiet: quiet)
                        detail
                    }
                }
                if state == .failed {
                    Text(state.word).font(.caption).foregroundStyle(MobileStyle.statusError)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 20)
        .padding(.bottom, last ? 0 : 12)
        .background(alignment: .topLeading) {
            if !last {
                Rectangle().fill(MobileStyle.border).frame(width: 1)
                    .padding(.top, 22).padding(.bottom, 2).padding(.leading, (Self.icon - 1) / 2)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(state.word)
    }

    private func title(quiet: Bool) -> some View {
        UiNodesView(nodes: node.children, parent: node.type, context: context)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(quiet ? MobileStyle.muted : MobileStyle.text)
    }

    @ViewBuilder private var detail: some View {
        if let detail = node.string("detail"), !detail.isEmpty {
            Text(detail).font(.caption).foregroundStyle(MobileStyle.muted).monospacedDigit()
        }
    }
}

struct UiTimelineView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        UiNodesView(nodes: node.children, parent: node.type, context: context, spacing: 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .uiTile(flat: true, vertical: 6)
            .accessibilityElement(children: .contain)
    }
}

/// The time, a dot in the tone, the title, and a short detail as a tag at the end or a longer one under the title. A
/// time nobody could read stays as written.
struct UiEventView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let tone = node.tone ?? .neutral
        let time = UiEventTime.text(node.string("at") ?? "")
        let detail = node.string("detail") ?? ""
        let tagged = UiTagLimit.fits(detail)
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(time).font(.caption.monospacedDigit()).foregroundStyle(MobileStyle.muted)
                .frame(width: 96, alignment: .leading)
            Circle().fill(tone == .neutral ? MobileStyle.faint : UiToneStyle.color(tone)).frame(width: 8, height: 8)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] }
            VStack(alignment: .leading, spacing: 2) {
                UiNodesView(nodes: node.children, parent: node.type, context: context)
                    .font(.subheadline).foregroundStyle(MobileStyle.text)
                if !detail.isEmpty && !tagged {
                    Text(detail).font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if tagged { UiPill(text: detail, tone: tone) }
        }
        .padding(.vertical, 8)
        .frame(minHeight: 36)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            [time, node.label, UiToneStyle.word(tone), detail].filter { !$0.isEmpty }.joined(separator: ", "))
    }
}
