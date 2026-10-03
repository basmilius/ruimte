import Foundation
import Observation

enum PhoneTab: String, CaseIterable, Hashable {
    case now, projects, machines, search

    var title: String {
        switch self {
        case .now: "Now"
        case .projects: "Projects"
        case .machines: "Machines"
        case .search: "Search"
        }
    }

    var icon: String {
        switch self {
        case .now: "inbox"
        case .projects: "folders"
        case .machines: "monitor"
        case .search: "search"
        }
    }
}

/// A page pushed on a tab's stack.
enum PhoneRoute: Hashable {
    case project(WorkspaceNavigation)
    /// A view opened from its project's list, over the project.
    case projectView(WorkspaceNavigation, String)
    /// A view opened outside its project's list.
    case view(ProjectViewTarget)
    /// A notification still finding the project that holds its node.
    case notification(NotificationDestination)
    case recentProjects
    /// A machine, by its id.
    case machine(String)

    /// A view fills the screen and its composer or keyboard bar stands where the tab bar would, so the bar leaves
    /// with its push; a list keeps it.
    var hidesTabBar: Bool {
        switch self {
        case .project, .recentProjects, .machine: false
        case .projectView, .view, .notification: true
        }
    }
}

/// Where the iPhone stands: the selected tab and the routes on each tab's stack. Nothing goes deeper than two
/// levels, so a route replaces what its tab had pushed, a project opened from a machine goes to Projects and a view
/// opened from Now stays under Now.
///
/// The paths are what the person should see. `PhoneTabController` pushes and pops to match them and hands back what
/// its stacks hold once a transition settles (`settle`), so a pop by the back button or a swipe shortens a path, and
/// a swipe the person takes back leaves it as it was.
@MainActor @Observable
final class PhoneRouter {
    var tab = PhoneTab.now
    private(set) var paths: [PhoneTab: [PhoneRoute]] = [:]

    func path(_ tab: PhoneTab) -> [PhoneRoute] {
        paths[tab] ?? []
    }

    /// The project open over Projects.
    var project: WorkspaceNavigation? {
        if case .project(let navigation) = path(.projects).first { return navigation }
        return nil
    }

    /// Opens a project over Projects, and with `view` that view once the project holds it.
    func openProject(_ workspace: MobileWorkspace, view: String? = nil) {
        let navigation = WorkspaceNavigation(workspace: workspace)
        navigation.pendingViewID = view
        tab = .projects
        paths[.projects] = [.project(navigation)]
    }

    /// Opens a view of the project open over Projects on top of it.
    func openView(_ id: String, in navigation: WorkspaceNavigation) {
        tab = .projects
        paths[.projects] = [.project(navigation), .projectView(navigation, id)]
    }

    /// Shows a view outside its project's list. Search keeps it over its own field; every other tab hands it to Now.
    func show(_ target: ProjectViewTarget, from origin: PhoneTab) {
        let destination: PhoneTab = origin == .search ? .search : .now
        tab = destination
        paths[destination] = [.view(target)]
    }

    /// A notification lands on Now: its chat or terminal on top, or for a machine's overview Now itself.
    func open(_ notification: NotificationDestination) {
        tab = .now
        let overview = notification.target == "machine" || notification.nodeID.isEmpty
        paths[.now] = overview ? [] : [.notification(notification)]
    }

    func showRecentProjects() {
        tab = .projects
        paths[.projects] = [.recentProjects]
    }

    func showMachine(_ id: String) {
        tab = .machines
        paths[.machines] = [.machine(id)]
    }

    /// Takes what a tab's stack holds once a push or a pop settled.
    func settle(_ tab: PhoneTab, path: [PhoneRoute]) {
        if self.path(tab) != path { paths[tab] = path }
    }

    /// Back to Now with every stack at its root, as after a change of account.
    func reset() {
        tab = .now
        paths = [:]
    }
}
