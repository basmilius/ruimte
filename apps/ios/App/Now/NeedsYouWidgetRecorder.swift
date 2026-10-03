import Foundation
import RuimtePulsar
import WidgetKit

/// Writes what Now shows into the app group for the needs-you widgets, which never connect themselves.
enum NeedsYouWidgetRecorder {
    static func snapshot(_ board: NowBoard, at date: Date = .now) -> NeedsYouWidgetSnapshot {
        NeedsYouWidgetSnapshot(
            items: board.needsYou.map { entry in
                NeedsYouWidgetItem(
                    machineID: entry.target.machineID, projectID: entry.target.projectID,
                    nodeID: entry.target.itemID, target: entry.kind == "terminal" ? "terminal" : "chat",
                    title: entry.title, projectName: entry.projectName, detail: detail(entry))
            }, working: board.working.count, updatedAt: date)
    }

    /// Writes only what changed, since every write wakes the widgets.
    static func record(_ board: NowBoard) {
        let next = snapshot(board)
        if let current = NeedsYouWidgetStore.snapshot(), current.says(next) { return }
        NeedsYouWidgetStore.save(next)
        WidgetCenter.shared.reloadTimelines(ofKind: NeedsYouWidgetStore.countKind)
        WidgetCenter.shared.reloadTimelines(ofKind: NeedsYouWidgetStore.listKind)
    }

    private static func detail(_ entry: ProjectViewEntry) -> String {
        guard entry.kind == "chat" else { return "Waiting in the terminal" }
        return entry.requests.first?.summary ?? "Waiting for your answer"
    }
}
