import RuimtePulsar
import SwiftUI

/// What the project page needs to be the iPad's sidebar: the router its rows open views through, and the rows above
/// its views.
struct PadSidebarContext {
    let router: PadRouter
    let header: AnyView
}

/// What the sidebar shows besides the project's views, apart from how it draws them.
enum PadSidebarLogic {
    /// How many of the waiting items Now lists under its row, so the sidebar leads to them without Now itself.
    static let waitingLimit = 3

    static func waiting(_ board: NowBoard) -> [ProjectViewEntry] {
        Array(board.needsYou.prefix(waitingLimit))
    }

    /// The switcher's two lines: the project and the machine it is on. The Chats project is named as such.
    static func switcherLines(summary: JSONValue?, title: String?, machine: String?) -> (title: String, detail: String)
    {
        guard let machine else { return ("Choose a project", "No project open") }
        let name = summary.map { NewChat.isChats($0) } == true ? "Chats" : title ?? "Project"
        return (name, machine)
    }

    /// The machines a folder can be opened on, which are the ones that answer: one opens at once, several ask which.
    static func folderMachines(_ machines: [Machine], connected: (Machine) -> Bool) -> [Machine] {
        machines.filter(connected)
    }
}

/// The iPad's sidebar: always the open project's, as on the desktop, under the project switcher, Search and Now.
struct PadSidebar: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    let now: NowModel
    let router: PadRouter
    let settingsLink: SettingsLink
    let openPalette: () -> Void
    let openTarget: (ProjectViewTarget) -> Void

    var body: some View {
        Group {
            if let project = router.project {
                WorkspacePage(navigation: project, sidebar: PadSidebarContext(router: router, header: AnyView(header)))
                    .id(project.id)
            } else {
                List { header }
                    .modifier(MobileSidebarList(minimumRowHeight: 0, opaque: false))
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { SettingsToolbarItem(link: settingsLink) }
    }

    private var header: some View {
        PadSidebarHeader(
            runtime: runtime, projects: projects, now: now, router: router, openPalette: openPalette,
            openTarget: openTarget)
    }
}

/// The rows above a project's views: the switcher, Search, and Now with the first of what waits on you.
private struct PadSidebarHeader: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    let now: NowModel
    let router: PadRouter
    let openPalette: () -> Void
    let openTarget: (ProjectViewTarget) -> Void

    var body: some View {
        let board = now.board
        Section {
            PadProjectSwitcher(
                runtime: runtime, projects: projects, now: now, router: router, openPalette: openPalette)
                .listRowInsets(EdgeInsets(top: 4, leading: 14, bottom: 8, trailing: 14))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            Button(action: openPalette) {
                HStack(spacing: 10) {
                    Image(lucide: "search", size: 15)
                    Text("Search").frame(maxWidth: .infinity, alignment: .leading)
                    Text("⌘K").font(.caption).foregroundStyle(MobileStyle.faint)
                }
                .modifier(MobileSidebarLabel())
            }
            .modifier(MobileSidebarRow())
            .accessibilityIdentifier("sidebar.search")
            Button { router.showNow() } label: {
                HStack(spacing: 10) {
                    Image(lucide: "inbox", size: 15)
                    Text("Now").frame(maxWidth: .infinity, alignment: .leading)
                    if !board.needsYou.isEmpty {
                        Text("\(board.needsYou.count)").font(.caption.weight(.semibold)).monospacedDigit()
                            .foregroundStyle(MobileStyle.statusNeedsYou)
                            .accessibilityLabel(
                                board.needsYou.count == 1 ? "1 needs you" : "\(board.needsYou.count) need you")
                    }
                }
                .modifier(MobileSidebarLabel())
            }
            .modifier(MobileSidebarRow(selected: router.detail == .now))
            .accessibilityIdentifier("sidebar.now")
            ForEach(PadSidebarLogic.waiting(board)) { entry in
                Button {
                    openTarget(entry.target)
                } label: {
                    HStack(spacing: 10) {
                        Circle().fill(MobileStyle.statusNeedsYou).frame(width: 6, height: 6)
                        Text(entry.title).foregroundStyle(MobileStyle.text).lineLimit(1).truncationMode(.tail)
                        Spacer(minLength: 6)
                        Text(entry.projectName).font(.caption).foregroundStyle(MobileStyle.faint).lineLimit(1)
                    }
                    .padding(.leading, 6)
                    .modifier(MobileSidebarLabel())
                    .accessibilityElement(children: .combine)
                    .accessibilityHint("Needs you")
                }
                .modifier(MobileSidebarRow())
                .accessibilityIdentifier("sidebar.waiting.\(entry.target.itemID)")
            }
        }
        .listSectionSeparator(.hidden)
        if router.project != nil {
            Section {
                Text("Views").font(.caption.weight(.semibold)).foregroundStyle(MobileStyle.muted)
                    .padding(.top, 14).padding(.bottom, 2)
                    .listRowInsets(EdgeInsets(top: 0, leading: 28, bottom: 0, trailing: 28))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .accessibilityAddTraits(.isHeader)
            }
            .listSectionSeparator(.hidden)
        }
    }
}

