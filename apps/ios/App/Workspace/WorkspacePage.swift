import RuimtePulsar
import SwiftUI

struct WorkspacePage: View {
    @Bindable var navigation: WorkspaceNavigation
    var isSidebar = false
    var settingsLink: SettingsLink?
    /// The branch line under the title on an iPhone.
    var gitLines: ProjectGitLines?
    /// What the iPhone's card for a machine that does not answer opens its diagnostics with.
    var runtime: AppRuntime?
    private var workspace: MobileWorkspace { navigation.workspace }
    @State private var showDiagnostics = false
    @Environment(\.dismiss) private var dismiss
    @State private var iconView: JSONValue?
    @State private var settingsView: JSONValue?
    @State private var renamed: JSONValue?
    @State private var renameText = ""
    @State private var deleteView: ViewDeletion?
    @State private var search = ""
    @State private var searching = false
    @State private var showProcesses = false
    @State private var forkProblem: String?
    @State private var listState: ProjectListState
    @State private var newView: NewViewResult?
    /// A view New view made that opens once its settings asked what it shows.
    @State private var openAfterSettings: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        navigation: WorkspaceNavigation, isSidebar: Bool = false, settingsLink: SettingsLink? = nil,
        gitLines: ProjectGitLines? = nil, runtime: AppRuntime? = nil
    ) {
        _navigation = Bindable(navigation)
        self.isSidebar = isSidebar
        self.settingsLink = settingsLink
        self.gitLines = gitLines
        self.runtime = runtime
        _listState = State(
            initialValue: ProjectListState(
                machineID: navigation.workspace.session.machine.id, projectID: navigation.workspace.projectID))
    }

    var body: some View {
        Group {
            if isSidebar {
                if workspace.ready { projectTabs } else { openingStatus }
            } else {
                // The list stands from the first frame of the push. Swapping it in for the status once the project
                // opened, as the push settles, made the bar drop its items for a moment and bring them back.
                PhoneProjectList(
                    workspace: workspace, state: listState, views: listedViews,
                    selectedID: navigation.selectedViewID, open: openView, act: act
                )
                .opacity(machineLost ? 0.3 : 1)
                .allowsHitTesting(!machineLost)
                .overlay {
                    if machineLost {
                        EmptyView()
                    } else if !workspace.ready {
                        openingStatus
                    } else if workspace.isScratch && listedViews.isEmpty {
                        noChats
                    }
                }
            }
        }
        .modifier(MobilePageSurface())
        .overlay(alignment: .bottom) {
            if !isSidebar && machineLost {
                MachineLostCard(
                    session: workspace.session, diagnostics: runtime == nil ? nil : { showDiagnostics = true },
                    otherProject: { dismiss() })
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                if isSidebar && workspace.ready && !workspace.session.connected {
                    HStack {
                        if workspace.session.failedAttempts >= 3 {
                            Text("Could not reconnect to your machine.").font(.caption)
                            Spacer()
                            Button("Try again") { workspace.session.reconnect() }
                        } else {
                            MobileLoadingRow("Reconnecting to your machine")
                        }
                    }.frame(maxWidth: .infinity).padding(8).background(.thinMaterial)
                }
                if let notice = workspace.notice {
                    HStack {
                        Text("An agent opened a view").font(.subheadline)
                        Spacer()
                        Button("Go there") {
                            openView(notice.text("viewId"))
                            workspace.notice = nil
                        }
                        Button("Dismiss", lucideIcon: "x") { workspace.notice = nil }
                            .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                    }.padding().background(.thinMaterial)
                }
                if let problem = workspace.problem, workspace.ready {
                    HStack {
                        Text(problem).font(.caption)
                        Spacer()
                        Button("Retry save") { Task { await workspace.save() } }
                    }.padding().background(.thinMaterial)
                }
            }
        }
        .navigationTitle(isSidebar ? "" : workspace.title)
        .modifier(PhoneSubtitle(text: isSidebar ? nil : phoneSubtitle))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isSidebar { tabletToolbar } else { phoneToolbar }
        }
        .navigationDestination(item: $navigation.openedViewID) { id in viewDestination(id) }
        .task { workspace.start() }
        .task(id: workspace.ready) {
            await openPendingView()
            await makePendingKind()
        }
        .task(id: workspace.ready) {
            guard !isSidebar, workspace.ready, !workspace.isScratch, let gitLines else { return }
            await gitLines.refresh(
                UnifiedProjectRow.ID(machineID: workspace.session.machine.id, projectID: workspace.projectID),
                folder: workspace.folder, client: workspace.client)
        }
        .alert(
            "Could not fork", isPresented: Binding(get: { forkProblem != nil }, set: { if !$0 { forkProblem = nil } }),
            presenting: forkProblem
        ) { _ in
            Button("OK", role: .cancel) { forkProblem = nil }
        } message: { problem in
            Text(problem)
        }
        .mobileSheet(isPresented: $navigation.newChat) {
            NewChatSheet(session: workspace.session) { place in
                guard place.projectID == workspace.projectID else { return }
                navigation.pendingViewID = place.viewID
                Task { await openPendingView() }
            }
        }
        .mobileSheet(isPresented: Binding(get: { iconView != nil }, set: { if !$0 { iconView = nil } })) {
            if let item = iconView { ViewIconPicker(workspace: workspace, item: item) }
        }
        .mobileSheet(
            isPresented: Binding(get: { settingsView != nil }, set: { if !$0 { settingsView = nil } }),
            onDismiss: {
                if let id = openAfterSettings { openView(id) }
                openAfterSettings = nil
            }
        ) {
            if let item = settingsView { ViewSettingsSheet(workspace: workspace, item: item) }
        }
        .mobileSheet(isPresented: $navigation.adding, onDismiss: afterNewView) {
            if isSidebar {
                AddProjectItem(workspace: workspace, canvasID: nil)
            } else {
                NewViewSheet(workspace: workspace) { newView = $0 }
            }
        }
        .mobileSheet(isPresented: $navigation.showingSettings) {
            ProjectSettingsPage(workspace: workspace) {
                navigation.showingSettings = false
                navigation.showingLaunches = true
            } closed: {
                navigation.showingSettings = false
                dismiss()
            }
        }
        .mobileSheet(isPresented: $showDiagnostics) {
            if let runtime {
                NavigationStack {
                    ConnectionScreen(runtime: runtime)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) { Button("Done") { showDiagnostics = false } }
                        }
                }
            }
        }
        .mobileSheet(isPresented: $navigation.showingUsage) {
            NavigationStack {
                MachineUsagePage(client: workspace.client)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { navigation.showingUsage = false }
                        }
                    }
            }
        }
        .mobileSheet(isPresented: $navigation.showingFiles) {
            NavigationStack {
                ProjectFilesPage(workspace: workspace) { id in
                    navigation.showingFiles = false
                    openView(id)
                }
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { navigation.showingFiles = false }
                        }
                    }
            }
        }
        .mobileSheet(isPresented: $navigation.showingGit) {
            NavigationStack {
                GitPage(client: workspace.client, folder: workspace.folder, workspace: workspace)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { navigation.showingGit = false } }
                    }
            }
        }
        .mobileSheet(isPresented: $navigation.showingLaunches) {
            NavigationStack {
                LaunchesPage(
                    client: workspace.client, projectID: workspace.projectID, folder: workspace.folder,
                    projectName: workspace.title
                )
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(role: .close) { navigation.showingLaunches = false }
                    }
                }
            }
        }
        .mobileSheet(isPresented: $showProcesses) {
            NavigationStack {
                ProcessesPage(client: workspace.client, titles: workspace.nodeTitles)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { showProcesses = false } }
                    }
            }
        }
        .alert(
            renamed?.text("kind") == "subheader" ? "Name the heading" : "Rename view",
            isPresented: Binding(get: { renamed != nil }, set: { if !$0 { renamed = nil } })
        ) {
            TextField("Name", text: $renameText)
            Button("Save") {
                guard let id = renamed?.stableID, !renameText.isEmpty else { return }
                Task {
                    await workspace.updateView(id) {
                        $0.setting("name", .string(renameText)).setting("titleSource", .string("user"))
                    }
                }
                renamed = nil
            }
            Button("Cancel", role: .cancel) { renamed = nil }
        }
        .confirmationDialog(
            deleteView?.item.text("kind") == "chat" ? "Delete this chat?" : "Delete this view?",
            isPresented: Binding(get: { deleteView != nil }, set: { if !$0 { deleteView = nil } }),
            titleVisibility: .visible, presenting: deleteView
        ) { pending in
            Button(pending.item.text("kind") == "chat" ? "Delete chat" : "Delete view", role: .destructive) {
                deleteView = nil
                Task {
                    await workspace.edit { document in
                        var views = document.list("views").filter { $0.stableID != pending.item.stableID }
                        if views.isEmpty && !workspace.isScratch { views = [newCanvas()] }
                        return document.setting("views", .array(views))
                    }
                    if workspace.problem == nil { await SessionEnding.end(pending.question, session: workspace.session) }
                }
            }
        } message: { pending in
            if let warning = pending.question.warning { Text(warning) }
        }
        .confirmationDialog(
            "This project changed elsewhere", isPresented: Binding(get: { workspace.conflict != nil }, set: { _ in }),
            titleVisibility: .visible
        ) {
            Button("Use machine version") { workspace.acceptRemote() }
            Button("Save my version", role: .destructive) { Task { await workspace.keepLocal() } }
        } message: {
            Text(
                "Your edits are kept until you choose. Saving your version replaces conflicting changes on the machine."
            )
        }
    }

    /// Files and Git, then the project's menu, beside the avatar, so Settings is one tap away here too. The Chats
    /// project's folder is the machine's own, so it has neither and its menu holds New chat and Usage only. The items
    /// wait for the project, not the other way round, so they stay the same through a push the project opens during.
    @ToolbarContentBuilder private var phoneToolbar: some ToolbarContent {
        if !workspace.isScratch {
            ToolbarItem(id: "project.files", placement: .topBarTrailing) {
                Button("Files", lucideIcon: "folder") { navigation.showingFiles = true }
                    .disabled(!workspace.ready)
                    .accessibilityIdentifier("project.files")
            }
            ToolbarItem(id: "project.git", placement: .topBarTrailing) {
                Button("Git", lucideIcon: "git-branch") { navigation.showingGit = true }
                    .disabled(!workspace.ready)
                    .accessibilityIdentifier("project.git")
            }
        }
        ToolbarItem(id: "project.menu", placement: .topBarTrailing) {
            Menu {
                Section {
                    if workspace.isScratch {
                        Button("New chat", lucideIcon: "message-square-plus") { navigation.newChat = true }
                    } else {
                        Button("New view", lucideIcon: "plus") { navigation.adding = true }
                    }
                }
                .disabled(!workspace.ready)
                Section {
                    if !workspace.isScratch {
                        Button("Launches", lucideIcon: "play") { navigation.showingLaunches = true }
                    }
                    Button("Usage", lucideIcon: "chart-no-axes-column") { navigation.showingUsage = true }
                }
                .disabled(!workspace.ready)
                if !workspace.isScratch {
                    Section {
                        Button("Project settings", lucideIcon: "settings-2") { navigation.showingSettings = true }
                    }
                    .disabled(!workspace.ready)
                }
            } label: {
                Image(lucide: "ellipsis")
            }
            .accessibilityLabel("Project menu")
            .accessibilityIdentifier("project.menu")
        }
        if let settingsLink {
            SettingsToolbarItem(link: settingsLink)
        }
    }

    @ToolbarContentBuilder private var tabletToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                // The Chats project's folder is the machine's own, so it has no launches.
                if !workspace.isScratch {
                    Button("Launches", lucideIcon: "rocket") { navigation.showingLaunches = true }
                }
                Button("Processes", lucideIcon: "activity") { showProcesses = true }
                Button("Usage", lucideIcon: "chart-no-axes-column") { navigation.showingUsage = true }
            } label: {
                Image(lucide: "ellipsis")
            }
            .accessibilityLabel("More")
            .disabled(!workspace.ready)
        }
        ToolbarItem(placement: .topBarTrailing) {
            // The views of the Chats project are its chats, so its plus makes one.
            if workspace.isScratch {
                Button("New chat", lucideIcon: "message-square-plus") { navigation.newChat = true }
                    .disabled(!workspace.ready)
            } else {
                Button("Add view", lucideIcon: "plus") { navigation.adding = true }
                    .disabled(!workspace.ready)
            }
        }
    }

    @ViewBuilder private var openingStatus: some View {
        if let problem = workspace.problem
            ?? (workspace.session.failedAttempts >= 3 ? "Could not connect to your machine." : nil)
        {
            ContentUnavailableView {
                Label("Could not open project", lucideIcon: "triangle-alert", iconSize: 48)
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
            MobileLoadingRow("Opening project")
        }
    }

    private var projectTabs: some View {
        TabView(selection: $navigation.section) {
            Tab(value: ProjectSection.views) {
                viewList(query: "")
            } label: {
                Label("Views", lucideIcon: "layout-grid")
            }
            // The Chats project's folder is the machine's own, so it shows neither files nor git.
            if !workspace.isScratch {
                Tab(value: ProjectSection.files) {
                    if isSidebar {
                        viewList(query: "")
                    } else {
                        ProjectFilesPage(workspace: workspace) { openView($0) }
                    }
                } label: {
                    Label("Files", lucideIcon: "folder")
                }
                Tab(value: ProjectSection.git) {
                    if isSidebar {
                        viewList(query: "")
                    } else {
                        GitPage(client: workspace.client, folder: workspace.folder, workspace: workspace)
                    }
                } label: {
                    Label("Git", lucideIcon: "git-branch")
                }
            }
            Tab(value: ProjectSection.search, role: .search) {
                searchResults.searchable(text: $search, isPresented: $searching, prompt: "Find a view")
            } label: {
                Label("Search", lucideIcon: "search")
            }
        }
        .tabViewStyle(.tabBarOnly)
        .tabViewSearchActivation(.searchTabSelection)
        // The sidebar is a narrow navigator; the separate detail column keeps its regular iPad traits.
        .environment(\.horizontalSizeClass, .compact)
        .environment(\.inProjectSidebar, isSidebar)
        .onChange(of: navigation.section) { _, selected in searching = selected == .search }
    }

    private var searchResults: some View {
        viewList(query: search)
            .overlay {
                if !search.isEmpty && WorkspaceViewSections.split(listedViews, search: search).isEmpty {
                    ContentUnavailableView("No matching views", lucideIcon: "search")
                }
            }
    }

    /// A view, or on an iPhone a node its canvas lists, which opens on its own over the list.
    @ViewBuilder private func viewDestination(_ id: String) -> some View {
        if let item = workspace.item(id) {
            ProjectItemPage(workspace: workspace, item: item).id(id)
        } else {
            ContentUnavailableView("This view was removed", lucideIcon: "square-x")
        }
    }

    private var noChats: some View {
        ContentUnavailableView {
            Label("No chats yet", lucideIcon: "messages-square", iconSize: 48)
        } actions: {
            Button("New chat") { navigation.newChat = true }.disabled(!workspace.session.connected)
        }
    }

    /// The machine and, once git answered, the branch with what changed on it.
    private var phoneSubtitle: String {
        let id = UnifiedProjectRow.ID(machineID: workspace.session.machine.id, projectID: workspace.projectID)
        return [workspace.session.machine.name, gitLines?.line(id)?.text].compactMap { $0 }.joined(separator: " · ")
    }

    private var machineLost: Bool {
        MachineLost.isLost(
            connected: workspace.session.connected, failedAttempts: workspace.session.failedAttempts,
            problem: workspace.session.problem)
    }

    private func act(_ action: ProjectRowAction, on item: JSONValue) {
        switch action {
        case .rename:
            renameText = item.text("name")
            renamed = item
        case .icon: iconView = item
        case .settings: settingsView = item
        case .fork: Task { await fork(item) }
        case .snooze: break
        case .stopTurn:
            Task {
                do {
                    _ = try await workspace.client.request(
                        "chat.cancel", payload: .object(["chatId": .string(item.stableID)]))
                } catch {
                    workspace.problem = error.localizedDescription
                }
            }
        case .delete:
            Task {
                let question = await SessionEnding.question(for: item, client: workspace.client)
                deleteView = ViewDeletion(item: item, question: question)
            }
        }
    }

    /// Opens the chat with the fork sheet up for its last turn that ended, as the desktop's Fork in a row's menu does.
    /// The chat's own screen takes the shared model over, sheet and all.
    private func fork(_ item: JSONValue) async {
        let id = item.stableID
        do {
            try await workspace.ensureSession(item)
        } catch {
            forkProblem = error.localizedDescription
            return
        }
        let session = workspace.session
        let model = session.retainChat(ChatModel(client: workspace.client, chatID: id, machineID: session.machine.id))
        defer { session.releaseChat(model) }
        var waited = 0
        while (model.loading || model.info == .null) && model.error == nil && waited < 50 {
            try? await Task.sleep(for: .milliseconds(100))
            waited += 1
        }
        guard let turnID = model.presentation.lastSettledTurnID else {
            forkProblem = model.error ?? "This chat has no turn that ended yet, so there is nothing to fork."
            return
        }
        model.presentation.forkRequest = ChatForkRequest(turnID: turnID)
        openView(id)
    }

    /// What New view made, once its sheet is gone: open the view, ask a heading for its words, or pick a file.
    private func afterNewView() {
        guard let made = newView else { return }
        newView = nil
        switch made {
        case .view(let id): openView(id)
        case .ask(let item):
            openAfterSettings = item.stableID
            settingsView = item
        case .heading(let item):
            renameText = ""
            renamed = item
        case .file: navigation.showingFiles = true
        }
    }

    /// A kind of view a command from Search asked for, made once the project is there.
    private func makePendingKind() async {
        guard workspace.ready, let kind = navigation.pendingKind else { return }
        navigation.pendingKind = nil
        let item = NewViewFactory.view(kind: kind, existing: workspace.views)
        await workspace.edit { $0.setting("views", .array($0.list("views") + [item])) }
        if workspace.problem == nil { openView(item.stableID) }
    }

    private var listedViews: [JSONValue] {
        workspace.views.filter { WorkspaceViewSections.isListed($0, selectedID: navigation.selectedViewID) }
    }

    private func viewList(query: String) -> some View {
        let sections = WorkspaceViewSections.split(listedViews, search: query)
        return List {
            ForEach(sections) { section in
                Section {
                    if section.id != sections.first?.id || section.title != nil || isSidebar {
                        VStack(alignment: .leading, spacing: 8) {
                            if isSidebar && section.id == sections.first?.id {
                                Text(workspace.title).font(.title3.weight(.semibold))
                                    .foregroundStyle(MobileStyle.text).lineLimit(1).truncationMode(.tail)
                                    .textCase(nil).padding(.vertical, 8)
                                    .accessibilityAddTraits(.isHeader)
                            }
                            if section.id != sections.first?.id {
                                MobileStyle.border.frame(height: 1).padding(.vertical, 10)
                            }
                            if let title = section.title {
                                Text(title).font(.footnote).foregroundStyle(MobileStyle.muted).textCase(nil)
                            }
                        }
                        .listRowInsets(EdgeInsets(top: 0, leading: 28, bottom: 0, trailing: 28))
                        .listRowSeparator(.hidden)
                        .moveDisabled(true)
                        .allowsHitTesting(false)
                        .accessibilityHidden(section.title == nil && !(isSidebar && section.id == sections.first?.id))
                    }
                    ForEach(section.items, id: \.stableID) { item in
                        let selected =
                            navigation.selectedViewID == item.stableID
                            && (navigation.section == .views || navigation.section == .search)
                        Button {
                            openView(item.stableID)
                        } label: {
                            viewRow(item)
                                .modifier(MobileSidebarLabel())
                        }
                        .foregroundStyle(MobileStyle.text)
                        .modifier(MobileSidebarRow(selected: isSidebar && selected))
                        .accessibilityIdentifier("workspace.view.\(item.stableID)")
                        .contextMenu {
                            Button("Rename", lucideIcon: "pencil") {
                                renameText = item.text("name")
                                renamed = item
                            }.disabled(item.text("kind") == "unknown")
                            Button("Change icon", lucideIcon: "palette") { iconView = item }
                                .disabled(item.text("kind") == "unknown")
                            if ["chat", "terminal"].contains(item.text("kind")) {
                                let snoozes = workspace.session.snoozes
                                SnoozeMenu(until: snoozes.until(item.stableID)) {
                                    snoozes.snooze(item.stableID, until: $0)
                                } wake: {
                                    snoozes.clear(item.stableID)
                                }
                            }
                            Button("Delete", lucideIcon: "trash", role: .destructive) {
                                Task {
                                    let question = await SessionEnding.question(for: item, client: workspace.client)
                                    deleteView = ViewDeletion(item: item, question: question)
                                }
                            }
                        }
                        .moveDisabled(!query.isEmpty)
                    }
                    .onMove { indices, destination in
                        guard query.isEmpty else { return }
                        let expectedIDs = section.items.map(\.stableID)
                        let selectedID = navigation.selectedViewID
                        Task {
                            await workspace.edit { document in
                                guard
                                    let reordered = WorkspaceViewSections.moving(
                                        document.list("views"), sectionID: section.id,
                                        expectedIDs: expectedIDs,
                                        from: indices, to: destination,
                                        listed: { WorkspaceViewSections.isListed($0, selectedID: selectedID) })
                                else { return document }
                                return document.setting("views", .array(reordered))
                            }
                        }
                    }
                }
                .listSectionSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
        }
        .modifier(MobileSidebarList(minimumRowHeight: 0))
        .overlay {
            if workspace.ready && workspace.isScratch && query.isEmpty && sections.isEmpty {
                noChats
            }
        }
        .contentMargins(.top, isSidebar ? nil : 0, for: .scrollContent)
        .contentMargins(.bottom, isSidebar ? nil : 24, for: .scrollContent)
        .accessibilityIdentifier("workspace.views")
    }

    /// Opens the view a project was opened for, once the machine's copy of the project holds it.
    private func openPendingView() async {
        guard workspace.ready, let id = navigation.pendingViewID else { return }
        navigation.pendingViewID = nil
        if await workspace.arrival(of: id) { openView(id) }
    }

    private func openView(_ id: String) {
        if !isSidebar, let canvas = workspace.views.first(where: { $0.list("nodes").contains { $0.stableID == id } }) {
            // A node opens on its own; what the project remembers as open is the canvas it stands on.
            workspace.select(canvas.stableID)
            navigation.selectedViewID = canvas.stableID
            navigation.openedViewID = id
            return
        }
        guard workspace.views.contains(where: { $0.stableID == id && !WorkspaceViewSections.isDivider($0) }) else { return }
        workspace.select(id)
        withAnimation(reduceMotion ? nil : .default) {
            navigation.section = .views
            navigation.selectedViewID = id
            searching = false
            if !isSidebar { navigation.openedViewID = id }
        }
    }

    private func viewRow(_ item: JSONValue) -> some View {
        HStack(spacing: 10) {
            WorkspaceViewIcon(item: item).foregroundStyle(MobileStyle.muted)
            Text(item.text("name", fallback: item.text("kind")))
                .font(.callout).lineLimit(1).truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let task = workspace.session.tasks.childTask(item.stableID) { TaskMark(task: task) }
            if let until = workspace.session.snoozes.until(item.stableID) {
                Image(lucide: "alarm-clock", size: 14).foregroundStyle(MobileStyle.muted)
                    .accessibilityLabel("Snoozed until \(SnoozeChoice.moment(until, from: .now))")
            } else {
                AttentionMark(store: workspace.session.attention, id: item.stableID)
            }
            if !isSidebar {
                Image(lucide: "chevron-right", size: 12)
                    .foregroundStyle(MobileStyle.faint).accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// A second line under an iPhone page's title: the machine of a project, or the project of a view opened elsewhere.
private struct PhoneSubtitle: ViewModifier {
    let text: String?

    func body(content: Content) -> some View {
        if let text { content.navigationSubtitle(text) } else { content }
    }
}

private struct ViewDeletion {
    let item: JSONValue
    let question: SessionEnding.Question
}

func newCanvas() -> JSONValue {
    .object([
        "id": .string("canvas-" + UUID().uuidString), "kind": .string("canvas"), "name": .string("Canvas"),
        "nodes": .array([]), "texts": .array([]), "edges": .array([]), "layouts": .array([]),
    ])
}

/// A node for a canvas, placed right of the nodes it already has.
func newCanvasNode(kind: String, title: String, after nodes: [JSONValue], extra: [String: JSONValue] = [:]) -> JSONValue
{
    let right = nodes.map { $0.number("x") + $0.number("w") }.max() ?? -40
    var node: [String: JSONValue] = [
        "id": .string(kind + "-" + UUID().uuidString), "kind": .string(kind), "title": .string(title),
        "titleSource": .string("user"), "x": .number(right + 40), "y": .number(0),
        "w": .number(kind == "chat" ? 480 : 400), "h": .number(300),
    ]
    node.merge(extra) { _, new in new }
    return .object(node)
}

struct ProjectItemPage: View {
    let workspace: MobileWorkspace
    let item: JSONValue
    /// Opened outside the project's list, from Now, Search or a notification, so the title names the project.
    var showsProject = false
    /// The project's name until the project behind a view opened outside its list has opened.
    var projectName: String?
    @State private var ready = false
    @State private var problem: String?
    @State private var selectedMember: String?
    private var isPresent: Bool {
        !workspace.ready || workspace.views.contains {
            $0.stableID == item.stableID || $0.list("nodes").contains { $0.stableID == item.stableID }
        }
    }
    private var current: JSONValue {
        workspace.views.first(where: { $0.stableID == item.stableID }) ?? workspace.views.flatMap { $0.list("nodes") }
            .first(where: { $0.stableID == item.stableID }) ?? item
    }
    var body: some View {
        Group {
            if !isPresent {
                ContentUnavailableView(
                    "This view was removed", lucideIcon: "square-x",
                    description: Text("Return to the project to choose another view."))
            } else if current.text("kind") == "chat" {
                VStack(spacing: 0) {
                    if let problem {
                        SessionErrorBanner(message: problem) { Task { await prepare() } }
                    }
                    ChatScreen(
                        client: workspace.client, chatID: current.stableID, title: title, isPrepared: ready,
                        workspace: workspace)
                }
            } else if let problem {
                ContentUnavailableView {
                    Label("Could not open", lucideIcon: "triangle-alert", iconSize: 48)
                } description: {
                    Text(problem)
                } actions: {
                    Button("Retry") { Task { await prepare() } }
                }
            } else if !ready {
                MobileLoadingRow("Opening").toolbar { OpeningViewToolbar(kind: current.text("kind")) }
            } else {
                switch current.text("kind") {
                case "canvas": CanvasPage(workspace: workspace, viewID: current.stableID)
                case "terminal":
                    VStack(spacing: 0) {
                        if let command = workspace.heldCommands[current.stableID] {
                            HStack {
                                Text("Run \(command)?").font(.callout.monospaced()).lineLimit(1).truncationMode(.middle)
                                Spacer()
                                Button("Run") { Task { await workspace.runHeldCommand(current.stableID) } }
                                    .buttonStyle(.borderedProminent)
                            }
                            .padding().background(.regularMaterial)
                            .disabled(!workspace.session.connected)
                        }
                        TerminalScreen(client: workspace.client, sessionID: current.stableID, title: title)
                    }
                case "browser": BrowserPage(url: current.text("url"))
                case "file":
                    FileContentPage(
                        client: workspace.client, path: absolutePath(current.text("path")),
                        project: FilesProject(workspace: workspace),
                        isView: workspace.views.contains { $0.stableID == current.stableID })
                case "note": NotePage(workspace: workspace, nodeID: current.stableID, bodyText: current.text("body"))
                case "drawing":
                    DrawingEditorPage(
                        client: workspace.client, machineID: workspace.session.machine.id,
                        projectID: workspace.projectID, viewID: current.text("viewId", fallback: current.stableID))
                case "diagram":
                    RenderDocumentPage(
                        client: workspace.client, projectID: workspace.projectID,
                        viewID: current.text("viewId", fallback: current.stableID), kind: current.text("kind"))
                case "group":
                    MobileList {
                        ForEach(current.list("memberIds").compactMap(\.stringValue), id: \.self) { id in
                            if let node = workspace.views.flatMap({ $0.list("nodes") }).first(where: {
                                $0.stableID == id
                            }) {
                                Button {
                                    selectedMember = id
                                } label: {
                                    Label {
                                        Text(node.text("title")).lineLimit(1).truncationMode(.tail)
                                    } icon: {
                                        WorkspaceViewIcon(item: node)
                                    }
                                    .modifier(MobileSidebarLabel(disclosure: true))
                                }
                                .modifier(MobileSidebarRow())
                            }
                        }
                    }
                default:
                    ContentUnavailableView(
                        "A newer view", lucideIcon: "circle-question-mark",
                        description: Text(
                            "Open this view in a newer Ruimte. Its content is preserved when you edit this project."))
                }
            }
        }
        .modifier(MobilePageSurface())
        .accessibilityIdentifier("workspace.destination.\(item.stableID)")
        .navigationDestination(item: $selectedMember) { id in
            if let node = workspace.views.flatMap({ $0.list("nodes") }).first(where: { $0.stableID == id }) {
                ProjectItemPage(workspace: workspace, item: node)
            }
        }
        .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        .modifier(PhoneSubtitle(text: showsProject ? subtitle : nil))
        .onAppear {
            workspace.session.attention.focus(item.stableID)
            Task { await workspace.session.markSeen(item.stableID) }
        }
        .onDisappear { workspace.session.attention.blur(item.stableID) }
        .task(id: "\(workspace.session.generation):\(workspace.ready)") { await prepare() }
    }
    private var subtitle: String { workspace.ready ? workspace.title : projectName ?? workspace.title }
    private var title: String { current.text("name", fallback: current.text("title", fallback: current.text("kind"))) }
    private func absolutePath(_ path: String) -> String {
        path.hasPrefix("/") || path.hasPrefix("~") ? path : workspace.folder + "/" + path
    }
    private func prepare() async {
        guard workspace.ready, isPresent else { return }
        let needsSession = ["chat", "terminal"].contains(current.text("kind"))
        guard !needsSession || workspace.session.connected else { return }
        do {
            try await workspace.ensureSession(current)
            guard !Task.isCancelled, isPresent else { return }
            ready = true
            problem = nil
        } catch { if !Task.isCancelled { problem = error.localizedDescription } }
    }
}

/// The trailing item a view's page will have, under the same id, while the page waits for its session: a push only
/// morphs into items that are there when it starts.
private struct OpeningViewToolbar: ToolbarContent {
    let kind: String

    var body: some ToolbarContent {
        if let glyph = OpeningViewToolbar.glyph(for: kind) {
            ToolbarItem(id: "\(kind).actions", placement: .topBarTrailing) {
                Button {} label: { Image(lucide: glyph) }.disabled(true)
            }
        }
    }

    static func glyph(for kind: String) -> String? {
        switch kind {
        case "terminal": "type"
        case "diagram": "refresh-cw"
        default: nil
        }
    }
}

struct AddProjectItem: View {
    let workspace: MobileWorkspace
    let canvasID: String?
    @Environment(\.dismiss) private var dismiss
    @State private var kind: String
    @State private var name = ""
    @State private var detail = ""
    @State private var provider = "codex"
    @State private var providers: [JSONValue]?
    @State private var saving = false

    init(workspace: MobileWorkspace, canvasID: String?, kind: String = "chat") {
        self.workspace = workspace
        self.canvasID = canvasID
        _kind = State(initialValue: kind)
    }

    private var chatAgents: [(kind: String, name: String)] {
        guard let providers else { return [("codex", "Codex"), ("claude", "Claude Code")] }
        return AgentCatalog.installed(providers, target: "chat").map {
            ($0.text("kind"), $0.text("name", fallback: $0.text("kind")))
        }
    }
    var body: some View {
        NavigationStack {
            MobileForm {
                Picker("Kind", selection: $kind) {
                    ForEach(
                        canvasID == nil
                            ? ["chat", "terminal", "canvas", "browser", "file", "drawing", "diagram", "separator", "subheader"]
                            : ["chat", "terminal", "browser", "file", "note", "group"], id: \.self
                    ) { Text($0.capitalized).tag($0) }
                }
                TextField("Name", text: $name)
                if kind == "browser" || kind == "file" {
                    TextField(kind == "browser" ? "https://" : "Path on the machine", text: $detail)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                if kind == "note" { TextEditor(text: $detail).frame(minHeight: 140) }
                if kind == "chat" {
                    Picker("Agent", selection: $provider) {
                        ForEach(chatAgents, id: \.kind) { agent in Text(agent.name).tag(agent.kind) }
                        Text("Choose a model in the chat").tag("")
                    }
                }
                if let problem = workspace.problem { Text(problem).foregroundStyle(.red) }
            }.navigationTitle("Add \(canvasID == nil ? "view" : "node")")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add") { Task { await add() } }.disabled(
                            saving || ((kind == "browser" || kind == "file") && detail.isEmpty))
                    }
                }
        }
        .task(id: workspace.session.generation) {
            guard workspace.session.connected, let loaded = try? await AgentCatalog.load(workspace.client) else {
                return
            }
            providers = loaded
            if !provider.isEmpty && !chatAgents.contains(where: { $0.kind == provider }) {
                provider = chatAgents.first?.kind ?? ""
            }
        }
    }
    private func add() async {
        saving = true
        defer { saving = false }
        let id = kind + "-" + UUID().uuidString
        let title = name.isEmpty ? kind.capitalized : name
        var item: [String: JSONValue] = ["id": .string(id), "kind": .string(kind)]
        let agent: [String: JSONValue] =
            kind == "chat" && !provider.isEmpty
            ? ["provider": .string(provider), "providerFixed": .bool(true)] : [:]
        if canvasID != nil {
            item.merge(agent) { _, new in new }
            if kind == "group" { item["memberIds"] = .array([]) }
            if kind == "note" { item["body"] = .string(detail) }
        } else {
            item["name"] = .string(title)
            item["titleSource"] = .string("user")
            if kind == "chat" || kind == "terminal" { item["node"] = .object(agent) }
            if kind == "canvas" { for key in ["nodes", "texts", "edges", "layouts"] { item[key] = .array([]) } }
        }
        if kind == "browser" { item["url"] = .string(detail) }
        if kind == "file" { item["path"] = .string(detail) }
        let value = JSONValue.object(item)
        if let canvasID {
            await workspace.updateView(canvasID) { view in
                let node = newCanvasNode(kind: kind, title: title, after: view.list("nodes"), extra: item)
                return view.setting("nodes", .array(view.list("nodes") + [node]))
            }
        } else {
            await workspace.edit { $0.setting("views", .array($0.list("views") + [value])) }
            // A line and a heading divide the list rather than standing in it, so neither opens.
            if !WorkspaceViewSections.isDivider(value) { workspace.select(id) }
        }
        if workspace.problem == nil { dismiss() }
    }
}

struct NotePage: View {
    let workspace: MobileWorkspace
    let nodeID: String
    @State var bodyText: String
    @State private var editing = false
    var body: some View {
        Group {
            if editing {
                TextEditor(text: $bodyText).padding()
            } else {
                ScrollView {
                    Text((try? AttributedString(markdown: bodyText)) ?? AttributedString(bodyText)).frame(
                        maxWidth: .infinity, alignment: .leading
                    ).padding().textSelection(.enabled)
                }
            }
        }.toolbar {
            Button(editing ? "Save" : "Edit") {
                if editing {
                    Task {
                        if let view = workspace.views.first(where: {
                            $0.list("nodes").contains(where: { $0.stableID == nodeID })
                        }) {
                            await workspace.updateView(view.stableID) {
                                $0.setting(
                                    "nodes",
                                    .array(
                                        $0.list("nodes").map {
                                            $0.stableID == nodeID ? $0.setting("body", .string(bodyText)) : $0
                                        }))
                            }
                        }
                        if workspace.problem == nil { editing = false }
                    }
                } else {
                    editing = true
                }
            }
        }
    }
}

extension EnvironmentValues {
    @Entry var inProjectSidebar = false
    @Entry var openMobileWorkspace = OpenMobileWorkspaceAction()
}

struct OpenMobileWorkspaceAction: Equatable {
    private let id: String?
    private let action: (MobileWorkspace, String?) -> Void

    init(id: String? = nil, action: @escaping (MobileWorkspace, String?) -> Void = { _, _ in }) {
        self.id = id
        self.action = action
    }

    /// Opens a project, and with `view` that view of it once the project is there.
    func callAsFunction(_ workspace: MobileWorkspace, view: String? = nil) {
        action(workspace, view)
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id
    }
}
