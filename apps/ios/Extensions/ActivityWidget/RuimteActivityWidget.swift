import ActivityKit
import LucideSwift
import RuimtePulsar
import SwiftUI
import WidgetKit

struct RuimteActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RuimteActivityAttributes.self) { context in
            ActivityCard(
                state: context.state, attributes: context.attributes, stale: context.isStale
            )
            .padding(.horizontal, 16).padding(.vertical, 12)
            .activityBackgroundTint(.activityTint)
            .activitySystemActionForegroundColor(.white)
            .widgetURL(activityURL(context.attributes))
        } dynamicIsland: { context in
            let presentation = ActivityPresentation(state: context.state, stale: context.isStale)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    ActivityCard(
                        state: context.state, attributes: context.attributes, stale: context.isStale
                    )
                    .padding(.horizontal, 8).padding(.bottom, 8)
                }
            } compactLeading: {
                ActivityCompactIndicator(presentation: presentation)
            } compactTrailing: {
                if context.state.phase != .done && !context.isStale {
                    ActivityTimer(startedAt: context.state.startedAt)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(context.state.phase == .needsYou ? Color.activityNeedsYou : .white)
                        .multilineTextAlignment(.trailing).minimumScaleFactor(0.85)
                        .frame(width: 44).padding(.trailing, 2)
                }
            } minimal: {
                ActivityCompactIndicator(presentation: presentation)
            }
            .keylineTint(presentation.color)
            .widgetURL(activityURL(context.attributes))
        }
    }
}

private struct ActivityCompactIndicator: View {
    let presentation: ActivityPresentation

    var body: some View {
        Group {
            if let agent = presentation.singleAgent {
                LucideIcon(agent.target == .chat ? .sparkles : .terminal, size: 16)
                    .foregroundStyle(presentation.color)
            } else {
                LucideIcon(presentation.statusIcon, size: 16)
                    .foregroundStyle(presentation.color)
            }
        }
        .frame(width: 18, height: 18)
        .accessibilityLabel(presentation.singleAgent?.title ?? presentation.title)
    }
}

private struct ActivityCard: View {
    let state: PushActivityContent
    let attributes: RuimteActivityAttributes
    let stale: Bool

    private var presentation: ActivityPresentation { .init(state: state, stale: stale) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !stale, state.phase != .done, let agents = state.agents, !agents.isEmpty {
                VStack(spacing: 4) {
                    ForEach(agents, id: \.nodeId) { agent in
                        if let url = activityURL(attributes, agent: agent) {
                            // Bound link labels so the rows and footer fit inside WidgetKit's clipped presentation.
                            Link(destination: url) { ActivityAgentRow(agent: agent) }.buttonStyle(.plain).frame(
                                height: 40)
                        }
                    }
                }
            } else {
                HStack(spacing: 10) {
                    ActivityGlyph(phase: state.phase, size: 20)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(presentation.title).font(.system(size: 16, weight: .medium)).foregroundStyle(.white)
                        Text(presentation.subtitle).font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
                    }
                    Spacer(minLength: 0)
                }.padding(.vertical, 2)
            }
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(presentation.footer).lineLimit(1)
                Spacer(minLength: 0)
                Text(state.title).lineLimit(1).truncationMode(.middle)
            }
            .font(.system(size: 11)).foregroundStyle(.white.opacity(0.45))
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ActivityAgentRow: View {
    let agent: PushActivityAgent

    private var needsYou: Bool { agent.phase == .needsYou }

    var body: some View {
        HStack(spacing: 10) {
            LucideIcon(agent.target == .chat ? .sparkles : .terminal, size: 19)
                .foregroundStyle(needsYou ? Color.activityNeedsYou : .white.opacity(0.9))
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(agent.title).font(.system(size: 15, weight: .medium)).foregroundStyle(.white)
                    .lineLimit(1).truncationMode(.tail)
                HStack(spacing: 5) {
                    Text(needsYou ? "Waiting for your input" : (agent.target == .chat ? "AI chat" : "Terminal agent"))
                        .lineLimit(1)
                    if let startedAt = agent.startedAt {
                        Text("·")
                        ActivityTimer(startedAt: startedAt).frame(width: 56, alignment: .leading)
                    }
                }.font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
            }
            Spacer(minLength: 4)
            if needsYou {
                Text("Review").font(.system(size: 13, weight: .semibold)).foregroundStyle(.black)
                    .padding(.horizontal, 15).frame(height: 32)
                    .background(Color.activityNeedsYou, in: Capsule())
            } else {
                ActivityStatus(text: "Running", color: .activityRunning, size: 12)
            }
        }
        .frame(minHeight: 35)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint(needsYou ? "Review this session" : "Open this session")
    }
}

