import RuimtePulsar
import SwiftUI

/// What runs in the background of a chat's CLI, as `info.background` lists it: its shells and its monitors.
enum ChatBackground {
    static func counts(_ tasks: [ChatInfoBackgroundItem]) -> (shells: Int, monitors: Int) {
        (tasks.count { $0.kind == .shell }, tasks.count { $0.kind == .monitor })
    }

    /// The chip's words, without the kinds that have none running.
    static func label(_ tasks: [ChatInfoBackgroundItem]) -> String {
        let counts = counts(tasks)
        return [
            counts.shells > 0 ? String(localized: "\(counts.shells) shells") : nil,
            counts.monitors > 0 ? String(localized: "\(counts.monitors) monitors") : nil,
        ].compactMap { $0 }.joined(separator: " · ")
    }

    static func subagents(_ count: Int) -> String {
        String(localized: "\(count) sub-agents")
    }
}

/// A stop from a chip's menu that the machine refused.
struct ChatActivityFailure: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

/// What the chat keeps working on beside the thread, in one small row over the composer: its sub-agents, its workflows
/// and what runs in the background. Each chip is a menu that grows out of it, with what it counts; a background command
/// has a stop.
struct ChatActivityChips: View {
    let model: ChatModel
    let tasks: TaskStore?
    /// The full list of the chat's sub-agents, the done ones included.
    let openList: () -> Void
    /// Asked by the screen, like the queue: the chips sit in the composer's own hosting controller.
    @Binding var failure: ChatActivityFailure?

