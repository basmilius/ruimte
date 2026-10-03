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
        let machine = runtime.machines.first { $0.id == target.machineID }
        _workspace = State(
            initialValue: machine.map {
                MobileWorkspace(session: runtime.session(for: $0), projectID: target.projectID)
            })
    }

    var body: some View {
        Group {
            if let workspace {
                if let item = shownItem(workspace) {
                    ProjectItemPage(
                        workspace: workspace, item: item, showsProject: true, projectName: preview?.projectName)
                } else if workspace.ready && arrived == false {
                    ContentUnavailableView(
                        "This view was removed", lucideIcon: "square-x",
                        description: Text("It is no longer in \(workspace.title)."))
                } else if let problem = workspace.problem
                    ?? (workspace.session.failedAttempts >= 3 ? "Could not connect to your machine." : nil)
                {
                    ContentUnavailableView {
                        Label("Could not open", lucideIcon: "triangle-alert", iconSize: 48)
                    } description: {
                        Text(problem)
                    } actions: {
                        Button("Try again") {
                            if workspace.session.connected {
                                Task { await workspace.open() }
                            } else {
                                workspace.problem = nil
                                workspace.session.reconnect()
                            }
                        }
                    }
                } else {
                    MobileLoadingRow("Opening")
                }
            } else {
                ContentUnavailableView(
                    "Machine unavailable", lucideIcon: "triangle-alert",
                    description: Text("This machine is no longer connected to this device."))
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
/// open project holds, such as one on a machine from before `project.sidebar`, opens on its own as it always did.
struct NotificationRoutePage: View {
    let runtime: AppRuntime
    let now: NowModel
    let destination: NotificationDestination
    @State private var target: ProjectViewTarget?
    @State private var searched = false

    var body: some View {
        Group {
            if let target {
                ProjectViewPage(runtime: runtime, target: target, preview: now.preview(of: target))
            } else if searched {
                NotificationSessionPage(runtime: runtime, destination: destination)
            } else {
                MobileLoadingRow("Finding the conversation").modifier(MobilePageSurface())
            }
        }
        .task {
            guard !searched, target == nil else { return }
            target = await now.locate(machineID: destination.machineID, itemID: destination.nodeID)
            searched = true
        }
    }
}
