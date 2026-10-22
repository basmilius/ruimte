import RuimtePulsar
import SwiftUI

/// What runs in the background of a chat's CLI, as `info.background` lists it: its shells and its monitors.
enum ChatBackground {
    static func counts(_ tasks: [ChatInfoBackgroundItem]) -> (shells: Int, monitors: Int) {
        (
            tasks.filter { $0.kind == .shell }.count,
            tasks.filter { $0.kind == .monitor }.count
        )
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

/// What the chat keeps working on beside the thread, in one small row over the composer: its sub-agents and what runs
/// in the background. Each chip is a menu that grows out of it, with what it counts and a stop for each.
struct ChatActivityChips: View {
    let model: ChatModel
    let tasks: TaskStore?
    /// The full list of the chat's sub-agents, the done ones included.
    let openList: () -> Void
    /// Asked by the screen, like the queue: the chips sit in the composer's own hosting controller.
    @Binding var ending: EndingAgents?
    @Binding var failure: ChatActivityFailure?

    var body: some View {
        let subagents = model.activitySubagents
        let background = model.info?.background ?? []
        if !subagents.isEmpty || !background.isEmpty {
            HStack(spacing: 6) {
                if !subagents.isEmpty {
                    let words = subagents.map { ChatSubagents.statusWord($0, task: task(of: $0)) }
                    Menu {
                        subagentRows(subagents)
                    } label: {
                        chip(ChatBackground.subagents(ChatSubagents.badgeCount(words))) {
                            SubagentStatusIcon(word: ChatSubagents.summaryWord(words), size: 13)
                        }
                    }
                    .buttonStyle(ChatComposerGlassStyle(shape: .capsule))
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
                    .buttonStyle(ChatComposerGlassStyle(shape: .capsule))
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
        Section {
            ForEach(items, id: \.id) { item in stopRow(item) }
        }
        Section {
            Button(String(localized: "All sub-agents"), lucideIcon: "bot", action: openList)
        }
    }

    @ViewBuilder private func stopRow(_ item: ChatSubagentItem) -> some View {
        let title = ChatSubagents.title(item)
        switch ChatSubagents.stop(item, turnRunning: model.working) {
        case .task:
            Button(String(localized: "Stop \(title)"), lucideIcon: "square") {
                Task { ending = await model.stopTaskQuestion(item) { await stop(item) } }
            }
        case .mark:
            // No CLI stops one sub-agent on its own, so it may keep working until the chat's process ends.
            Button(String(localized: "Mark \(title) as stopped"), lucideIcon: "square") { Task { await stop(item) } }
        case nil:
            EmptyView()
        }
    }

    private func stop(_ item: ChatSubagentItem) async {
        do {
            try await model.stopSubagent(item)
        } catch {
            failure = ChatActivityFailure(
                title: String(localized: "Could not stop sub-agent"), message: error.localizedDescription)
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
                    startedAt > 0 ? ChatToolPresentation.elapsed(elapsed) : nil,
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
