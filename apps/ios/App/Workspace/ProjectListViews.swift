import RuimtePulsar
import SwiftUI

/// A project's list on the iPhone, as its part of the desktop's sidebar: the views in the project's order, the nodes
/// that run under an unfolded canvas, and on each row its draft dot, process warning, shared mark and status.
struct PhoneProjectList: View {
    let workspace: MobileWorkspace
    let state: ProjectListState
    let views: [JSONValue]
    /// The open view, which keeps its row while a chat nobody wrote in would otherwise leave the list.
    let selectedID: String?
    let open: (String) -> Void
    let act: (ProjectRowAction, JSONValue) -> Void
    /// The iPad sidebar's rows above the views: the project switcher, Search and Now.
    var header: AnyView?
    /// The row whose view the iPad shows beside the sidebar.
    var highlightedID: String?

    var body: some View {
        let sections = WorkspaceViewSections.split(views)
        let sources = markSources
        List {
            if let header { header }
            ForEach(sections) { section in
                Section {
                    if section.id != sections.first?.id || section.title != nil {
                        VStack(alignment: .leading, spacing: 8) {
                            if section.id != sections.first?.id {
                                MobileStyle.border.frame(height: 1).padding(.vertical, 8)
                            }
                            if let title = section.title {
                                Text(title).font(.caption.weight(.semibold)).foregroundStyle(MobileStyle.muted)
                                    .textCase(nil).padding(.bottom, 2)
                            }
                        }
                        .listRowInsets(EdgeInsets(top: 0, leading: 28, bottom: 0, trailing: 28))
                        .listRowSeparator(.hidden)
                        .moveDisabled(true)
                        .allowsHitTesting(false)
                        .accessibilityHidden(section.title == nil)
                    }
                    ForEach(section.items, id: \.stableID) { item in
                        ProjectListCell(
                            workspace: workspace, item: item, state: state, sources: sources,
                            highlightedID: highlightedID, open: open, act: act)
                    }
                    .onMove { indices, destination in move(section: section, from: indices, to: destination) }
                }
                .listSectionSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
        }
        .modifier(MobileSidebarList(minimumRowHeight: 0, opaque: header == nil))
        .contentMargins(.top, header == nil ? 0 : nil, for: .scrollContent)
        .contentMargins(.bottom, 24, for: .scrollContent)
        .accessibilityIdentifier("workspace.views")
        .task(id: ProjectListLogic.chatIDs(views)) {
            state.readDrafts(machineID: workspace.session.machine.id, chatIDs: ProjectListLogic.chatIDs(views))
        }
        .onAppear {
            state.readDrafts(machineID: workspace.session.machine.id, chatIDs: ProjectListLogic.chatIDs(views))
            state.watchWarnings(workspace.client)
        }
        .onDisappear { state.stopWatching() }
    }

    private var markSources: ProjectMarkSources {
        let attention = workspace.session.attention
        return ProjectMarkSources(
            statuses: attention.statuses, unseen: attention.unseen,
            delegating: attention.delegating.union(workspace.session.tasks.parentsWithOpenTasks),
            drafts: state.drafts, warnings: state.warnings,
            shared: Set(workspace.document.list("shared").compactMap(\.stringValue)),
            snoozes: workspace.session.snoozes.standing)
    }

    private func move(section: WorkspaceViewSection, from indices: IndexSet, to destination: Int) {
        let expectedIDs = section.items.map(\.stableID)
        let selectedID = selectedID
        Task {
            await workspace.edit { document in
                guard
                    let reordered = WorkspaceViewSections.moving(
                        document.list("views"), sectionID: section.id, expectedIDs: expectedIDs,
                        from: indices, to: destination,
                        listed: { WorkspaceViewSections.isListed($0, selectedID: selectedID) })
                else { return document }
                return document.setting("views", .array(reordered))
            }
        }
    }
}

/// One view of the list, and under a canvas that is unfolded the nodes on it that run. Both are one row of the list,
/// so dragging a canvas takes its nodes along.
private struct ProjectListCell: View {
    let workspace: MobileWorkspace
    let item: JSONValue
    let state: ProjectListState
    let sources: ProjectMarkSources
    let highlightedID: String?
    let open: (String) -> Void
    let act: (ProjectRowAction, JSONValue) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let nodes = ProjectListLogic.nodes(of: item)
        let expanded = !nodes.isEmpty && state.isExpanded(item.stableID)
        let marks = ProjectListLogic.marks(view: item, sources: sources)
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                if !nodes.isEmpty {
                    Button {
                        withAnimation(reduceMotion ? nil : .snappy) { state.toggle(item.stableID) }
                    } label: {
                        Image(lucide: expanded ? "chevron-down" : "chevron-right", size: 15)
                            .foregroundStyle(MobileStyle.muted)
                            .frame(width: 40, height: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(expanded ? "Fold \(title(item))" : "Unfold \(title(item))")
                }
                Button {
                    open(item.stableID)
                } label: {
                    HStack(spacing: 10) {
                        if nodes.isEmpty {
                            WorkspaceViewIcon(item: item, size: 15).foregroundStyle(MobileStyle.muted)
                        }
                        Text(title(item)).foregroundStyle(MobileStyle.text).lineLimit(1).truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        ProjectRowMarksView(marks: marks, task: workspace.session.tasks.childTask(item.stableID))
                    }
                    .padding(.leading, nodes.isEmpty ? 0 : -10)
                    .modifier(MobileSidebarLabel())
                    .accessibilityElement(children: .combine)
                }
                .buttonStyle(MobileSidebarButtonStyle(selected: highlightedID == item.stableID))
                .accessibilityAddTraits(highlightedID == item.stableID ? .isSelected : [])
                .accessibilityIdentifier("workspace.view.\(item.stableID)")
                .contextMenu {
                    ProjectRowMenu(item: item, isView: true, status: marks.status, workspace: workspace, act: act)
                } preview: {
                    ProjectRowPreview(workspace: workspace, item: item, marks: marks, nodes: nodes, sources: sources)
                }
            }
            if expanded {
                ForEach(nodes, id: \.stableID) { node in
                    let nodeMarks = ProjectListLogic.marks(node: node, sources: sources)
                    Button {
                        open(node.stableID)
                    } label: {
                        HStack(spacing: 10) {
                            WorkspaceViewIcon(item: node, size: 14)
                            Text(title(node)).lineLimit(1).truncationMode(.tail)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            ProjectRowMarksView(
                                marks: nodeMarks, task: workspace.session.tasks.childTask(node.stableID))
                        }
                        .foregroundStyle(MobileStyle.muted)
                        .padding(.leading, 26)
                        .modifier(MobileSidebarLabel())
                        .accessibilityElement(children: .combine)
                    }
                    .buttonStyle(MobileSidebarButtonStyle(selected: highlightedID == node.stableID))
                    .accessibilityAddTraits(highlightedID == node.stableID ? .isSelected : [])
                    .accessibilityIdentifier("workspace.node.\(node.stableID)")
                    .contextMenu {
                        ProjectRowMenu(
                            item: node, isView: false, status: nodeMarks.status, workspace: workspace, act: act)
                    } preview: {
                        ProjectRowPreview(workspace: workspace, item: node, marks: nodeMarks, nodes: [], sources: sources)
                    }
                }
            }
        }
        .modifier(MobileSidebarRow())
    }

