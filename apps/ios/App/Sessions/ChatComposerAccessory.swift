import RuimtePulsar
import SwiftUI

struct ChatComposerAccessory: View {
    @Bindable var model: ChatModel
    @Binding var focused: Bool
    let availableHeight: CGFloat
    @State private var showingQueue = false
    @State private var dismissedQuery: ChatDraftQuery?

    private var query: ChatDraftQuery? {
        focused && model.connected
            ? ChatDraftSyntax.query(in: model.draft, selection: model.composition.selection) : nil
    }

    private var hasContent: Bool {
        (query != nil && query != dismissedQuery) || model.sendProblem != nil || model.composition.validation != nil
            || model.composition.storageProblem != nil || model.composition.problem != nil || !model.connected
            || model.loading || !model.queue.isEmpty || model.queuedNotice || model.draft.utf16.count >= 100_000
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let query, query != dismissedQuery {
                VStack(spacing: 0) {
                    HStack {
                        Text(query.kind == "@" ? "Files and conversations" : query.kind == "$" ? "Skills" : "Commands")
                            .font(.caption.weight(.semibold)).foregroundStyle(MobileStyle.muted)
                        Spacer()
                        Button {
                            dismissedQuery = query
                        } label: {
                            Image(lucide: "x", size: 14).frame(width: 44, height: 44)
                        }
                        .accessibilityLabel("Close suggestions")
                    }
                    ScrollView {
                        VStack(spacing: 4) {
                            ChatSuggestionRows(model: model) { suggestion in
                                model.chooseSuggestion(suggestion)
                                focused = true
                            }
                        }
                    }.frame(maxHeight: max(88, min(200, availableHeight * 0.3)))
                }
                .padding(.horizontal, 12).padding(.bottom, 8)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
            }
            if let error = model.sendProblem {
                VStack(alignment: .leading, spacing: 4) {
                    Text(error).font(.subheadline).foregroundStyle(MobileStyle.statusError)
                    HStack {
                        if model.sendUncertain {
                            Button("Reload conversation") { model.attach() }.disabled(!model.connected)
                            Button("I've checked") {
                                model.sendUncertain = false
                                model.sendProblem = nil
                            }
                        } else {
                            Button("Try sending again") { Task { await model.send() } }.disabled(!model.canSend)
                            Button("Dismiss") { model.sendProblem = nil }
                        }
                    }.font(.footnote).buttonStyle(.borderless).frame(minHeight: 44)
                }.padding(12).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            }
            if let issue = model.composition.validation ?? model.composition.storageProblem ?? model.composition.problem
            {
                HStack(alignment: .top, spacing: 8) {
                    Image(lucide: "circle-alert", size: 16)
                    Text(issue).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                    if model.composition.problem != nil && model.composition.validation == nil
                        && model.composition.storageProblem == nil
                    {
                        Button {
                            model.composition.problem = nil
                        } label: {
                            Image(lucide: "x", size: 14).frame(width: 44, height: 44)
                        }
                        .accessibilityLabel("Dismiss attachment message")
                    }
                }.foregroundStyle(MobileStyle.statusError).padding(12).background(
                    .regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                if model.composition.storageProblem != nil {
                    Button(
                        model.composition.restoreFailed
                            ? "Save new draft and keep a backup of the old one" : "Try saving again"
                    ) {
                        Task { await model.composition.recoverStorage() }
                    }.font(.footnote).frame(minHeight: 44)
                }
            }
            if !model.connected || model.loading {
                Label(
                    model.connected ? "Connecting… You can keep writing." : "Offline. Your draft stays on this iPhone.",
                    lucideIcon: "wifi-off", iconSize: 14
                )
                .font(.caption).foregroundStyle(MobileStyle.muted).padding(.horizontal, 8)
            }
            if !model.queue.isEmpty || model.queuedNotice || model.draft.utf16.count >= 100_000 {
                HStack(spacing: 12) {
                    if !model.queue.isEmpty {
                        Button {
                            focused = false
                            showingQueue = true
                        } label: {
                            Label("\(model.queue.count) queued", lucideIcon: "list-ordered", iconSize: 14)
                                .font(.footnote.weight(.medium)).padding(.horizontal, 12).frame(minHeight: 44)
                                .background(.regularMaterial, in: Capsule())
                        }.buttonStyle(ChatComposerButtonStyle())
                    } else if model.queuedNotice {
                        Text("Added to queue").font(.caption).foregroundStyle(MobileStyle.muted).padding(.horizontal, 8)
                    }
                    Spacer(minLength: 0)
                    if model.draft.utf16.count >= 100_000 {
                        Text("\(model.draft.utf16.count.formatted()) / 120,000").font(.caption).monospacedDigit()
                            .foregroundStyle(MobileStyle.muted)
                    }
                }
            }
        }
        .padding(.bottom, hasContent ? 8 : 0)
        .task(id: query) {
            if let query { await model.search(query.kind, query: query.text) }
        }
        .task(id: model.queuedNotice) {
            guard model.queuedNotice else { return }
            do {
                try await Task.sleep(for: .seconds(3))
                model.queuedNotice = false
            } catch {}
        }
        .mobileSheet(isPresented: $showingQueue) { queueSheet }
    }

    private var queueSheet: some View {
        NavigationStack {
            List {
                if let error = model.queueProblem { Text(error).foregroundStyle(MobileStyle.statusError) }
                if model.queue.isEmpty { Text("No messages waiting").foregroundStyle(MobileStyle.muted) }
                ForEach(Array(model.queue.enumerated()), id: \.offset) { _, message in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message.text("text", fallback: "Attachments")).font(.body).lineLimit(6)
                        if !message.list("attachments").isEmpty {
                            Text("\(message.list("attachments").count) attachments").font(.caption).foregroundStyle(
                                MobileStyle.muted)
                        }
                        HStack {
                            Button("Edit") {
                                Task {
                                    await model.queueAction(message, edit: true)
                                    if model.queueProblem == nil {
                                        showingQueue = false
                                        focused = true
                                    }
                                }
                            }
                            Spacer()
                            Menu {
                                Button("Stop current turn and send now", lucideIcon: "fast-forward") {
                                    Task { await model.queueAction(message, sendNow: true) }
                                }
                                Button("Remove from queue", lucideIcon: "trash", role: .destructive) {
                                    Task { await model.queueAction(message) }
                                }
                            } label: {
                                Image(lucide: "ellipsis").frame(width: 44, height: 44)
                            }
                            .accessibilityLabel("Queued message actions")
                        }.buttonStyle(.borderless).frame(minHeight: 44)
                    }.disabled(!model.connected || model.queueBusy || model.sending || model.composition.importing)
                }
            }
            .overlay {
                if model.queueBusy {
                    ProgressView().padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .navigationTitle("Message queue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingQueue = false } } }
        }
    }
}
