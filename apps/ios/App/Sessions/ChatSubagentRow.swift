import RuimtePulsar
import RuimteTransport
import SwiftUI

struct ChatSubagentRow: View {
    let item: ChatSubagentItem
    let children: [ChatItemState]
    let presentation: ChatPresentation
    let client: any MachineRequesting
    let chatID: String
    @State private var showingResult = false
    private var running: Bool { item.status == .running }
    private var expanded: Bool { !opens && presentation.expandedSubagents.contains(item.id) }
    private var opens: Bool { ChatSubagents.canOpen(item) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if opens {
                // The conversation opens on a page of its own, as a row of the sub-agent list does.
                Button {
                    presentation.conversationRequest = SubagentCrumb(item)
                } label: {
                    header
                }.buttonStyle(.plain).font(.footnote).foregroundStyle(MobileStyle.muted)
                    .accessibilityHint("Opens the conversation")
            } else {
                ChatExpansionButton(expanding: !expanded) {
                    presentation.toggleSubagent(item.id)
                } label: {
                    header
                }.buttonStyle(.plain).font(.footnote).foregroundStyle(MobileStyle.muted)
                    .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            }
            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    if item.itemsTruncated {
                        Text("Only the start is kept.").font(.caption).foregroundStyle(
                            MobileStyle.muted)
                    }
                    if children.isEmpty {
                        Text("Nothing to show yet.").font(.caption).foregroundStyle(MobileStyle.muted)
                    } else {
                        ScrollViewReader { reader in
                            ScrollView {
                                LazyVStack(alignment: .leading, spacing: 8) {
                                    ForEach(children) { child in
                                        ChatObservedRow(record: child, client: client, chatID: chatID).id(child.id)
                                    }
                                }
                            }
                            .defaultScrollAnchor(.bottom)
                            .frame(height: min(320, max(88, CGFloat(children.count) * 88)))
                            .onChange(of: children.count) { _, _ in
                                if running, let last = children.last { reader.scrollTo(last.id, anchor: .bottom) }
                            }
                        }
                    }
                    if let result = item.result, !result.isEmpty {
                        DisclosureGroup("Show result", isExpanded: $showingResult) {
                            MarkdownMessage(text: result).modifier(ChatMessageMenu(text: result))
                        }
                    }
                }
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Rectangle().fill(MobileStyle.border).frame(width: 1) }
            }
        }
    }

    @ViewBuilder private var header: some View {
        if item.origin == .ruimte {
            ChatTaskLine(item: item, sources: presentation.agentSources, open: !opens && expanded)
        } else {
            subagentLine
        }
    }

    /// One line, as a tool call's: what it is, what it was asked, and where it stands.
    private var subagentLine: some View {
        let failed = item.status == .failed
        return HStack(spacing: 8) {
            Image(lucide: "bot", size: 14)
            ChatLiveLabel(text: String(localized: "Sub-agent"), active: running).lineLimit(1).layoutPriority(2)
            let detail = [item.description, item.summary ?? "", item.subagentType ?? ""].first { !$0.isEmpty } ?? ""
            if !detail.isEmpty {
                // Above the spacer, which would otherwise take half of what the line has left.
                Text(detail).foregroundStyle(MobileStyle.faint).lineLimit(1).layoutPriority(0.5)
            }
            Spacer(minLength: 0)
            if item.background {
                Text("background", comment: "A sub-agent that runs in the background, lowercase")
                    .foregroundStyle(MobileStyle.faint).fixedSize().layoutPriority(1)
            }
            // A tool's name can be long, and the line still has to say which agent this is.
            if running, let tool = item.lastTool, !tool.isEmpty {
                Text(tool).foregroundStyle(MobileStyle.faint).lineLimit(1).frame(maxWidth: 96).fixedSize()
                    .layoutPriority(1)
            }
            Group {
                if running {
                    // Just the time, as a running call's line has it: a phone's line has no room for the words too.
                    ChatElapsed(startedAt: item.startedAt)
                } else if let outcome = ChatSubagents.outcome(item) {
                    Text(outcome).monospacedDigit().foregroundStyle(
                        failed ? MobileStyle.statusError : MobileStyle.faint)
                }
            }
            .foregroundStyle(MobileStyle.faint).fixedSize().layoutPriority(1)
            Image(lucide: opens || !expanded ? "chevron-right" : "chevron-down", size: 12)
        }
        .font(.footnote).foregroundStyle(failed ? MobileStyle.statusError : MobileStyle.muted)
        .frame(minHeight: 28).contentShape(Rectangle())
    }
}

