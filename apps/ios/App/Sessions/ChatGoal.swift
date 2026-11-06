import RuimtePulsar
import RuimteShared
import RuimteTransport
import SwiftUI

extension ChatGoalAction {
    var title: String {
        switch self {
        case .pause: String(localized: "Pause")
        case .resume: String(localized: "Resume")
        case .clear: String(localized: "goal.clear", defaultValue: "Clear", comment: "Ends the goal of a chat")
        }
    }
}

/// The row above the composer while the chat has a goal, as `chat/logic/goal.ts` in the desktop's chat lays it out.
struct ChatGoalView: Equatable {
    let goal: ChatInfoGoal
    /// What a person may do to it from the row; empty where the CLI or the machine offers nothing.
    let actions: [ChatGoalAction]

    /// A CLI with calls for goals (`native`) pauses, resumes and clears one at any time; one that only reads `/goal`
    /// (`command`) clears it with a turn of its own, so only between turns, and a goal it already met clears itself.
    init?(goal: ChatInfoGoal?, activeTurnID: String?, goals: String?, canAct: Bool) {
        guard let goal else { return nil }
        self.goal = goal
        guard canAct, let goals else {
            actions = []
            return
        }
        if goals == "command" {
            actions = goal.status == .complete || activeTurnID != nil ? [] : [.clear]
            return
        }
        var actions: [ChatGoalAction] = []
        if goal.status == .active {
            actions.append(.pause)
        } else if goal.status != .complete {
            actions.append(.resume)
        }
        actions.append(.clear)
        self.actions = actions
    }

    var status: String {
        switch goal.status {
        case .active: String(localized: "Working toward a goal")
        case .paused: String(localized: "Goal paused")
        case .blocked: String(localized: "Goal blocked")
        case .usageLimited: String(localized: "Goal stopped on a usage limit")
        case .budgetLimited: String(localized: "Goal used up its token budget")
        case .complete: String(localized: "Goal met")
        }
    }

    /// How far the goal got, in what its CLI counts: the checks that sent the agent on, or the tokens it spent.
    var progress: String? {
        var parts: [String] = []
        if let checks = goal.checks, checks > 0 {
            parts.append(String(localized: "\(Int(checks)) checks not met yet"))
        }
        if let used = goal.tokensUsed, used > 0 || goal.tokenBudget != nil {
            let tokens = Format.tokens(Double(used))
            if let budget = goal.tokenBudget {
                parts.append(String(localized: "\(tokens) of \(Format.tokens(Double(budget))) tokens"))
            } else {
                parts.append(String(localized: "\(tokens) tokens"))
            }
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var line: String { progress.map { "\(goal.objective) · \($0)" } ?? goal.objective }
}

/// At the top of the composer while the chat has a goal: where it stands, the objective, how far it got, and what a
/// person may do to it. The whole objective and what the last check said open on a tap.
struct ChatGoalDock: View {
    let model: ChatModel
    @State private var changing = false
    @State private var failure: String?
    @State private var showingDetail = false

    private var view: ChatGoalView? {
        ChatGoalView(
            goal: model.info?.goal, activeTurnID: model.info?.activeTurnId,
            goals: model.capabilities["goals"]?.stringValue,
            canAct: (model.client as? MachineFeatures)?.answers(.chatGoal) == true)
    }

    var body: some View {
        if let view {
            HStack(spacing: 10) {
                Button {
                    showingDetail = true
                } label: {
                    HStack(spacing: 10) {
                        Image(lucide: "target", size: 16)
                            .foregroundStyle(view.goal.status == .active ? MobileStyle.accent : MobileStyle.faint)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(view.status).font(.subheadline).foregroundStyle(MobileStyle.text).lineLimit(1)
                            Text(view.line).font(.caption).monospacedDigit().foregroundStyle(MobileStyle.faint)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                ForEach(view.actions, id: \.self) { action in
                    Button(action.title) { act(action) }
                        .buttonStyle(.mobileCapsuleSmall)
                        .disabled(changing || !model.connected)
                }
            }
            .chatDockCard()
            .alert(
                view.status, isPresented: $showingDetail
            ) {
                Button("OK") {}
            } message: {
                if let check = view.goal.lastCheck {
                    Text(verbatim: "\(view.goal.objective)\n\n\(String(localized: "Last check: \(check)"))")
                } else {
                    Text(view.goal.objective)
                }
            }
            .failureAlert("Could not change goal", $failure)
        }
    }

    private func act(_ action: ChatGoalAction) {
        changing = true
        Task {
            do {
                _ = try await model.client.request(
                    .chatGoal, payload: model.target(["action": .string(action.rawValue)]))
            } catch {
                failure = error.localizedDescription
            }
            changing = false
        }
    }
}

extension View {
    /// A card of glass over the composer, such as the goal, a limit or the offer to compact.
    func chatDockCard(vertical: CGFloat = 10) -> some View {
        padding(.horizontal, 14).padding(.vertical, vertical)
            .glassEffect(.regular, in: .rect(cornerRadius: 26))
            .padding(.bottom, 10)
    }
}
