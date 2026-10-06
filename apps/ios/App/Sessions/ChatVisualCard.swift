import RuimtePulsar
import RuimteTransport
import SwiftUI

/// A visual in the thread: its page borderless on the thread's ground and as wide as the reply, with Open large and
/// Remove over its top corner, which the page has no way to reach.
struct ChatVisualCard: View {
    let visual: ChatVisual
    let presentation: ChatPresentation
    let client: any MachineRequesting
    let chatID: String
    @State private var reported: Double?
    @State private var failed = false

    var body: some View {
        let remembered = ChatVisualHeights.remembered(visual.id)
        ChatVisualBox(height: { [reported, visual] width in
            reported ?? ChatVisualHeights.initial(visual, width: width, remembered: remembered)
        }) {
            ChatVisualContent(
                visual: visual, failed: $failed,
                read: { [presentation, client, chatID, visual] in
                    try await presentation.visualPages.page(visual.id, client: client, chatID: chatID)
                },
                onHeight: { height, width in
                    let clamped = ChatVisualHeights.clamp(height, maxHeight: visual.maxHeight)
                    ChatVisualHeights.remember(visual.id, width: width, height: clamped)
                    if clamped != reported { reported = clamped }
                })
        }
        .overlay(alignment: .topTrailing) { controls }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: visual.title))
    }

    private var controls: some View {
        GlassEffectContainer(spacing: 6) {
            HStack(spacing: 6) {
                Button {
                    presentation.visualRequest = ChatVisualRequest(visualID: visual.id, action: .expand)
                } label: {
                    Image(lucide: "maximize-2", size: 14).frame(width: 36, height: 36)
                }
                .disabled(failed)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Open large")
                Menu {
                    Button(String(localized: "Remove visual"), lucideIcon: "trash", role: .destructive) {
                        presentation.visualRequest = ChatVisualRequest(visualID: visual.id, action: .remove)
                    }
                } label: {
                    Image(lucide: "ellipsis", size: 14).frame(width: 36, height: 36)
                }
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("More actions")
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(MobileStyle.text)
        .padding(6)
    }
}

/// Takes the width it is offered and the height that width calls for, so a card stands at its height in the same
/// pass that sizes the row, before its page runs.
private struct ChatVisualBox: Layout {
    let height: @Sendable (Double) -> Double

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width.flatMap { $0.isFinite ? $0 : nil } ?? 360
        return CGSize(width: width, height: height(width))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for subview in subviews { subview.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size)) }
    }
}

/// A visual's page with what stands in its place while it loads or when it cannot, in the same box.
private struct ChatVisualContent: View {
    let visual: ChatVisual
    @Binding var failed: Bool
    let read: () async throws -> Data
    var fill = false
    var onHeight: (Double, Double) -> Void = { _, _ in }
    @Environment(\.colorScheme) private var colorScheme
    @State private var page: Data?
    @State private var shown = false

    var body: some View {
        ZStack {
            if let page {
                ChatVisualFrame(
                    visual: visual, page: page, theme: colorScheme == .dark ? .dark : .light, fill: fill,
                    onHeight: onHeight, onShown: { shown = true }, onFailure: { failed = true }
                )
                .opacity(failed ? 0 : 1)
            }
            if failed {
                Label(String(localized: "Could not load \(visual.title)"), lucideIcon: "image-off", iconSize: 14)
                    .font(.caption).foregroundStyle(MobileStyle.muted).multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
            } else if !shown {
                ProgressView().accessibilityLabel(Text("Loading \(visual.title)"))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: visual.id) {
            do {
                page = try await read()
            } catch is CancellationError {
            } catch {
                failed = true
            }
        }
    }
}

/// Opens a visual large and asks before removing one, for the cards of a chat: a card that scrolls out of view goes
/// with its row and would take either along.
struct ChatVisualDialogs: ViewModifier {
    let model: ChatModel
    @State private var expanded: ChatVisual?
    @State private var removing: ChatVisual?

    func body(content: Content) -> some View {
        content
            .onChange(of: model.presentation.visualRequest) { _, request in
                guard let request else { return }
                model.presentation.visualRequest = nil
                guard let visual = model.presentation.visuals.first(where: { $0.id == request.visualID }) else {
                    return
                }
                switch request.action {
                case .expand: expanded = visual
                case .remove: removing = visual
                }
            }
            .onChange(of: model.presentation.visuals) { _, visuals in
                if let expanded, !visuals.contains(where: { $0.id == expanded.id }) { self.expanded = nil }
            }
            .fullScreenCover(item: $expanded) { visual in
                ChatVisualPage(visual: visual, model: model)
            }
            .alert(
                "Remove this visual?",
                isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                presenting: removing
            ) { visual in
                Button("Cancel", role: .cancel) {}
                Button("Remove", role: .destructive) {
                    Task { await model.removeVisual(visual.id) }
                }
            } message: { visual in
                Text("\(visual.title) is deleted from the chat on every device. This cannot be undone.")
            }
    }
}

/// A visual over the whole screen, where its page scrolls inside.
private struct ChatVisualPage: View {
    let visual: ChatVisual
    let model: ChatModel
    @Environment(\.dismiss) private var dismiss
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ChatVisualContent(
                visual: visual, failed: $failed, read: { [model, visual] in try await model.visualPage(visual.id) },
                fill: true
            )
            .background(MobileStyle.surface.ignoresSafeArea())
            .navigationTitle(Text(verbatim: visual.title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
