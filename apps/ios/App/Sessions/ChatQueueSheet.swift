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
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func card(_ message: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message.text("text", fallback: "Attachments")).font(.body).lineLimit(6)
            let attachments = message.list("attachments").count
            if attachments > 0 {
                Text(ChatBackground.counted(attachments, "attachment")).font(.caption)
                    .foregroundStyle(MobileStyle.muted)
            }
            HStack(spacing: 8) {
                Button("Send now", lucideIcon: "zap") {
                    Task { await model.queueAction(message, sendNow: true) }
                }
                .accessibilityHint("Stops the current turn and sends this message.")
                Button("Edit", lucideIcon: "pencil") {
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
                    Image(lucide: "trash", size: 16)
                }
                .tint(MobileStyle.statusError)
                .accessibilityLabel("Remove from queue")
            }
            .font(.subheadline.weight(.medium))
            .buttonStyle(.bordered).buttonBorderShape(.capsule).tint(MobileStyle.text)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MobileStyle.inset.opacity(0.65), in: RoundedRectangle(cornerRadius: 20))
        .disabled(!model.connected || model.queueBusy || model.sending || model.composition.importing)
    }
}
