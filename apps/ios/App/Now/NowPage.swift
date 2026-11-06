import RuimtePulsar
import RuimteShared
import SwiftUI

/// The iPhone's start: what waits on you, what works, what ended since you last looked and what comes up, over every
/// machine.
struct NowPage: View {
    let runtime: AppRuntime
    let now: NowModel
    let scheduled: ScheduledModel
    let open: (ProjectViewTarget) -> Void
    let openProject: (ProjectViewTarget) -> Void
    let openRoutine: (ScheduledRoute) -> Void
    let addMachine: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let board = now.board
            MobileList {
                if runtime.machines.isEmpty {
                    NoMachinesView(
                        description: Text("Connect a machine to see what your agents are doing."), add: addMachine)
                } else if !now.loaded && board.isEmpty {
                    MobileLoadingRow(String(localized: "Connecting to your machines"))
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    NowSections(
                        now: now, board: board,
                        comingUp: NowComingUp.build(
                            snoozed: board.snoozed, scheduled: scheduled.board(now: timeline.date)),
                        notifies: runtime.notifications.enabled, date: timeline.date, connected: now.connected,
                        open: open, openProject: openProject, openRoutine: openRoutine)
                }
            }
        }
        .modifier(NowWatch(now: now))
        .onAppear { AppUsage.screen(.screenNow) }
    }
}

/// What a page of Now keeps up while it shows: answers that settled, a pull to refresh and, for a machine that cannot
/// say when a project changed, a read every 15 seconds.
struct NowWatch: ViewModifier {
    let now: NowModel

    func body(content: Content) -> some View {
        content
            .onChange(of: now.liveRequests) { _, live in now.answers.keep(live) }
            .refreshable { await now.refresh() }
            .task {
                // Released projects have no watcher on the machine, so new chats there show on `project.listChanged`
                // where the machine takes `project.watch` and only on a read where it does not.
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(15)) } catch { return }
                    await now.refreshUnwatched()
                }
            }
    }
}

/// The groups of Now as sections of a list: Needs you, Working, Finished and Coming up.
struct NowSections: View {
    let now: NowModel
    let board: NowBoard
    let comingUp: [NowComingUp]
    let notifies: Bool
    let date: Date
    let connected: (String) -> Bool
    let open: (ProjectViewTarget) -> Void
    let openProject: (ProjectViewTarget) -> Void
    let openRoutine: (ScheduledRoute) -> Void

    /// Half the gap between two cards above and below each. A card pads its own content, so its sides stand in from the
    /// margin by that padding and the content lines up with the page.
    static let cardInsets = EdgeInsets(
        top: MobileSpacing.medium / 2, leading: MobileSpacing.margin - MobileSpacing.cardPadding,
        bottom: MobileSpacing.medium / 2, trailing: MobileSpacing.margin - MobileSpacing.cardPadding)

    var body: some View {
        if board.needsYou.isEmpty {
            NowNothingWaits(notifies: notifies).listRowInsets(Self.cardInsets)
        } else {
            Section {
                header(String(localized: "Needs you"), count: board.needsYou.count, first: true)
                ForEach(board.needsYou) { entry in
                    NowCard(
                        now: now, entry: entry,
                        subtitle: NowCard.subtitle(entry, namesMachine: board.namesMachines, at: date),
                        connected: connected(entry.target.machineID), task: now.task(for: entry.target)
                    ) { open(entry.target) }
                    .contextMenu { menu(entry) }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button {
                            now.snoozes(for: entry.target.machineID)?.snooze(
                                entry.target.itemID, until: SnoozeChoice.hour.until(from: .now))
                        } label: {
                            Label(String(localized: "1 hour"), lucideIcon: "alarm-clock")
                        }
                        .tint(MobileStyle.statusIdle)
                    }
                    .accessibilityIdentifier("now.\(entry.target.itemID)")
                    .listRowInsets(Self.cardInsets)
                }
            }
        }
        section(String(localized: "Working"), board.working) { entry in
            NowWorkingRow(
                entry: entry, namesMachine: board.namesMachines, task: now.task(for: entry.target), date: date)
        }
        section(String(localized: "Finished"), board.finished) { entry in
            NowFinishedRow(
                entry: entry, namesMachine: board.namesMachines, task: now.task(for: entry.target), date: date)
        }
        if !comingUp.isEmpty {
            Section {
                header(String(localized: "Coming up"))
                MobileRowGroup(items: comingUp) { item in
                    NowComingUpButton(
                        item: item, namesMachine: board.namesMachines, date: date, open: open,
                        openRoutine: openRoutine
                    ) { menu($0) }
                }
                .listRowInsets(Self.cardInsets)
            }
        }
    }

    /// A row and not the section's header: a plain list pins its headers, and they stood under the bar.
    private func header(_ title: String, count: Int? = nil, first: Bool = false) -> some View {
        MobileSectionHeader(title: title, count: count)
            .padding(.top, first ? 0 : MobileSpacing.large)
    }

    @ViewBuilder private func section<Label: View>(
        _ title: String, _ entries: [ProjectViewEntry], @ViewBuilder label: @escaping (ProjectViewEntry) -> Label
    ) -> some View {
        if !entries.isEmpty {
            Section {
                header(title, count: entries.count)
                MobileRowGroup(items: entries) { entry in row(entry) { label(entry) } }
                    .listRowInsets(Self.cardInsets)
            }
        }
    }

    private func row<Label: View>(_ entry: ProjectViewEntry, @ViewBuilder label: () -> Label) -> some View {
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
        NowEntryMenu(now: now, entry: entry) {
            open(entry.target)
        } openProject: {
            openProject(entry.target)
        }
    }
}

