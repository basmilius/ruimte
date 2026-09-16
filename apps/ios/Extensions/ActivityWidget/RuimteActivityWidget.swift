import ActivityKit
import LucideSwift
import RuimtePulsar
import SwiftUI
import WidgetKit

@main struct RuimteActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RuimteActivityAttributes.self) { context in
            HStack(spacing: 12) {
                activityIcon(context.state.phase, size: 24).foregroundStyle(.primary)
                VStack(alignment: .leading, spacing: 4) {
                    Text(context.state.title).font(.headline).lineLimit(1)
                    Text(label(context.state)).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if context.state.phase != .done {
                    Text(Date(timeIntervalSince1970: Double(context.state.startedAt) / 1000), style: .timer)
                        .monospacedDigit().font(.caption)
                }
            }.padding()
                .widgetURL(
                    URL(
                        string:
                            "ruimte://activity?machine=\(context.attributes.machineId)&collapse=\(context.attributes.collapseId)"
                    ))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    activityIcon(context.state.phase, size: 20).foregroundStyle(.primary)
                }
                DynamicIslandExpandedRegion(.center) { Text(context.state.title).font(.headline).lineLimit(1) }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(label(context.state))
                        Spacer()
                        Text(Date(timeIntervalSince1970: Double(context.state.startedAt) / 1000), style: .timer)
                            .monospacedDigit()
                    }.font(.caption)
                }
            } compactLeading: {
                activityIcon(context.state.phase, size: 16)
            } compactTrailing: {
                Text(compact(context.state)).monospacedDigit()
            } minimal: {
                activityIcon(context.state.phase, size: 16)
            }
            .widgetURL(
                URL(
                    string:
                        "ruimte://activity?machine=\(context.attributes.machineId)&collapse=\(context.attributes.collapseId)"
                ))
        }
    }
    private func activityIcon(_ phase: PushActivityContentPhase, size: CGFloat) -> Image {
        Image(lucide: icon(phase), size: CGSize(width: size, height: size), strokeWidth: size / 12)
    }

    private func icon(_ phase: PushActivityContentPhase) -> LucideIconName {
        switch phase {
        case .running: .sparkles
        case .tool: .wrench
        case .needsYou: .hand
        case .done: .circleCheck
        }
    }
    private func compact(_ state: PushActivityContent) -> String {
        if let waiting = state.attentionCount, waiting > 0 { return "\(waiting)!" }
        if let running = state.runningCount, running > 0 { return "\(running)" }
        return state.phase == .done ? "✓" : "···"
    }

    private func label(_ state: PushActivityContent) -> String {
        if let running = state.runningCount, let waiting = state.attentionCount {
            if waiting > 0 && running > 0 { return "\(running) working · \(waiting) need attention" }
            if waiting > 0 { return "\(waiting) need attention" }
            if running > 0 { return "\(running) working" }
            return "All finished"
        }
        return switch state.phase {
        case .running: "Working"
        case .tool: "Using a tool"
        case .needsYou: "Needs your attention"
        case .done: "Finished"
        }
    }
}
