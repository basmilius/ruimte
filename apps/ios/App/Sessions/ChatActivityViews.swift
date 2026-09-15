import RuimtePulsar
import SwiftUI

struct ChatLiveLabel: View {
    let text: String
    var active = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    var body: some View {
        Text(text)
            .foregroundStyle(MobileStyle.muted)
            .overlay {
                if active && !reduceMotion && visible && scenePhase == .active {
                    TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                        GeometryReader { geometry in
                            let phase =
                                context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                            LinearGradient(
                                colors: [.clear, MobileStyle.text, .clear], startPoint: .leading, endPoint: .trailing
                            )
                            .frame(width: geometry.size.width)
                            .offset(x: geometry.size.width * (phase * 3 - 1.5))
                        }
                    }
                    .mask(Text(text))
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)
                }
            }
            .onAppear { visible = true }
            .onDisappear { visible = false }
    }
}

struct ChatElapsed: View {
    let startedAt: Double
    var clock = false
    @Environment(\.scenePhase) private var scenePhase

    @State private var visible = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1, paused: !visible || scenePhase != .active)) { context in
            let elapsed = max(0, context.date.timeIntervalSince1970 * 1000 - startedAt)
            let seconds = Int(elapsed / 1000)
            Text(
                clock ? String(format: "%02d:%02d", seconds / 60, seconds % 60) : ChatToolPresentation.elapsed(elapsed)
            )
            .monospacedDigit()
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
    }
}

struct ChatWorkingRow: View {
    let presentation: ChatPresentation

    var body: some View {
        HStack(spacing: 8) {
            Image(lucide: presentation.isAnimating ? "circle-dashed" : "circle-pause", size: 14)
            ChatLiveLabel(text: presentation.activityLabel, active: presentation.isAnimating)
            if presentation.isAnimating, let startedAt = presentation.startedAt {
                ChatElapsed(startedAt: startedAt, clock: true).accessibilityHidden(true)
            }
        }
        .font(.footnote).foregroundStyle(MobileStyle.muted)
        .frame(minHeight: 28)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(presentation.isAnimating ? "Agent is working" : presentation.activityLabel)
        .accessibilityIdentifier("chat.working")
    }
}

struct ChatThinkingRow: View {
    let item: JSONValue
    @AppStorage("ruimte.chat.streaming") private var streamingMode: ChatStreamingMode = .words
    @State private var expanded = false
    @Environment(\.chatWillExpand) private var willExpand
    private var streaming: Bool { item["streaming"]?.boolValue == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                willExpand()
                expanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(lucide: "brain", size: 14)
                    if streaming {
                        ChatLiveLabel(text: "Thinking...")
                    } else {
                        Text(
                            "Thought for \(ChatToolPresentation.elapsed(item.number("endedAt", fallback: item.number("createdAt")) - item.number("createdAt")))"
                        )
                        Image(lucide: expanded ? "chevron-down" : "chevron-right", size: 12)
                    }
                }.frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(streaming)
            .font(.footnote).foregroundStyle(MobileStyle.muted)
            .accessibilityValue(streaming || expanded ? "Expanded" : "Collapsed")
            if expanded || streaming && streamingMode != .whole {
                ChatStreamingMessage(text: item.text("text"), streaming: streaming)
                    .foregroundStyle(MobileStyle.muted)
                    .padding(.leading, 14)
                    .overlay(alignment: .leading) { Rectangle().fill(MobileStyle.border).frame(width: 1) }
            }
        }
    }
}

struct ChatToolRow: View {
    let item: JSONValue
    @State private var expanded = false
    @Environment(\.chatWillExpand) private var willExpand
    private var running: Bool { item.text("state") == "running" }
    private var failed: Bool { item.text("state") == "error" }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                willExpand()
                expanded.toggle()
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Image(lucide: failed ? "circle-alert" : ChatToolPresentation.icon(item.text("name")), size: 14)
                        ChatLiveLabel(text: item.text("name", fallback: "Tool"), active: running)
                        Spacer(minLength: 4)
                        if running {
                            ChatElapsed(
                                startedAt: item["progress"]?["startedAt"]?.numberValue ?? item.number("createdAt"))
                        } else if failed {
                            Text("Failed").foregroundStyle(.red)
                        }
                        Image(lucide: expanded ? "chevron-down" : "chevron-right", size: 12)
                    }
                    let summary = ChatToolPresentation.summary(item)
                    if !summary.isEmpty {
                        Text(summary).font(.system(.caption, design: .monospaced)).lineLimit(2)
                            .padding(.leading, 22)
                    }
                }.frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain).font(.footnote).foregroundStyle(failed ? Color.red : MobileStyle.muted)
            .accessibilityValue(expanded ? "Expanded" : running ? "Running, collapsed" : "Collapsed")
            if item.text("state") == "done", ["Read", "NotebookRead"].contains(item.text("name")),
                let path = item["input"]?["file_path"]?.stringValue,
                ["png", "jpg", "jpeg", "gif", "webp"].contains((path as NSString).pathExtension.lowercased())
            {
                ChatInlineImage(
                    resource: .object(["kind": .string("file"), "path": .string(path)]),
                    name: (path as NSString).lastPathComponent)
            }
            if expanded {
                let changes = ChatFileChanges.grouped(ChatFileChanges.fromTool(item))
                if changes.isEmpty {
                    if let input = item["input"], let data = try? input.encoded(),
                        let text = String(data: data, encoding: .utf8)
                    {
                        ChatToolOutput(text: text, language: "json")
                    }
                } else {
                    ForEach(changes) { change in ChatFileChangeView(change: change) }
                }
                ChatToolOutput(text: item["output"]?.stringValue ?? item["progress"]?.text("output") ?? "")
            } else if running {
                let tail = ChatToolPresentation.tail(item)
                if !tail.isEmpty {
                    ScrollView(.horizontal) {
                        Text(tail).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                            .padding(12)
                    }
                    .frame(maxHeight: 180)
                    .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 10))
                    .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(MobileStyle.border) }
                }
            }
        }
    }
}

private struct ChatToolOutput: View {
    let text: String
    var language = ""
    @State private var expanded = false
    @Environment(\.chatWillExpand) private var willExpand
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            CodeMessage(text: expanded ? text : String(text.prefix(4000)), language: language)
            if !expanded && text.count > 4000 {
                Button("Show all output") {
                    willExpand()
                    expanded = true
                }.font(.caption).frame(minHeight: 44)
            }
        }
    }
}
