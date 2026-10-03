import RuimtePulsar
import SwiftUI

/// The iPhone's start: what waits on you, what works and what ended since you last looked, over every machine.
struct NowPage: View {
    let runtime: AppRuntime
    let now: NowModel
    let open: (ProjectViewTarget) -> Void
    let openProject: (ProjectViewTarget) -> Void
    let pair: () -> Void
    @State private var showingSnoozed = false

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
                if board.needsYou.isEmpty {
                    nothingWaits(board)
                } else {
                    Section {
                        ForEach(board.needsYou) { entry in
                            NowCard(
                                now: now, entry: entry, namesMachine: board.namesMachines,
                                task: now.task(for: entry.target)
                            ) { open(entry.target) }
                            .contextMenu { menu(entry) }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button {
                                    snooze(entry, until: SnoozeChoice.hour.until(from: .now))
                                } label: {
                                    Label("1 hour", lucideIcon: "alarm-clock")
                                }
                                .tint(MobileStyle.statusIdle)
                            }
                            .accessibilityIdentifier("now.\(entry.target.itemID)")
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        }
                    } header: {
                        NowHeader(
                            title: "Needs you", count: board.needsYou.count, color: MobileStyle.statusNeedsYou,
                            first: true)
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
                if let first = board.snoozed.first?.snoozedUntil {
                    Section {
                        Button {
                            withAnimation { showingSnoozed.toggle() }
                        } label: {
                            HStack(spacing: 7) {
                                Image(lucide: "alarm-clock", size: 14)
                                Text("Snoozed until \(SnoozeChoice.moment(first, from: .now))")
                                Spacer()
                                Text("\(board.snoozed.count)").monospacedDigit()
                                Image(lucide: showingSnoozed ? "chevron-up" : "chevron-down", size: 12)
                            }
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(MobileStyle.muted)
                        }
                        .accessibilityLabel("Snoozed, \(board.snoozed.count)")
                        .accessibilityValue(showingSnoozed ? "Shown" : "Hidden")
                        .accessibilityIdentifier("now.snoozed")
                        .listRowInsets(EdgeInsets(top: 8 + NowHeader.spacing, leading: 28, bottom: 8, trailing: 28))
                        if showingSnoozed {
                            ForEach(board.snoozed) { entry in
                                row(entry, board: board) {
                                    NowRow(
                                        entry: entry, namesMachine: board.namesMachines,
                                        task: now.task(for: entry.target))
                                }
                            }
                        }
                    }
                }
            }
        }
        .onChange(of: now.liveRequests) { _, live in now.answers.keep(live) }
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
        .contextMenu { menu(entry) }
        .accessibilityIdentifier("now.\(entry.target.itemID)")
    }

    private func menu(_ entry: ProjectViewEntry) -> some View {
        NowEntryMenu(now: now, entry: entry) { open(entry.target) } openProject: { openProject(entry.target) }
    }

    private func snooze(_ entry: ProjectViewEntry, until: Date) {
        now.snoozes(for: entry.target.machineID)?.snooze(entry.target.itemID, until: until)
    }

    private func nothingWaits(_ board: NowBoard) -> some View {
        NowNothingWaits(working: board.working.count, notifies: runtime.notifications.enabled)
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
    }
}

/// What a long press on an entry of Now offers: open it or its project, snooze it, and answer its approval.
struct NowEntryMenu: View {
    let now: NowModel
    let entry: ProjectViewEntry
    let open: () -> Void
    let openProject: () -> Void

    var body: some View {
        Button(entry.kind == "chat" ? "Open chat" : "Open", lucideIcon: entry.iconName, action: open)
        Button("Open project", lucideIcon: "folder-open", action: openProject)
        if entry.status == .needsYou {
            Divider()
            SnoozeMenu(until: entry.snoozedUntil) {
                now.snoozes(for: entry.target.machineID)?.snooze(entry.target.itemID, until: $0)
            } wake: {
                now.snoozes(for: entry.target.machineID)?.clear(entry.target.itemID)
            }
        }
        if entry.kind == "chat", let request = entry.requests.first, let approval = request.approval {
            Divider()
            if let rule = approval.allowAlways {
                Button(rule.label, lucideIcon: "check-check") {
                    Task { await now.approve(entry, request, decision: .allowAlways) }
                }
            }
            if entry.repliesWithMessage {
                Button("Deny with a message", lucideIcon: "message-square-x") {
                    let key = NowAnswers.key(machineID: entry.target.machineID, requestID: request.requestID)
                    now.answers.drafts[key, default: NowRequestDraft()].replying = true
                }
            }
        }
    }
}

/// The card Now shows while nothing waits on you, saying what still works.
struct NowNothingWaits: View {
    let working: Int
    let notifies: Bool

    var body: some View {
        let still =
            working == 0
            ? "No agent is working right now."
            : working == 1 ? "One agent is still working." : "\(working) agents are still working."
        VStack(spacing: 6) {
            LucideIcon(name: "check", size: 22)
                .foregroundStyle(MobileStyle.positive)
                .frame(width: 44, height: 44)
                .background(MobileStyle.positive.opacity(0.12), in: Circle())
                .padding(.bottom, 6)
            Text("Nothing needs you").font(.callout.weight(.semibold)).foregroundStyle(MobileStyle.text)
            Text(working > 0 && notifies ? still + " You get a notification when one asks for you." : still)
                .font(.footnote).foregroundStyle(MobileStyle.muted).multilineTextAlignment(.center)
        }
        .padding(EdgeInsets(top: 26, leading: 20, bottom: 30, trailing: 20))
        .frame(maxWidth: .infinity)
        .background(MobileStyle.panel, in: .rect(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(MobileStyle.border))
        .accessibilityElement(children: .combine)
    }
}

struct NowHeader: View {
    /// What the design puts above every group but the first.
    static let spacing: CGFloat = 10

    let title: String
    let count: Int
    let color: Color
    var first = false

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
        .padding(.top, first ? 0 : Self.spacing)
        .accessibilityElement(children: .combine)
    }
}

struct NowRow: View {
    let entry: ProjectViewEntry
    let namesMachine: Bool
    let task: JSONValue?

    var body: some View {
        HStack(spacing: 10) {
            LucideIcon(name: entry.iconName, size: 16).foregroundStyle(MobileStyle.muted)
            Text(entry.title).foregroundStyle(MobileStyle.text).lineLimit(1).truncationMode(.tail)
            if let task { TaskMark(task: task) }
            Spacer(minLength: 8)
            Text(nowPlace(entry, namesMachine: namesMachine)).font(.caption).foregroundStyle(MobileStyle.faint)
                .lineLimit(1)
            if let until = entry.snoozedUntil {
                Text(SnoozeChoice.moment(until, from: .now)).font(.caption).foregroundStyle(MobileStyle.muted)
                    .monospacedDigit().accessibilityLabel("Snoozed until \(SnoozeChoice.moment(until, from: .now))")
            } else if entry.status == .running {
                Spinner(size: 14, label: "Working").foregroundStyle(MobileStyle.statusRunning)
            } else if entry.delegating {
                Spinner(size: 14, label: "Its sub-agents are working").foregroundStyle(MobileStyle.muted)
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
