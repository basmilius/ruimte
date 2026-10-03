import RuimtePulsar
import SwiftUI

/// The iPhone's start: what waits on you, what works and what ended since you last looked, over every machine.
struct NowPage: View {
    let runtime: AppRuntime
    let now: NowModel
    let open: (ProjectViewTarget) -> Void
    let openProject: (ProjectViewTarget) -> Void
    let pair: () -> Void

    var body: some View {
        let board = now.board
        MobileList {
            if runtime.machines.isEmpty {
                ContentUnavailableView {
                    Label("No machines yet", lucideIcon: "monitor", iconSize: 48)
                } description: {
                    Text("Connect your computer to see what your agents are doing.")
                } actions: {
                    Button("Use a pairing link", action: pair)
                }
            } else if !now.loaded && board.isEmpty {
                MobileLoadingRow("Connecting to your machines").frame(maxWidth: .infinity, minHeight: 120)
            } else {
                // TODO(Bas): answer a prompt on its card once the daemon sends a chat's pending prompt, and snooze one
                // once it keeps snoozes; until then a card opens the chat with the prompt in its composer.
                if board.needsYou.isEmpty {
                    nothingWaits(board)
                } else {
                    Section {
                        ForEach(board.needsYou) { entry in
                            row(entry, board: board) {
                                NowCard(entry: entry, namesMachine: board.namesMachines, task: now.task(for: entry.target))
                            }
                                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        }
                    } header: {
                        NowHeader(title: "Needs you", count: board.needsYou.count, color: MobileStyle.statusNeedsYou)
                    }
                }
                if !board.working.isEmpty {
                    Section {
                        ForEach(board.working) { entry in
                            row(entry, board: board) {
                                NowRow(entry: entry, namesMachine: board.namesMachines, task: now.task(for: entry.target))
                            }
                        }
                    } header: {
                        NowHeader(title: "Working", count: board.working.count, color: MobileStyle.statusRunning)
                    }
                }
                if !board.finished.isEmpty {
                    Section {
                        ForEach(board.finished) { entry in
                            row(entry, board: board) {
                                NowRow(entry: entry, namesMachine: board.namesMachines, task: now.task(for: entry.target))
                            }
                        }
                    } header: {
                        NowHeader(title: "Finished", count: board.finished.count, color: MobileStyle.positive)
                    }
                }
            }
            if !now.offline.isEmpty && !runtime.machines.isEmpty {
                Section("Not connected") {
                    ForEach(now.offline, id: \.machine.id) { session in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(session.machine.name).font(.subheadline.weight(.medium))
                                Text(session.problem ?? "Connecting").font(.caption).foregroundStyle(MobileStyle.muted)
                                    .lineLimit(2)
                            }
                            Spacer()
                            if session.failedAttempts > 0 {
                                Button("Reconnect") { session.reconnect() }.font(.subheadline).fixedSize()
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Now")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await now.refresh() }
        .task {
            // Released projects have no watcher on the machine, so new chats there only show on a read.
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
                await now.refresh()
            }
        }
    }

    private func row<Label: View>(
        _ entry: ProjectViewEntry, board: NowBoard, @ViewBuilder label: () -> Label
    ) -> some View {
        Button {
            open(entry.target)
        } label: {
            label()
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(entry.kind == "chat" ? "Open chat" : "Open", lucideIcon: entry.iconName) { open(entry.target) }
            Button("Open project", lucideIcon: "folder-open") { openProject(entry.target) }
        }
        .accessibilityIdentifier("now.\(entry.target.itemID)")
    }

    @ViewBuilder private func nothingWaits(_ board: NowBoard) -> some View {
        let working = board.working.count
        let still =
            working == 0
            ? "No agent is working right now."
            : working == 1 ? "One agent is still working." : "\(working) agents are still working."
        let notified = working > 0 && runtime.notifications.enabled
        VStack(spacing: 6) {
            Text("Nothing needs you").font(.headline).foregroundStyle(MobileStyle.text)
            Text(notified ? still + " You get a notification when one asks for you." : still)
                .font(.subheadline).foregroundStyle(MobileStyle.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .accessibilityElement(children: .combine)
    }
}

private struct NowHeader: View {
    let title: String
    let count: Int
    let color: Color

    var body: some View {
        HStack(spacing: 7) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(title)
            Spacer()
            Text("\(count)").monospacedDigit()
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(MobileStyle.muted)
        .textCase(nil)
        .accessibilityElement(children: .combine)
    }
}

/// Where a row stands: its project, and its machine once the work spans several.
private func place(_ entry: ProjectViewEntry, namesMachine: Bool) -> String {
    namesMachine ? "\(entry.projectName) · \(entry.machineName)" : entry.projectName
}

/// A session waiting on a person, as a card of its own. It opens the chat, whose composer holds the prompt.
private struct NowCard: View {
    let entry: ProjectViewEntry
    let namesMachine: Bool
    let task: JSONValue?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                LucideIcon(name: entry.iconName, size: 15).foregroundStyle(MobileStyle.muted)
                Text(entry.title).font(.callout.weight(.semibold)).foregroundStyle(MobileStyle.text)
                    .lineLimit(1).truncationMode(.tail)
                if let task { TaskMark(task: task) }
                Spacer(minLength: 8)
                Text(place(entry, namesMachine: namesMachine)).font(.caption).foregroundStyle(MobileStyle.muted)
                    .lineLimit(1)
            }
            HStack(spacing: 6) {
                Image(lucide: "hand", size: 14).foregroundStyle(MobileStyle.statusNeedsYou)
                Text(entry.kind == "chat" ? "Waiting for your answer" : "Waiting for you in the terminal")
                    .font(.subheadline).foregroundStyle(MobileStyle.text)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MobileStyle.panel, in: .rect(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(MobileStyle.border))
        .contentShape(.rect(cornerRadius: 22))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

private struct NowRow: View {
    let entry: ProjectViewEntry
    let namesMachine: Bool
    let task: JSONValue?

    var body: some View {
        HStack(spacing: 10) {
            LucideIcon(name: entry.iconName, size: 16).foregroundStyle(MobileStyle.muted)
            Text(entry.title).foregroundStyle(MobileStyle.text).lineLimit(1).truncationMode(.tail)
            if let task { TaskMark(task: task) }
            Spacer(minLength: 8)
            Text(place(entry, namesMachine: namesMachine)).font(.caption).foregroundStyle(MobileStyle.faint)
                .lineLimit(1)
            if entry.status == .running {
                ProgressView().controlSize(.mini).tint(MobileStyle.statusRunning).accessibilityLabel("Working")
            } else if entry.unseen {
                Circle().fill(MobileStyle.accent).frame(width: 8, height: 8).accessibilityLabel("New activity")
            }
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}
