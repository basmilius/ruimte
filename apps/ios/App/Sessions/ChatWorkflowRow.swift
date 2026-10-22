import RuimtePulsar
import RuimteTransport
import SwiftUI

/// Where an agent of a workflow stands: the words of the wire, `waiting` for one that has not started yet and
/// `stopped` for one still at work by the last report when the workflow ended.
enum WorkflowAgentState: Equatable {
    case running, done, failed, waiting, stopped
}

struct WorkflowAgentView: Identifiable, Equatable {
    let agent: ChatToolItemWorkflowAgentsItem
    let state: WorkflowAgentState
    var id: Int64 { agent.index }
}

struct WorkflowPhaseView: Identifiable, Equatable {
    let id: String
    /// Nil for the agents outside any phase the script announced.
    let title: String?
    let agents: [WorkflowAgentView]
}

/// What a Workflow call runs, laid out as the desktop's `chat/logic/workflow.ts` does.
enum ChatWorkflowLayout {
    static func state(_ agent: ChatToolItemWorkflowAgentsItem, workflowRunning: Bool) -> WorkflowAgentState {
        switch agent.status {
        case .done: return .done
        case .failed: return .failed
        case .running:
            if !workflowRunning { return .stopped }
            return agent.startedAt == nil ? .waiting : .running
        }
    }

    /// The phases in the order the script announced them, each with the agents it started in it. A phase announced
    /// ahead of its agents is there without any, and agents of no known phase come first, untitled.
    static func phases(_ workflow: ChatToolItemWorkflow, running: Bool) -> [WorkflowPhaseView] {
        let known = Set(workflow.phases.map(\.index))
        var loose: [WorkflowAgentView] = []
        var byPhase: [Int64: [WorkflowAgentView]] = [:]
        for agent in workflow.agents {
            let view = WorkflowAgentView(agent: agent, state: state(agent, workflowRunning: running))
            if let phase = agent.phaseIndex, known.contains(phase) {
                byPhase[phase, default: []].append(view)
            } else {
                loose.append(view)
            }
        }
        let phases = workflow.phases.map {
            WorkflowPhaseView(id: "phase-\($0.index)", title: $0.title, agents: byPhase[$0.index] ?? [])
        }
        return loose.isEmpty ? phases : [WorkflowPhaseView(id: "loose", title: nil, agents: loose)] + phases
    }

    /// What the line of an agent that is not at work says about its time; one at work counts on by itself.
    static func time(_ view: WorkflowAgentView) -> String? {
        let duration = view.agent.durationMs.map { ChatToolPresentation.elapsed(Double($0)) }
        switch view.state {
        case .running: return nil
        case .waiting: return String(localized: "waiting", comment: "A workflow's agent that has not started yet")
        case .stopped: return String(localized: "stopped", comment: "A workflow's agent that ended with its workflow")
        case .done: return duration.map { String(localized: "done in \($0)") } ?? String(localized: "Done")
        case .failed: return duration.map { String(localized: "failed in \($0)") } ?? String(localized: "Failed")
        }
    }
}

/// A Workflow call with its phases and the agents each started under it, and a Stop while it runs, which may be
/// long after the turn that started it ended.
struct ChatWorkflowRow: View {
    let item: ChatToolItem
    let workflow: ChatToolItemWorkflow
    let presentation: ChatPresentation?
    @Environment(\.chatContent) private var context
    @State private var failure: String?
    private var running: Bool { item.state == .running }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 4) {
                ChatToolRow(item: item, detail: running ? nil : workflow.name)
                if running, let taskID = workflow.taskId, context != nil {
                    Button {
                        stop(taskID)
                    } label: {
                        Image(lucide: "square", size: 14).frame(width: 36, height: 28).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).foregroundStyle(MobileStyle.muted)
                    .accessibilityLabel("Stop")
                }
            }
            if running, workflow.stalledAt != nil {
                HStack(spacing: 6) {
                    Image(lucide: "triangle-alert", size: 12).foregroundStyle(MobileStyle.statusNeedsYou)
                    Text("No progress for five minutes. It is still running, and you can stop it.")
                        .lineLimit(1)
                }
                .font(.caption).foregroundStyle(MobileStyle.muted)
                .frame(minHeight: 28).padding(.leading, 22)
                .accessibilityElement(children: .combine)
            }
            let phases = ChatWorkflowLayout.phases(workflow, running: running)
            if !phases.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(phases) { phase in
                        if let title = phase.title {
                            HStack(spacing: 8) {
                                Image(lucide: "list-tree", size: 12)
                                Text(title).lineLimit(1)
                                Spacer(minLength: 0)
                                if phase.agents.isEmpty {
                                    Text("not started", comment: "A workflow's phase none of whose agents started")
                                        .foregroundStyle(MobileStyle.faint).fixedSize()
                                }
                            }
                            .font(.footnote).foregroundStyle(MobileStyle.muted)
                            .frame(minHeight: 28)
                            .accessibilityElement(children: .combine)
                        }
                        ForEach(phase.agents) { view in
                            agentLine(view).padding(.leading, phase.title == nil ? 0 : 22)
                        }
                    }
                }
                .padding(.leading, 22)
            }
        }
        .alert(
            "Could not stop the task",
            isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
        ) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    @ViewBuilder private func agentLine(_ view: WorkflowAgentView) -> some View {
        let agent = view.agent
        let line = WorkflowAgentLine(view: view)
        // One still waiting has no transcript yet.
        if let agentID = agent.agentId, let presentation {
            Button {
                presentation.conversationRequest = SubagentCrumb(
                    toolUseID: Self.agentRef(agentID), description: agent.label)
            } label: {
                line
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the conversation")
        } else {
            line
        }
    }

    /// A workflow's agent has no call of its own, so `chat.subagent` names it by its agent id under this prefix.
    static func agentRef(_ agentID: String) -> String { "workflow-agent:\(agentID)" }

    private func stop(_ taskID: String) {
        guard let context else { return }
        Task {
            do {
                _ = try await context.client.request(
                    "chat.stopTask",
                    payload: .object(["chatId": .string(context.chatID), "taskId": .string(taskID)]))
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}

private struct WorkflowAgentLine: View {
    let view: WorkflowAgentView

    var body: some View {
        let agent = view.agent
        let running = view.state == .running
        let failed = view.state == .failed
        HStack(spacing: 8) {
            Image(lucide: "bot", size: 12)
            ChatLiveLabel(text: agent.label, active: running).lineLimit(1).layoutPriority(1)
            if running, let tool = agent.lastTool, !tool.isEmpty {
                Text(tool).foregroundStyle(MobileStyle.faint).lineLimit(1)
            }
            Spacer(minLength: 0)
            Group {
                if running, let startedAt = agent.startedAt {
                    ChatElapsed(startedAt: startedAt, runningFor: true)
                } else if let time = ChatWorkflowLayout.time(view) {
                    Text(time).monospacedDigit()
                }
            }
            .foregroundStyle(failed ? MobileStyle.statusError : MobileStyle.faint)
            .fixedSize()
        }
        .font(.footnote).foregroundStyle(failed ? MobileStyle.statusError : MobileStyle.muted)
        .frame(minHeight: 28).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
