import Foundation
import Observation

enum PhoneTab: Hashable {
    case now, projects, machines, search
}

/// A page Now or Search pushes over its root: a view of a project, or a notification still finding its project.
enum PhoneDestination: Hashable, Identifiable {
    case view(ProjectViewTarget)
    case notification(NotificationDestination)

    var id: String {
        switch self {
        case .view(let target): "view:\(target.id)"
        case .notification(let notification): "notification:\(notification.id.uuidString)"
        }
    }
}

/// Where the iPhone stands: the tab, and the one page each tab pushes. Nothing goes deeper than two levels, so
/// a project opened from a machine goes to Projects and a view opened from Now stays under Now.
@MainActor @Observable
final class PhoneRouter {
    var tab = PhoneTab.now
    /// The project open in Projects.
    var project: WorkspaceNavigation?
    var showingRecent = false
    var now: PhoneDestination?
    var search: PhoneDestination?

    /// Opens a project in Projects, and with `view` that view once the project holds it.
    func openProject(_ workspace: MobileWorkspace, view: String? = nil) {
        let navigation = WorkspaceNavigation(workspace: workspace)
        navigation.pendingViewID = view
        showingRecent = false
        project = navigation
        tab = .projects
    }

    /// Shows a view outside its project's list. Search keeps it under its own field; every other tab hands it to Now.
    func show(_ target: ProjectViewTarget, from origin: PhoneTab) {
        if origin == .search {
            search = .view(target)
        } else {
            now = .view(target)
            tab = .now
        }
    }

    /// A notification lands on Now: its chat or terminal on top, or for a machine's overview Now itself.
    func open(_ notification: NotificationDestination) {
        tab = .now
        now = notification.target == "machine" || notification.nodeID.isEmpty ? nil : .notification(notification)
    }
}
