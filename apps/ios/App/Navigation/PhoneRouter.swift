import Foundation
import Observation

enum PhoneTab: Hashable {
    case now, projects, machines, search

    var title: String {
        switch self {
        case .now: "Now"
        case .projects: "Projects"
        case .machines: "Machines"
        case .search: "Search"
        }
    }
}

/// A page pushed over the tabs. Each one covers the tab bar, which leaves and returns with the push and the pop.
enum PhoneRoute: Hashable {
    case project(WorkspaceNavigation)
    case view(ProjectViewTarget)
    /// A notification still finding the project that holds its node.
    case notification(NotificationDestination)
    case recentProjects
    /// A machine, by its id.
    case machine(String)
    case file(ProjectFileTarget)
}

/// A file of a project, by where it is on its machine.
struct ProjectFileTarget: Hashable {
    let machineID: String
    let projectID: String
    /// Absolute on the machine.
    let path: String
}

/// Where the iPhone stands: the tab under the stack and the pages pushed over it. Nothing goes deeper than two
/// levels, so a project opened from a machine goes to Projects and a view opened from Now stays under Now.
///
/// Every route is a value of `path`, which the stack only shortens once a pop settles; a swipe back the person takes
/// back leaves it as it was, so nothing here clears a route on a page's disappearance.
@MainActor @Observable
final class PhoneRouter {
    var tab = PhoneTab.now
    var path: [PhoneRoute] = []

    /// The project open over Projects.
    var project: WorkspaceNavigation? {
        if case .project(let navigation) = path.first { return navigation }
        return nil
    }

    /// Opens a project over Projects, and with `view` that view once the project holds it.
    @discardableResult func openProject(_ workspace: MobileWorkspace, view: String? = nil) -> WorkspaceNavigation {
        let navigation = WorkspaceNavigation(workspace: workspace)
        navigation.pendingViewID = view
        tab = .projects
        path = [.project(navigation)]
        return navigation
    }

    /// Shows a file of a project that Search found, over Search.
    func show(file: ProjectFileTarget) {
        tab = .search
        path = [.file(file)]
    }

    /// Shows a view outside its project's list. Search keeps it over its own field; every other tab hands it to Now.
    func show(_ target: ProjectViewTarget, from origin: PhoneTab) {
        tab = origin == .search ? .search : .now
        path = [.view(target)]
    }

    /// A notification lands on Now: its chat or terminal on top, or for a machine's overview Now itself.
    func open(_ notification: NotificationDestination) {
        tab = .now
        path = notification.target == "machine" || notification.nodeID.isEmpty ? [] : [.notification(notification)]
    }

    func showRecentProjects() {
        path = [.recentProjects]
    }

    func showMachine(_ id: String) {
        path = [.machine(id)]
    }
}
