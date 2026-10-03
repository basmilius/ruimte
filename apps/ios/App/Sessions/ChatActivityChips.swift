import RuimtePulsar
import SwiftUI

/// What runs in the background of a chat's CLI, as `info.background` lists it: its shells and its monitors.
enum ChatBackground {
    static func counts(_ tasks: [JSONValue]) -> (shells: Int, monitors: Int) {
        (
            tasks.filter { $0.text("kind") == "shell" }.count,
            tasks.filter { $0.text("kind") == "monitor" }.count
        )
    }

    /// The chip's words, without the kinds that have none running.
    static func label(_ tasks: [JSONValue]) -> String {
        let counts = counts(tasks)
        return [
            counts.shells > 0 ? counted(counts.shells, "shell") : nil,
            counts.monitors > 0 ? counted(counts.monitors, "monitor") : nil,
        ].compactMap { $0 }.joined(separator: " · ")
    }

    static func counted(_ count: Int, _ noun: String) -> String {
        "\(count) \(noun)\(count == 1 ? "" : "s")"
    }
}

/// What the chat keeps working on beside the thread, in one small row over the composer: its sub-agents and what runs
/// in the background. Each chip opens the list it counts.
struct ChatActivityChips: View {
    let model: ChatModel
    let tasks: TaskStore?
    @State private var showingSubagents = false
    @State private var showingBackground = false