/// What a long press on an entry of Now offers: open it or its project, snooze it, and answer its approval.
struct NowEntryMenu: View {
    let now: NowModel
    let entry: ProjectViewEntry
    let open: () -> Void
    let openProject: () -> Void

    var body: some View {
        Button(
            entry.kind == "chat" ? String(localized: "Open chat") : String(localized: "Open", comment: "Opens a view"),
            lucideIcon: entry.iconName, action: open)
        Button(String(localized: "Open project"), lucideIcon: "folder-open", action: openProject)
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
                Button(String(localized: "Deny with a message"), lucideIcon: "message-square-x") {
                    let key = NowAnswers.key(machineID: entry.target.machineID, requestID: request.requestID)
                    now.answers.drafts[key, default: NowRequestDraft()].replying = true
                }
            }
        }
    }
}

/// The one row Now shows in place of the cards while nothing waits on you, with whether a request would reach you.
struct NowNothingWaits: View {
    let notifies: Bool

    var body: some View {
        MobileStatusRow(
            tone: .done, symbol: "circle-check", title: String(localized: "Nothing needs you"),
            value: notifies ? String(localized: "Notifications on") : String(localized: "Notifications off")
        )
        .mobileCard(padding: 0)
    }
}

/// A session that works: what runs beside its turn where the machine says, and for how long where that work says
/// when it began.
struct NowWorkingRow: View {
    let entry: ProjectViewEntry
    let namesMachine: Bool
    let task: AgentTask?
    let date: Date

    var body: some View {
        MobileStatusRow(
            tone: .working, symbol: entry.iconName, title: entry.title,
            subtitle: entry.workingLine(namesMachine: namesMachine)
        ) {
            if let task { TaskMark(task: task) }
            if let since = entry.workingSince {
                MobileRowValue(text: Format.duration(milliseconds: date.timeIntervalSince1970 * 1000 - since))
            }
        }
        .accessibilityAddTraits(.isButton)
    }
}

/// A session that ended since you last looked, with when it ended where this phone knows it.
struct NowFinishedRow: View {
    let entry: ProjectViewEntry
    let namesMachine: Bool
    let task: AgentTask?
    let date: Date

    var body: some View {
        MobileStatusRow(
            tone: .done, symbol: entry.iconName, title: entry.title, subtitle: entry.place(namesMachine: namesMachine)
        ) {
            if let task { TaskMark(task: task) }
            if let finishedAt = entry.finishedAt {
                MobileRowValue(
                    text: Format.moment(Date(timeIntervalSince1970: finishedAt / 1000), now: date))
            }
        }
        .accessibilityAddTraits(.isButton)
    }
}

/// A row of Coming up, which opens the snoozed node or the routine.
struct NowComingUpButton<Actions: View>: View {
    let item: NowComingUp
    let namesMachine: Bool
    let date: Date
    let open: (ProjectViewTarget) -> Void
    let openRoutine: (ScheduledRoute) -> Void
    @ViewBuilder var menu: (ProjectViewEntry) -> Actions

    var body: some View {
        switch item.subject {
        case .snoozed(let entry):
            Button {
                open(entry.target)
            } label: {
                MobileStatusRow(
                    tone: .idle, symbol: entry.iconName, title: entry.title,
                    subtitle: String(
                        localized: "Snoozed · \(entry.place(namesMachine: namesMachine))",
                        comment: "A node put aside until a moment, then where it stands"),
                    value: SnoozeChoice.moment(item.at, from: date)
                )
                .accessibilityAddTraits(.isButton)
            }
            .buttonStyle(.plain)
            .contextMenu { menu(entry) }
            .accessibilityIdentifier("now.\(entry.target.itemID)")
        case .routine(let scheduled):
            Button {
                openRoutine(.routine(scheduled.target))
            } label: {
                MobileStatusRow(
                    tone: .idle, symbol: "calendar-clock", title: scheduled.entry.title,
                    subtitle: scheduled.place(namesMachine: namesMachine),
                    value: Format.moment(item.at, now: date)
                )
                .accessibilityAddTraits(.isButton)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("now.routine.\(scheduled.entry.id)")
        }
    }
}
