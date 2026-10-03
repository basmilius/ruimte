import Foundation
import RuimtePulsar
import WidgetKit

/// Writes the views of every open project with their state into the app group for the project widget.
enum ProjectWidgetRecorder {
    /// Per project in the order Now reads them, its views in list order. A view needs you when it or a node on it
    /// waits unsnoozed, and works when either works.
    static func snapshot(_ entries: [ProjectViewEntry], at date: Date = .now) -> ProjectWidgetSnapshot {
        var order: [String] = []
        var projects: [String: (entry: ProjectViewEntry, views: [ProjectViewEntry], nodes: [String: [ProjectViewEntry]])] =
            [:]
        for entry in entries {
            let key = "\(entry.target.machineID):\(entry.target.projectID)"
            if projects[key] == nil {
                order.append(key)
                projects[key] = (entry, [], [:])
            }
            if entry.target.itemID == entry.target.viewID {
                projects[key]?.views.append(entry)
            } else {
                projects[key]?.nodes[entry.target.viewID, default: []].append(entry)
            }
        }
        return ProjectWidgetSnapshot(
            projects: order.compactMap { key in
                guard let project = projects[key] else { return nil }
                return ProjectWidgetProject(
                    machineID: project.entry.target.machineID, projectID: project.entry.target.projectID,
                    name: project.entry.projectName, machineName: project.entry.machineName,
                    views: project.views.map { view in
                        ProjectWidgetView(
                            id: view.target.itemID, title: view.title, icon: view.iconName,
                            state: state([view] + (project.nodes[view.target.viewID] ?? [])))
                    })
            }, updatedAt: date)
    }

    /// Writes only what changed, since every write wakes the widget.
    static func record(_ entries: [ProjectViewEntry]) {
        let next = snapshot(entries)
        if let current = ProjectWidgetStore.snapshot(), current.says(next) { return }
        ProjectWidgetStore.save(next)
        WidgetCenter.shared.reloadTimelines(ofKind: ProjectWidgetStore.kind)
    }

    private static func state(_ entries: [ProjectViewEntry]) -> ProjectWidgetView.State {
        if entries.contains(where: { $0.status == .needsYou && $0.snoozedUntil == nil }) { return .needsYou }
        if entries.contains(where: { $0.status == .running || $0.delegating }) { return .working }
        return .idle
    }
}
