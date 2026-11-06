import RuimtePulsar
import SwiftUI

/// A page Scheduled pushes, on the iPhone's stack or in the iPad's content column.
struct ScheduledDestination: View {
    let runtime: AppRuntime
    let model: ScheduledModel
    let route: ScheduledRoute
    let open: (ScheduledRoute) -> Void

    var body: some View {
        switch route {
        case .routine(let target):
            RoutineDetailPage(runtime: runtime, model: model, target: target, open: open)
        case .run(let target):
            RoutineRunPage(runtime: runtime, target: target)
        }
    }
}

/// One routine: when it runs, its runs newest first, and Pause, Resume and Run now. Making and changing a routine,
/// and approving one, happen on the machine.
struct RoutineDetailPage: View {
    let runtime: AppRuntime
    let model: ScheduledModel
    let target: RoutineTarget
    let open: (ScheduledRoute) -> Void
    @State private var confirmingRun = false
    @State private var working = false
    @State private var notice: RoutineNotice?
    @ScaledMetric(relativeTo: .subheadline) private var rowHeight = MobileMetrics.rowHeight

    private var feed: ScheduledFeed? { model.feed(target.machineID) }
    private var entry: RoutineEntry? { model.entry(target) }
    private var machineName: String { feed?.session.machine.name ?? String(localized: "your machine") }

    var body: some View {
        MobileList {
            if let entry {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: entry.schedule.words(timeZone: feed?.timeZone))
                            .font(.callout.weight(.semibold))
                        Text(status(entry)).font(.footnote).foregroundStyle(MobileStyle.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                Section {
                    actions(entry)
                }
                Section(String(localized: "Runs")) {
                    if entry.runs.isEmpty {
                        Text("It has not run yet.").font(.footnote).foregroundStyle(MobileStyle.muted)
                    }
                    ForEach(entry.runs) { run in runRow(entry, run) }
                }
            }
        }
        .overlay {
            if entry == nil {
                if feed?.answers == true || feed == nil {
                    ContentUnavailableView(
                        String(localized: "This routine was removed"), lucideIcon: "calendar-x",
                        description: Text("It is no longer on \(machineName)."))
                } else {
                    MobileLoadingRow(String(localized: "Connecting to your machine"))
                }
            }
        }
        .modifier(MobilePageSurface())
        .navigationTitle(entry?.title ?? String(localized: "Routine"))
        .navigationSubtitle(entry?.projectName ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await feed?.refresh() }
        .onAppear { model.appear(runtime: runtime) }
        .onDisappear { model.disappear() }
        .alert(String(localized: "Run this routine now?"), isPresented: $confirmingRun) {
            Button(String(localized: "Run now")) { runNow() }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text("It starts on \(machineName) right away, and what it delivers lands in Output.")
        }
        .routineNotice($notice)
    }

    private func status(_ entry: RoutineEntry) -> String {
        if let pausedAt = entry.pausedAt {
            return String(localized: "Paused since \(Format.moment(pausedAt))")
        }
        if !entry.approved {
            return String(
                localized: "Approve it on \(machineName) before it runs.", comment: "%@ is the name of a machine")
        }
        if entry.waitingRun != nil {
            return String(localized: "A run waits for you. The next one is skipped until you answer.")
        }
        if let next = entry.nextDate {
            return String(localized: "Runs next at \(Format.moment(next))", comment: "%@ is a moment, such as 08:30")
        }
        return String(localized: "Nothing more is scheduled.")
    }

    @ViewBuilder private func actions(_ entry: RoutineEntry) -> some View {
        let connected = feed?.session.connected == true
        HStack(spacing: 8) {
            if entry.pausedAt != nil {
                Button {
                    act { try await feed?.resume(entry) }
                } label: {
                    Label(String(localized: "Resume"), lucideIcon: "play")
                }
                .accessibilityIdentifier("routine.resume")
            } else {
                Button {
                    act { try await feed?.pause(entry) }
                } label: {
                    Label(String(localized: "Pause"), lucideIcon: "pause")
                }
                .accessibilityIdentifier("routine.pause")
            }
            Spacer(minLength: 0)
            Button {
                confirmingRun = true
            } label: {
                Label(String(localized: "Run now"), lucideIcon: "play")
            }
            .buttonStyle(.mobileCapsuleProminent)
            .disabled(!entry.approved || entry.runs.first?.active == true)
            .accessibilityIdentifier("routine.runNow")
        }
        .buttonStyle(.mobileCapsule)
        .disabled(!connected || working)
    }