    var body: some View {
        let subagents = model.activitySubagents
        let background = model.info.list("background")
        if !subagents.isEmpty || !background.isEmpty {
            HStack(spacing: 6) {
                if !subagents.isEmpty {
                    let words = subagents.map { ChatSubagents.statusWord($0, task: task(of: $0)) }
                    let word = ChatSubagents.summaryWord(words)
                    chip(
                        ChatBackground.counted(ChatSubagents.badgeCount(words), "sub-agent"),
                        showing: $showingSubagents
                    ) {
                        SubagentStatusIcon(word: word, size: 13)
                    }
                    .mobileSheet(isPresented: $showingSubagents) {
                        ChatSubagentActivity(model: model, tasks: tasks, items: subagents) {
                            showingSubagents = false
                        }
                    }
                }
                if !background.isEmpty {
                    let shells = ChatBackground.counts(background).shells
                    chip(ChatBackground.label(background), showing: $showingBackground) {
                        Image(lucide: shells > 0 ? "square-terminal" : "activity", size: 13)
                    }
                    .mobileSheet(isPresented: $showingBackground) {
                        ChatBackgroundActivity(model: model, tasks: background)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.bottom, 4)
        }
    }

    private func task(of item: JSONValue) -> JSONValue? {
        ChatSubagents.taskID(item).flatMap { tasks?.task($0) }
    }

    private func chip(_ label: String, showing: Binding<Bool>, @ViewBuilder icon: () -> some View) -> some View {
        Button {
            showing.wrappedValue = true
        } label: {
            HStack(spacing: 6) {
                icon()
                Text(label).lineLimit(1)
            }
            .font(.footnote).foregroundStyle(MobileStyle.muted)
            .padding(.horizontal, 11).frame(minHeight: 28)
            .glassEffect(.regular.interactive(), in: .capsule)
            .frame(minHeight: 44).contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// Keeps the chip's sub-agents until a subagent row or the thread's length moves, so the composer does not derive them
/// again on every word the thread streams.
@MainActor final class ChatActivityDerivation {
    private var key: (revision: Int, count: Int)?
    private var cached: [JSONValue] = []

    func subagents(revision: Int, count: Int, items: () -> [JSONValue]) -> [JSONValue] {
        if let key, key.revision == revision, key.count == count { return cached }
        key = (revision, count)
        cached = ChatSubagents.activity(items())
        return cached
    }
}

private struct ChatActivityList<Rows: View>: View {
    let title: String
    @ViewBuilder let rows: () -> Rows
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) { rows() }
                    .padding(.horizontal, 10).padding(.vertical, 6)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct ChatSubagentActivity: View {
    let model: ChatModel
    let tasks: TaskStore?
    let items: [JSONValue]
    let close: () -> Void
    @State private var ending: EndingAgents?
    @State private var failure: String?

    var body: some View {
        ChatActivityList(title: ChatBackground.counted(items.count, "sub-agent")) {
            ForEach(items, id: \.stableID) { item in
                let task = ChatSubagents.taskID(item).flatMap { tasks?.task($0) }
                let word = ChatSubagents.statusWord(item, task: task)
                let title = ChatSubagents.title(item)
                HStack(spacing: 4) {
                    Button {
                        close()
                        model.presentation.conversationRequest = SubagentCrumb(item)
                    } label: {
                        HStack(spacing: 10) {
                            if let word { SubagentStatusIcon(word: word, size: 15) }
                            Text(title).font(.subheadline).foregroundStyle(MobileStyle.text).lineLimit(1)
                            Spacer(minLength: 0)
                            SubagentEntryTime(item: item, task: task)
                        }
                        .padding(.leading, 10).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(ChatComposerButtonStyle())
                    .disabled(!ChatSubagents.canOpen(item, machineRefused: model.presentation.subagentsRefused))
                    .accessibilityLabel(word.map { "\(title), \($0.rawValue)" } ?? title)
                    stopButton(item, title: title)
                }
            }
        }
        .endingAgentsConfirmation($ending)
        .alert(
            "The sub-agent could not be stopped",
            isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
        ) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    @ViewBuilder private func stopButton(_ item: JSONValue, title: String) -> some View {
        switch ChatSubagents.stop(item, turnRunning: model.working) {
        case .task:
            ChatActivityStop(label: "Stop \(title)") {
                Task { ending = await model.stopTaskQuestion(item) { await stop(item) } }
            }
        case .mark:
            // No CLI stops one sub-agent on its own, so it may keep working until the chat's process ends.
            ChatActivityStop(label: "Mark \(title) as stopped") { Task { await stop(item) } }
        case nil:
            EmptyView()
        }
    }

    private func stop(_ item: JSONValue) async {
        do {
            try await model.stopSubagent(item)
        } catch {
            failure = error.localizedDescription
        }
    }
}

private struct ChatBackgroundActivity: View {
    let model: ChatModel
    let tasks: [JSONValue]
    @State private var failure: String?

    var body: some View {
        ChatActivityList(title: ChatBackground.label(tasks)) {
            ForEach(tasks, id: \.stableID) { task in
                let command = task["command"]?.stringValue ?? ""
                let description = task.text("description")
                let title = [description, command].first { !$0.isEmpty } ?? task.text("kind").capitalized
                HStack(spacing: 4) {
                    HStack(spacing: 10) {
                        Image(lucide: task.text("kind") == "shell" ? "square-terminal" : "activity", size: 15)
                            .foregroundStyle(MobileStyle.faint)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(title).font(.subheadline).foregroundStyle(MobileStyle.text).lineLimit(1)
                            if !description.isEmpty && !command.isEmpty {
                                Text(command).font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(MobileStyle.faint).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                        ChatElapsed(startedAt: task.number("startedAt"))
                            .font(.footnote).foregroundStyle(MobileStyle.faint)
                    }
                    .padding(.leading, 10).padding(.vertical, 4).frame(minHeight: 44)
                    .accessibilityElement(children: .combine)
                    ChatActivityStop(label: "Stop \(title)") { stop(task) }
                }
            }
        }
        .alert(
            "The task could not be stopped",
            isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
        ) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private func stop(_ task: JSONValue) {
        Task {
            do {
                _ = try await model.client.request(
                    "chat.stopTask", payload: model.target(["taskId": task["id"] ?? .null]))
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}

private struct ChatActivityStop: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(lucide: "square", size: 14).foregroundStyle(MobileStyle.muted)
                .frame(width: 32, height: 32).background(MobileStyle.inset, in: Circle())
                .frame(width: 44, height: 44).contentShape(Circle())
        }
        .buttonStyle(ChatComposerButtonStyle())
        .accessibilityLabel(label)
    }
}