/// The project name at the top of the sidebar. A tap opens every open project per machine, the machine's Chats among
/// them, then the pages of all projects and machines, and what belongs to the project itself.
private struct PadProjectSwitcher: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    let now: NowModel
    let router: PadRouter
    let openPalette: () -> Void
    @State private var openingFolder: FolderMachine?
    @Environment(\.openMobileWorkspace) private var openWorkspace

    private var workspace: MobileWorkspace? { router.project?.workspace }

    var body: some View {
        let lines = PadSidebarLogic.switcherLines(
            summary: workspace?.summary, title: workspace?.title, machine: workspace?.session.machine.name)
        Menu {
            Button("Find a project", lucideIcon: "search", action: openPalette)
            ForEach(groups) { group in
                Section(group.machine.name) {
                    ForEach(group.rows) { overview in
                        Button {
                            openWorkspace(
                                MobileWorkspace(
                                    session: runtime.session(for: overview.row.machine),
                                    projectID: overview.id.projectID, summary: overview.row.summary))
                        } label: {
                            Label(
                                overview.isChats
                                    ? "Chats" : overview.row.summary.text("name", fallback: "Untitled project"),
                                lucideIcon: current(overview) ? "check" : overview.isChats ? "messages-square" : "folder")
                            if let needsYou = overview.activity?.needsYou, needsYou > 0 {
                                Text(needsYou == 1 ? "1 needs you" : "\(needsYou) need you")
                            }
                        }
                        .disabled(overview.unavailable)
                    }
                }
            }
            Section {
                Button("All projects", lucideIcon: "folders") { router.detail = .projects }
                Button("Machines", lucideIcon: "monitor") { router.detail = .machines }
                let machines = PadSidebarLogic.folderMachines(runtime.machines) { runtime.session(for: $0).connected }
                if machines.count == 1, let machine = machines.first {
                    Button("Open a folder…", lucideIcon: "folder-open") { openingFolder = FolderMachine(id: machine.id) }
                } else if machines.count > 1 {
                    Menu {
                        ForEach(machines, id: \.id) { machine in
                            Button(machine.name) { openingFolder = FolderMachine(id: machine.id) }
                        }
                    } label: {
                        Label("Open a folder…", lucideIcon: "folder-open")
                    }
                }
                Button("Recently closed", lucideIcon: "clock-arrow-left") { router.detail = .recentlyClosed }
            }
            if let navigation = router.project, !navigation.workspace.isScratch {
                Section(navigation.workspace.title) {
                    Button("Project settings", lucideIcon: "settings-2") { navigation.showingSettings = true }
                    Button("Usage", lucideIcon: "chart-no-axes-column") { navigation.showingUsage = true }
                }
                .disabled(!navigation.workspace.ready)
            } else if let navigation = router.project {
                Section("Chats") {
                    Button("Usage", lucideIcon: "chart-no-axes-column") { navigation.showingUsage = true }
                }
            }
        } label: {
            HStack(spacing: 10) {
                if let workspace {
                    ProjectBadge(summary: workspace.summary, session: workspace.session, chats: workspace.isScratch)
                } else {
                    LucideIcon(name: "folders", size: 18).foregroundStyle(MobileStyle.muted).frame(width: 32, height: 32)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(lines.title).font(.headline).foregroundStyle(MobileStyle.text)
                        .lineLimit(1).truncationMode(.tail)
                    Text(lines.detail).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(lucide: "chevrons-up-down", size: 14).foregroundStyle(MobileStyle.faint)
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .contentShape(.rect(cornerRadius: 12))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .accessibilityLabel("Project, \(lines.title) on \(lines.detail)")
        .accessibilityHint("Switches the project")
        .accessibilityIdentifier("sidebar.switcher")
        .mobileSheet(item: $openingFolder) { target in
            if let machine = runtime.machines.first(where: { $0.id == target.id }) {
                OpenFolderSheet(session: runtime.session(for: machine))
            }
        }
    }

    private var groups: [ProjectMachineGroup] {
        let activity = now.activity
        return ProjectOverview.groups(
            open: projects.open, chats: projects.chats,
            reach: { machine in
                let session = runtime.session(for: machine)
                return MachineLinkState(
                    connected: session.connected, relayed: session.relayed, failedAttempts: session.failedAttempts,
                    problem: session.problem)
            },
            activity: { activity[$0] }, git: { _ in nil })
    }

    private func current(_ overview: ProjectOverviewRow) -> Bool {
        guard let workspace else { return false }
        return overview.id.machineID == workspace.session.machine.id && overview.id.projectID == workspace.projectID
    }
}

private struct FolderMachine: Identifiable {
    let id: String
}
