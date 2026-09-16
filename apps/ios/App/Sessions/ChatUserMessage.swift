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
    func body(content: Content) -> some View {
        content.contextMenu {
            if !text.isEmpty {
                Button("Copy message", lucideIcon: "copy") {
                    UIPasteboard.general.string =
                        (try? AttributedString(markdown: text)).map { String($0.characters) } ?? text
                }
                Button("Copy as Markdown", lucideIcon: "file-text") { UIPasteboard.general.string = text }
            }
        }
    }
}
