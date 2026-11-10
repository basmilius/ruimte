import RuimtePulsar
import SwiftUI

/// Now on an iPad, beside the sidebar: the cards that wait on you in two columns, Working and Finished side by side
/// under them, and Coming up below. The same board and rows as the iPhone's, answered in place the same way.
struct PadNowPage: View {
    let runtime: AppRuntime
    let now: NowModel
    let scheduled: ScheduledModel
    let open: (ProjectViewTarget) -> Void
    let openProject: (ProjectViewTarget) -> Void
    let openRoutine: (ScheduledRoute) -> Void
    let addMachine: () -> Void

    private static let columns = 2

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let board = now.board
            ScrollView {
                VStack(alignment: .leading, spacing: MobileSpacing.xLarge) {
                    if runtime.machines.isEmpty {
                        NoMachinesView(
                            description: Text("Connect a machine to see what your agents are doing."),
                            add: addMachine)
                    } else if !now.loaded && board.isEmpty {
                        MobileLoadingRow(String(localized: "Connecting to your machines"))
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else {
                        NowSections(
                            now: now, board: board,
                            comingUp: NowComingUp.build(
                                snoozed: board.snoozed, scheduled: scheduled.board(now: timeline.date)),
                            notifies: runtime.notifications.enabled, date: timeline.date, connected: now.connected,
                            open: open, openProject: openProject, openRoutine: openRoutine,
                            columns: Self.columns)
                    }
                }
                .frame(maxWidth: 980)
                .padding(.horizontal, MobileSpacing.xLarge).padding(.vertical, MobileSpacing.large)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Now")
        .navigationBarTitleDisplayMode(.inline)
        .modifier(NowWatch(now: now))
        .onAppear { AppUsage.screen(.screenNow) }
    }
}
