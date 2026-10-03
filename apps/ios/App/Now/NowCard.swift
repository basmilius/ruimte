import RuimtePulsar
import SwiftUI

/// A session waiting on a person, as a card of its own. A chat's oldest request is answered on the card; its header
/// opens the chat, as does every card without a request it can answer here.
struct NowCard: View {
    let now: NowModel
    let entry: ProjectViewEntry
    let namesMachine: Bool
    let task: JSONValue?
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
    private var connected: Bool { now.connected(entry.target.machineID) }
    private var enabled: Bool { connected && !sending }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: open) {
                HStack(spacing: 8) {
                    LucideIcon(name: entry.iconName, size: 15).foregroundStyle(MobileStyle.muted)
                    Text(entry.title).font(.callout.weight(.semibold)).foregroundStyle(MobileStyle.text)
                        .lineLimit(1).truncationMode(.tail)
                    if let task { TaskMark(task: task) }
                    Spacer(minLength: 8)
                    Text(nowPlace(entry, namesMachine: namesMachine)).font(.caption)
                        .foregroundStyle(MobileStyle.muted).lineLimit(1)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityHint(entry.kind == "chat" ? "Opens the chat" : "Opens the terminal")
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
                waiting(
                    entry.kind == "chat"
                        ? String(localized: "Waiting for your answer")
                        : String(localized: "Waiting for you in the terminal"))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MobileStyle.panel, in: .rect(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(MobileStyle.border))
        .accessibilityElement(children: .contain)
    }

    /// The approval itself, with Deny, Reply where the CLI passes a reason on, and Allow.
    @ViewBuilder private func approvalBody(_ request: NowRequest, _ approval: NowRequest.Approval) -> some View {
        waiting(request.headline)
        if let description = approval.description, description != approval.subject {
            Text(description).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(3)
        }
        if let diff = approval.diff {
            code(diff, colored: true, truncated: approval.truncated)
        } else if let command = approval.command {
            code(command, colored: false, truncated: approval.truncated)
        }
        if draft.wrappedValue.replying {
            replyField(String(localized: "Tell the agent what to do instead")) {
                send { await now.approve(entry, request, decision: .deny, message: draft.wrappedValue.reply) }
            }
        } else {
            HStack(spacing: 8) {
                Button("Deny") { send { await now.approve(entry, request, decision: .deny) } }
                    .buttonStyle(.bordered)
                if entry.repliesWithMessage {
                    Button("Reply…") { startReply() }.buttonStyle(.bordered)
                }
                Spacer(minLength: 0)
                Button {
                    send { await now.approve(entry, request, decision: .allow) }
                } label: {
                    if sending { ProgressView().controlSize(.small) } else { Text("Allow").fontWeight(.semibold) }
                }
                .buttonStyle(.borderedProminent).tint(MobileStyle.accent)
            }
            .font(.subheadline)
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
            waiting(question.text, icon: "message-circle-question-mark")
            if draft.wrappedValue.replying || question.choices.isEmpty {
                replyField(String(localized: "Your answer")) {
                    guard let answers = draft.wrappedValue.answer(question) else { return }
                    send { await now.answer(entry, request, with: answers) }
                }
            } else {
                NowFlow(spacing: 8) {
                    ForEach(question.choices, id: \.label) { choice in
                        let picked = question.multiSelect && draft.wrappedValue.selected.contains(choice.label)
                        Button {
                            if question.multiSelect {
                                draft.wrappedValue.toggle(choice.label)
                            } else if let answers = draft.wrappedValue.answer(question, choice: choice.label) {
                                send { await now.answer(entry, request, with: answers) }
                            }
                        } label: {
                            Text(choice.label).lineLimit(2)
                        }
                        .modifier(NowChoiceStyle(picked: picked))
                        .accessibilityHint(choice.description)
                        .accessibilityAddTraits(picked ? .isSelected : [])
                    }
                    Button("Reply…") { startReply() }.buttonStyle(.bordered)
                }
                .font(.subheadline)
                .disabled(!enabled)
                if question.multiSelect {
                    HStack {
                        Spacer(minLength: 0)
                        Button {
                            guard let answers = draft.wrappedValue.answer(question) else { return }
                            send { await now.answer(entry, request, with: answers) }
                        } label: {
                            if sending { ProgressView().controlSize(.small) } else { Text("Send").fontWeight(.semibold) }
                        }
                        .buttonStyle(.borderedProminent).tint(MobileStyle.accent)
                        .disabled(!enabled || draft.wrappedValue.answer(question) == nil)
                    }
                    .font(.subheadline)
                }
            }
        } else {
            waiting(request.headline, icon: "message-circle-question-mark")
            Button("Answer in the chat", action: open).buttonStyle(.bordered).font(.subheadline)
        }
    }

    private func waiting(_ text: String, icon: String = "hand") -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(lucide: icon, size: 14).foregroundStyle(MobileStyle.statusNeedsYou).accessibilityHidden(true)
            Text(text).font(.subheadline).foregroundStyle(MobileStyle.text).lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func code(_ text: String, colored: Bool, truncated: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(text.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                Text(line.isEmpty ? " " : line)
                    .foregroundStyle(
                        !colored
                            ? MobileStyle.text
                            : line.hasPrefix("+")
                                ? MobileStyle.positive : line.hasPrefix("-") ? MobileStyle.statusError : MobileStyle.muted
                    )
                    .lineLimit(1).truncationMode(.tail)
            }
            if truncated {
                Text("…").foregroundStyle(MobileStyle.muted).accessibilityLabel("The rest is in the chat")
            }
        }
        .font(.system(.caption, design: .monospaced))
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MobileStyle.inset, in: RoundedRectangle(cornerRadius: 12))
    }

    private func replyField(_ prompt: String, send: @escaping () -> Void) -> some View {
        VStack(alignment: .trailing, spacing: 8) {
            TextField(prompt, text: draft.reply, axis: .vertical)
                .lineLimit(1...5).focused($replyFocused)
                .font(.subheadline).padding(10)
                .background(MobileStyle.inset, in: RoundedRectangle(cornerRadius: 12))
                .onAppear { replyFocused = true }
            HStack(spacing: 8) {
                Button("Cancel") {
                    draft.wrappedValue.replying = false
                    replyFocused = false
                }
                .buttonStyle(.bordered)
                Button {
                    replyFocused = false
                    send()
                } label: {
                    if sending { ProgressView().controlSize(.small) } else { Text("Send").fontWeight(.semibold) }
                }
                .buttonStyle(.borderedProminent).tint(MobileStyle.accent)
                .disabled(!enabled || draft.wrappedValue.reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .font(.subheadline)
        }
    }

    private func startReply() { draft.wrappedValue.replying = true }

    private func send(_ action: @escaping @MainActor () async -> Void) {
        Task { await action() }
    }
}

/// A choice of a question: plain until picked, filled once picked on a question that takes several.
private struct NowChoiceStyle: ViewModifier {
    let picked: Bool

    func body(content: Content) -> some View {
        if picked {
            content.buttonStyle(.borderedProminent).tint(MobileStyle.accent)
        } else {
            content.buttonStyle(.bordered)
        }
    }
}

/// Where a row stands: its project, and its machine once the work spans several.
func nowPlace(_ entry: ProjectViewEntry, namesMachine: Bool) -> String {
    namesMachine ? "\(entry.projectName) · \(entry.machineName)" : entry.projectName
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

/// Lays its children out in rows, wrapping onto the next row where one is full.
private struct NowFlow: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var top = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var left = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
                subviews[index].place(
                    at: CGPoint(x: left, y: top), proposal: ProposedViewSize(width: size.width, height: size.height))
                left += size.width + spacing
            }
            top += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil))
            let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if needed > width && !current.indices.isEmpty {
                rows.append(current)
                current = Row()
            }
            current.width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.indices.append(index)
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}
