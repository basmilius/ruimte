import RuimtePulsar
import SwiftUI

/// The content column beside the iPad's sidebar. Each page has a stack of its own, so a page pushed inside one never
/// outlives a switch to another.
struct PadDetailColumn: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    let now: NowModel
    @Bindable var router: PadRouter
    let openPalette: () -> Void
    let open: (ProjectViewTarget) -> Void
    let pair: () -> Void
    let signIn: () -> Void
    @State private var diagnostics = false
    @State private var newChat = false
    @State private var launches = false

    var body: some View {
        content
            .mobileSheet(isPresented: $diagnostics) {
                NavigationStack {
                    ConnectionScreen(runtime: runtime)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) { Button("Done") { diagnostics = false } }
                        }
                }
            }
    }

    @ViewBuilder private var content: some View {
        switch router.detail {
        case .now:
            NavigationStack {
                PadNowPage(runtime: runtime, now: now, open: open, openProject: openProject, pair: pair)
                    .modifier(MobilePageSurface())
                    .toolbar { toolbar }
            }
        case .project:
            if let navigation = router.project {
                PadProjectCell(navigation: navigation, router: router, diagnostics: { diagnostics = true }) {
                    toolbar
                }
                .id(navigation.id)
            } else {
                NavigationStack {
                    ContentUnavailableView(
                        String(localized: "No project open"), lucideIcon: "folder",
                        description: Text("Choose a project in the sidebar."))
                        .modifier(MobilePageSurface())
                        .toolbar { toolbar }
                }
            }
        case .machines:
            PadMachinesPage(runtime: runtime, pair: pair, signIn: signIn, selectedID: $router.machineID)
        case .recentlyClosed:
            NavigationStack {
                RecentProjectsPage(runtime: runtime, projects: projects)
                    .toolbar { toolbar }
            }
        case .notification(let destination):
            NavigationStack {
                PadNotificationPage(runtime: runtime, now: now, destination: destination, open: open)
                    .toolbar { toolbar }
            }
            .id(destination.id)
        }
    }

    /// What every page beside the sidebar has in its bar: a new chat, the project's launches, the palette, and Files
    /// and Git while a project folder is open.
    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if !runtime.machines.isEmpty {
                Button {
                    newChat = true
                } label: {
                    Image(lucide: "square-pen").accessibilityLabel("New chat")
                }
                .accessibilityIdentifier("pad.newChat")
                .popover(isPresented: $newChat, arrowEdge: .top) {
                    NowNewChatSheet(runtime: runtime, now: now, project: chatProject, opened: open)
                        .frame(minWidth: 380, idealWidth: 420, minHeight: 480)
                        .modifier(MobileSheetSurface())
                }
            }
            if let navigation = router.project, router.offersFilesAndGit {
                Button {
                    launches = true
                } label: {
                    Image(lucide: "play").accessibilityLabel("Launches")
                }
                .disabled(!navigation.workspace.ready)
                .accessibilityIdentifier("pad.launches")
                .popover(isPresented: $launches, arrowEdge: .top) {
                    NavigationStack {
                        LaunchesPage(
                            client: navigation.workspace.client, projectID: navigation.workspace.projectID,
                            folder: navigation.workspace.folder)
                            .navigationBarTitleDisplayMode(.inline)
                    }
                    .frame(minWidth: 400, idealWidth: 440, minHeight: 520)
                    .modifier(MobileSheetSurface())
                }
            }
        }
        if router.offersFilesAndGit && router.detail == .project {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    router.toggle(.files)
                } label: {
                    Image(lucide: "folder").accessibilityLabel("Files")
                }
                .accessibilityAddTraits(router.inspector == .files ? .isSelected : [])
                .accessibilityIdentifier("pad.files")
                Button {
                    router.toggle(.git)
                } label: {
                    Image(lucide: "git-branch").accessibilityLabel("Git")
                }
                .accessibilityAddTraits(router.inspector == .git ? .isSelected : [])
                .accessibilityIdentifier("pad.git")
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button(action: openPalette) {
                Image(lucide: "search").accessibilityLabel("Search")
            }
            .accessibilityIdentifier("pad.search")
        }
    }

    /// Where the write button starts a chat: the open project, or with the Chats project open, Chats itself.
    private var chatProject: NowChatProject? {
        guard let workspace = router.project?.workspace, !workspace.isScratch else { return nil }
        return NowChatProject(
            machineID: workspace.session.machine.id, projectID: workspace.projectID, name: workspace.title)
    }

    private func openProject(_ target: ProjectViewTarget) {
        guard let machine = runtime.machines.first(where: { $0.id == target.machineID }) else { return }
        router.openProject(MobileWorkspace(session: runtime.session(for: machine), projectID: target.projectID))
    }
}

/// The inspector beside the content, which stands on the split view itself: inside the content column it shared that
/// column's navigation, so what it pushed took the content's place.
struct PadInspectorPane: View {
    let router: PadRouter

    var body: some View {
        if case .subagent(let pane) = router.inspector {
            SubagentInspector(
                model: pane.model, crumb: pane.crumb, session: pane.session,
                openAsView: {
                    router.show(
                        subagent: PadSubagent(
                            chatID: pane.model.chatID, toolUseID: pane.crumb.toolUseID, title: pane.crumb.description))
                },
                close: { router.inspector = nil }
            )
            .id(pane.crumb.toolUseID)
        } else if let navigation = router.project {
            let workspace = navigation.workspace
            NavigationStack {
                switch router.inspector {
                case .files:
                    ProjectFilesPage(
                        workspace: workspace, openView: { router.show(view: $0) },
                        openFile: { router.show(file: $0, line: $1) }, shownFile: router.file)
                case .git:
                    GitPage(client: workspace.client, folder: workspace.folder, workspace: workspace)
                case .subagent, nil:
                    EmptyView()
                }
            }
            .id("\(navigation.id):\(router.inspector == .git ? "git" : "files")")
            .modifier(InspectorEdge())
        }
    }
}

