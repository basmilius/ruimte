import Foundation
import Observation

/// What the iPad's content column shows beside the sidebar.
enum PadDetail: Hashable {
    case now
    /// The cells of the project in the sidebar.
    case project
    /// The project cards per machine, from All projects in the switcher.
    case projects
    case machines
    case recentlyClosed
    /// A notification still finding the project that holds its node.
    case notification(NotificationDestination)
}

/// What stands in the inspector column beside the content: the project's files or its git.
enum PadInspector: Hashable {
    case files, git
}

/// Where the iPad stands. The sidebar always belongs to one project, as on the desktop, and everything else (Now, the
/// project cards, machines) opens beside it in the content column, so another project is a switch of the sidebar and
/// never a page pushed over it.
@MainActor @Observable
final class PadRouter {
    private(set) var project: WorkspaceNavigation?
    var detail = PadDetail.now
    var inspector: PadInspector?
    /// The machine shown beside the list of machines.
    var machineID: String?
    /// The view in the second cell, beside the project's selected view.
    private(set) var secondViewID: String?
    /// A file the files inspector opened in the content column, by its absolute path.
    private(set) var file: String?
    /// A sub-agent of a chat opened as a view of its own, which lives on this iPad only, as on the desktop.
    private(set) var subagent: PadSubagent?

    /// The view or node in the first cell, which its row in the sidebar marks.
    var shownID: String? { file == nil && subagent == nil ? project?.selectedViewID : nil }

    /// Puts a project in the sidebar, and with `view` opens that view once the project holds it. The project already
    /// there keeps its state, so opening one of its views from Now or a notification does not open it again.
    @discardableResult func openProject(_ workspace: MobileWorkspace, view: String? = nil) -> WorkspaceNavigation {
        let navigation: WorkspaceNavigation
        if let project, project.workspace.session === workspace.session,
            project.workspace.projectID == workspace.projectID
        {
            navigation = project
        } else {
            navigation = WorkspaceNavigation(workspace: workspace)
            project = navigation
            inspector = nil
            secondViewID = nil
            file = nil
            subagent = nil
            LastProject.remember(machineID: workspace.session.machine.id, projectID: workspace.projectID)
        }
        if let view {
            if navigation.workspace.ready, navigation.workspace.item(view) != nil {
                show(view: view)
            } else {
                navigation.pendingViewID = view
                detail = .project
            }
        } else {
            detail = .project
        }
        return navigation
    }

    /// Reopens the project of the last session in the sidebar, while the content column stays on Now.
    func restore(_ workspace: MobileWorkspace) {
        guard project == nil else { return }
        project = WorkspaceNavigation(workspace: workspace)
    }

    /// Leaves the project, for one that was closed or a machine that went.
    func closeProject() {
        project = nil
        inspector = nil
        secondViewID = nil
        file = nil
        subagent = nil
        if detail == .project { detail = .now }
        LastProject.forget()
    }

    /// Shows a view of the project in the sidebar in the first cell.
    func show(view id: String) {
        guard let project else { return }
        // A node opens on its own; what the project remembers as open is the canvas it stands on.
        let canvas = project.workspace.views.first { $0.list("nodes").contains { $0.stableID == id } }
        project.workspace.select(canvas?.stableID ?? id)
        project.selectedViewID = id
        if secondViewID == id { secondViewID = nil }
        file = nil
        subagent = nil
        detail = .project
    }

    /// A project that opened without a view to show shows the one it had open last, as the desktop reopens it.
    func adoptActiveView() {
        guard let project, project.workspace.ready, project.selectedViewID == nil, project.pendingViewID == nil,
            let id = project.workspace.selectedID, project.workspace.item(id) != nil
        else { return }
        project.selectedViewID = id
    }

    /// Opens a view in the cell beside the one shown, as the desktop's split grid does.
    func showBeside(view id: String) {
        guard let project else { return }
        guard project.selectedViewID != nil, project.selectedViewID != id || file != nil || subagent != nil else {
            show(view: id)
            return
        }
        secondViewID = id
        detail = .project
    }

    func closeSecondCell() {
        secondViewID = nil
    }

    /// A view the project lost leaves its cell; the second cell takes the first one's place when that one went.
    func forget(missing exists: (String) -> Bool) {
        if let id = secondViewID, !exists(id) { secondViewID = nil }
        if let id = project?.selectedViewID, !exists(id) {
            project?.selectedViewID = secondViewID
            secondViewID = nil
        }
    }

    func show(file path: String) {
        file = path
        subagent = nil
        detail = .project
    }

    func show(subagent: PadSubagent) {
        self.subagent = subagent
        file = nil
        detail = .project
    }

    func showNow() {
        detail = .now
    }

    /// Files and Git belong to a project folder, so the Chats project and no project have neither.
    var offersFilesAndGit: Bool {
        guard let project else { return false }
        return !project.workspace.isScratch
    }

    func toggle(_ panel: PadInspector) {
        guard offersFilesAndGit else { return }
        inspector = inspector == panel ? nil : panel
    }

    /// A notification's node opens in its project once Now says which one holds it.
    func open(_ notification: NotificationDestination) {
        detail = notification.target == "machine" || notification.nodeID.isEmpty ? .now : .notification(notification)
    }
}

/// A sub-agent of a chat, opened as a view of its own.
struct PadSubagent: Hashable {
    let chatID: String
    let toolUseID: String
    let title: String
}
