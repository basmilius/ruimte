import RuimtePulsar
import RuimteShared
import SwiftUI

struct ChatComposerAccessory: View {
    @Bindable var model: ChatModel
    @Binding var focused: Bool
    let availableHeight: CGFloat
    @State private var dismissedQuery: ChatDraftQuery?

    private var query: ChatDraftQuery? {
        focused && model.connected ? model.draftQuery : nil
    }

    private var hasContent: Bool {
        (query != nil && query != dismissedQuery) || model.sendProblem != nil || model.composition.validation != nil
            || model.composition.storageProblem != nil || model.composition.problem != nil || !model.connected
            || model.loading || model.draft.utf16.count >= 100_000
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let query, query != dismissedQuery {
                VStack(spacing: 0) {
                    HStack {
                        Text(ChatSuggestion.heading(query.kind))
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
                    }.buttonStyle(.mobileCapsuleSmall).frame(minHeight: 44)
                }.padding(12).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            }
            if let issue = model.composition.validation ?? model.composition.storageProblem ?? model.composition.problem
            {
                HStack(spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(lucide: "circle-alert", size: 16).centeredOnFirstLine(of: .footnote)
                        Text(issue).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if model.composition.problem != nil && model.composition.validation == nil
                        && model.composition.storageProblem == nil
                    {
                        Button {
                            model.composition.problem = nil
                        } label: {
                            Image(lucide: "x", size: 14)
                        }
                        .buttonStyle(.mobileIcon)
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
                    model.connected
                        ? String(localized: "Connecting… You can keep writing.")
                        : String(localized: "Offline. Your draft stays on this iPhone."),
                    lucideIcon: "wifi-off", iconSize: 14
                )
                .font(.caption).foregroundStyle(MobileStyle.muted).padding(.horizontal, 8)
            }
            if model.draft.utf16.count >= 100_000 {
                Text("\(Format.number(Double(model.draft.utf16.count))) / \(Format.number(120_000))").font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(MobileStyle.muted).frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(.bottom, hasContent ? 8 : 0)
        .task(id: query) {
            if let query { await model.search(query.kind, query: query.text) }
        }
    }
}
