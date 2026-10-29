import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

struct ChatUserMessage: View {
    let item: ChatUserItem
    let client: any MachineRequesting
    let chatID: String
    var presentation: ChatPresentation?
    @Environment(\.chatReferenceLookup) private var lookup
    @State private var expanded = false
    private var long: Bool { item.text.count > 600 || item.text.split(separator: "\n").count > 8 }

    private var referenced: [String] {
        var seen = Set<String>()
        return ((item.chats ?? []) + (item.references ?? [])).filter { seen.insert($0).inserted }
    }

    /// Each reference under the name it has now, which is how the text spells one that was not renamed since.
    private var tokens: [ChatDraftReference] {
        referenced.compactMap { id in lookup.item(id).map { ChatDraftReference(id: id, title: $0.name) } }
    }

    /// A chat attached before `#` existed, or a view renamed or gone since, is not in the text; it stands beside it.
    private var beside: [String] {
        let placed = Set(ChatDraftSyntax.presentReferences(in: item.text, references: tokens))
        return referenced.filter { !placed.contains($0) }
    }

    private func choiceReveal(_ origin: ChatUserItemUiChoice) -> (() -> Void)? {
        guard let presentation, UiChoiceJump(origin) != nil else { return nil }
        return { presentation.uiChoiceRequest = UiChoiceJump(origin) }
    }

    /// The pictures attached to this message, which a swipe in the lightbox walks.
    private var images: [ChatLightboxImage] {
        (item.attachments ?? []).filter { $0.mime.hasPrefix("image/") }.map {
            ChatLightboxImage(resource: .chatAttachment(chatID: chatID, id: $0.id), name: $0.name, mime: $0.mime)
        }
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            ChatImageGroupScope(images: images) {
                ForEach(Array((item.attachments ?? []).enumerated()), id: \.offset) { _, attachment in
                    ChatAttachmentButton(
                        client: client, chatID: chatID, id: attachment.id, name: attachment.name,
                        mime: attachment.mime, size: attachment.size)
                }
            }
            let beside = beside
            if !beside.isEmpty {
                UiFlowLayout(spacing: 6) {
                    ForEach(beside, id: \.self) { id in
                        ChatReferenceChip(
                            look: ChatReferenceChip.look(id, chat: item.chats?.contains(id) == true, lookup: lookup))
                    }
                }
            }
            if let origin = item.uiChoice {
                UiChoiceLine(origin: origin, reveal: choiceReveal(origin))
            }
            if !item.text.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    text
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
                                expanded ? String(localized: "Show less") : String(localized: "Show all"),
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

    /// A quote only leads somewhere while the message still opens with the blockquote it was sent with.
    @ViewBuilder private var text: some View {
        if let source = item.quoteSource?.itemId, let presentation, let quoted = ChatQuote.split(item.text) {
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    presentation.requestQuote(messageID: item.id, sourceID: source)
                } label: {
                    MarkdownMessage(text: quoted.quote)
                        .foregroundStyle(MobileStyle.muted)
                        .padding(.leading, 10)
                        .overlay(alignment: .leading) { Rectangle().fill(MobileStyle.border).frame(width: 2) }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Goes to the reply")
                if presentation.goneQuotes.contains(item.id) {
                    Text("Quoted reply no longer in this chat.").font(.caption).foregroundStyle(MobileStyle.faint)
                }
                if !quoted.rest.isEmpty { message(quoted.rest) }
            }
        } else {
            message(item.text)
        }
    }

    private func message(_ text: String) -> some View {
        MarkdownMessage(text: text)
            .environment(\.chatMentions, item.mentions ?? [])
            .environment(\.chatSkills, item.skills ?? [])
            .environment(\.chatPickedReferences, tokens)
    }
}

/// A message another node sent the chat: a bubble like a person's, under a chip that names and opens the sender, but
/// on the leading side, since the person did not write it.
struct ChatSentMessage: View {
    let message: ChatNoteItemMessage
    @Environment(\.chatReferenceLookup) private var lookup
    @State private var expanded = false
    private var long: Bool { message.text.count > 600 || message.text.split(separator: "\n").count > 8 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ChatReferenceChip(look: ChatReferenceChip.look(message.from, chat: false, lookup: lookup, lastName: message.title))
            VStack(alignment: .leading, spacing: 4) {
                MarkdownMessage(text: message.text)
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
                            expanded ? String(localized: "Show less") : String(localized: "Show all"),
                            lucideIcon: expanded ? "chevron-up" : "chevron-down", iconSize: 12
                        )
                        .font(.caption).foregroundStyle(MobileStyle.muted).frame(minHeight: 44)
                    }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(MobileStyle.hover, in: RoundedRectangle(cornerRadius: 18))
        }
        .frame(maxWidth: 620, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            message.title.isEmpty
                ? String(localized: "Message from another node")
                : String(
                    localized: "Message from \(message.title)",
                    comment: "%@ is the name the sending node had on the canvas"))
    }
}

/// A view, node or chat a message points at that its text does not spell, under the name it has now; one that went
/// says so. It opens what it points at, as the chips in the text do.
struct ChatReferenceChip: View {
    struct Look: Equatable {
        let id: String
        let icon: String
        let title: String
        /// False for one that is no longer in the project, or a thread outside any project.
        let opens: Bool
        let gone: Bool
    }

