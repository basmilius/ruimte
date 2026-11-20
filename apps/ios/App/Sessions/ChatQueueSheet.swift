import RuimtePulsar
import SwiftUI

/// The messages written while a turn ran, each with what can still happen to it before it goes.
struct ChatQueueSheet: View {
    @Bindable var model: ChatModel
    let edited: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let error = model.queueProblem {
                        Text(error).font(.subheadline).foregroundStyle(MobileStyle.statusError)
                    }
                    if model.queue.isEmpty {
                        Text("No messages waiting").foregroundStyle(MobileStyle.muted)
                    }
                    ForEach(Array(model.queue.enumerated()), id: \.offset) { _, message in card(message) }
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .overlay {
                if model.queueBusy {
                    ProgressView().padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .navigationTitle("Queue (\(model.queue.count))")
            .navigationSubtitle("Sent as soon as the current turn finishes.")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(role: .close) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func card(_ message: ChatInfoQueueItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(verbatim: RuimteSkillNames.withTitles(message.text)).font(.body).lineLimit(6)
            let attachments = message.attachments?.count ?? 0
            if attachments > 0 {
                Text("\(attachments) attachments").font(.caption)
                    .foregroundStyle(MobileStyle.muted)
            }
            HStack(spacing: 8) {
                Button(String(localized: "Send now"), lucideIcon: "fast-forward") {
                    Task { await model.queueAction(message, sendNow: true) }
                }
                .accessibilityHint("Stops the current turn and sends this message.")
                Button(String(localized: "Edit"), lucideIcon: "pencil") {
                    Task {
                        await model.queueAction(message, edit: true)
                        if model.queueProblem == nil {
                            dismiss()
                            edited()
                        }
                    }
                }
                Spacer(minLength: 0)
                Button(role: .destructive) {
                    Task { await model.queueAction(message) }
                } label: {
                    Image(lucide: "x", size: 16)
                }
                .buttonStyle(.mobileIcon)
                .accessibilityLabel("Remove from queue")
            }
            .buttonStyle(.mobileCapsule)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MobileStyle.inset.opacity(0.65), in: RoundedRectangle(cornerRadius: 20))
        .disabled(!model.connected || model.queueBusy || model.sending || model.composition.importing)
    }
}
