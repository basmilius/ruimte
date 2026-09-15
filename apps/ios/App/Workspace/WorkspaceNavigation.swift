import Observation
import SwiftUI

@MainActor @Observable
final class WorkspaceNavigation: Hashable, Identifiable {
    nonisolated let id = UUID()
    let workspace: MobileWorkspace
    var section = ProjectSection.views
    var selectedViewID: String?

    init(workspace: MobileWorkspace) { self.workspace = workspace }

    nonisolated static func == (lhs: WorkspaceNavigation, rhs: WorkspaceNavigation) -> Bool { lhs.id == rhs.id }
    nonisolated func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

enum ProjectSection: String, CaseIterable, Identifiable {
    case views, files, git, search
    var id: Self { self }
    var title: String {
        switch self {
        case .views: "Views"
        case .files: "Files"
        case .git: "Git"
        case .search: "Search"
        }
    }
    var icon: String {
        switch self {
        case .views: "layout-grid"
        case .files: "folder"
        case .git: "git-branch"
        case .search: "search"
        }
    }
}

struct WorkspaceDetail: View {
    @Bindable var navigation: WorkspaceNavigation
    private var workspace: MobileWorkspace { navigation.workspace }

    var body: some View {
        Group {
            switch navigation.section {
            case .files: MachineFilesPage(client: workspace.client, path: workspace.folder)
            case .git: GitPage(client: workspace.client, cwd: workspace.folder)
            case .views, .search:
                if let id = navigation.selectedViewID,
                    let item = workspace.views.first(where: { $0.stableID == id })
                {
                    ProjectItemPage(workspace: workspace, item: item).id(id)
                } else {
                    ContentUnavailableView(
                        "Select a view", lucideIcon: "panel-left",
                        description: Text("Choose a view in the sidebar to get started.")
                    )
                    .background(MobileStyle.surface)
                }
            }
        }
        .environment(\.mobileMachineSession, workspace.session)
    }
}
