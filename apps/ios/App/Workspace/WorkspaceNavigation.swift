import Observation
import SwiftUI

@MainActor @Observable
final class WorkspaceNavigation: Hashable, Identifiable {
    nonisolated let id = UUID()
    let workspace: MobileWorkspace
    var selectedViewID: String?
    /// A view to open once the project is there, such as a chat a machine just made.
    var pendingViewID: String?
    var openedViewID: String?
    var adding = false
    var newChat = false
    var showingUsage = false
    var showingFiles = false
    var showingGit = false
    var showingLaunches = false
    var showingOutput = false
    var showingSettings = false
    /// A kind of view to make once the project is there, as a command from Search asks.
    var pendingKind: String?
    /// A sheet to put up once the project is there, which a sheet asked for during the push would not survive.
    var pendingSheet: ProjectSheet?
    /// A navigation is one opening of its project, so it times that opening.
    let load = WorkspaceLoad()

    init(workspace: MobileWorkspace) { self.workspace = workspace }

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