    private func title(_ row: JSONValue) -> String {
        let name = row.text("name", fallback: row.text("title"))
        return name.isEmpty ? row.text("kind").capitalized : name
    }
}

/// The marks on a row, the way the desktop's sidebar draws them: what another agent asked of it, a process warning,
/// the shared mark and the draft dot, then the status.
struct ProjectRowMarksView: View {
    let marks: ProjectRowMarks
    var task: JSONValue?

    var body: some View {
        HStack(spacing: 8) {
            if let task { TaskMark(task: task) }
            if marks.warning {
                Image(lucide: "triangle-alert", size: 12).foregroundStyle(MobileStyle.statusNeedsYou)
                    .accessibilityLabel("Process warning")
            }
            if marks.shared {
                Image(lucide: "users", size: 12).foregroundStyle(MobileStyle.faint)
                    .accessibilityLabel("Shared with the team")
            }
            if marks.draft {
                Circle().fill(MobileStyle.faint).frame(width: 6, height: 6).accessibilityLabel("Draft")
            }
            if let until = marks.snoozedUntil {
                Image(lucide: "alarm-clock", size: 12).foregroundStyle(MobileStyle.muted)
                    .accessibilityLabel("Snoozed until \(SnoozeChoice.moment(until, from: .now))")
            } else if marks.needsYou {
                Circle().fill(MobileStyle.statusNeedsYou).frame(width: 6, height: 6).accessibilityLabel("Needs you")
            } else if marks.working {
                Spinner(size: 12, label: "Working")
                    .foregroundStyle(marks.status == .running ? MobileStyle.statusRunning : MobileStyle.faint)
            } else if marks.unseen {
                Circle().fill(MobileStyle.accent).frame(width: 6, height: 6).accessibilityLabel("New activity")
            }
        }
    }
}