    var body: some View {
        let subagents = model.activitySubagents
        let workflows = model.activityWorkflows
        let background = model.info?.background ?? []
        if !subagents.isEmpty || !workflows.isEmpty || !background.isEmpty {
            HStack(spacing: 6) {
                if !subagents.isEmpty {
                    let words = subagents.map { ChatSubagents.statusWord($0, task: task(of: $0)) }
                    let attention = model.presentation.agentSources?.attention
                    let states = subagents.map {
                        ChatSubagents.taskRowState(
                            $0, task: task(of: $0), childWaiting: ChatSubagents.childWaiting($0, attention: attention))
                    }
                    Menu {
                        subagentRows(subagents)
                    } label: {
                        chip(ChatSubagents.chipLabel(states, words: words)) {
                            if states.contains(.waiting) {
                                Image(lucide: "message-circle-question-mark", size: 13)
                                    .foregroundStyle(MobileStyle.statusNeedsYou)
                            } else {
                                SubagentStatusIcon(word: ChatSubagents.summaryWord(words), size: 13)
                            }
                        }
                    }
                    .buttonStyle(MobileGlassButtonStyle(shape: .capsule))
                }
                if !workflows.isEmpty {
                    let pill = ChatWorkflows.pill(workflows)
                    Menu {
                        workflowRows(workflows)
                    } label: {
                        chip(pill.label) {
                            WorkflowStatusIcon(word: pill.word, size: 13)
                        }
                    }
                    .buttonStyle(MobileGlassButtonStyle(shape: .capsule))
                    .accessibilityValue(workflows.count == 1 ? ChatWorkflowRow.stateWord(workflows[0].item.state) : "")
                }
                if !background.isEmpty {
                    let shells = ChatBackground.counts(background).shells
                    Menu {
                        backgroundRows(background)
                    } label: {
                        chip(ChatBackground.label(background)) {
                            Image(lucide: shells > 0 ? "square-terminal" : "activity", size: 13)
                        }
                    }
                    .buttonStyle(MobileGlassButtonStyle(shape: .capsule))
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .padding(.bottom, 4)
        }
    }

    private func task(of item: ChatSubagentItem) -> JSONValue? {
        ChatSubagents.taskID(item).flatMap { tasks?.task($0) }
    }

    private func chip(_ label: String, @ViewBuilder icon: () -> some View) -> some View {
        HStack(spacing: 6) {
            icon()
            Text(label).lineLimit(1)
        }
        .font(.footnote).foregroundStyle(MobileStyle.muted)
        .padding(.horizontal, 11).frame(minHeight: 28)
    }

    @ViewBuilder private func subagentRows(_ items: [ChatSubagentItem]) -> some View {
        Section(ChatBackground.subagents(items.count)) {
            ForEach(items, id: \.id) { item in
                let task = task(of: item)
                let word = ChatSubagents.statusWord(item, task: task)
                let detail = [word.title, ChatSubagents.entryTime(item, task: task, now: .now)]
                    .compactMap { $0 }.joined(separator: " · ")
                Button {
                    model.presentation.conversationRequest = SubagentCrumb(item)
                } label: {
                    Label {
                        Text(ChatSubagents.title(item))
                        if !detail.isEmpty { Text(detail) }
                    } icon: {
                        Image(lucide: Self.icon(word), size: 16)
                    }
                }
                .disabled(!ChatSubagents.canOpen(item))
            }
        }
        // No stop here: a chip's menu is opened in passing and a stop was too easy to hit. The list and a sub-agent's
        // own page still stop one.
        Section {
            Button(String(localized: "All sub-agents"), lucideIcon: "bot", action: openList)
        }
    }

    /// A section per workflow with its agents by phase; one that started opens its conversation. No stop here either,
    /// for the reason of the sub-agents: the row in the thread still stops a workflow.
    @ViewBuilder private func workflowRows(_ calls: [WorkflowCall]) -> some View {
        ForEach(calls) { call in
            let running = call.item.state == .running
            Section(ChatWorkflows.title(call)) {
                ForEach(ChatWorkflowLayout.phases(call.workflow, running: running)) { phase in
                    ForEach(phase.agents) { view in
                        let detail = [phase.title, ChatWorkflowLayout.time(view)].compactMap { $0 }
                            .joined(separator: " · ")
                        Button {
                            guard let agentID = view.agent.agentId else { return }
                            model.presentation.conversationRequest = SubagentCrumb(
                                toolUseID: ChatWorkflowRow.agentRef(agentID), description: view.agent.label)
                        } label: {
                            Label {
                                Text(view.agent.label)
                                if !detail.isEmpty { Text(detail) }
                            } icon: {
                                Image(lucide: Self.icon(view.state), size: 16)
                            }
                        }
                        // One still waiting has no transcript yet.
                        .disabled(view.agent.agentId == nil)
                    }
                }
            }
        }
    }

    @ViewBuilder private func backgroundRows(_ tasks: [ChatInfoBackgroundItem]) -> some View {
        Section(ChatBackground.label(tasks)) {
            ForEach(tasks, id: \.id) { task in
                let command = task.command ?? ""
                let description = task.description
                let title = [description, command].first { !$0.isEmpty } ?? Self.kindTitle(task.kind)
                let startedAt = task.startedAt
                let elapsed = Date.now.timeIntervalSince1970 * 1000 - startedAt
                let detail = [
                    !description.isEmpty && !command.isEmpty ? command : nil,
                    startedAt > 0 ? Format.elapsedShort(milliseconds: elapsed) : nil,
                ].compactMap { $0 }.joined(separator: " · ")
                Button {
                    stop(task)
                } label: {
                    Label {
                        Text("Stop \(title)")
                        if !detail.isEmpty { Text(detail) }
                    } icon: {
                        Image(lucide: "square", size: 16)
                    }
                }
            }
        }
    }

    private func stop(_ task: ChatInfoBackgroundItem) {
        Task {
            do {
                _ = try await model.client.request(
                    "chat.stopTask", payload: model.target(["taskId": .string(task.id)]))
            } catch {
                failure = ChatActivityFailure(
                    title: String(localized: "Could not stop the task"), message: error.localizedDescription)
            }
        }
    }

    private static func kindTitle(_ kind: ChatInfoBackgroundItemKind) -> String {
        switch kind {
        case .shell: String(localized: "Shell")
        case .monitor: String(localized: "Monitor")
        }
    }

    private static func icon(_ word: SubagentStatusWord) -> String {
        switch word {
        case .running: "loader-circle"
        case .done: "circle-check"
        case .failed: "circle-x"
        case .cancelled: "circle-slash"
        }
    }

    private static func icon(_ state: WorkflowAgentState) -> String {
        switch state {
        case .running: "loader-circle"
        case .waiting: "circle-dashed"
        case .stopped: "circle-slash"
        case .done: "circle-check"
        case .failed: "circle-x"
        }
    }
}

/// The chip's mark for its workflows: the sub-agents' marks, and a warning for one that stalled.
struct WorkflowStatusIcon: View {
    let word: WorkflowWord
    var size: CGFloat = 16

    var body: some View {
        switch word {
        case .running: SubagentStatusIcon(word: .running, size: size)
        case .done: SubagentStatusIcon(word: .done, size: size)
        case .failed: SubagentStatusIcon(word: .failed, size: size)
        case .stalled:
            Image(lucide: "triangle-alert", size: size)
                .foregroundStyle(MobileStyle.statusNeedsYou)
                .frame(width: size + 2, height: size + 2)
                .accessibilityHidden(true)
        }
    }
}

/// Keeps the chip's sub-agents until a subagent row or the thread's length moves, so the composer does not derive them
/// again on every word the thread streams.
@MainActor final class ChatActivityDerivation {
    private var key: (revision: Int, count: Int)?
    private var cached: [ChatSubagentItem] = []

    func subagents(revision: Int, count: Int, items: () -> [ChatItem]) -> [ChatSubagentItem] {
        if let key, key.revision == revision, key.count == count { return cached }
        key = (revision, count)
        cached = ChatSubagents.activity(items())
        return cached
    }
}
