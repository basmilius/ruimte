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
}

/// The head of the block when it is the first node, with the icon of its tone; further down a subheading.
struct UiSummaryView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let head = context.headID == node.id
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if head, let tone = node.tone {
                Image(lucide: tone.icon, size: 16).foregroundStyle(UiToneStyle.color(tone))
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
                    .accessibilityHidden(true)
            }
            UiNodesView(nodes: node.children, parent: node.type, context: context)
                .font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let badge = node.string("badge"), !badge.isEmpty {
                UiPill(text: badge, tone: node.tone ?? .neutral)
            }
        }
        .padding(.horizontal, 8)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A note on the tone mixed over the ground, never with a colored edge on one side.
struct UiCalloutView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let tone = node.tone ?? .neutral
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(lucide: tone.icon, size: 16).foregroundStyle(UiToneStyle.color(tone))
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                if let title = node.string("title"), !title.isEmpty {
                    Text(title).font(.subheadline.weight(.medium)).foregroundStyle(MobileStyle.text)
                }
                UiNodesView(nodes: node.children, parent: node.type, context: context, spacing: 6)
                    .font(.subheadline).foregroundStyle(MobileStyle.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .background(
            UiToneStyle.color(tone).opacity(tone == .neutral ? 0.08 : 0.1), in: RoundedRectangle(cornerRadius: 12)
        )
        .accessibilityElement(children: .combine)
    }
}

struct UiTagView: View {
    let node: UiNode

    var body: some View { UiPill(text: node.label, tone: node.tone ?? .neutral) }
}

struct UiPill: View {
    let text: String
    let tone: UiTone

    var body: some View {
        Text(text).font(.caption.weight(.medium)).lineLimit(1)
            .foregroundStyle(UiToneStyle.color(tone))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(UiToneStyle.color(tone).opacity(0.12), in: Capsule())
    }
}

/// Without a value the progress is indeterminate; without a max the value is a percentage.
struct UiProgressView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let value = node.number("value")
        let limit = node.number("max") ?? 100
        let reading = value.map { value in
            limit == 100
                ? UiFormat.percent(value)
                : String(localized: "\(UiFormat.number(value)) of \(UiFormat.number(limit))")
        }
        let label = node.label
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                UiNodesView(nodes: node.children, parent: node.type, context: context)
                    .font(.footnote).foregroundStyle(MobileStyle.text)
                Spacer(minLength: 0)
                if let reading {
                    Text(reading).font(.footnote).foregroundStyle(MobileStyle.muted).monospacedDigit()
                } else if context.live {
                    Spinner(size: 12).foregroundStyle(MobileStyle.faint)
                }
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
            .accessibilityValue(reading ?? "")
        }
        .padding(.horizontal, 8)
    }
}

struct UiStepsView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        UiNodesView(nodes: node.children, parent: node.type, context: context, spacing: 0).padding(.horizontal, 8)
    }
}

/// A running step spins only while the block is live; in a still block it is a dot.
struct UiStepView: View {
    let node: UiNode
    let context: UiRenderContext

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
        HStack(spacing: 8) {
            Group {
                if state == .running && context.live {
                    Spinner(size: 14)
                } else {
                    Image(lucide: state.icon, size: 14)
                }
            }
            .foregroundStyle(state.color).frame(width: 16, height: 16)
            UiNodesView(nodes: node.children, parent: node.type, context: context)
                .font(.subheadline)
                .foregroundStyle(state == .pending || state == .skipped ? MobileStyle.faint : MobileStyle.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let detail = node.string("detail"), !detail.isEmpty {
                Text(detail).font(.caption).foregroundStyle(MobileStyle.faint).monospacedDigit()
            }
        }
        .frame(minHeight: 32)
        .accessibilityElement(children: .combine)
        .accessibilityValue(state.word)
    }
}
