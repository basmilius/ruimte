import RuimtePulsar
import SwiftUI

/// A view of a project opened outside the project's list. It opens the project behind it, so the page has the
/// project's sessions, plans and forks the way a view opened from the list has them.
struct ProjectViewPage: View {
    let target: ProjectViewTarget
    /// Lets the page stand with its title and bar from the first frame of the push, which is what the bar morphs into.
    let preview: ProjectViewPreview?
    @State private var workspace: MobileWorkspace?
    @State private var arrived: Bool?

    init(runtime: AppRuntime, target: ProjectViewTarget, preview: ProjectViewPreview?) {
        self.target = target
        self.preview = preview
        _workspace = State(
            initialValue: runtime.session(machineID: target.machineID).map {
                MobileWorkspace(session: $0, projectID: target.projectID)
            })
    }

    var body: some View {
        Group {
            if let workspace {
                if let item = shownItem(workspace) {
                    ProjectItemPage(
                        workspace: workspace, item: item, showsProject: true, projectName: preview?.projectName)
                } else if workspace.ready && arrived != nil {
                    ContentUnavailableView(
                        String(localized: "This view was removed"), lucideIcon: "square-x",
                        description: Text("It is no longer in \(workspace.title)."))
                } else {
                    WorkspaceOpeningStatus(
                        workspace: workspace, failure: String(localized: "Could not open"),
                        opening: String(localized: "Opening"))
                }
            } else {
                ContentUnavailableView.machineUnavailable
            }
        }
        .modifier(MobilePageSurface())
        .task { workspace?.start() }
        .task(id: workspace?.ready) {
            guard let workspace, workspace.ready, arrived == nil else { return }
            arrived = await workspace.arrival(of: target.itemID)
        }
    }

    /// One expression for the preview and the opened row, so the page under them stays the same view.
    private func shownItem(_ workspace: MobileWorkspace) -> JSONValue? {
        if workspace.ready { return workspace.item(target.itemID) }
        return workspace.problem == nil ? preview?.item : nil
    }
}

/// A notification's chat or terminal, opened in its project once the machine says which one holds it. A node no
/// open project holds opens on its own. With `open` the router takes the node it found, as the iPad's sidebar pushes
/// its project; without, the page shows the node in place.
struct NotificationRoutePage: View {
    let runtime: AppRuntime
    let now: NowModel
    let destination: NotificationDestination
    var open: ((ProjectViewTarget) -> Void)?
    @State private var target: ProjectViewTarget?
    @State private var searched = false

    var body: some View {
        Group {
            if let target {
                ProjectViewPage(runtime: runtime, target: target, preview: now.preview(of: target))
            } else if searched {
                NotificationSessionPage(runtime: runtime, destination: destination)
            } else {
                MobileLoadingRow(String(localized: "Finding the conversation")).modifier(MobilePageSurface())
            }
        }
        .task {
            guard !searched, target == nil else { return }
            let found = await now.locate(machineID: destination.machineID, itemID: destination.nodeID)
            if let found, let open {
                open(found)
            } else {
                target = found
                searched = true
            }
        }
    }
}
