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

/// A page pushed for a route. A project, Recently closed and a machine are list-level pages on their tab's stack,
/// under the tab bar; a view fills the screen on the stack around the tabs.
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
}

/// Where the iPhone stands: the selected tab, the list-level pages on each tab's stack and the view over the tabs.
/// Nothing goes deeper than two levels, so a route replaces what its stack had pushed, a project opened from a
/// machine goes to Projects and a view opened from Now stays over Now.
///
/// The paths are what the person should see. `PhoneRootController` pushes and pops to match them and hands back what
/// its stacks hold once a transition settles (`settle`, `settleViews`), so a pop by the back button or a swipe
/// shortens a path, and a swipe the person takes back leaves it as it was.
@MainActor @Observable
final class PhoneRouter {
    var tab = PhoneTab.now
    private(set) var paths: [PhoneTab: [PhoneRoute]] = [:]
    /// The view over the tabs, if any.
    private(set) var views: [PhoneRoute] = []

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
        views = []
    }

    /// Opens a view of a project over the tabs with the project under it, so its pop lands on the project.
    func openView(_ id: String, in navigation: WorkspaceNavigation) {
        tab = .projects
        paths[.projects] = [.project(navigation)]
        views = [.projectView(navigation, id)]
    }

    /// Shows a view outside its project's list. Search stays under it; every other tab hands it to Now.
    func show(_ target: ProjectViewTarget, from origin: PhoneTab) {
        tab = origin == .search ? .search : .now
        views = [.view(target)]
    }

    /// A notification lands over Now: its chat or terminal on top, or for a machine's overview Now itself.
    func open(_ notification: NotificationDestination) {
        tab = .now
        let overview = notification.target == "machine" || notification.nodeID.isEmpty
        views = overview ? [] : [.notification(notification)]
    }

    func showRecentProjects() {
        tab = .projects
        paths[.projects] = [.recentProjects]
        views = []
    }

    func showMachine(_ id: String) {
        tab = .machines
        paths[.machines] = [.machine(id)]
        views = []
    }

    /// Takes what a tab's stack holds once a push or a pop settled.
    func settle(_ tab: PhoneTab, path: [PhoneRoute]) {
        if self.path(tab) != path { paths[tab] = path }
    }

    /// Takes what the stack around the tabs holds once a push or a pop settled.
    func settleViews(_ path: [PhoneRoute]) {
        if views != path { views = path }
    }

    /// Back to Now with every stack at its root, as after a change of account.
    func reset() {
        tab = .now
        paths = [:]
        views = []
    }
}
