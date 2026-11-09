import RuimtePulsar
import RuimteShared
import SwiftUI
import UIKit

/// Buttons side by side, wrapping where the row runs out, the primary one first and in the accent. In a block of 420
/// points or more a choice takes at most half the row, so two long ones end on one edge.
struct UiChoicesView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let choices = node.children.filter { !$0.isText }
        let ordered = choices.filter { $0.bool("primary") == true } + choices.filter { $0.bool("primary") != true }
        UiFlowLayout(spacing: 8, halvesFrom: 420) {
            ForEach(ordered) { choice in UiNodeView(node: choice, parent: node.type, context: context) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
    @Environment(\.uiInSection) private var inSection

    var body: some View {
        // A choice the host would refuse draws as its text and offers nothing to press; while the reply streams it
        // waits as a closed row, since its label may still come.
        if !context.streaming && node.choiceLabel == nil {
            UiFallbackPart(fallback: node.fallback, problem: .failed)
        } else {
            choice
        }
    }

    @ViewBuilder private var choice: some View {
        let model = context.model
        let label = node.choiceLabel ?? node.label
        let detail = node.string("context").flatMap {
            $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0
        }
        let answeredID = model.answer?["choiceId"]?.stringValue
        let chosen = answeredID == node.id || (model.sending && context.local.pick("choosing") == node.id)
        let waiting = context.streaming
        let refused = model.readings.values.contains { $0["state"] == .string("refused") }
        let unavailable = node.bool("disabled") == true || !context.host.connected || refused
        let failed = model.answer == nil && model.failedChoiceID == node.id
        let closed = waiting || unavailable || model.answer != nil || model.sending
        // A live reading or a changed input closes a block for a moment; only what lasts dims the rows.
        let reading = !closed && !model.canChoose
        let reason: String? =
            waiting
            ? String(localized: "Available when the reply is done")
            : reading
                ? String(localized: "Reading live data")
                : model.answer == nil && !model.sending && unavailable ? String(localized: "Not available") : nil
        VStack(alignment: .leading, spacing: 4) {
            Button {
                choose()
            } label: {
                row(label: label, detail: detail, chosen: chosen, failed: failed, reading: reading)
            }
            .buttonStyle(UiChoiceStyle(open: !closed && !reading))
            .disabled(closed || reading)
            .opacity(waiting ? 0.6 : closed && !chosen ? 0.5 : 1)
            .accessibilityLabel(label)
            .accessibilityHint(reason ?? detail ?? "")
            .accessibilityValue(chosen ? stateWord : "")
            .contextMenu {
                Button(String(localized: "Send"), lucideIcon: "arrow-right") { choose() }
                    .disabled(closed || reading || node.choiceLabel == nil)
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
                Text("Could not send. Try again.").font(.caption).foregroundStyle(MobileStyle.statusError)
                    .padding(.horizontal, 4)
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

    private func row(label: String, detail: String?, chosen: Bool, failed: Bool, reading: Bool) -> some View {
        let strong = node.bool("primary") == true
        let ink = strong ? MobileStyle.onAccent : MobileStyle.text
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text(label).font(.subheadline.weight(strong ? .semibold : .medium)).foregroundStyle(ink)
                if let detail {
                    Text(detail).font(.caption).lineLimit(2)
                        .foregroundStyle(strong ? MobileStyle.onAccent.opacity(0.8) : MobileStyle.muted)
                }
            }
            if chosen {
                HStack(spacing: 4) {
                    if slow && context.model.sending {
                        Spinner(size: 12)
                    } else {
                        Image(lucide: "check", size: 12)
                    }
                    Text(stateWord)
                }
                .font(.caption).foregroundStyle(strong ? MobileStyle.onAccent : MobileStyle.accent)
                .accessibilityHidden(true)
            } else if reading {
                Spinner(size: 12).foregroundStyle(ink).accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .frame(minHeight: 44)
        .background(
            strong ? MobileStyle.accent : inSection ? UiTileStyle.inset : UiTileStyle.tile,
            in: RoundedRectangle(cornerRadius: UiTileStyle.radius)
        )
        .overlay {
            if chosen {
                RoundedRectangle(cornerRadius: UiTileStyle.radius + 4).strokeBorder(MobileStyle.accent, lineWidth: 2)
                    .padding(-4)
            } else if failed {
                RoundedRectangle(cornerRadius: UiTileStyle.radius).strokeBorder(MobileStyle.statusError, lineWidth: 2)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: UiTileStyle.radius))
    }

    private func choose() {
        guard context.model.canChoose, node.choiceLabel != nil, node.bool("disabled") != true, context.host.connected
        else { return }
        context.local.setPick("choosing", node.id)
        Task { await context.model.choose(nodeID: node.id) }
    }
}

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
    /// New for every tap, so tapping the same line again reveals it again.
    let nonce: UUID

    init?(_ origin: ChatUserItemUiChoice) {
        guard !origin.itemId.isEmpty, !origin.blockId.isEmpty, !origin.revision.isEmpty else { return nil }
        itemID = origin.itemId
        blockID = origin.blockId
        revision = origin.revision
        nonce = UUID()
    }
}

struct UiChoiceLine: View {
    let origin: ChatUserItemUiChoice
    var reveal: (() -> Void)?

    var body: some View {
        let label = origin.label
        let words =
            origin.older
            ? String(
                localized:
                    "Chose \"\(label)\" on the reply of \(Format.moment(UiFormat.moment(milliseconds: origin.sourceAt)))"
            )
            : String(localized: "Chose \"\(label)\"")
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
