import Observation
import SwiftUI

@MainActor @Observable
final class WorkspaceNavigation: Hashable, Identifiable {
    nonisolated let id = UUID()
    let workspace: MobileWorkspace
    var section = ProjectSection.views
    var selectedViewID: String?
    /// A view to open once the project is there, such as a chat a machine just made.
    var pendingViewID: String?
    /// The view pushed over the project's list on an iPhone.
    var openedViewID: String?
    var adding = false
    var newChat = false
    var showingUsage = false
    var showingFiles = false
    var showingGit = false
    var showingLaunches = false
    var showingSettings = false
    /// A kind of view to make once the project is there, as a command from Search asks.
    var pendingKind: String?
    /// A sheet to put up once the project is there, which a sheet asked for during the push would not survive.
    var pendingSheet: ProjectSheet?

    init(workspace: MobileWorkspace) { self.workspace = workspace }

    /// Puts a sheet up at once.
    func show(_ sheet: ProjectSheet) {
        switch sheet {
        case .newView: adding = true
        case .files: showingFiles = true
        case .git: showingGit = true
        case .launches: showingLaunches = true
        case .settings: showingSettings = true
        }
    }

    nonisolated static func == (lhs: WorkspaceNavigation, rhs: WorkspaceNavigation) -> Bool { lhs.id == rhs.id }
    nonisolated func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

enum ProjectSheet: Hashable {
    case newView, files, git, launches, settings
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
            case .files:
                ProjectFilesPage(workspace: workspace) { id in
                    workspace.select(id)
                    navigation.selectedViewID = id
                    navigation.section = .views
                }
            case .git: GitPage(client: workspace.client, folder: workspace.folder, workspace: workspace)
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
                }
            }
        }
        .modifier(MobilePageSurface())
    }
}
