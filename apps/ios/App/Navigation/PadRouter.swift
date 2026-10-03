import Foundation
import Observation

/// What the iPad's content column shows beside the sidebar.
enum PadDetail: Hashable {
    case now
    /// The view of the project pushed in the sidebar.
    case project
    case machines
    case recentlyClosed
    /// A notification still finding the project that holds its node.
    case notification(NotificationDestination)
}

/// What stands in the inspector column beside the content: the project's files, its git, or a sub-agent of the chat
/// in the content.
enum PadInspector: Hashable {
    case files, git
    case subagent(PadSubagentPane)
}

/// Where the iPad stands. The sidebar lists Now, the machines and the open projects; a project opened from anywhere is
/// pushed in it with its views, and its back button closes it again.
@MainActor @Observable
final class PadRouter {
    private(set) var project: WorkspaceNavigation?
    var detail = PadDetail.now
    var inspector: PadInspector?
    /// The machine shown beside the list of machines.
    var machineID: String?
    /// A file the palette opened in the content column, by its absolute path.
    private(set) var file: String?
    /// A sub-agent of a chat opened as a view of its own, which lives on this iPad only, as on the desktop.
    private(set) var subagent: PadSubagent?

    /// The view or node in the content, which its row in the sidebar marks.
    var shownID: String? { file == nil && subagent == nil ? project?.selectedViewID : nil }

    /// Pushes a project in the sidebar, and with `view` opens that view once the project holds it. The project already
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
            file = nil
            subagent = nil
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

    /// What a project row in the sidebar or a sheet opens with. The action compares by its id, so the id names this
    /// router: a signed-in account brings a new router, and an action equal to the old one would keep opening there.
    func openAction(before: @escaping () -> Void = {}) -> OpenMobileWorkspaceAction {
        OpenMobileWorkspaceAction(id: "pad:\(ObjectIdentifier(self).hashValue)") { [weak self] workspace, view in
            before()
            self?.openProject(workspace, view: view)
        }
    }

    /// Leaves the project, for the sidebar's back button, one that was closed or a machine that went.
    func closeProject() {
        project = nil
        inspector = nil
        file = nil
        subagent = nil
        if detail == .project { detail = .now }
    }

    /// Shows a view of the project in the sidebar in the content.
    func show(view id: String) {
        guard let project else { return }
        closeSubagentPane()
        // A node opens on its own; what the project remembers as open is the canvas it stands on.
        let canvas = project.workspace.views.first { $0.list("nodes").contains { $0.stableID == id } }
        project.workspace.select(canvas?.stableID ?? id)
        project.selectedViewID = id
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

    /// A view the project lost leaves the content.
    func forget(missing exists: (String) -> Bool) {
        if let id = project?.selectedViewID, !exists(id) { project?.selectedViewID = nil }
    }

    func show(file path: String) {
        closeSubagentPane()
        file = path
        subagent = nil
        detail = .project
    }

    func show(subagent: PadSubagent) {
        closeSubagentPane()
        self.subagent = subagent
        file = nil
        detail = .project
    }

    /// Files and Git belong to a project folder, so the Chats project and no project have neither.
    var offersFilesAndGit: Bool {
        guard let project else { return false }
        return !project.workspace.isScratch
    }

    /// The inspector only stands beside a project's content.
    var showsInspector: Bool {
        guard detail == .project, let inspector else { return false }
        if case .subagent = inspector { return true }
        return offersFilesAndGit
    }

    /// A sub-agent of the chat in the content, beside it in the inspector.
    func inspect(_ pane: PadSubagentPane) {
        inspector = .subagent(pane)
    }

    /// A sub-agent belongs to the chat it ran in, so it leaves the inspector with that chat.
    private func closeSubagentPane() {
        if case .subagent = inspector { inspector = nil }
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

/// A sub-agent in the inspector, with the chat it ran in.
struct PadSubagentPane: Hashable {
    let model: ChatModel
    let crumb: SubagentCrumb
    let session: SharedMachineSession?

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.model === rhs.model && lhs.crumb == rhs.crumb
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(ObjectIdentifier(model))
        hasher.combine(crumb)
    }
}

/// A sub-agent of a chat, opened as a view of its own.
struct PadSubagent: Hashable {
    let chatID: String
    let toolUseID: String
    let title: String
}
