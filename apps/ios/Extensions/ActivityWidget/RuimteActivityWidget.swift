import ActivityKit
import RuimtePulsar
import SwiftUI
import WidgetKit

@main struct RuimteActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RuimteActivityAttributes.self) { context in
            HStack(spacing: 12) {
                Image(systemName: icon(context.state.phase)).font(.title2).foregroundStyle(.indigo)
                VStack(alignment: .leading, spacing: 4) {
                    Text(context.state.title).font(.headline).lineLimit(1)
                    Text(label(context.state.phase)).font(.caption).foregroundStyle(.secondary)
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
                    Image(systemName: icon(context.state.phase)).foregroundStyle(.indigo)
                }
                DynamicIslandExpandedRegion(.center) { Text(context.state.title).font(.headline).lineLimit(1) }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(label(context.state.phase))
                        Spacer()
                        Text(Date(timeIntervalSince1970: Double(context.state.startedAt) / 1000), style: .timer)
                            .monospacedDigit()
                    }.font(.caption)
                }
            } compactLeading: {
                Image(systemName: icon(context.state.phase))
            } compactTrailing: {
                Text(context.state.phase == .needsYou ? "!" : context.state.phase == .done ? "✓" : "···")
            } minimal: {
                Image(systemName: icon(context.state.phase))
            }
            .widgetURL(
                URL(
                    string:
                        "ruimte://activity?machine=\(context.attributes.machineId)&collapse=\(context.attributes.collapseId)"
                ))
        }
    }
    private func icon(_ phase: PushActivityContentPhase) -> String {
        switch phase {
        case .running: "sparkles"
        case .tool: "wrench.and.screwdriver"
        case .needsYou: "hand.raised"
        case .done: "checkmark.circle"
        }
    }
    private func label(_ phase: PushActivityContentPhase) -> String {
        switch phase {
        case .running: "Working"
        case .tool: "Using a tool"
        case .needsYou: "Needs your attention"
        case .done: "Finished"
        }
    }
}
