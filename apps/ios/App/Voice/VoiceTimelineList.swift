import RuimteVoice
import SwiftUI

/// The conversation as one timeline, kept at its newest line while it grows.
struct VoiceTimelineList: View {
    let items: [VoiceTimelineItem]
    let voice: VoiceCoordinator
    /// Why the conversation ended, beside its end.
    let problem: VoiceCoordinator.Problem?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    row(item).padding(.top, index == 0 ? 0 : spacing(above: item))
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 18)
        }
        .defaultScrollAnchor(.bottom)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .scrollIndicators(.hidden)
    }

    @ViewBuilder private func row(_ item: VoiceTimelineItem) -> some View {
        switch item {
        case .line(let line):
            VoiceLineRow(line: line, streaming: line.speaker == .model && line.id == voice.transcript.current?.id
                && voice.speaking)
        case .action(let action):
            if let question = action.question, let scene = voice.owner {
                VoiceQuestionCard(
                    action: action, question: question, answering: voice.answering.contains(question.token)
                ) { confirm in
                    Task { await voice.answer(question, confirm: confirm, scene: scene) }
                }
            } else {
                VoiceActionRow(action: action, followed: voice.owner != nil)
            }
        case .ended: VoiceEndedRow(problem: problem)
        }
    }

    private func spacing(above item: VoiceTimelineItem) -> CGFloat {
        switch item {
        case .line: 22
        case .action: 10
        case .ended: 26
        }
    }
}

private struct VoiceLineRow: View {
    let line: VoiceUtterance
    /// The reply still comes in, so a cursor stands at its end.
    let streaming: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(line.speaker == .person ? String(localized: "You") : String(localized: "Voice"))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(line.speaker == .person ? MobileStyle.muted : VoiceStyle.voice)
            Text(text).font(.body).textSelection(.enabled)
            if line.interrupted {
                Text("Interrupted").font(.caption).foregroundStyle(MobileStyle.faint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var text: AttributedString {
        var text = AttributedString(line.text)
        text.foregroundColor = MobileStyle.text
        guard streaming else { return text }
        var cursor = AttributedString("\u{258E}")
        cursor.foregroundColor = VoiceStyle.voice
        return text + cursor
    }
}

private struct VoiceActionRow: View {
    let action: VoiceActivityLine
    /// The session still reports on it. Once it ended, an action that ran is no longer followed and shows no status.
    let followed: Bool

    private var running: Bool { followed && action.status == "running" }

    var body: some View {
        HStack(spacing: 12) {
            Image(lucide: Self.icon(action.kind), size: 16).foregroundStyle(MobileStyle.muted)
            Text(title).font(.callout).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
            status
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 14))
        .overlay {
            if running {
                RoundedRectangle(cornerRadius: 14).strokeBorder(VoiceStyle.voice.opacity(0.7), lineWidth: 1)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// The label in the text color and its detail muted beside it.
    private var title: AttributedString {
        var label = AttributedString(action.label)
        label.foregroundColor = MobileStyle.text
        guard !action.detail.isEmpty else { return label }
        var detail = AttributedString(" · \(action.detail)")
        detail.foregroundColor = MobileStyle.muted
        return label + detail
    }

    @ViewBuilder private var status: some View {
        switch action.status {
        case "running":
            if followed {
                Text("Running").font(.footnote).foregroundStyle(VoiceStyle.voice)
            }
        case "failed":
            Label {
                Text("Failed")
            } icon: {
                Image(lucide: "circle-x", size: 14)
            }
            .labelStyle(.titleAndIcon).font(.footnote).foregroundStyle(MobileStyle.statusError)
        default:
            Image(lucide: "check", size: 16).foregroundStyle(MobileStyle.positive)
                .accessibilityLabel("Done")
        }
    }

    /// The kinds `voice.activity` names, as the desktop's timeline draws them; an unknown one gets a plain dot.
    static func icon(_ kind: String) -> String {
        switch kind {
        case "focus": "scan-eye"
        case "rename": "pencil"
        case "note": "sticky-note"
        case "terminal": "terminal"
        case "chat": "message-square"
        case "node": "square-dashed"
        case "view": "panels-top-left"
        case "delete": "trash"
        case "git": "git-branch"
        default: "circle-dot"
        }
    }
}

/// An action that waits on the person: what Voice wants to do, answered here or by telling Voice.
private struct VoiceQuestionCard: View {
    let action: VoiceActivityLine
    let question: VoiceQuestion
    /// The answer is on its way to the machine.
    let answering: Bool
    let answer: (_ confirm: Bool) -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(lucide: VoiceActionRow.icon(action.kind), size: 16).foregroundStyle(MobileStyle.muted)
                Text(question.title.isEmpty ? action.label : question.title).font(.callout.weight(.semibold))
                    .foregroundStyle(MobileStyle.text).frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(Array(question.consequences.enumerated()), id: \.offset) { _, line in
                Text(line).font(.footnote).foregroundStyle(MobileStyle.muted).padding(.leading, 28)
            }
            buttons.padding(.top, 2)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(VoiceStyle.voice.opacity(0.7), lineWidth: 1) }
        .accessibilityElement(children: .contain)
    }

    private var buttons: some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 16))
        return layout {
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
            Button("Cancel") { answer(false) }
                .frame(minHeight: 44)
                .accessibilityIdentifier("voice.question.cancel")
            Button(role: .destructive) {
                answer(true)
            } label: {
                Text("Confirm").fontWeight(.semibold)
            }
            .frame(minHeight: 44)
            .accessibilityIdentifier("voice.question.confirm")
        }
        .font(.subheadline)
        .disabled(answering)
    }
}

private struct VoiceEndedRow: View {
    let problem: VoiceCoordinator.Problem?

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 10) {
                Rectangle().fill(MobileStyle.border).frame(height: 1)
                Text("Conversation ended").font(.footnote).foregroundStyle(MobileStyle.muted).fixedSize()
                Rectangle().fill(MobileStyle.border).frame(height: 1)
            }
            if let problem {
                Text(VoiceText.problem(problem)).font(.footnote).foregroundStyle(MobileStyle.statusError)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
