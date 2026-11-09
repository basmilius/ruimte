import RuimtePulsar
import RuimteShared
import SwiftUI

/// A session waiting on a person, as a card of its own, on Now and for a routine run on Scheduled. A chat's oldest
/// request is answered on the card; its header opens the chat, as does every card without a request it can answer here.
struct NowCard: View {
    let now: NowModel
    let entry: ProjectViewEntry
    /// Where it stands and how long it waits, or for a routine run, when it was due.
    let subtitle: String
    let connected: Bool
    let task: AgentTask?
    let open: () -> Void
    @FocusState private var replyFocused: Bool

    private var request: NowRequest? { entry.kind == "chat" ? entry.requests.first : nil }
    private var key: String {
        NowAnswers.key(machineID: entry.target.machineID, requestID: request?.requestID ?? "")
    }
    private var draft: Binding<NowRequestDraft> {
        Binding(get: { now.answers.drafts[key] ?? NowRequestDraft() }, set: { now.answers.drafts[key] = $0 })
    }
    private var sending: Bool { now.answers.sending.contains(key) }
    private var enabled: Bool { connected && !sending }

    /// Its place and, where the request says when it came, how long it waits, as in "score-engine · 2 min".
    static func subtitle(_ entry: ProjectViewEntry, namesMachine: Bool, at date: Date) -> String {
        let place = entry.place(namesMachine: namesMachine)
        if entry.status != .needsYou && entry.waitingChild != nil {
            let child = String(localized: "Sub-agent waiting", comment: "A child agent waits on a person or on a limit")
            return "\(place) · \(child)"
        }
        guard let since = entry.waitingSince else { return place }
        let waited = Format.duration(milliseconds: date.timeIntervalSince1970 * 1000 - since)
        return "\(place) · \(waited)"
    }

    var body: some View {
        MobileRequestCard(
            symbol: request?.approval == nil && request != nil ? "message-circle-question-mark" : entry.iconName,
            title: entry.title, subtitle: subtitle,
            openHint: entry.kind == "chat"
                ? String(localized: "Opens the chat") : String(localized: "Opens the terminal"),
            open: open
        ) {
            if let task { TaskMark(task: task) }
        } content: {
            if let request {
                switch request.kind {
                case .approval(let approval): approvalBody(request, approval)
                case .questions: questionBody(request)
                }
                if entry.requests.count > 1 {
                    Text("\(entry.requests.count - 1) more requests wait")
                        .font(.caption).foregroundStyle(MobileStyle.muted)
                }
                if let problem = now.answers.problems[key] {
                    Text(problem).font(.caption).foregroundStyle(MobileStyle.statusError)
                        .accessibilityLabel("Could not send. \(problem)")
                }
                if !connected {
                    Label(String(localized: "Not connected"), lucideIcon: "wifi-off").font(.caption)
                        .foregroundStyle(MobileStyle.muted)
                }
            } else {
                MobileRequestHeadline(
                    text: entry.kind == "chat"
                        ? String(localized: "Waiting for your answer")
                        : String(localized: "Waiting for you in the terminal"))
            }
        }
    }

    /// The approval itself, with Deny, Reply where the CLI passes a reason on, and Allow.
    @ViewBuilder private func approvalBody(_ request: NowRequest, _ approval: NowRequest.Approval) -> some View {
        MobileRequestHeadline(text: request.wants)
        if let diff = approval.diff {
            MobileRequestCode(text: diff, diff: true, truncated: approval.truncated)
        } else if let command = approval.command {
            MobileRequestCode(text: command, truncated: approval.truncated)
        }
        if draft.wrappedValue.replying {
            replyField(String(localized: "Tell the agent what to do instead")) {
                send { await now.approve(entry, request, decision: .deny, message: draft.wrappedValue.reply) }
            }
        } else {
            let reply: (() -> Void)? = entry.repliesWithMessage ? { startReply() } : nil
            MobilePermissionActions(
                sending: sending,
                deny: { send { await now.approve(entry, request, decision: .deny) } },
                reply: reply,
                allow: { send { await now.approve(entry, request, decision: .allow) } }
            )
            .disabled(!enabled)
        }
    }

