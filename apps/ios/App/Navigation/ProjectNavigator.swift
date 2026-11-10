import SwiftUI

/// Where a project's list stands: pushed over the iPhone's tabs, or in the iPad's sidebar with its content beside it.
enum ProjectPlacement {
    case pushed, beside
}

/// What a project's page, and the chats in it, ask of the router that holds them. `PhoneRouter` pushes what they open
/// over the list; `PadRouter` shows it in the content beside the list.
@MainActor protocol ProjectNavigator: AnyObject {
    var placement: ProjectPlacement { get }
    var highlightedViewID: String? { get }
    /// Shows a view or a node of the project, once the project holds it.
    func open(view id: String, in navigation: WorkspaceNavigation, animation: Animation?)
    /// Puts a sheet of the project up: where the page has a place for its content instead, that place takes it.
    func present(_ sheet: ProjectSheet, in navigation: WorkspaceNavigation)
    /// Leaves the project; `dismiss` is the way back of a page that was pushed.
    func leave(_ navigation: WorkspaceNavigation, dismiss: () -> Void)
    /// Shows a sub-agent of a chat beside it. Only a `beside` placement has the room; a pushed chat opens the
    /// sub-agent in its own stack.
    func inspect(_ pane: PadSubagentPane)
}

extension EnvironmentValues {
    /// The router of the project a chat stands in, set where the project's content stands beside its list.
    @Entry var projectNavigator: (any ProjectNavigator)?
}

extension PhoneRouter: ProjectNavigator {
    var placement: ProjectPlacement { .pushed }
    var highlightedViewID: String? { nil }

    func open(view id: String, in navigation: WorkspaceNavigation, animation: Animation?) {
        let workspace = navigation.workspace
        guard workspace.canOpen(id) else { return }
        let remembered = workspace.rememberedView(opening: id)
        workspace.select(remembered)
        // A node opens in the canvas that holds it, which the list already shows, so there is no selection to animate.
        withAnimation(remembered == id ? animation : nil) {
            navigation.selectedViewID = remembered
            navigation.openedViewID = id
        }
    }

    func present(_ sheet: ProjectSheet, in navigation: WorkspaceNavigation) {
        navigation.show(sheet)
    }

    func leave(_ navigation: WorkspaceNavigation, dismiss: () -> Void) {
        dismiss()
    }

    func inspect(_ pane: PadSubagentPane) {}
}

extension PadRouter: ProjectNavigator {
    var placement: ProjectPlacement { .beside }
    var highlightedViewID: String? { detail == .project ? shownID : nil }

    func open(view id: String, in navigation: WorkspaceNavigation, animation: Animation?) {
        guard navigation.workspace.canOpen(id) else { return }
        show(view: id)
    }

    func present(_ sheet: ProjectSheet, in navigation: WorkspaceNavigation) {
        switch sheet {
        case .files: inspector = .files
        case .git: inspector = .git
        default: navigation.show(sheet)
        }
    }

    func leave(_ navigation: WorkspaceNavigation, dismiss: () -> Void) {
        closeProject()
    }
}