    let look: Look
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if let url = ChatReferables.url(look.id) { openURL(url) }
        } label: {
            HStack(spacing: 4) {
                Image(lucide: look.icon, size: 12)
                Text(look.title).lineLimit(1)
            }
            .font(.footnote.weight(.medium)).foregroundStyle(look.gone ? MobileStyle.faint : MobileStyle.text)
            .padding(.horizontal, 6).frame(minHeight: 22)
            .background(MobileStyle.text.opacity(look.gone ? 0.04 : 0.08), in: RoundedRectangle(cornerRadius: 6))
            .overlay {
                RoundedRectangle(cornerRadius: 6).strokeBorder(MobileStyle.text.opacity(look.gone ? 0.08 : 0.16))
            }
        }
        .buttonStyle(.plain)
        .disabled(!look.opens)
        .accessibilityLabel(look.title)
    }

    /// Without the project around it a thread cannot tell a reference that left it from one it does not know.
    /// `lastName` is what the message knows the reference was called, shown when it is not in the project now.
    static func look(_ id: String, chat: Bool, lookup: ChatReferenceLookup, lastName: String = "") -> Look {
        guard lookup.known else {
            let fallback = chat ? String(localized: "Chat") : String(localized: "View or node")
            return Look(
                id: id, icon: chat ? "message-square" : "hash",
                title: lastName.isEmpty ? fallback : lastName, opens: false, gone: false)
        }
        guard let item = lookup.item(id) else {
            return Look(
                id: id, icon: "circle-off", title: lastName.isEmpty ? String(localized: "Not in this project") : lastName,
                opens: false, gone: true)
        }
        return Look(
            id: id, icon: ChatReferables.icon(item.kind),
            title: item.name.isEmpty ? String(localized: "Untitled") : item.name, opens: true, gone: false)
    }
}

struct ChatMessageMenu: ViewModifier {
    let text: String
    /// The thread that can fork after this row's turn; nil where a row has nothing to fork.
    var presentation: ChatPresentation?
    var turnID = ""
    /// The thread whose bookmarks this row can hold; nil where a row takes none.
    var bookmarks: ChatPresentation?
    var itemID = ""
    func body(content: Content) -> some View {
        content.contextMenu {
            if !text.isEmpty {
                Button(String(localized: "Copy message"), lucideIcon: "copy") {
                    UIPasteboard.general.string =
                        (try? AttributedString(markdown: text)).map { String($0.characters) } ?? text
                }
                Button(String(localized: "Copy as Markdown"), lucideIcon: "file-text") {
                    UIPasteboard.general.string = text
                }
            }
            if let presentation, presentation.forkable, !turnID.isEmpty {
                ChatForkButton(presentation: presentation, turnID: turnID)
            }
            if let bookmarks, !itemID.isEmpty {
                ChatBookmarkButtons(presentation: bookmarks, itemID: itemID)
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
            Label(String(localized: "Fork from here"), lucideIcon: "git-fork")
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
                        Button(
                            title ?? String(localized: "Fork", comment: "A forked conversation"), lucideIcon: "git-fork"
                        ) { presentation.openRequest = id }
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
            Text(
                preTokens.map { String(localized: "Context compacted from \(Format.number($0)) tokens") }
                    ?? String(localized: "Context compacted")
            )
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
    let item: ChatNoteItem
    let presentation: ChatPresentation?
    @State private var expanded = false

    var body: some View {
        let level = item.level
        let parts = ChatForking.noteParts(item.text)
        let from = item.from
        let forkTitle = from.flatMap { presentation?.places?.title($0) }
        VStack(alignment: .leading, spacing: 6) {
            Label(
                parts.head,
                lucideIcon: level == .error ? "circle-alert" : level == .warning ? "triangle-alert" : "info",
                iconSize: 14
            )
            .font(.callout).foregroundStyle(
                level == .error ? MobileStyle.statusError : level == .warning ? MobileStyle.statusNeedsYou : MobileStyle.muted
            )
            .accessibilityLabel("\(Self.levelName(level)): \(parts.head)")
            if !parts.rest.isEmpty || forkTitle != nil {
                HStack(spacing: 16) {
                    if !parts.rest.isEmpty {
                        ChatExpansionButton(expanding: !expanded) {
                            expanded.toggle()
                        } label: {
                            Label(
                                expanded ? String(localized: "Hide") : String(localized: "Show"),
                                lucideIcon: expanded ? "chevron-up" : "chevron-down",
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
                            Group {
                                if ChatForking.waitingNote(item) {
                                    Label(
                                        String(localized: "Open to answer"),
                                        lucideIcon: "message-circle-question-mark", iconSize: 12)
                                } else {
                                    Label(String(localized: "Open fork"), lucideIcon: "git-fork", iconSize: 12)
                                }
                            }
                            .frame(minHeight: 44)
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

    private static func levelName(_ level: ChatNoteItemLevel) -> String {
        switch level {
        case .error: String(localized: "Error")
        case .warning: String(localized: "Warning")
        case .info: String(localized: "Info")
        }
    }
}
