import RuimtePulsar
import RuimteShared
import SwiftUI

struct ChatLiveLabel: View {
    let text: AttributedString
    var active = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    init(text: String, active: Bool = true) {
        self.init(attributed: AttributedString(text), active: active)
    }

    init(attributed: AttributedString, active: Bool = true) {
        self.text = attributed
        self.active = active
    }

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
    var runningFor = false
    @Environment(\.scenePhase) private var scenePhase

    @State private var visible = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1, paused: !visible || scenePhase != .active)) { context in
            let elapsed = max(0, context.date.timeIntervalSince1970 * 1000 - startedAt)
            let value = clock ? Format.clockDuration(milliseconds: elapsed) : Format.elapsedShort(milliseconds: elapsed)
            Text(Self.label(value, runningFor: runningFor)).monospacedDigit()
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
    }

    private static func label(_ value: String, runningFor: Bool) -> String {
        guard runningFor else { return value }
        return String(
            localized: "running for \(value)", comment: "How long a sub-agent or a workflow's agent has run so far")
    }
}

/// The line closing a running turn, under the mark of the call it runs last and a spinner between calls. While it
/// waits on a person or lost its machine it says so instead of its clock, which the desktop does not.
struct ChatWorkingRow: View {
    let entry: ChatTimelineEntry
    let presentation: ChatPresentation

    var body: some View {
        let call = entry.items.last?.item.toolItem
        let startedAt = entry.items.first?.item.turnItem?.createdAt ?? presentation.startedAt
        HStack(spacing: 8) {
            if let call {
                ChatToolMarkView(mark: ChatToolPresentation.mark(call)).foregroundStyle(MobileStyle.accent)
            } else {
                Spinner(size: 14).foregroundStyle(MobileStyle.statusRunning)
            }
            ChatLiveLabel(text: presentation.activityLabel, active: presentation.isAnimating)
            if presentation.isAnimating, let startedAt {
                ChatElapsed(startedAt: startedAt, clock: true).accessibilityHidden(true)
            }
        }
        .font(.footnote).foregroundStyle(MobileStyle.muted)
        .frame(minHeight: 28)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            presentation.isAnimating ? String(localized: "Agent is working") : presentation.activityLabel
        )
        .accessibilityIdentifier("chat.working")
    }
}

struct ChatThinkingRow: View {
    let item: ChatThinkingItem
    @AppStorage(Settings.chatStreaming) private var streamingMode
    @State private var expanded = false
    private var streaming: Bool { item.streaming }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ChatExpansionButton(expanding: !expanded) {
                expanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(lucide: "brain", size: 14)
                    if streaming {
                        // Whole, the thought stays behind its placeholder until it is done.
                        let live = streamingMode == .whole ? "" : ChatThought.line(item.text)
                        ChatLiveLabel(text: live.isEmpty ? String(localized: "Thinking…") : live).lineLimit(1)
                    } else {
                        let duration = Format.elapsedShort(
                            milliseconds: (item.endedAt ?? item.createdAt) - item.createdAt)
                        let preview = ChatThought.preview(item.text)
                        if preview.isEmpty {
                            Text("Thought for \(duration)").lineLimit(1)
                        } else {
                            Text(expanded ? String(localized: "Thought") : preview).lineLimit(1)
                            Spacer(minLength: 0)
                            Text(duration).monospacedDigit().foregroundStyle(MobileStyle.faint).fixedSize()
                        }
                        Image(lucide: expanded ? "chevron-down" : "chevron-right", size: 12)
                    }
                }.frame(minHeight: 28).contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(streaming)
            .font(.footnote).foregroundStyle(MobileStyle.muted)
            .accessibilityValue(streaming || expanded ? "Expanded" : "Collapsed")
            if expanded || streaming && streamingMode != .whole {
                ChatStreamingMessage(text: item.text, streaming: streaming)
                    .foregroundStyle(MobileStyle.muted)
                    .padding(.leading, 14)
                    .overlay(alignment: .leading) { Rectangle().fill(MobileStyle.border).frame(width: 1) }
            }
        }
    }
}

