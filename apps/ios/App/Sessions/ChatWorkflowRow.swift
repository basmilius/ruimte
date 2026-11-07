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

    var settled: Int { agents.count(where: { $0.state == .done || $0.state == .failed }) }
}

/// The second line of an agent: the tool it last called, drawn apart from what it was called on, and a line of text.
struct WorkflowAgentPreview: Equatable {
    var tool: String?
    var text: String?
}

struct WorkflowCounts: Equatable {
    var total = 0
    var running = 0
    var waiting = 0
    var stopped = 0
    var done = 0
    var failed = 0
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
        switch view.state {
        case .running: return nil
        case .waiting: return String(localized: "waiting", comment: "A workflow's agent that has not started yet")
        case .stopped: return String(localized: "stopped", comment: "A workflow's agent that ended with its workflow")
        case .done, .failed: return view.agent.durationMs.map { Format.elapsedShort(milliseconds: Double($0)) }
        }
    }

    /// What an agent does while at work, what it answered once it stopped, what it was asked before.
    static func preview(_ view: WorkflowAgentView) -> WorkflowAgentPreview {
        let agent = view.agent
        switch view.state {
        case .running:
            guard let tool = agent.lastTool else {
                return WorkflowAgentPreview(text: firstLine(agent.promptPreview))
            }
            return WorkflowAgentPreview(tool: tool, text: firstLine(agent.lastToolSummary))
        case .waiting:
            return WorkflowAgentPreview(text: firstLine(agent.promptPreview))
        case .failed:
            return WorkflowAgentPreview(text: firstLine(agent.error) ?? firstLine(agent.resultPreview))
        case .done, .stopped:
            return WorkflowAgentPreview(text: firstLine(agent.resultPreview) ?? firstLine(agent.promptPreview))
        }
    }

    static func counts(_ phases: [WorkflowPhaseView]) -> WorkflowCounts {
        var counts = WorkflowCounts()
        for view in phases.flatMap(\.agents) {
            counts.total += 1
            switch view.state {
            case .running: counts.running += 1
            case .waiting: counts.waiting += 1
            case .stopped: counts.stopped += 1
            case .done: counts.done += 1
            case .failed: counts.failed += 1
            }
        }
        return counts
    }

    /// The description in the script's `meta`, which the CLI keeps a pure literal, so it reads without running
    /// anything. A saved workflow called by name has no script here.
    static func description(_ input: JSONValue) -> String? {
        guard let script = input["script"]?.stringValue, let meta = metaLiteral(script),
            let match = meta.firstMatch(of: #/\bdescription\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/#)
        else { return nil }
        let found = String(match.2).replacing(#/\\(.)/#) { String($0.output.1) }
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return found.isEmpty ? nil : found
    }

    // The CLI's previews start with a markdown heading as often as not, which says nothing on one line.
    private static func firstLine(_ text: String?) -> String? {
        text?.split(separator: "\n", omittingEmptySubsequences: false)
            .lazy
            .map { $0.replacing(#/^#+\s*/#, with: "").trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
    }

    /// The literal from its opening brace to the one that closes it, skipping braces inside strings.
    private static func metaLiteral(_ script: String) -> String? {
        guard let start = script.firstMatch(of: #/export\s+const\s+meta\s*=\s*\{/#) else { return nil }
        let characters = Array(script[script.index(before: start.range.upperBound)...])
        var depth = 0
        var quote: Character?
        var i = 0
        while i < characters.count {
            let character = characters[i]
            if let open = quote {
                if character == "\\" {
                    i += 1
                } else if character == open {
                    quote = nil
                }
            } else if character == "'" || character == "\"" || character == "`" {
                quote = character
            } else if character == "{" {
                depth += 1
            } else if character == "}" {
                depth -= 1
                if depth == 0 {
                    return String(characters[...i])
                }
            }
            i += 1
        }
        return nil
    }
}

/// A Workflow call: where it stands and how its agents are doing, then its name, what it is for and its phases with
/// the agents each started, and a Stop while it runs, which may be long after the turn that started it ended.
struct ChatWorkflowRow: View {
    let item: ChatToolItem
    let workflow: ChatToolItemWorkflow
    let presentation: ChatPresentation?
    @Environment(\.chatContent) private var context
    @State private var failure: String?
    @State private var expanded = false
    private var running: Bool { item.state == .running }
    private var failed: Bool { item.state == .error }

    var body: some View {
        let phases = ChatWorkflowLayout.phases(workflow, running: running)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                header(ChatWorkflowLayout.counts(phases))
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
            if expanded {
                ChatToolBodyView(item: item).padding(.vertical, 4)
            }
            VStack(alignment: .leading, spacing: 2) {
                if let name = workflow.name {
                    Text(name).font(.subheadline.weight(.medium)).foregroundStyle(MobileStyle.text).lineLimit(1)
                }
                if let description = ChatWorkflowLayout.description(item.input) {
                    Text(description).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(2)
                }
                if running, workflow.stalledAt != nil {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(lucide: "triangle-alert", size: 12).foregroundStyle(MobileStyle.statusNeedsYou)
                        Text("No progress for five minutes. It is still running, and you can stop it.")
                    }
                    .font(.caption).foregroundStyle(MobileStyle.muted)
                    .padding(.top, 4)
                    .accessibilityElement(children: .combine)
                }
                ForEach(phases) { phase in
                    phaseBlock(phase).padding(.top, 8)
                }
            }
            .padding(.leading, 22).padding(.top, 4)
        }
        .failureAlert("Could not stop the task", $failure)
    }

    @ViewBuilder private func header(_ counts: WorkflowCounts) -> some View {
        let opens = ChatToolBody.opens(item)
        let line = HStack(spacing: 8) {
            Image(lucide: "workflow", size: 14).foregroundStyle(running ? MobileStyle.accent : .primary)
            ChatLiveLabel(text: Self.stateWord(item.state), active: running).lineLimit(1).fixedSize()
            Spacer(minLength: 0)
            if counts.total > 0 {
                Text(Self.countsText(counts)).font(.caption).foregroundStyle(MobileStyle.faint).monospacedDigit()
                    .lineLimit(1)
            }
            if opens {
                Image(lucide: expanded ? "chevron-down" : "chevron-right", size: 12)
                    .foregroundStyle(MobileStyle.faint)
            }
        }
        .font(.footnote).foregroundStyle(failed ? MobileStyle.statusError : MobileStyle.muted)
        .frame(minHeight: 28).contentShape(Rectangle())
        if opens {
            ChatExpansionButton(expanding: !expanded) {
                expanded.toggle()
            } label: {
                line
            }
            .buttonStyle(.plain)
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
        } else {
            line.accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder private func phaseBlock(_ phase: WorkflowPhaseView) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let title = phase.title {
                HStack(spacing: 8) {
                    Text(title).fontWeight(.medium).foregroundStyle(MobileStyle.text).lineLimit(1)
                    Group {
                        if phase.agents.isEmpty {
                            Text("not started", comment: "A workflow's phase none of whose agents started")
                        } else {
                            Text(verbatim: "\(phase.settled)/\(phase.agents.count)").monospacedDigit()
                        }
                    }
                    .foregroundStyle(MobileStyle.faint).fixedSize()
                    Spacer(minLength: 0)
                }
                .font(.caption)
                .frame(minHeight: 28)
                .accessibilityElement(children: .combine)
            }
            ForEach(phase.agents) { view in
                agentLine(view)
            }
        }
    }

    @ViewBuilder private func agentLine(_ view: WorkflowAgentView) -> some View {
        let agent = view.agent
        // One still waiting has no transcript yet.
        if let agentID = agent.agentId, let presentation {
            Button {
                presentation.conversationRequest = SubagentCrumb(
                    toolUseID: Self.agentRef(agentID), description: agent.label)
            } label: {
                WorkflowAgentLine(view: view, provider: presentation.info?.provider, opens: true)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the conversation")
        } else {
            WorkflowAgentLine(view: view, provider: presentation?.info?.provider, opens: false)
        }
    }

    static func stateWord(_ state: ChatToolState) -> String {
        switch state {
        case .running: String(localized: "Workflow running")
        case .error: String(localized: "Workflow failed")
        default: String(localized: "Workflow done")
        }
    }

    /// "3 agents · 1 working · 2 done": the total, then each state that has an agent, in the color of its state.
    static func countsText(_ counts: WorkflowCounts) -> AttributedString {
        var text = AttributedString(String(localized: "\(counts.total) agents"))
        let parts: [(Int, String, Color)] = [
            (counts.running, String(localized: "\(counts.running) working"), MobileStyle.statusRunning),
            (counts.done, String(localized: "\(counts.done) done"), MobileStyle.statusIdle),
            (counts.failed, String(localized: "\(counts.failed) failed"), MobileStyle.statusError),
        ]
        for (count, words, color) in parts where count > 0 {
            text += AttributedString(" · ")
            var part = AttributedString(words)
            part.foregroundColor = color
            text += part
        }
        return text
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
    let provider: String?
    let opens: Bool

    var body: some View {
        let agent = view.agent
        let failed = view.state == .failed
        let preview = ChatWorkflowLayout.preview(view)
        HStack(alignment: .top, spacing: 8) {
            ChatAgentMark(provider: provider, dot: Self.dot(view.state))
            VStack(alignment: .leading, spacing: 1) {
                Text(agent.label).font(.caption.weight(.medium))
                    .foregroundStyle(failed ? MobileStyle.statusError : MobileStyle.text).lineLimit(1)
                if preview.tool != nil || preview.text != nil {
                    Self.previewText(preview).font(.caption2).foregroundStyle(MobileStyle.muted).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                if view.state == .running, let startedAt = agent.startedAt {
                    ChatElapsed(startedAt: startedAt)
                } else if let time = ChatWorkflowLayout.time(view) {
                    Text(time).monospacedDigit()
                }
                if failed {
                    Image(lucide: "x", size: 12).foregroundStyle(MobileStyle.statusError)
                }
                if opens {
                    Image(lucide: "chevron-right", size: 12)
                }
            }
            .font(.caption).foregroundStyle(MobileStyle.faint).fixedSize()
            .frame(minHeight: 18)
        }
        .padding(.vertical, 4)
        .frame(minHeight: 32).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private static func previewText(_ preview: WorkflowAgentPreview) -> Text {
        var text = AttributedString()
        if let tool = preview.tool {
            var name = AttributedString(tool)
            name.font = .system(.caption2, design: .monospaced)
            text += name
        }
        if let line = preview.text {
            text += AttributedString(preview.tool == nil ? line : " · \(line)")
        }
        return Text(text)
    }

    private static func dot(_ state: WorkflowAgentState) -> Color {
        switch state {
        case .running: MobileStyle.statusRunning
        case .done: MobileStyle.statusIdle
        case .failed: MobileStyle.statusError
        case .waiting, .stopped: MobileStyle.faint
        }
    }
}