    /// One question answered on the card: a choice goes at once, several picked go with Send, and Reply types an answer
    /// of its own. A request with more questions is answered in the chat.
    @ViewBuilder private func questionBody(_ request: NowRequest) -> some View {
        if let question = request.inlineQuestion {
            if !question.header.isEmpty && question.header != question.text {
                Text(question.header).font(.caption).foregroundStyle(MobileStyle.muted)
            }
            MobileRequestHeadline(text: question.text)
            if draft.wrappedValue.replying || question.choices.isEmpty {
                replyField(String(localized: "Your answer")) {
                    guard let answers = draft.wrappedValue.answer(question) else { return }
                    send { await now.answer(entry, request, with: answers) }
                }
            } else {
                MobileFlow {
                    ForEach(question.choices, id: \.label) { choice in
                        MobileChoiceButton(
                            label: choice.label,
                            picked: question.multiSelect && draft.wrappedValue.selected.contains(choice.label),
                            hint: choice.description
                        ) {
                            if question.multiSelect {
                                draft.wrappedValue.toggle(choice.label)
                            } else if let answers = draft.wrappedValue.answer(question, choice: choice.label) {
                                send { await now.answer(entry, request, with: answers) }
                            }
                        }
                    }
                    Button("Reply…", action: startReply).buttonStyle(.mobileCapsule)
                }
                .disabled(!enabled)
                if question.multiSelect {
                    HStack {
                        Spacer(minLength: 0)
                        MobileSendButton(title: String(localized: "Send"), sending: sending) {
                            guard let answers = draft.wrappedValue.answer(question) else { return }
                            send { await now.answer(entry, request, with: answers) }
                        }
                        .disabled(!enabled || draft.wrappedValue.answer(question) == nil)
                    }
                }
            }
        } else {
            MobileRequestHeadline(text: request.headline)
            Button("Answer in the chat", action: open).buttonStyle(.mobileCapsule)
        }
    }

    private func replyField(_ prompt: String, send: @escaping () -> Void) -> some View {
        VStack(alignment: .trailing, spacing: MobileSpacing.small) {
            TextField(prompt, text: draft.reply, axis: .vertical)
                .lineLimit(1...5).focused($replyFocused)
                .font(.subheadline).padding(.horizontal, MobileSpacing.medium).padding(.vertical, 10)
                .background(MobileStyle.subtleFill, in: RoundedRectangle(cornerRadius: MobileMetrics.tileRadius))
                .onAppear { replyFocused = true }
            HStack(spacing: MobileSpacing.small) {
                Button("Cancel") {
                    draft.wrappedValue.replying = false
                    replyFocused = false
                }
                .buttonStyle(.mobileCapsule)
                MobileSendButton(title: String(localized: "Send"), sending: sending) {
                    replyFocused = false
                    send()
                }
                .disabled(!enabled || draft.wrappedValue.reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func startReply() { draft.wrappedValue.replying = true }

    private func send(_ action: @escaping @MainActor () async -> Void) {
        Task { await action() }
    }
}

/// The snooze choices with the moment each one ends, and a way to end a snooze that stands.
struct SnoozeMenu: View {
    let until: Date?
    let snooze: (Date) -> Void
    let wake: () -> Void

    var body: some View {
        Menu {
            let now = Date.now
            ForEach(SnoozeChoice.allCases) { choice in
                let date = choice.until(from: now)
                Button {
                    snooze(date)
                } label: {
                    Text(choice.title)
                    Text(SnoozeChoice.moment(date, from: now))
                }
            }
            if until != nil {
                Divider()
                Button(String(localized: "End snooze"), lucideIcon: "alarm-clock-off", action: wake)
            }
        } label: {
            Label(
                until.map { String(localized: "Snoozed until \(SnoozeChoice.moment($0, from: .now))") }
                    ?? String(localized: "Snooze"),
                lucideIcon: "alarm-clock")
        }
    }
}
