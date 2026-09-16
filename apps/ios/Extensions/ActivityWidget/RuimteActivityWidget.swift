import ActivityKit
import LucideSwift
import RuimtePulsar
import SwiftUI
import WidgetKit

@main struct RuimteActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RuimteActivityAttributes.self) { context in
            ActivityCard(
                state: context.state, attributes: context.attributes, stale: context.isStale, showsHeader: true
            )
            .padding(.horizontal, 16).padding(.vertical, 12)
            .activityBackgroundTint(Color(red: 0.105, green: 0.105, blue: 0.13))
            .activitySystemActionForegroundColor(.white)
            .widgetURL(activityURL(context.attributes))
        } dynamicIsland: { context in
            let presentation = ActivityPresentation(state: context.state, stale: context.isStale)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text("Ruimte").font(.system(size: 16, weight: .semibold)).padding(.leading, 8)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.title).font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
                        .lineLimit(1).truncationMode(.middle).padding(.trailing, 8)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ActivityCard(
                        state: context.state, attributes: context.attributes, stale: context.isStale, showsHeader: false
                    )
                    .padding(.horizontal, 8).padding(.bottom, 8)
                }
            } compactLeading: {
                ActivityGlyph(phase: context.state.phase, size: 18)
                    .padding(.leading, 2)
            } compactTrailing: {
                ActivityStatus(text: presentation.compactTitle, color: presentation.color, size: 12)
                    .padding(.trailing, 2)
            } minimal: {
                ActivityGlyph(phase: context.state.phase, size: 18)
            }
            .keylineTint(presentation.color)
            .widgetURL(activityURL(context.attributes))
        }
    }
}

private struct ActivityCard: View {
    let state: PushActivityContent
    let attributes: RuimteActivityAttributes
    let stale: Bool
    let showsHeader: Bool

    private var presentation: ActivityPresentation { .init(state: state, stale: stale) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if showsHeader {
                HStack(alignment: .firstTextBaseline, spacing: 20) {
                    Text("Ruimte").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    Spacer(minLength: 0)
                    Text(state.title).font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
                        .lineLimit(1).truncationMode(.middle)
                }
            }
            if !stale, state.phase != .done, let agents = state.agents, !agents.isEmpty {
                VStack(spacing: 4) {
                    ForEach(agents, id: \.nodeId) { agent in
                        if let url = activityURL(attributes, agent: agent) {
                            // Bound link labels so the rows and footer fit inside WidgetKit's clipped presentation.
                            Link(destination: url) { ActivityAgentRow(agent: agent) }.buttonStyle(.plain).frame(
                                height: showsHeader ? 40 : 36)
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
                if state.phase != .done && !stale {
                    HStack(spacing: 4) {
                        Text("Started")
                        Text(
                            Date(timeIntervalSince1970: Double(state.startedAt) / 1000),
                            format: .dateTime.hour().minute())
                    }.lineLimit(1).frame(width: 100, alignment: .trailing)
                }
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
                .foregroundStyle(needsYou ? Color.orange : .white.opacity(0.9))
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(agent.title).font(.system(size: 15, weight: .medium)).foregroundStyle(.white)
                    .lineLimit(1).truncationMode(.tail)
                Text(needsYou ? "Waiting for your input" : (agent.target == .chat ? "AI chat" : "Terminal agent"))
                    .font(.system(size: 12)).foregroundStyle(.white.opacity(0.5)).lineLimit(1)
            }
            Spacer(minLength: 4)
            if needsYou {
                Text("Review").font(.system(size: 13, weight: .semibold)).foregroundStyle(.black)
                    .padding(.horizontal, 15).frame(height: 32)
                    .background(Color.orange, in: Capsule())
            } else {
                ActivityStatus(text: "Running", color: .activityBlue, size: 12)
            }
        }
        .frame(minHeight: 35)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.title), \(needsYou ? "needs your attention, review" : "running, open session")")
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
    var color: Color { stale ? .gray : state.phase == .done ? .green : waiting > 0 ? .orange : .activityBlue }
    var compactTitle: String {
        if stale { return "Updating" }
        if state.phase == .done { return "Done" }
        if waiting > 0 { return "Needs you" }
        return "\(working) running"
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
            .foregroundStyle(phase == .done ? Color.green : phase == .needsYou ? .orange : .white)
    }
}

extension Color {
    fileprivate static let activityBlue = Color(red: 0.30, green: 0.53, blue: 1)
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