private struct ActivityTimer: View {
    let startedAt: Int64

    var body: some View {
        let start = Date(timeIntervalSince1970: Double(startedAt) / 1000)
        Text(timerInterval: start...Date.distantFuture, countsDown: false)
            .monospacedDigit().lineLimit(1)
    }
}

private struct ActivityStatus: View {
    let text: String
    let color: Color
    let size: CGFloat

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(text).font(.system(size: size, weight: .medium)).foregroundStyle(color).monospacedDigit()
        }.fixedSize()
    }
}

private struct ActivityPresentation {
    let state: PushActivityContent
    let stale: Bool

    private var working: Int64 { state.runningCount ?? (state.phase == .needsYou || state.phase == .done ? 0 : 1) }
    private var waiting: Int64 { state.attentionCount ?? (state.phase == .needsYou ? 1 : 0) }
    var singleAgent: PushActivityAgent? {
        guard !stale, state.phase != .done, working + waiting == 1, state.agents?.count == 1 else { return nil }
        return state.agents?.first
    }
    var color: Color {
        stale
            ? .activityStale
            : state.phase == .done ? .activityDone : waiting > 0 ? .activityNeedsYou : .activityRunning
    }
    var statusIcon: LucideIconName {
        if state.phase == .done { return .check }
        return waiting > 0 ? .circleAlert : .loaderCircle
    }
    var title: String {
        if stale { return "Waiting for an update" }
        if state.phase == .done { return "Work finished" }
        if waiting > 0 { return waiting == 1 ? "1 agent needs you" : "\(waiting) agents need you" }
        return working == 1 ? "1 agent running" : "\(working) agents running"
    }
    var subtitle: String {
        if stale { return "The machine has not sent a recent update." }
        if state.phase == .done { return "Your agents have finished their work." }
        return "Open Ruimte to see your agents."
    }
    var footer: String {
        if stale { return "Last known status" }
        if state.phase == .done { return "No agents running" }
        let more = max(0, working + waiting - Int64(state.agents?.count ?? 0))
        let counts = waiting > 0 ? "\(working) running · \(waiting) needs you" : "\(working) running"
        return more > 0 && state.agents?.isEmpty == false ? "+\(more) more · \(counts)" : counts
    }
}

private struct ActivityGlyph: View {
    let phase: PushActivityContentPhase
    let size: CGFloat

    var body: some View {
        LucideIcon(phase == .done ? .check : phase == .needsYou ? .messageCircle : .loaderCircle, size: size)
            .foregroundStyle(phase == .done ? Color.activityDone : phase == .needsYou ? .activityNeedsYou : .white)
    }
}

/// A Live Activity is always drawn on its own dark tint, whatever the system appearance is, so each of these takes
/// the dark value of its token. Plain white keeps its contrast against that tint and is no token of its own.
extension Color {
    fileprivate static let activityTint = RuimteColors.activityTint.onDark
    fileprivate static let activityRunning = RuimteColors.statusRunning.onDark
    fileprivate static let activityNeedsYou = RuimteColors.statusNeedsYou.onDark
    fileprivate static let activityDone = RuimteColors.statusIdle.onDark
    fileprivate static let activityStale = RuimteColors.muted.onDark
}

private func activityURL(_ attributes: RuimteActivityAttributes, agent: PushActivityAgent? = nil) -> URL? {
    var url = URLComponents()
    url.scheme = "ruimte"
    url.host = "activity"
    url.queryItems = [
        .init(name: "machine", value: attributes.machineId),
        .init(name: "collapse", value: attributes.collapseId),
    ]
    if let agent {
        url.queryItems?.append(contentsOf: [
            .init(name: "node", value: agent.nodeId), .init(name: "target", value: agent.target.rawValue),
        ])
    }
    return url.url
}
