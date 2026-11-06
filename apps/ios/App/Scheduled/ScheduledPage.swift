import RuimtePulsar
import SwiftUI

/// Every routine of the connected machines, grouped by what a person needs to know: what waits on them, what still
/// runs today, what runs tonight, what comes later and what stands still. Routines are made on the machine; the
/// phone answers their runs, pauses, resumes and starts one now.
struct ScheduledPage: View {
    let runtime: AppRuntime
    let now: NowModel
    let model: ScheduledModel
    let open: (ScheduledRoute) -> Void
    let addMachine: () -> Void
    @State private var resuming = Set<String>()
    @State private var notice: RoutineNotice?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let board = model.board(now: timeline.date)
            MobileList {
                if runtime.machines.isEmpty {
                    NoMachinesView(description: Text("Connect a machine to see its routines."), add: addMachine)
                } else if !board.answered {
                    unanswered(board)
                } else if board.isEmpty {
                    ContentUnavailableView(
                        String(localized: "No routines"), lucideIcon: "clock",
                        description: Text("Routines you set up on a machine show up here."))
                } else {
                    ScheduledSections(
                        now: now, board: board, date: timeline.date, namesMachines: runtime.machines.count > 1,
                        resuming: resuming, connected: now.connected, entry: now.entry(for:),
                        timeZone: { model.feed($0)?.timeZone }, open: open, resume: resume)
                }
                if board.answered, !board.outdated.isEmpty {
                    Text("Update Ruimte on \(board.outdated.formatted(.list(type: .and))) to see its routines here.")
                        .font(.footnote).foregroundStyle(MobileStyle.muted)
                }
            }
        }
        .refreshable { await model.refresh() }
        .modifier(ScheduledWatch(runtime: runtime, model: model))
        .routineNotice($notice)
        .onAppear { AppUsage.screen(.screenRoutines) }
    }

    @ViewBuilder private func unanswered(_ board: ScheduledBoard) -> some View {
        if model.connecting {
            MobileLoadingRow(String(localized: "Connecting to your machines"))
                .frame(maxWidth: .infinity, minHeight: 120)
        } else if !board.outdated.isEmpty {
            ContentUnavailableView(
                String(localized: "Your machine needs an update"), lucideIcon: "clock",
                description: Text(
                    "Update Ruimte on \(board.outdated.formatted(.list(type: .and))) to see its routines here."
                ))
        } else {
            ContentUnavailableView {
                Label(String(localized: "Machine unavailable"), lucideIcon: "triangle-alert", iconSize: 48)
            } description: {
                Text("Could not connect to your machine.")
            } actions: {
                Button("Try again") {
                    for feed in model.feeds.values where !feed.session.connected { feed.session.reconnect() }
                }
            }
        }
    }

    private func resume(_ item: ScheduledItem) {
        guard let feed = model.feed(item.machineID), resuming.insert(item.id).inserted else { return }
        Task {
            do {
                try await feed.resume(item.entry)
            } catch {
                notice = .failure(error)
            }
            resuming.remove(item.id)
        }
    }
}

/// Reads the routines of every machine while the view shows. A home holds it too, so the badge on Now counts the runs
/// that wait and Coming up names the next routines without Scheduled open.
struct ScheduledWatch: ViewModifier {
    let runtime: AppRuntime
    let model: ScheduledModel

    func body(content: Content) -> some View {
        content
            .onAppear { model.appear(runtime: runtime) }
            .onDisappear { model.disappear() }
            .onChange(of: runtime.machines.map(\.id)) { model.reconcile(runtime: runtime) }
            .onChange(of: runtime.connectionRevision) { model.reconcile(runtime: runtime) }
    }
}

/// The groups of Scheduled as sections of a list. A run that waits is the same card as on Now; the groups below it
/// carry no color, since the time says what they are.
struct ScheduledSections: View {
    let now: NowModel
    let board: ScheduledBoard
    let date: Date
    let namesMachines: Bool
    let resuming: Set<String>
    let connected: (String) -> Bool
    let entry: (ScheduledWait) -> ProjectViewEntry?
    let timeZone: (String) -> TimeZone?
    let open: (ScheduledRoute) -> Void
    let resume: (ScheduledItem) -> Void

    var body: some View {
        if !board.needsYou.isEmpty {
            // Headings are rows and not the sections' headers: a plain list pins its headers under the bar.
            Section {
                MobileSectionHeader(title: String(localized: "Needs you"), count: board.needsYou.count)
                ForEach(board.needsYou) { wait in
                    card(wait)
                        .accessibilityIdentifier("scheduled.wait.\(wait.item.entry.id)")
                        .listRowInsets(NowSections.cardInsets)
                }
            }
        }
        group(String(localized: "Today"), \.today)
        group(String(localized: "Tonight", comment: "Routines that run before tomorrow noon"), \.overnight)
        group(String(localized: "Later"), \.later)
        group(String(localized: "Paused", comment: "Routines that do not run: paused, or not approved yet"), \.held)
    }

