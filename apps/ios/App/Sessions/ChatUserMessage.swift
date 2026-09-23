import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

struct ChatUserMessage: View {
    let item: JSONValue
    let client: any MachineRequesting
    let chatID: String
    @State private var expanded = false
    private var long: Bool { item.text("text").count > 600 || item.text("text").split(separator: "\n").count > 8 }

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            ForEach(Array(item.list("attachments").enumerated()), id: \.offset) { _, attachment in
                ChatAttachmentButton(client: client, chatID: chatID, attachment: attachment)
            }
            if !item.text("text").isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    MarkdownMessage(text: item.text("text"))
                        .environment(\.chatMentions, item.list("mentions").compactMap(\.stringValue))
                        .environment(\.chatSkills, item.list("skills").compactMap(\.stringValue))
                        .frame(maxHeight: long && !expanded ? 180 : nil, alignment: .top)
                        .clipped()
                        .mask {
                            if long && !expanded {
                                LinearGradient(
                                    stops: [
                                        .init(color: .black, location: 0), .init(color: .black, location: 0.75),
                                        .init(color: .clear, location: 1),
                                    ], startPoint: .top, endPoint: .bottom)
                            } else {
                                Rectangle()
                            }
                        }
                    if long {
                        ChatExpansionButton(expanding: !expanded) {
                            expanded.toggle()
                        } label: {
                            Label(
                                expanded ? "Show less" : "Show all",
                                lucideIcon: expanded ? "chevron-up" : "chevron-down", iconSize: 12
                            )
                            .font(.caption).foregroundStyle(MobileStyle.muted).frame(minHeight: 44)
                        }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(MobileStyle.active, in: RoundedRectangle(cornerRadius: 18))
            }
        }
        .frame(maxWidth: 620, alignment: .trailing)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .contain).accessibilityLabel("You")
    }
}

struct ChatMessageMenu: ViewModifier {
    let text: String
    /// The thread that can fork after this row's turn; nil where a row has nothing to fork.
    var presentation: ChatPresentation?
    var turnID = ""
    func body(content: Content) -> some View {
        content.contextMenu {
            if !text.isEmpty {
                Button("Copy message", lucideIcon: "copy") {
                    UIPasteboard.general.string =
                        (try? AttributedString(markdown: text)).map { String($0.characters) } ?? text
                }
                Button("Copy as Markdown", lucideIcon: "file-text") { UIPasteboard.general.string = text }
            }
            if let presentation, presentation.forkable, !turnID.isEmpty {
                ChatForkButton(presentation: presentation, turnID: turnID)
            }
        }
    }
}

/// "Fork from here" in a row's menu, with the reason beneath it while the turn cannot be forked.
struct ChatForkButton: View {
    let presentation: ChatPresentation
    let turnID: String
    var body: some View {
        let refusal = presentation.forkRefusal(turnID: turnID)
        Button {
            presentation.forkRequest = ChatForkRequest(turnID: turnID)
        } label: {
            Label("Fork from here", lucideIcon: "git-fork")
            if let refusal { Text(refusal) }
        }
        .disabled(refusal != nil)
    }
}

/// The long press on a turn's header, which forks after that turn.
struct ChatForkMenu: ViewModifier {
    let presentation: ChatPresentation
    let turnID: String
    func body(content: Content) -> some View {
        if presentation.forkable {
            content.contextMenu { ChatForkButton(presentation: presentation, turnID: turnID) }
        } else {
            content
        }
    }
}

/// Under a turn that forks went on after, the way over to them: one fork opens at once, more open a menu of them by
/// name. A fork no longer in the project has nowhere to lead.
struct ChatForksRow: View {
    let forkIDs: [String]
    let presentation: ChatPresentation

    var body: some View {
        Group {
            if forkIDs.count == 1, let id = forkIDs.first {
                Button {
                    presentation.openRequest = id
                } label: {
                    label
                }
                .disabled(presentation.places?.title(id) == nil)
            } else {
                Menu {
                    ForEach(forkIDs, id: \.self) { id in
                        let title = presentation.places?.title(id)
                        Button(title ?? "Fork", lucideIcon: "git-fork") { presentation.openRequest = id }
                            .disabled(title == nil)
                    }
                } label: {
                    label
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var label: some View {
        HStack(spacing: 8) {
            Image(lucide: "git-fork", size: 12)
            Text(ChatForking.forksLabel(forkIDs.count))
            Image(lucide: "chevron-right", size: 12)
        }
        .font(.footnote).foregroundStyle(MobileStyle.muted)
        .frame(minHeight: 44).contentShape(Rectangle())
    }
}

/// A compaction as a dashed rule: what stands above it is still there to read, but only a summary to the agent.
struct ChatCompactionRule: View {
    let preTokens: Double?

    var body: some View {
        HStack(spacing: 12) {
            dash
            Text(preTokens.map { "Context compacted from \(Int($0).formatted()) tokens" } ?? "Context compacted")
                .font(.caption).foregroundStyle(MobileStyle.faint).lineLimit(1).layoutPriority(1)
            dash
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Everything above reaches the agent only as a summary")
    }

    private var dash: some View {
        ChatHorizontalLine().stroke(MobileStyle.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])).frame(height: 1)
    }
}

private struct ChatHorizontalLine: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.minX, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        }
    }
}

/// A line from the machine. A note of more than one line (a summary a fork sent back) shows its first line and
/// folds the rest open as Markdown; one that came from a fork still in the project leads to it.
struct ChatNoteRow: View {
    let item: JSONValue
    let presentation: ChatPresentation?
    @State private var expanded = false

    var body: some View {
        let level = item.text("level")
        let parts = ChatForking.noteParts(item.text("text"))
        let from = item["from"]?.stringValue
        let forkTitle = from.flatMap { presentation?.places?.title($0) }
        VStack(alignment: .leading, spacing: 6) {
            Label(
                parts.head,
                lucideIcon: level == "error" ? "circle-alert" : level == "warning" ? "triangle-alert" : "info",
                iconSize: 14
            )
            .font(.callout).foregroundStyle(
                level == "error" ? Color.red : level == "warning" ? Color.orange : MobileStyle.muted
            )
            .accessibilityLabel("\(level.capitalized): \(parts.head)")
            if !parts.rest.isEmpty || forkTitle != nil {
                HStack(spacing: 16) {
                    if !parts.rest.isEmpty {
                        ChatExpansionButton(expanding: !expanded) {
                            expanded.toggle()
                        } label: {
                            Label(
                                expanded ? "Hide" : "Show", lucideIcon: expanded ? "chevron-up" : "chevron-down",
                                iconSize: 12
                            )
                            .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(expanded ? "Hide summary" : "Show summary")
                    }
                    if let from, forkTitle != nil {
                        Button {
                            presentation?.openRequest = from
                        } label: {
                            Label("Open fork", lucideIcon: "git-fork", iconSize: 12).frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(forkTitle ?? "")
                    }
                }
                .font(.caption).foregroundStyle(MobileStyle.muted)
            }
            if expanded && !parts.rest.isEmpty {
                MarkdownMessage(text: parts.rest)
            }
        }
    }
}