/// What the sidebar's project shows beside it: its selected view, a file the palette opened, or the card that says
/// its machine stopped answering.
private struct PadProjectCell<Bar: ToolbarContent>: View {
    let navigation: WorkspaceNavigation
    let router: PadRouter
    let diagnostics: () -> Void
    @ToolbarContentBuilder let toolbar: () -> Bar

    private var workspace: MobileWorkspace { navigation.workspace }

    var body: some View {
        NavigationStack {
            shown
                .modifier(MobilePageSurface())
                .toolbar(content: toolbar)
        }
        .id(shownKey)
        .environment(
            \.padCells,
            PadCellActions(
                openSubagent: { router.show(subagent: $0) }, inspectSubagent: { router.inspect($0) })
        )
        .opacity(machineLost ? 0.3 : 1)
        .allowsHitTesting(!machineLost)
        .overlay {
            if machineLost {
                MachineLostCard(session: workspace.session, diagnostics: diagnostics) { router.closeProject() }
            }
        }
        .task(id: workspace.ready) { router.adoptActiveView() }
        .onChange(of: workspace.views.map(\.stableID)) { _, _ in
            guard workspace.ready else { return }
            router.forget { workspace.item($0) != nil }
        }
    }

    private var shownKey: String {
        router.file.map { "\($0):\(router.fileLine ?? 0)" } ?? router.subagent?.toolUseID
            ?? navigation.selectedViewID ?? ""
    }

    @ViewBuilder private var shown: some View {
        if let path = router.file {
            FileContentPage(
                client: workspace.client, path: path, initialLine: router.fileLine,
                project: FilesProject(workspace: workspace, openView: { router.show(view: $0) }))
        } else if !workspace.ready {
            opening
        } else if let subagent = router.subagent {
            PadSubagentPage(workspace: workspace, subagent: subagent) { router.show(view: subagent.chatID) }
        } else if let id = navigation.selectedViewID, let item = workspace.item(id) {
            ProjectItemPage(workspace: workspace, item: item).id(id)
        } else {
            ContentUnavailableView(
                String(localized: "Select a view"), lucideIcon: "panel-left",
                description: Text("Choose a view in the sidebar to get started."))
                .navigationTitle(workspace.title)
                .navigationBarTitleDisplayMode(.inline)
        }
    }

    @ViewBuilder private var opening: some View {
        if let problem = workspace.problem
            ?? (workspace.session.failedAttempts >= 3 ? String(localized: "Could not connect to your machine.") : nil)
        {
            ContentUnavailableView {
                Label(String(localized: "Could not open project"), lucideIcon: "triangle-alert", iconSize: 48)
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
            MobileLoadingRow(String(localized: "Opening project"))
        }
    }

    private var machineLost: Bool {
        MachineLost.isLost(
            connected: workspace.session.connected, failedAttempts: workspace.session.failedAttempts,
            problem: workspace.session.problem)
    }
}

/// A notification's chat or terminal, opened in its project once Now says which one holds it, which pushes that
/// project in the sidebar. A node no open project holds opens on its own, as it always did.
private struct PadNotificationPage: View {
    let runtime: AppRuntime
    let now: NowModel
    let destination: NotificationDestination
    let open: (ProjectViewTarget) -> Void
    @State private var searched = false

    var body: some View {
        Group {
            if searched {
                NotificationSessionPage(runtime: runtime, destination: destination)
            } else {
                MobileLoadingRow(String(localized: "Finding the conversation")).modifier(MobilePageSurface())
            }
        }
        .task {
            guard !searched else { return }
            if let target = await now.locate(machineID: destination.machineID, itemID: destination.nodeID) {
                open(target)
            } else {
                searched = true
            }
        }
    }
}

/// What the iPad's content offers the page in it: a sub-agent as a view of its own, or beside it in the inspector.
struct PadCellActions {
    let openSubagent: (PadSubagent) -> Void
    let inspectSubagent: (PadSubagentPane) -> Void
}

extension EnvironmentValues {
    @Entry var padCells: PadCellActions?
}

/// A sub-agent opened as a view of its own: its conversation, holding its chat while it shows.
private struct PadSubagentPage: View {
    let workspace: MobileWorkspace
    let subagent: PadSubagent
    let showChat: () -> Void
    @State private var model: ChatModel?

    var body: some View {
        Group {
            if let model {
                SubagentConversationPage(
                    model: model, crumb: SubagentCrumb(toolUseID: subagent.toolUseID, description: subagent.title),
                    session: workspace.session)
            } else {
                MobileLoadingRow(String(localized: "Opening"))
                    .navigationTitle(subagent.title)
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(String(localized: "Show chat"), lucideIcon: "messages-square", action: showChat)
            }
        }
        .task {
            guard model == nil else { return }
            if let chat = workspace.item(subagent.chatID) { try? await workspace.ensureSession(chat) }
            let session = workspace.session
            model = session.retainChat(
                ChatModel(client: workspace.client, chatID: subagent.chatID, machineID: session.machine.id))
        }
        .onDisappear {
            if let model { workspace.session.releaseChat(model) }
            model = nil
        }
    }
}
