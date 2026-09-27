import SwiftUI
import UIKit

/// Searchable message index shown as a popover on iPad and a sheet on iPhone.
struct ChatMessageIndex: View {
    let marks: [ChatMessageMark]
    /// The timeline entries on screen when the index opened.
    let onScreen: Set<String>
    /// Where the page before starts; nil once the whole conversation is here.
    let olderCursor: String?
    let presentation: ChatPresentation
    let loadOlder: () -> Void
    let jump: (String) -> Void
    let fork: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    /// The first message before the page before went in, which the list goes back to once it has.
    @State private var firstBeforeOlder: String?

    private var shown: [ChatMessageMark] {
        query.isEmpty ? marks : marks.filter { $0.text.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { reader in
                List {
                    if let olderCursor, query.isEmpty {
                        MobileLoadingRow("Loading earlier messages")
                            .frame(maxWidth: .infinity)
                            .listRowSeparator(.hidden)
                            .onAppear {
                                firstBeforeOlder = marks.first?.id
                                loadOlder()
                            }
                            // A new cursor is a new row, so a row still in view after a page asks for the next one.
                            .id(olderCursor)
                    }
                    ForEach(shown) { mark in
                        row(mark)
                    }
                }
                .listStyle(.plain)
                .overlay {
                    if !query.isEmpty && shown.isEmpty {
                        ContentUnavailableView.search(text: query)
                    }
                }
                .onAppear {
                    if let first = marks.last(where: { onScreen.contains($0.id) }) ?? marks.last {
                        reader.scrollTo(first.id, anchor: .center)
                    }
                }
                .onChange(of: marks.first?.id) {
                    guard let first = firstBeforeOlder else { return }
                    firstBeforeOlder = nil
                    reader.scrollTo(first, anchor: .top)
                }
            }
            .searchable(
                text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Find a message"
            )
            .navigationTitle("Messages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .frame(idealWidth: 400, idealHeight: 560)
    }

    private func row(_ mark: ChatMessageMark) -> some View {
        let visible = onScreen.contains(mark.id)
        return Button {
            jump(mark.id)
            dismiss()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                // The reading position: messages on screen carry the accent, the rest a quiet mark.
                Circle()
                    .fill(visible ? MobileStyle.accent : MobileStyle.border)
                    .frame(width: 8, height: 8)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(mark.text.isEmpty ? "Message" : mark.text)
                        .lineLimit(3)
                        .foregroundStyle(mark.kind == .wake ? MobileStyle.muted : MobileStyle.text)
                    Text(Date(timeIntervalSince1970: mark.createdAt / 1000), format: .dateTime.hour().minute())
                        .font(.caption).foregroundStyle(MobileStyle.muted).monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .id(mark.id)
        .accessibilityValue(visible ? "On screen" : "")
        .accessibilityHint("Jumps to this message")
        .contextMenu {
            if !mark.text.isEmpty && mark.kind == .person {
                Button("Copy message", lucideIcon: "copy") { UIPasteboard.general.string = mark.text }
            }
            if presentation.forkable, let turnID = mark.turnID {
                let refusal = presentation.forkRefusal(turnID: turnID)
                Button {
                    fork(turnID)
                } label: {
                    Label("Fork from here", lucideIcon: "git-fork")
                    if let refusal { Text(refusal) }
                }
                .disabled(refusal != nil)
            }
        }
        .swipeActions(edge: .trailing) {
            if presentation.forkable, let turnID = mark.turnID, presentation.forkRefusal(turnID: turnID) == nil {
                Button("Fork", lucideIcon: "git-fork") { fork(turnID) }.tint(MobileStyle.accent)
            }
        }
    }
}
