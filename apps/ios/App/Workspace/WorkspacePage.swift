import RuimtePulsar
import SwiftUI

struct WorkspacePage: View {
    @State var workspace: MobileWorkspace
    @State private var adding = false
    @State private var renamed: JSONValue?
    @State private var renameText = ""
    @State private var deleteView: JSONValue?
    @State private var search = ""
    @State private var showTools = false
    @State private var openedViewID: String?
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        Group {
            if workspace.ready {
                if sizeClass == .regular {
                    NavigationSplitView {
                        sidebar
                    } detail: {
                        if let item = workspace.views.first(where: { $0.stableID == workspace.selectedID }) {
                            ProjectItemPage(workspace: workspace, item: item).id(item.stableID)
                        } else {
                            ContentUnavailableView("Choose a view", systemImage: "sidebar.left")
                        }
                    }
                } else {
                    sidebar
                }
            } else if let problem = workspace.problem {
                ContentUnavailableView {
                    Label("Could not open project", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(problem)
                } actions: {
                    Button("Try again") { Task { await workspace.open() } }
                }
            } else {
                ProgressView("Opening project")
            }
        }
        .navigationTitle(workspace.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Project tools", systemImage: "folder.badge.gearshape") { showTools = true }.disabled(
                    !workspace.ready)
                Button("Add view", systemImage: "plus") { adding = true }.disabled(!workspace.ready)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                if !workspace.session.connected {
                    Label("Reconnecting to your machine…", systemImage: "wifi.slash").font(.caption).frame(
                        maxWidth: .infinity
                    ).padding(8).background(.thinMaterial)
                }
                if let notice = workspace.notice {
                    HStack {
                        Text("An agent opened a view").font(.subheadline)
                        Spacer()
                        Button("Go there") {
                            openView(notice.text("viewId"))
                            workspace.notice = nil
                        }
                        Button("Dismiss", systemImage: "xmark") { workspace.notice = nil }
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
        .task { workspace.start() }
        .navigationDestination(item: $openedViewID) { id in
            if let item = workspace.views.first(where: { $0.stableID == id }) {
                ProjectItemPage(workspace: workspace, item: item).id(id)
            } else {
                ContentUnavailableView("This view was removed", systemImage: "rectangle.slash")
            }
        }
        .sheet(isPresented: $adding) { AddProjectItem(workspace: workspace, canvasID: nil) }
        .sheet(isPresented: $showTools) { NavigationStack { ProjectTools(workspace: workspace) } }
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

    private var sidebar: some View {
        List {
            ForEach(WorkspaceViewSections.split(workspace.views, search: search)) { section in
                Section {
                    ForEach(section.items, id: \.stableID) { item in
                        Button {
                            openView(item.stableID)
                        } label: {
                            viewRow(item)
                        }
                        .foregroundStyle(.primary)
                        .accessibilityIdentifier("workspace.view.\(item.stableID)")
                        .contextMenu {
                            Button("Rename", systemImage: "pencil") {
                                renameText = item.text("name")
                                renamed = item
                            }.disabled(item.text("kind") == "unknown")
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                deleteView = item
                            }
                        }
                        .moveDisabled(!search.isEmpty)
                    }
                    .onMove { indices, destination in
                        guard search.isEmpty else { return }
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
                } header: {
                    if let title = section.title { Text(title).textCase(nil) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $search, prompt: "Find a view")
        .accessibilityIdentifier("workspace.views")
    }

    private func openView(_ id: String) {
        guard workspace.views.contains(where: { $0.stableID == id && $0.text("kind") != "separator" }) else { return }
        workspace.select(id)
        if sizeClass != .regular { openedViewID = id }
    }

    private func viewRow(_ item: JSONValue) -> some View {
        HStack(spacing: 12) {
            WorkspaceViewIcon(item: item).foregroundStyle(.secondary)
            Text(item.text("name", fallback: item.text("kind")))
                .font(.body).foregroundStyle(.primary).lineLimit(1).truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            AttentionMark(store: workspace.session.attention, id: item.stableID)
            if sizeClass == .regular && workspace.selectedID == item.stableID {
                Image(systemName: "checkmark").font(.body.weight(.semibold))
                    .foregroundStyle(MobileStyle.accent).accessibilityLabel("Selected")
            } else if sizeClass != .regular {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary).accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

func iconForKind(_ kind: String) -> String {
    switch kind {
    case "canvas": "square.grid.2x2"
    case "chat": "bubble.left.and.bubble.right"
    case "terminal": "terminal"
    case "browser": "globe"
    case "file": "doc"
    case "drawing": "pencil.tip.crop.circle"
    case "diagram": "point.3.connected.trianglepath.dotted"
    case "group": "square.stack.3d.up"
    case "note": "note.text"
    default: "questionmark.square.dashed"
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
                    "This view was removed", systemImage: "rectangle.slash",
                    description: Text("Return to the project to choose another view."))
            } else if let problem {
                ContentUnavailableView {
                    Label("Could not open", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(problem)
                } actions: {
                    Button("Retry") { Task { await prepare() } }
                }
            } else if !ready {
                ProgressView("Opening")
            } else {
                switch current.text("kind") {
                case "canvas": CanvasPage(workspace: workspace, viewID: current.stableID)
                case "chat": ChatScreen(client: workspace.client, chatID: current.stableID, title: title)
                case "terminal": TerminalScreen(client: workspace.client, sessionID: current.stableID, title: title)
                case "browser": BrowserPage(url: current.text("url"))
                case "file": FileContentPage(client: workspace.client, path: absolutePath(current.text("path")))
                case "note": NotePage(workspace: workspace, nodeID: current.stableID, bodyText: current.text("body"))
                case "drawing", "diagram":
                    RenderDocumentPage(
                        client: workspace.client, projectID: workspace.projectID,
                        viewID: current.text("viewId", fallback: current.stableID), kind: current.text("kind"))
                case "group":
                    List(current.list("memberIds").compactMap(\.stringValue), id: \.self) { id in
                        if let node = workspace.views.flatMap({ $0.list("nodes") }).first(where: { $0.stableID == id })
                        {
                            NavigationLink(node.text("title")) { ProjectItemPage(workspace: workspace, item: node) }
                        }
                    }
                default:
                    ContentUnavailableView(
                        "A newer view", systemImage: "questionmark.square",
                        description: Text(
                            "Open this view in a newer Ruimte. Its content is preserved when you edit this project."))
                }
            }
        }
        .accessibilityIdentifier("workspace.destination.\(item.stableID)")
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
            Form {
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

struct ProjectTools: View {
    let workspace: MobileWorkspace
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        List {
            NavigationLink {
                MachineFilesPage(client: workspace.client, path: workspace.folder)
            } label: {
                Label("Files", systemImage: "folder")
            }
            NavigationLink {
                GitPage(client: workspace.client, cwd: workspace.folder)
            } label: {
                Label("Git", systemImage: "point.3.connected.trianglepath.dotted")
            }
            NavigationLink {
                ProcessesPage(client: workspace.client, cwd: workspace.folder)
            } label: {
                Label("Processes", systemImage: "waveform.path.ecg")
            }
            NavigationLink {
                MachineUsagePage(client: workspace.client)
            } label: {
                Label("Usage", systemImage: "chart.bar")
            }
        }.navigationTitle("Project tools").toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
    }
}
