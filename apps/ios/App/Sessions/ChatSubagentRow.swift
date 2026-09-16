import RuimtePulsar
import RuimteTransport
import SwiftUI

struct ChatSubagentRow: View {
    let agent: ChatItemState
    let children: [ChatItemState]
    let presentation: ChatPresentation
    let client: any MachineRequesting
    let chatID: String
    @State private var showingResult = false
    private var item: JSONValue { agent.value }
    private var running: Bool { item.text("status") == "running" }
    private var expanded: Bool { presentation.expandedSubagents.contains(agent.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ChatExpansionButton(expanding: !expanded) {
                presentation.toggleSubagent(agent.id)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Image(lucide: "bot", size: 14)
                        // A node another agent opened with `--task` reads as the task it is.
                        ChatLiveLabel(text: item.text("origin") == "ruimte" ? "Task" : "Sub-agent", active: running)
                        Spacer(minLength: 4)
                        if running {
                            ChatElapsed(startedAt: item.number("startedAt"))
                        } else {
                            Text(item.text("status") == "failed" ? "Failed" : "Done")
                                .foregroundStyle(item.text("status") == "failed" ? Color.red : MobileStyle.muted)
                            if let end = item["finishedAt"]?.numberValue {
                                Text("in \(ChatToolPresentation.elapsed(end - item.number("startedAt")))")
                            }
                        }
                        Image(lucide: expanded ? "chevron-down" : "chevron-right", size: 12)
                    }
                    Text(item.text("description", fallback: item.text("summary"))).lineLimit(2).padding(.leading, 22)
                    if item["background"]?.boolValue == true || running && !item.text("lastTool").isEmpty {
                        Text(
                            [
                                item["background"]?.boolValue == true ? "Background" : "",
                                running ? item.text("lastTool") : "",
                            ].filter { !$0.isEmpty }.joined(separator: " · ")
                        )
                        .font(.caption).padding(.leading, 22)
                    }
                }.frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).font(.footnote).foregroundStyle(MobileStyle.muted)
                .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    if item["itemsTruncated"]?.boolValue == true {
                        Text("Only the beginning of this agent's work is kept.").font(.caption).foregroundStyle(
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
                    if let result = item["result"]?.stringValue, !result.isEmpty {
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
}