    @ViewBuilder private func runRow(_ entry: RoutineEntry, _ run: RoutineRun) -> some View {
        let label = HStack(spacing: MobileSpacing.medium) {
            HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.medium) {
                MobileStatusGlyph(tone: tone(run), symbol: run.icon).centeredOnFirstLine(of: .body)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(Format.moment(run.dueDate)).monospacedDigit()
                    Text(run.words()).font(.caption).foregroundStyle(MobileStyle.muted)
                    if let error = run.failure, run.state == .failed {
                        Text(verbatim: error).font(.caption).foregroundStyle(MobileStyle.statusError).lineLimit(3)
                    }
                }
            }
            Spacer(minLength: 8)
            if run.chatId != nil {
                Image(lucide: "chevron-right", size: 14).foregroundStyle(MobileStyle.faint)
            }
        }
        .frame(minHeight: rowHeight)
        .contentShape(Rectangle())
        if let chatID = run.chatId {
            Button {
                open(
                    .run(
                        RoutineRunTarget(
                            machineID: target.machineID, chatID: chatID, title: entry.title, due: run.dueDate)))
            } label: {
                label
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint("Opens the run")
        } else {
            label.accessibilityElement(children: .combine)
        }
    }

    private func tone(_ run: RoutineRun) -> MobileTone {
        switch run.state {
        case .needsYou, .limit: .waiting
        case .starting, .running: .working
        case .done: .done
        case .failed: .error
        case .skipped: .idle
        }
    }

    private func runNow() {
        guard let entry else { return }
        act {
            let outcome = try await feed?.runNow(entry)
            if outcome == .held {
                notice = RoutineNotice(
                    title: String(localized: "Not started"),
                    message: String(localized: "Approve this routine on \(machineName) first."))
            } else if outcome == .busy {
                notice = RoutineNotice(
                    title: String(localized: "Not started"),
                    message: String(localized: "Its previous run is still going or waits for you."))
            }
        }
    }

    private func act(_ work: @escaping () async throws -> Void) {
        working = true
        Task {
            do {
                try await work()
            } catch {
                notice = .failure(error)
            }
            working = false
        }
    }
}

struct RoutineNotice {
    let title: String
    let message: String

    static func failure(_ error: any Error) -> Self {
        Self(title: String(localized: "Could not do that"), message: error.localizedDescription)
    }
}

extension View {
    func routineNotice(_ notice: Binding<RoutineNotice?>) -> some View {
        alert(notice.wrappedValue?.title ?? "", isPresented: notice.isPresent(), presenting: notice.wrappedValue) {
            _ in
            Button(String(localized: "OK")) {}
        } message: { notice in
            Text(notice.message)
        }
    }
}

/// A run of a routine, opened as the chat it ran in, where a question is answered as in any other chat. The chat is
/// on no canvas, so it opens on its machine alone.
struct RoutineRunPage: View {
    let runtime: AppRuntime
    let target: RoutineRunTarget
    @State private var lease: MachineNavigationLease?
    @State private var session: SharedMachineSession?

    init(runtime: AppRuntime, target: RoutineRunTarget) {
        self.runtime = runtime
        self.target = target
        _session = State(initialValue: runtime.session(machineID: target.machineID))
    }

    var body: some View {
        Group {
            if let session {
                ChatScreen(
                    client: session.rpc, chatID: target.chatID, title: target.title, session: session,
                    subtitle: String(
                        localized: "Routine run · \(Format.moment(target.due))",
                        comment: "%@ is when the run was due"))
            } else {
                ContentUnavailableView.machineUnavailable.modifier(MobilePageSurface())
            }
        }
        .task {
            guard lease == nil, let shared = runtime.session(machineID: target.machineID) else { return }
            lease = MachineNavigationLease(shared)
            await shared.markSeen(target.chatID)
        }
    }
}