/// What a long press on a row offers: what the view is, how to get another one, its session, and the delete.
private struct ProjectRowMenu: View {
    let item: JSONValue
    let isView: Bool
    let status: AgentStatus?
    let workspace: MobileWorkspace
    let act: (ProjectRowAction, JSONValue) -> Void

    var body: some View {
        let actions = ProjectListLogic.actions(for: item, isView: isView, status: status)
        Section {
            if actions.contains(.rename) { Button("Rename", lucideIcon: "pencil") { act(.rename, item) } }
            if actions.contains(.icon) { Button("Change icon", lucideIcon: "palette") { act(.icon, item) } }
            if actions.contains(.settings) {
                Button("View settings", lucideIcon: "sliders-horizontal") { act(.settings, item) }
            }
        }
        Section {
            if actions.contains(.fork) { Button("Fork", lucideIcon: "git-fork") { act(.fork, item) } }
            if actions.contains(.snooze) {
                let snoozes = workspace.session.snoozes
                SnoozeMenu(until: snoozes.until(item.stableID)) {
                    snoozes.snooze(item.stableID, until: $0)
                } wake: {
                    snoozes.clear(item.stableID)
                }
            }
            if actions.contains(.stopTurn) { Button("Stop turn", lucideIcon: "square") { act(.stopTurn, item) } }
        }
        if actions.contains(.delete) {
            Section {
                Button("Delete", lucideIcon: "trash-2", role: .destructive) { act(.delete, item) }
            }
        }
    }
}

/// The card over a long-pressed row's menu: the row with its status and what it waits on or holds, read live from
/// the machine's attention without attaching the session.
private struct ProjectRowPreview: View {
    let workspace: MobileWorkspace
    let item: JSONValue
    let marks: ProjectRowMarks
    let nodes: [JSONValue]
    let sources: ProjectMarkSources

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                WorkspaceViewIcon(item: item, size: 14)
                Text(item.text("name", fallback: item.text("title", fallback: item.text("kind").capitalized)))
                    .font(.footnote.weight(.semibold)).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ProjectRowMarksView(marks: marks)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            MobileStyle.border.frame(height: 1)
            VStack(alignment: .leading, spacing: 8) {
                if nodes.isEmpty {
                    Text(line).foregroundStyle(MobileStyle.text.opacity(0.85))
                } else {
                    ForEach(nodes.prefix(6), id: \.stableID) { node in
                        HStack(spacing: 8) {
                            WorkspaceViewIcon(item: node, size: 12).foregroundStyle(MobileStyle.muted)
                            Text(node.text("title", fallback: node.text("kind").capitalized)).lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            ProjectRowMarksView(marks: ProjectListLogic.marks(node: node, sources: sources))
                        }
                    }
                }
            }
            .font(.footnote)
            .padding(14)
        }
        .foregroundStyle(MobileStyle.text)
        .frame(width: 320, alignment: .leading)
        .background(MobileStyle.panel)
    }

    private var line: String {
        let id = item.stableID
        if let wait = workspace.session.attention.waits[id],
            let request = wait.requests.compactMap(NowRequest.init).first
        {
            return request.headline
        }
        if let until = marks.snoozedUntil { return "Snoozed until \(SnoozeChoice.moment(until, from: .now))." }
        switch marks.status {
        case .needsYou: return "Waiting for you."
        case .running: return "Working on it."
        case .error: return "Stopped on an error."
        case .exited: return "Its process ended."
        default: break
        }
        if marks.delegating { return "Work it started still runs." }
        switch item.text("kind") {
        case "browser": return item.text("url", fallback: "No address yet.")
        case "file": return item.text("path")
        default: return marks.draft ? "A message is waiting to be sent." : "Nothing is running."
        }
    }
}
