import RuimtePulsar
import SwiftUI

/// Now on an iPad, beside the sidebar: the cards that wait on you in two columns, and Working and Finished side by
/// side under them. The same board as the iPhone's, answered in place the same way.
struct PadNowPage: View {
    let runtime: AppRuntime
    let now: NowModel
    let open: (ProjectViewTarget) -> Void
    let openProject: (ProjectViewTarget) -> Void
    let pair: () -> Void
    @State private var showingSnoozed = false

    private let columns = [GridItem(.flexible(), spacing: 14, alignment: .top), GridItem(.flexible(), alignment: .top)]

    var body: some View {
        let board = now.board
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if runtime.machines.isEmpty {
                    ContentUnavailableView {
                        Label(String(localized: "No machines yet"), lucideIcon: "monitor", iconSize: 48)
                    } description: {
                        Text("Connect your computer to see what your agents are doing.")
                    } actions: {
                        Button("Use a pairing link", action: pair)
                    }
                } else if !now.loaded && board.isEmpty {
                    MobileLoadingRow(String(localized: "Connecting to your machines"))
                        .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    if board.needsYou.isEmpty {
                        NowNothingWaits(working: board.working.count, notifies: runtime.notifications.enabled)
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            NowHeader(
                                title: String(localized: "Needs you"), count: board.needsYou.count,
                                color: MobileStyle.statusNeedsYou, first: true)
                            LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
                                ForEach(board.needsYou) { entry in
                                    NowCard(
                                        now: now, entry: entry, namesMachine: board.namesMachines,
                                        task: now.task(for: entry.target)
                                    ) { open(entry.target) }
                                    .contextMenu { menu(entry) }
                                    .accessibilityIdentifier("now.\(entry.target.itemID)")
                                }
                            }
                        }
                    }
                    if !board.working.isEmpty || !board.finished.isEmpty {
                        HStack(alignment: .top, spacing: 14) {
                            group(
                                String(localized: "Working"), empty: String(localized: "Nothing is working."),
                                entries: board.working, color: MobileStyle.statusRunning, board: board)
                            group(
                                String(localized: "Finished"),
                                empty: String(localized: "Nothing finished while you were away."),
                                entries: board.finished, color: MobileStyle.positive, board: board)
                        }
                    }
                    if let first = board.snoozed.first?.snoozedUntil {
                        snoozed(board, first: first)
                    }
                }
            }
            .frame(maxWidth: 980)
            .padding(.horizontal, 24).padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Now")
        .navigationBarTitleDisplayMode(.inline)
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

    /// One of the two columns under the cards; an empty one keeps its place, so the other does not stretch across.
    private func group(
        _ title: String, empty: String, entries: [ProjectViewEntry], color: Color, board: NowBoard
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            NowHeader(title: title, count: entries.count, color: color, first: true)
            VStack(spacing: 0) {
                if entries.isEmpty {
                    Text(empty)
                        .font(.footnote).foregroundStyle(MobileStyle.faint)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                ForEach(entries) { entry in row(entry, board: board) }
            }
            .padding(.horizontal, 14).padding(.vertical, 4)
            .background(MobileStyle.panel, in: .rect(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(MobileStyle.border))
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private func snoozed(_ board: NowBoard, first: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
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
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Snoozed, \(board.snoozed.count)")
            .accessibilityValue(showingSnoozed ? "Shown" : "Hidden")
            .accessibilityIdentifier("now.snoozed")
            if showingSnoozed {
                VStack(spacing: 0) {
                    ForEach(board.snoozed) { entry in row(entry, board: board) }
                }
                .padding(.horizontal, 14).padding(.vertical, 4)
                .background(MobileStyle.panel, in: .rect(cornerRadius: 18))
            }
        }
    }

    private func row(_ entry: ProjectViewEntry, board: NowBoard) -> some View {
        Button {
            open(entry.target)
        } label: {
            NowRow(entry: entry, namesMachine: board.namesMachines, task: now.task(for: entry.target))
        }
        .buttonStyle(.plain)
        .contextMenu { menu(entry) }
        .accessibilityIdentifier("now.\(entry.target.itemID)")
    }

    private func menu(_ entry: ProjectViewEntry) -> some View {
        NowEntryMenu(now: now, entry: entry) { open(entry.target) } openProject: { openProject(entry.target) }
    }
}