    /// The groups below Needs you, top to bottom. The first one shown sits at the top of the page.
    private static var groups: [KeyPath<ScheduledBoard, [ScheduledItem]>] { [\.today, \.overnight, \.later, \.held] }

    @ViewBuilder private func card(_ wait: ScheduledWait) -> some View {
        let subtitle = [
            String(
                localized: "\(Format.moment(wait.run.dueDate, now: date)) run",
                comment: "A routine's run by the time it was due, such as 07:00 run"),
            wait.item.entry.projectName, namesMachines ? wait.item.machineName : nil,
        ].compactMap { $0 }.joined(separator: " · ")
        if let entry = entry(wait) {
            NowCard(
                now: now, entry: entry, subtitle: subtitle, connected: connected(wait.item.machineID), task: nil
            ) { openRun(wait) }
        } else {
            MobileRequestCard(
                symbol: "workflow", title: wait.item.entry.title, subtitle: subtitle,
                openHint: String(localized: "Opens the run"), open: { openRun(wait) }
            ) {
                MobileRequestHeadline(text: String(localized: "Waiting for your answer"))
            }
        }
    }

    private func openRun(_ wait: ScheduledWait) {
        guard let chatID = wait.run.chatId else { return open(.routine(wait.item.target)) }
        open(
            .run(
                RoutineRunTarget(
                    machineID: wait.item.machineID, chatID: chatID, title: wait.item.entry.title,
                    due: wait.run.dueDate)))
    }

    @ViewBuilder private func group(_ title: String, _ path: KeyPath<ScheduledBoard, [ScheduledItem]>) -> some View {
        let items = board[keyPath: path]
        if !items.isEmpty {
            let first =
                board.needsYou.isEmpty && Self.groups.prefix { $0 != path }.allSatisfy { board[keyPath: $0].isEmpty }
            Section {
                MobileSectionHeader(title: title).padding(.top, first ? 0 : MobileSpacing.large)
                MobileRowGroup(items: items) { item in
                    row(item)
                }
                .listRowInsets(NowSections.cardInsets)
            }
        }
    }

    /// A paused row holds Resume of its own, so the row opens on a tap instead of being a button around it.
    @ViewBuilder private func row(_ item: ScheduledItem) -> some View {
        let label = ScheduledRow(
            item: item, timeZone: timeZone(item.machineID), namesMachine: namesMachines, date: date,
            resuming: resuming.contains(item.id), connected: connected(item.machineID)
        ) { resume(item) }
        if item.entry.pausedAt != nil {
            label
                .onTapGesture { open(.routine(item.target)) }
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { open(.routine(item.target)) }
                .accessibilityAction(named: String(localized: "Resume")) { resume(item) }
                .accessibilityIdentifier("scheduled.\(item.entry.id)")
        } else {
            Button {
                open(.routine(item.target))
            } label: {
                label.accessibilityAddTraits(.isButton)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("scheduled.\(item.entry.id)")
        }
    }
}

/// A routine in a group: its schedule in words and its project, and when it is due next, Resume while it is paused,
/// or nothing while it waits for approval on its machine.
struct ScheduledRow: View {
    let item: ScheduledItem
    let timeZone: TimeZone?
    let namesMachine: Bool
    let date: Date
    var resuming = false
    var connected = true
    let resume: () -> Void

    private var entry: RoutineEntry { item.entry }

    var body: some View {
        MobileStatusRow(tone: .idle, symbol: "workflow", title: entry.title, subtitle: subtitle) {
            trailing
        }
    }

    private var subtitle: String {
        let place = item.place(namesMachine: namesMachine)
        if entry.pausedAt != nil {
            return place
        }
        if !entry.approved {
            return String(
                localized: "Approve on \(item.machineName) first · \(entry.projectName)",
                comment: "A routine that waits for approval: the machine to approve it on, then its project")
        }
        let words = entry.schedule.words(timeZone: timeZone)
        if entry.waitingRun != nil {
            return "\(words) · \(String(localized: "skips while waiting")) · \(place)"
        }
        return "\(words) · \(place)"
    }

    @ViewBuilder private var trailing: some View {
        if entry.pausedAt != nil {
            Button(String(localized: "Resume"), action: resume)
                .buttonStyle(.mobileCapsuleSmall)
                .disabled(resuming || !connected)
        } else if entry.approved, let next = entry.nextDate {
            // Today and tonight read as a time alone, the way the groups above them already name the day.
            Text(next.timeIntervalSince(date) < 86_400 ? Format.clock(next) : Format.weekdayClock(next))
                .font(.subheadline).monospacedDigit().foregroundStyle(MobileStyle.text)
        }
    }
}
