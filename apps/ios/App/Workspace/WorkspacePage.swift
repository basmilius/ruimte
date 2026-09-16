import RuimtePulsar
import SwiftUI

struct WorkspacePage: View {
    @Bindable var navigation: WorkspaceNavigation
    var isSidebar = false
    private var workspace: MobileWorkspace { navigation.workspace }
    @State private var adding = false
    @State private var iconView: JSONValue?
    @State private var renamed: JSONValue?
    @State private var renameText = ""
    @State private var deleteView: JSONValue?
    @State private var search = ""
    @State private var searching = false
    @State private var showUsage = false
    @State private var openedViewID: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Group {
            if workspace.ready {
                projectTabs
            } else {
                openingStatus
            }
        }
        .modifier(MobilePageSurface())
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                if workspace.ready && !workspace.session.connected {
                    HStack {
                        if workspace.session.failedAttempts >= 3 {
                            Text("Could not reconnect to your machine.").font(.caption)
                            Spacer()
                            Button("Try again") { workspace.session.reconnect() }
                        } else {
                            ProgressView().accessibilityLabel("Reconnecting to your machine")
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
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Usage", lucideIcon: "chart-no-axes-column") { showUsage = true }
                    .disabled(!workspace.ready)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add view", lucideIcon: "plus") { adding = true }
                    .disabled(!workspace.ready)
            }
        }
        .navigationDestination(item: $openedViewID) { id in viewDestination(id) }
        .environment(\.mobileMachineSession, workspace.session)
        .task { workspace.start() }
        .mobileSheet(isPresented: Binding(get: { iconView != nil }, set: { if !$0 { iconView = nil } })) {
            if let item = iconView { ViewIconPicker(workspace: workspace, item: item) }
        }
        .mobileSheet(isPresented: $adding) { AddProjectItem(workspace: workspace, canvasID: nil) }
        .mobileSheet(isPresented: $showUsage) {
            NavigationStack {
                MachineUsagePage(client: workspace.client)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { showUsage = false } }
                    }
            }
        }
        .alert("Rename view", isPresented: Binding(get: { renamed != nil }, set: { if !$0 { renamed = nil } })) {
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
            "Delete this view?", isPresented: Binding(get: { deleteView != nil }, set: { if !$0 { deleteView = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete view", role: .destructive) {
                guard let item = deleteView else { return }
                deleteView = nil
                Task {
                    await workspace.edit { document in
                        var views = document.list("views").filter { $0.stableID != item.stableID }
                        if views.isEmpty { views = [newCanvas()] }
                        return document.setting("views", .array(views))
                    }
                }
            }
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
            ProgressView().accessibilityLabel("Opening project")
        }
    }

    private var projectTabs: some View {
        TabView(selection: $navigation.section) {
            Tab(value: ProjectSection.views) {
                viewList(query: "")
            } label: {
                Label("Views", lucideIcon: "layout-grid")
            }
            Tab(value: ProjectSection.files) {
                if isSidebar {
                    viewList(query: "")
                } else {
                    MachineFilesPage(client: workspace.client, path: workspace.folder)
                }
            } label: {
                Label("Files", lucideIcon: "folder")
            }
            Tab(value: ProjectSection.git) {
                if isSidebar { viewList(query: "") } else { GitPage(client: workspace.client, cwd: workspace.folder) }
            } label: {
                Label("Git", lucideIcon: "git-branch")
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
                if !search.isEmpty && WorkspaceViewSections.split(workspace.views, search: search).isEmpty {
                    ContentUnavailableView("No matching views", lucideIcon: "search")
                }
            }
    }

    @ViewBuilder private func viewDestination(_ id: String) -> some View {
        if let item = workspace.views.first(where: { $0.stableID == id }) {
            ProjectItemPage(workspace: workspace, item: item).id(id)
        } else {
            ContentUnavailableView("This view was removed", lucideIcon: "square-x")
        }
    }

    private func viewList(query: String) -> some View {
        let sections = WorkspaceViewSections.split(workspace.views, search: query)
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
                            Button("Delete", lucideIcon: "trash", role: .destructive) {
                                deleteView = item
                            }
                        }
                        .moveDisabled(!query.isEmpty)
                    }
                    .onMove { indices, destination in
                        guard query.isEmpty else { return }
                        let expectedIDs = section.items.map(\.stableID)
                        Task {
                            await workspace.edit { document in
                                guard
                                    let reordered = WorkspaceViewSections.moving(
                                        document.list("views"), sectionID: section.id,
                                        expectedIDs: expectedIDs,
                                        from: indices, to: destination)
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
        .contentMargins(.top, isSidebar ? nil : 0, for: .scrollContent)
        .contentMargins(.bottom, isSidebar ? nil : 24, for: .scrollContent)
        .accessibilityIdentifier("workspace.views")
    }

    private func openView(_ id: String) {
        guard workspace.views.contains(where: { $0.stableID == id && $0.text("kind") != "separator" }) else { return }
        workspace.select(id)
        withAnimation(reduceMotion ? nil : .default) {
            navigation.section = .views
            navigation.selectedViewID = id
            searching = false
            if !isSidebar { openedViewID = id }
        }
    }

    private func viewRow(_ item: JSONValue) -> some View {
        HStack(spacing: 10) {
            WorkspaceViewIcon(item: item).foregroundStyle(MobileStyle.muted)
            Text(item.text("name", fallback: item.text("kind")))
                .font(.callout).lineLimit(1).truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let task = workspace.session.tasks.childTask(item.stableID) { TaskMark(task: task) }
            AttentionMark(store: workspace.session.attention, id: item.stableID)
            if !isSidebar {
                Image(lucide: "chevron-right", size: 12)
                    .foregroundStyle(MobileStyle.faint).accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

func newCanvas() -> JSONValue {
    .object([
        "id": .string("canvas-" + UUID().uuidString), "kind": .string("canvas"), "name": .string("Canvas"),
        "nodes": .array([]), "texts": .array([]), "edges": .array([]), "layouts": .array([]),
    ])
}

struct ProjectItemPage: View {
    let workspace: MobileWorkspace
    let item: JSONValue
    @State private var ready = false
    @State private var problem: String?
    @State private var selectedMember: String?
    private var isPresent: Bool {
        workspace.views.contains {
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
                        client: workspace.client, chatID: current.stableID, title: title, isPrepared: ready)
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
                ProgressView().accessibilityLabel("Opening")
            } else {
                switch current.text("kind") {
                case "canvas": CanvasPage(workspace: workspace, viewID: current.stableID)
                case "terminal": TerminalScreen(client: workspace.client, sessionID: current.stableID, title: title)
                case "browser": BrowserPage(url: current.text("url"))
                case "file": FileContentPage(client: workspace.client, path: absolutePath(current.text("path")))
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
        .onAppear {
            workspace.session.attention.focus(item.stableID)
            Task { await workspace.session.markSeen(item.stableID) }
        }
        .onDisappear { workspace.session.attention.blur(item.stableID) }
        .task(id: workspace.session.generation) { await prepare() }
    }
    private var title: String { current.text("name", fallback: current.text("title", fallback: current.text("kind"))) }
    private func absolutePath(_ path: String) -> String {
        path.hasPrefix("/") || path.hasPrefix("~") ? path : workspace.folder + "/" + path
    }
    private func prepare() async {
        guard isPresent else { return }
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

struct AddProjectItem: View {
    let workspace: MobileWorkspace
    let canvasID: String?
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "chat"
    @State private var name = ""
    @State private var detail = ""
    @State private var provider = "codex"
    @State private var saving = false
    var body: some View {
        NavigationStack {
            MobileForm {
                Picker("Kind", selection: $kind) {
                    ForEach(
                        canvasID == nil
                            ? ["chat", "terminal", "canvas", "browser", "file", "drawing", "diagram", "separator"]
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
                        Text("Codex").tag("codex")
                        Text("Claude Code").tag("claude")
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
    }
    private func add() async {
        saving = true
        defer { saving = false }
        let id = kind + "-" + UUID().uuidString
        let title = name.isEmpty ? kind.capitalized : name
        var item: [String: JSONValue] = ["id": .string(id), "kind": .string(kind)]
        if let canvasID {
            let nodes = workspace.views.first(where: { $0.stableID == canvasID })?.list("nodes") ?? []
            let right = nodes.map { $0.number("x") + $0.number("w") }.max() ?? -40
            item.merge([
                "title": .string(title), "titleSource": .string("user"), "x": .number(right + 40), "y": .number(0),
                "w": .number(kind == "chat" ? 480 : 400), "h": .number(300),
            ]) { _, new in new }
            if kind == "chat" {
                item["provider"] = .string(provider)
                item["providerFixed"] = .bool(true)
            }
            if kind == "group" { item["memberIds"] = .array([]) }
            if kind == "note" { item["body"] = .string(detail) }
        } else {
            item["name"] = .string(title)
            item["titleSource"] = .string("user")
            if kind == "chat" || kind == "terminal" {
                item["node"] =
                    kind == "chat"
                    ? .object(["provider": .string(provider), "providerFixed": .bool(true)]) : .object([:])
            }
            if kind == "canvas" { for key in ["nodes", "texts", "edges", "layouts"] { item[key] = .array([]) } }
        }
        if kind == "browser" { item["url"] = .string(detail) }
        if kind == "file" { item["path"] = .string(detail) }
        let value = JSONValue.object(item)
        if let canvasID {
            await workspace.updateView(canvasID) { $0.setting("nodes", .array($0.list("nodes") + [value])) }
        } else {
            await workspace.edit { $0.setting("views", .array($0.list("views") + [value])) }
            workspace.select(id)
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
    @Entry var mobileMachineSession: SharedMachineSession?
    @Entry var inProjectSidebar = false
    @Entry var openMobileWorkspace: (MobileWorkspace) -> Void = { _ in }
}
