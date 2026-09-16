import SwiftUI
import UIKit

/// The messages a person sent in a long conversation, to jump back to one. A phone has no width to spare for a
/// strip beside the thread and a finger cannot hover one, so this is a list the toolbar opens: a popover on iPad
/// and a sheet on iPhone, searchable, scrolled to what is on screen and marking it.
struct ChatMessageIndex: View {
    let marks: [ChatMessageMark]
    /// The timeline entries on screen when the index opened.
    let onScreen: Set<String>
    let olderAvailable: Bool
    let loadingOlder: Bool
    let presentation: ChatPresentation
    let loadOlder: () -> Void
    let jump: (String) -> Void
    let fork: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var shown: [ChatMessageMark] {
        query.isEmpty ? marks : marks.filter { $0.text.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { reader in
                List {
                    if olderAvailable && query.isEmpty {
                        Button {
                            loadOlder()
                        } label: {
                            if loadingOlder {
                                ProgressView()
                            } else {
                                Label("Load older messages", lucideIcon: "arrow-up", iconSize: 14)
                            }
                        }
                        .disabled(loadingOlder)
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