/// A task Ruimte gave another node: that agent's mark and model, what the task is about and where it stands, read
/// from the task's own record and the status of the child's chat. A child without one keeps the task's own words.
private struct ChatTaskLine: View {
    let item: ChatSubagentItem
    let sources: ChatAgentSources?
    let open: Bool

    var body: some View {
        let task = ChatSubagents.taskID(item).flatMap { sources?.tasks?.task($0) }
        let child = item.childId.flatMap { sources?.attention?.agents[$0] }
        let waiting =
            item.childId.map { id in
                sources?.attention?.needsYou(id) == true || sources?.attention?.waits[id] != nil
            } ?? false
        let state = ChatSubagents.taskRowState(item, task: task, childWaiting: waiting)
        let span = ChatSubagents.taskSpan(item, task: task)
        HStack(spacing: 10) {
            ZStack(alignment: .bottomTrailing) {
                Group {
                    if let provider = child?.provider {
                        ChatProviderMark(provider: provider, size: 14)
                    } else {
                        Image(lucide: "bot", size: 14)
                    }
                }
                .foregroundStyle(MobileStyle.text)
                .frame(width: 28, height: 28)
                .background(MobileStyle.hover, in: Circle())
                Circle().fill(state.look.color).frame(width: 10, height: 10)
                    .overlay { Circle().strokeBorder(MobileStyle.surface, lineWidth: 2).padding(-2) }
                    .offset(x: 2, y: 2)
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(ChatSubagents.taskTitle(item, model: modelName(child)))
                    .fontWeight(.medium).foregroundStyle(MobileStyle.text).lineLimit(1)
                stateLine(state, task: task).font(.caption).lineLimit(1)
            }
            Spacer(minLength: 0)
            Group {
                if state == .running || state == .waiting, span.startedAt > 0 {
                    ChatElapsed(startedAt: span.startedAt)
                } else if let duration = ChatSubagents.taskDuration(item, task: task, state: state) {
                    Text(duration).monospacedDigit()
                }
            }
            .font(.caption).foregroundStyle(MobileStyle.faint).fixedSize()
            Image(lucide: open ? "chevron-down" : "chevron-right", size: 12).foregroundStyle(MobileStyle.faint)
        }
        .font(.footnote)
        .frame(minHeight: 32).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func stateLine(_ state: TaskRowState, task: JSONValue?) -> some View {
        switch state {
        case .running:
            ChatLiveLabel(text: ChatSubagents.taskStateText(state, task: task, now: .now))
        case .paused:
            // The time it waits for reads as today, tomorrow or a day, so it is said again once a minute.
            TimelineView(.everyMinute) { context in
                Text(ChatSubagents.taskStateText(state, task: task, now: context.date))
                    .foregroundStyle(MobileStyle.faint)
            }
        default:
            Text(ChatSubagents.taskStateText(state, task: task, now: .now)).foregroundStyle(Self.tone(state))
        }
    }

    private static func tone(_ state: TaskRowState) -> Color {
        switch state {
        case .waiting: MobileStyle.statusNeedsYou
        case .failed: MobileStyle.statusError
        default: MobileStyle.faint
        }
    }

    /// The model as its CLI names it, without the words every model of that CLI shares.
    private func modelName(_ child: ChatAgentIdentity?) -> String? {
        let slug = child?.model.isEmpty == false ? child?.model : item.model
        guard let slug, !slug.isEmpty else { return nil }
        let models = child.map { sources?.models($0.provider) ?? [] } ?? []
        return ModelName.short(ModelName.of(slug, in: models), in: models)
    }
}

/// A CLI's mark, as the desktop's `AgentIcon` draws it. A CLI without one here, such as one only a newer machine
/// knows, gets the generic agent icon instead of another CLI's mark.
struct ChatProviderMark: View {
    let provider: String
    var size: CGFloat = 14

    var body: some View {
        switch provider {
        case "claude", "codex":
            Image(provider == "codex" ? "CodexMark" : "ClaudeMark")
                .renderingMode(.template).resizable().scaledToFit()
                .frame(width: size, height: size)
                .accessibilityLabel(provider.capitalized)
        default:
            Image(lucide: "bot", size: size)
        }
    }
}
