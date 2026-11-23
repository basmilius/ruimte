import RuimtePulsar
import RuimteShared
import SwiftUI

/// What runs in the background of a chat's CLI, as `info.background` lists it: its shells, its monitors and the wakeups
/// it scheduled, as `chat/activity.ts` in `@adecore/agents-react` counts and names them.
enum ChatBackground {
    struct Counts: Equatable {
        var shells = 0
        var monitors = 0
        var wakeups = 0
        var others = 0
    }

    /// When a task that is a scheduled wakeup fires, in epoch milliseconds; nil for any other task. The time rides in
    /// the id, as `scheduledWakeupAt` in `@adecore/agent-contracts` reads it.
    static func wakesAt(_ id: String) -> Double? {
        guard let match = id.firstMatch(of: /^wakeup-(\d+)-./) else { return nil }
        return Double(match.1)
    }

    static func counts(_ tasks: [ChatInfoBackgroundItem]) -> Counts {
        var counts = Counts()
        for task in tasks {
            if wakesAt(task.id) != nil {
                counts.wakeups += 1
            } else if task.kind == .shell {
                counts.shells += 1
            } else if task.kind == .monitor {
                counts.monitors += 1
            } else {
                counts.others += 1
            }
        }
        return counts
    }

    /// The chip's words, without the kinds that have none running.
    static func label(_ tasks: [ChatInfoBackgroundItem]) -> String {
        let counts = counts(tasks)
        return [
            counts.shells > 0 ? String(localized: "\(counts.shells) shells") : nil,
            counts.monitors > 0 ? String(localized: "\(counts.monitors) monitors") : nil,
            counts.wakeups > 0 ? String(localized: "\(counts.wakeups) scheduled wakeups") : nil,
            counts.others > 0 ? String(localized: "\(counts.others) background tasks") : nil,
        ].compactMap { $0 }.joined(separator: " · ")
    }

    /// A terminal while a command runs, a clock while only wakeups wait (the alarm clock means a snooze), else a monitor.
    static func icon(shell: Bool, wakeupsOnly: Bool) -> String {
        shell ? "square-terminal" : wakeupsOnly ? "clock" : "activity"
    }

    /// What a person reads for a task: a wakeup in their words, else what it does, else the command, else its kind.
    static func name(id: String, description: String, command: String?, kind: ChatInfoBackgroundItemKind) -> String {
        if wakesAt(id) != nil { return String(localized: "Scheduled wakeup") }
        return [description, command ?? ""].first { !$0.isEmpty } ?? kindTitle(kind)
    }

    /// How long a task has run, or for a wakeup when it fires; nil for a task that names no start.
    static func time(id: String, startedAt: Double, now: Date) -> String? {
        if let wakesAt = wakesAt(id) {
            let moment = Format.moment(Date(timeIntervalSince1970: wakesAt / 1000), now: now)
            return String(localized: "wakes at \(moment)")
        }
        guard startedAt > 0 else { return nil }
        return Format.elapsedShort(milliseconds: max(0, now.timeIntervalSince1970 * 1000 - startedAt))
    }

    private static func kindTitle(_ kind: ChatInfoBackgroundItemKind) -> String {
        switch kind {
        case .shell: String(localized: "Shell")
        case .monitor: String(localized: "Monitor")
        // A kind of a newer machine, in its own word.
        case .unknown(let word): word
        }
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
                    .accessibilityValue(workflows.count == 1 ? ChatWorkflowRow.stateWord(workflows[0].item) : "")
                }
                if !background.isEmpty {
                    let counts = ChatBackground.counts(background)
                    Menu {
                        backgroundRows(background)
                    } label: {
                        chip(ChatBackground.label(background)) {
                            Image(
                                lucide: ChatBackground.icon(
                                    shell: counts.shells > 0, wakeupsOnly: counts.wakeups == background.count),
                                size: 13)
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

    private func task(of item: ChatSubagentItem) -> AgentTask? {
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
                let title = ChatBackground.name(
                    id: task.id, description: description, command: task.command, kind: task.kind)
                let detail = [
                    !description.isEmpty && !command.isEmpty ? command : nil,
                    ChatBackground.time(id: task.id, startedAt: task.startedAt, now: .now),
                ].compactMap { $0 }.joined(separator: " · ")
                Button {
                    stop(task)
                } label: {
                    Label {
                        Text("Stop \(title)")
                        if !detail.isEmpty { Text(detail) }
                    } icon: {
                        // The row's kind, as the desktop's rows show it; the title says the tap stops it.
                        Image(
                            lucide: ChatBackground.icon(
                                shell: task.kind == .shell, wakeupsOnly: ChatBackground.wakesAt(task.id) != nil),
                            size: 16)
                    }
                }
            }
        }
    }

    private func stop(_ task: ChatInfoBackgroundItem) {
        Task {
            do {
                _ = try await model.client.request(
                    .chatStopTask, payload: model.target(["taskId": .string(task.id)]))
            } catch {
                failure = ChatActivityFailure(
                    title: String(localized: "Could not stop the task"), message: error.localizedDescription)
            }
        }
    }

    private static func icon(_ word: SubagentStatusWord) -> String {
        switch word {
        case .running: "loader-circle"
        case .paused: "circle-pause"
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
