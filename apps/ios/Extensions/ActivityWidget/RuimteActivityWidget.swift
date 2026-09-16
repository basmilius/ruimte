import ActivityKit
import LucideSwift
import RuimtePulsar
import SwiftUI
import WidgetKit

@main struct RuimteActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RuimteActivityAttributes.self) { context in
            let presentation = ActivityPresentation(state: context.state, stale: context.isStale)
            HStack(alignment: .center, spacing: 12) {
                ActivityGlyph(phase: context.state.phase, size: 20)
                    .frame(width: 38, height: 38)
                    .background(.white.opacity(0.08), in: Circle())
                VStack(alignment: .leading, spacing: 5) {
                    Text(presentation.title)
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    Text(context.state.title)
                        .font(.system(size: 12)).foregroundStyle(.white.opacity(0.6)).lineLimit(1).truncationMode(
                            .middle)
                    if presentation.showsAttention {
                        AttentionLabel(count: context.state.attentionCount ?? 0).padding(.top, 3)
                    }
                }
                Spacer(minLength: 0)
                ActivityTimer(state: context.state, stale: context.isStale)
            }
            .padding(16)
            .activityBackgroundTint(Color(red: 0.075, green: 0.075, blue: 0.09))
            .activitySystemActionForegroundColor(.white)
            .accessibilityElement(children: .combine)
            .widgetURL(activityURL(context.attributes))
        } dynamicIsland: { context in
            let presentation = ActivityPresentation(state: context.state, stale: context.isStale)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        ActivityGlyph(phase: context.state.phase, size: 16)
                        Text(presentation.title)
                            .font(.system(size: 15, weight: .semibold)).lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ActivityTimer(state: context.state, stale: context.isStale)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 10) {
                        Text(context.state.title)
                            .font(.system(size: 11)).foregroundStyle(.white.opacity(0.6)).lineLimit(1).truncationMode(
                                .middle)
                        Spacer(minLength: 0)
                        if presentation.showsAttention {
                            AttentionLabel(count: context.state.attentionCount ?? 0)
                        }
                    }.padding(.top, 3).padding(.bottom, 3)
                }
            } compactLeading: {
                ActivityGlyph(phase: context.state.phase, size: 16)
            } compactTrailing: {
                Text(presentation.compactCount)
                    .font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(context.state.phase == .needsYou ? Color.orange : .white)
                    .accessibilityLabel(presentation.title)
            } minimal: {
                ActivityGlyph(phase: context.state.phase, size: 16)
            }
            .keylineTint(context.state.phase == .needsYou ? .orange : .white.opacity(0.3))
            .widgetURL(activityURL(context.attributes))
        }
    }

    private func activityURL(_ attributes: RuimteActivityAttributes) -> URL? {
        var url = URLComponents()
        url.scheme = "ruimte"
        url.host = "activity"
        url.queryItems = [
            .init(name: "machine", value: attributes.machineId),
            .init(name: "collapse", value: attributes.collapseId),
        ]
        return url.url
    }
}

private struct ActivityPresentation {
    let state: PushActivityContent
    let stale: Bool

    private var working: Int64 { state.runningCount ?? (state.phase == .needsYou || state.phase == .done ? 0 : 1) }
    private var waiting: Int64 { state.attentionCount ?? (state.phase == .needsYou ? 1 : 0) }
    var showsAttention: Bool { !stale && state.phase != .done && working > 0 && waiting > 0 }

    var title: String {
        if stale { return "Waiting for an update" }
        if state.phase == .done { return "Work finished" }
        if working > 0 { return working == 1 ? "1 agent working" : "\(working) agents working" }
        if waiting > 0 { return waiting == 1 ? "1 agent needs you" : "\(waiting) agents need you" }
        return "Getting started"
    }

    var compactCount: String {
        if state.phase == .done { return "✓" }
        return "\(waiting > 0 ? waiting : working)"
    }
}

private struct AttentionLabel: View {
    let count: Int64

    var body: some View {
        HStack(spacing: 5) {
            Circle().frame(width: 5, height: 5)
            Text(count == 1 ? "1 needs you" : "\(count) need you").font(.system(size: 11, weight: .medium))
                .monospacedDigit()
        }
        .foregroundStyle(.orange)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(.orange.opacity(0.12), in: Capsule())
        .fixedSize()
    }
}

private struct ActivityTimer: View {
    let state: PushActivityContent
    let stale: Bool

    var body: some View {
        if state.phase != .done && !stale && (state.runningCount ?? 1) > 0 {
            Text(Date(timeIntervalSince1970: Double(state.startedAt) / 1000), style: .timer)
                .font(.system(size: 11, weight: .medium)).monospacedDigit()
                .foregroundStyle(.white.opacity(0.5)).multilineTextAlignment(.trailing)
                .frame(width: 52)
        }
    }
}

private struct ActivityGlyph: View {
    let phase: PushActivityContentPhase
    let size: CGFloat

    var body: some View {
        Image(lucide: icon, size: CGSize(width: size, height: size), strokeWidth: 2)
            .foregroundStyle(phase == .needsYou ? Color.orange : phase == .done ? .green : .white)
            .accessibilityHidden(true)
    }

    private var icon: LucideIconName {
        switch phase {
        case .running: .sparkles
        case .tool: .wrench
        case .needsYou: .hand
        case .done: .circleCheck
        }
    }
}
