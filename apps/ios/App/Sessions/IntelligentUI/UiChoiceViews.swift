import RuimtePulsar
import SwiftUI
import UIKit

/// The primary choice stands first, with its arrow in the accent; chosen, nothing else sets it apart.
struct UiChoicesView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let choices = node.children.filter { !$0.isText }
        let ordered = choices.filter { $0.bool("primary") == true } + choices.filter { $0.bool("primary") != true }
        VStack(alignment: .leading, spacing: 8) {
            ForEach(ordered) { choice in UiNodeView(node: choice, parent: node.type, context: context) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(String(localized: "Choices"))
    }
}

/// A row that shows what it sends: the label, and under it the context the agent receives. It stays closed while
/// the reply streams, once the block is answered and without a connection, and remains focusable then so VoiceOver
/// says why. Holding it shows the whole context with Send and Copy text.
struct UiChoiceView: View {
    let node: UiNode
    let context: UiRenderContext
    @State private var slow = false

    var body: some View {
        let model = context.model
        let label = node.label
        let detail = node.string("context").flatMap {
            $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0
        }
        let answeredID = model.answer?["choiceId"]?.stringValue
        let chosen = answeredID == node.id || (model.sending && context.local.pick("choosing") == node.id)
        let waiting = context.streaming
        let unavailable = node.bool("disabled") == true || !context.host.connected
        let failed = model.answer == nil && model.failedChoiceID == node.id
        // A live reading or a changed input closes a block for a moment; only what lasts dims the rows.
        let closed = waiting || unavailable || model.answer != nil || model.sending
        let reason: String? =
            waiting
            ? String(localized: "Available when the reply is done")
            : model.answer == nil && !model.sending && unavailable ? String(localized: "Not available") : nil
        VStack(alignment: .leading, spacing: 4) {
            Button {
                choose()
            } label: {
                row(label: label, detail: detail, chosen: chosen, failed: failed)
            }
            .buttonStyle(UiChoiceStyle(open: !closed))
            .disabled(closed)
            .opacity(waiting ? 0.6 : closed && !chosen ? 0.5 : 1)
            .accessibilityLabel(label)
            .accessibilityHint(reason ?? detail ?? "")
            .accessibilityValue(chosen ? stateWord : "")
            .contextMenu {
                Button(String(localized: "Send"), lucideIcon: "arrow-right") { choose() }.disabled(closed)
                Button(String(localized: "Copy text"), lucideIcon: "copy") {
                    UIPasteboard.general.string = detail ?? label
                }
            } preview: {
                VStack(alignment: .leading, spacing: 8) {
                    Text(label).font(.headline).foregroundStyle(MobileStyle.text)
                    if let detail { Text(detail).font(.subheadline).foregroundStyle(MobileStyle.muted) }
                }
                .padding(16).frame(width: 320, alignment: .leading)
                .background(MobileStyle.panel)
            }
            if failed {
                Text("Could not send. Try again.").font(.footnote).foregroundStyle(MobileStyle.statusError)
                    .padding(.horizontal, 8)
            }
        }
        .animation(.easeOut(duration: 0.15), value: waiting)
        .sensoryFeedback(trigger: answeredID) { _, next in next == node.id ? .success : nil }
        .onChange(of: failed) { _, failed in
            if failed {
                AccessibilityNotification.Announcement(String(localized: "Could not send. Try again.")).post()
            }
        }
        .task(id: chosen && model.sending) {
            slow = false
            guard chosen && model.sending else { return }
            do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
            slow = true
        }
    }

    private var stateWord: String {
        context.model.answerState == "queued" ? String(localized: "Queued") : String(localized: "Sent")
    }

    private func row(label: String, detail: String?, chosen: Bool, failed: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(lucide: "arrow-right", size: 14)
                .foregroundStyle(node.bool("primary") == true ? MobileStyle.accent : MobileStyle.faint)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.text)
                if let detail {
                    Text(detail).font(.footnote).foregroundStyle(MobileStyle.muted).lineLimit(3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if chosen {
                HStack(spacing: 4) {
                    if slow && context.model.sending {
                        Spinner(size: 12)
                    } else {
                        Image(lucide: "check", size: 12)
                    }
                    Text(stateWord)
                }
                .font(.caption.weight(.medium)).foregroundStyle(MobileStyle.accent)
                .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(minHeight: 44)
        .background(chosen ? MobileStyle.active : MobileStyle.hover, in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12).strokeBorder(
                chosen ? MobileStyle.accent : failed ? MobileStyle.statusError : MobileStyle.border)
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
    }

    private func choose() {
        guard context.model.canChoose, node.bool("disabled") != true, context.host.connected else { return }
        context.local.setPick("choosing", node.id)
        Task { await context.model.choose(nodeID: node.id) }
    }
}

/// Pressed, an open row sinks a little and darkens; a closed row does neither.
private struct UiChoiceStyle: ButtonStyle {
    let open: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brightness(open && configuration.isPressed ? -0.03 : 0)
            .scaleEffect(open && configuration.isPressed && !reduceMotion ? 0.99 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// The line above a person's message that a choice sent: which choice it was, and for an older reply, which one.
/// The label stays out of the message itself, which holds exactly what the agent read.
struct UiChoiceJump: Equatable {
    let itemID: String
    let blockID: String
    let revision: String
    let nonce = UUID()

    init?(_ origin: JSONValue) {
        guard let itemID = origin["itemId"]?.stringValue, !itemID.isEmpty,
            let blockID = origin["blockId"]?.stringValue, !blockID.isEmpty,
            let revision = origin["revision"]?.stringValue, !revision.isEmpty
        else { return nil }
        self.itemID = itemID
        self.blockID = blockID
        self.revision = revision
    }
}

struct UiChoiceLine: View {
    /// The message's `uiChoice`: its `label`, `older` and `sourceAt` in milliseconds.
    let origin: JSONValue
    var reveal: (() -> Void)?

    var body: some View {
        let label = origin["label"]?.stringValue ?? ""
        let words =
            origin["older"]?.boolValue == true
            ? String(
                localized:
                    "Chose “\(label)” on the reply of \(UiFormat.moment(milliseconds: origin["sourceAt"]?.numberValue ?? 0).formatted(date: .omitted, time: .shortened))"
            )
            : String(localized: "Chose “\(label)”")
        Group {
            if let reveal {
                Button(action: reveal) { choiceLabel(words) }.buttonStyle(.plain)
            } else {
                choiceLabel(words)
            }
        }
    }

    private func choiceLabel(_ words: String) -> some View {
        Label {
            Text(words)
        } icon: {
            Image(lucide: "reply", size: 12)
        }
        .font(.caption).foregroundStyle(MobileStyle.muted)
        .accessibilityElement(children: .combine)
    }
}