/// The latest thought of a running turn over the call it led to, so what the model found stays in sight while the
/// call checks it.
struct ChatLiveThoughtRow: View {
    let item: ChatThinkingItem

    var body: some View {
        let line = ChatThought.line(item.text)
        if !line.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(lucide: "brain", size: 14)
                Text(line).lineLimit(4).textSelection(.enabled)
            }
            .font(.footnote).foregroundStyle(MobileStyle.muted)
            .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}

struct ChatToolRow: View {
    let item: ChatToolItem
    /// Said instead of what the call was called with, as a workflow's name.
    var detail: String?
    /// Whether the call waits on a person's answer to an approval of it, when its clock is not running yet.
    var awaitingApproval = false
    @Environment(\.colorScheme) private var colorScheme
    @State private var expanded = false
    private var running: Bool { item.state == .running }

    var body: some View {
        let opens = ChatToolBody.opens(item)
        VStack(alignment: .leading, spacing: 6) {
            if opens {
                ChatExpansionButton(expanding: !expanded) {
                    expanded.toggle()
                } label: {
                    ChatToolLine(
                        item: item, expanded: expanded, opens: true, detail: detail, awaitingApproval: awaitingApproval)
                }
                .buttonStyle(.plain)
                .accessibilityValue(expanded ? "Expanded" : running ? "Running, collapsed" : "Collapsed")
            } else {
                ChatToolLine(
                    item: item, expanded: false, opens: false, detail: detail, awaitingApproval: awaitingApproval
                )
                .accessibilityElement(children: .combine)
            }
            // The suffixes `readImagePath` on the desktop draws, without SVG, which UIImage cannot.
            if item.state == .done, ["Read", "NotebookRead"].contains(item.name),
                let path = item.input["file_path"]?.stringValue,
                ["png", "jpg", "jpeg", "gif", "webp"].contains((path as NSString).pathExtension.lowercased())
            {
                ChatInlineImage(
                    resource: .object(["kind": .string("file"), "path": .string(path)]),
                    name: (path as NSString).lastPathComponent)
            }
            if expanded && opens {
                ChatToolBodyView(item: item)
            } else if running {
                let tail = ChatToolPresentation.tail(item)
                if !tail.isEmpty {
                    ScrollView(.horizontal) {
                        Text(
                            ChatAnsi.attributed(
                                tail, dark: colorScheme == .dark, base: MobileStyle.text, ground: MobileStyle.panel)
                        )
                        .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
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

/// The one line of a call: what did it, then what it worked on, cut where the line ends and never wrapped.
private struct ChatToolLine: View {
    let item: ChatToolItem
    let expanded: Bool
    let opens: Bool
    var detail: String?
    var awaitingApproval = false
    private var running: Bool { item.state == .running }
    private var failed: Bool { item.state == .error }

    var body: some View {
        let run = RuimteCommandLook.run(of: item)
        HStack(spacing: 8) {
            ChatToolMarkView(mark: ChatToolPresentation.mark(item))
                .foregroundStyle(running ? MobileStyle.accent : MobileStyle.muted)
            // The label is the body face and the detail mono, so only a shared baseline puts them on one line.
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                ChatLiveLabel(
                    attributed: run.map(RuimteCommandLook.title) ?? AttributedString(item.name), active: running
                )
                .lineLimit(1).layoutPriority(2)
                Group {
                    if let run {
                        if !run.detail.isEmpty {
                            ChatCommandDetail(run: run).foregroundStyle(MobileStyle.faint)
                        }
                        ForEach(RuimteCommandLook.tags(run), id: \.self) { tag in
                            Text(tag).font(.caption2).foregroundStyle(MobileStyle.faint)
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                .background(MobileStyle.hover, in: RoundedRectangle(cornerRadius: 4))
                                .layoutPriority(1)
                        }
                    } else {
                        let summary = detail ?? ChatToolPresentation.lineDetail(item)
                        if !summary.isEmpty {
                            Text(summary).font(.system(.caption, design: .monospaced))
                                .foregroundStyle(MobileStyle.faint)
                                .truncationMode(
                                    detail == nil && ChatToolPresentation.summaryIsPath(item) ? .middle : .tail)
                        }
                    }
                }
                .lineLimit(1)
            }
            Spacer(minLength: 0)
            Group {
                if running && awaitingApproval {
                    Text("waiting for you", comment: "On a call that waits on a person's approval, lowercase")
                        .foregroundStyle(MobileStyle.faint)
                } else if running {
                    ChatElapsed(startedAt: item.progress?.startedAt ?? item.createdAt)
                } else if failed {
                    // Only a cross says it failed, so the line stays readable in its own tone.
                    Image(lucide: "x", size: 12).foregroundStyle(MobileStyle.statusError)
                        .accessibilityLabel(String(localized: "Failed"))
                }
                if opens {
                    Image(lucide: expanded ? "chevron-down" : "chevron-right", size: 12)
                }
            }
            .fixedSize().layoutPriority(3)
        }
        .font(.footnote).foregroundStyle(MobileStyle.muted)
        .frame(minHeight: 28).contentShape(Rectangle())
    }
}

struct ChatToolMarkView: View {
    let mark: ChatToolMark
    var size: CGFloat = 14

    var body: some View {
        switch mark {
        case .lucide(let name): Image(lucide: name, size: size)
        case .ruimte:
            Image("RuimteMark").resizable().frame(width: size, height: size).accessibilityHidden(true)
        }
    }
}

/// A `ruimte-context` call from the word that says what it does, with the ids of views and nodes of the chat's
/// project drawn as their titles.
struct ChatCommandDetail: View {
    let run: RuimteCommandRun
    @Environment(\.chatContent) private var context

    var body: some View {
        let parts = RuimteCommandLook.detailParts(run, names: names)
        Self.text(parts)
            .font(.system(.caption, design: .monospaced))
            .textRenderer(ChatNamePillRenderer())
            .accessibilityLabel(Text(verbatim: Self.spoken(parts)))
    }

    private var names: [String: ChatCommandName] {
        guard let context, let workspace = context.workspace else { return [:] }
        let names = RuimteCommandLook.projectNames(workspace.storedViews)
        // A chat of another project keeps its ids, since the ids it names are not in this one.
        return names[context.chatID] == nil ? [:] : names
    }

    private static func text(_ parts: [ChatCommandDetailPart]) -> Text {
        parts.reduce(Text(verbatim: "")) { output, part in
            switch part {
            case .text(let text):
                return Text("\(output)\(Text(verbatim: text))")
            case .name(let name, _):
                let pill = Text("\(Text(Image(lucide: name.icon, size: 11)))\(Text(verbatim: " \(name.name)"))")
                    .font(.caption).foregroundStyle(MobileStyle.text).customAttribute(ChatNamePill())
                return Text("\(output)\(pill)")
            }
        }
    }

    private static func spoken(_ parts: [ChatCommandDetailPart]) -> String {
        parts.map { part in
            switch part {
            case .text(let text): text
            case .name(let name, _): name.name
            }
        }.joined()
    }
}

private struct ChatNamePill: TextAttribute {}

/// Draws a frame behind each name, so a title reads as a reference and not as part of the command.
private struct ChatNamePillRenderer: TextRenderer {
    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            var frame: CGRect?
            for run in line {
                if run[ChatNamePill.self] != nil {
                    frame = frame?.union(run.typographicBounds.rect) ?? run.typographicBounds.rect
                } else if let pill = frame {
                    fill(pill, in: &context)
                    frame = nil
                }
            }
            if let frame { fill(frame, in: &context) }
            for run in line { context.draw(run) }
        }
    }

    private func fill(_ rect: CGRect, in context: inout GraphicsContext) {
        let shape = RoundedRectangle(cornerRadius: 4).path(in: rect.insetBy(dx: -3, dy: -1))
        context.fill(shape, with: .color(MobileStyle.hover))
        context.stroke(shape, with: .color(MobileStyle.border), lineWidth: 1)
    }
}
