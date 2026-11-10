import RuimtePulsar
import SwiftUI

/// The open projects of every machine, with New chat, each machine's Chats and Recently closed under them. On the
/// iPhone and in the iPad's sidebar they stand under the machine each is on, with the counts Now reads beside them.
struct ProjectsPage<Notice: View>: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    /// Without a search field or an updating mark of its own: on the iPhone's Projects tab the tabs around it hold
    /// those, in the iPad's sidebar the palette searches.
    var embedded = false
    var now: NowModel? = nil
    var gitLines: ProjectGitLines? = nil
    var cards = false
    let showRecent: () -> Void
    @ViewBuilder let notice: () -> Notice
    @State private var search = ""
    @State private var newChat: NewChatTarget?
    @Environment(\.openMobileWorkspace) private var openWorkspace

    var body: some View {
        MobileList {
            notice()
            if grouped {
                ProjectGroupsList(runtime: runtime, groups: groups, cards: cards)
            } else if !visibleProjects.isEmpty {
                Section {
                    ProjectLinks(runtime: runtime, rows: visibleProjects)
                }
                .listSectionSeparator(.hidden, edges: .top)
            } else if loadingProjects {
                Section {
                    MobileLoadingRow(String(localized: "Loading projects"))
                        .frame(maxWidth: .infinity, minHeight: 120)
                        .accessibilityIdentifier("projects.loading")
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else if !search.isEmpty {
                ContentUnavailableView.search(for: search)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ContentUnavailableView {
                        Label(String(localized: "No open projects"), lucideIcon: "folders", iconSize: 48)
                    } description: {
                        Text(
                            runtime.machines.isEmpty
                                ? "Connect a machine to pick up your projects and chats."
                                : "Open a project on a machine, or pick one from Recent.")
                    }
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            if cards {
                cardActions
            } else {
                sidebarActions
            }
            if !connectionProblems.isEmpty {
                Section("Connections") {
                    ForEach(connectionProblems, id: \.id) { machine in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(machine.name).font(.subheadline.weight(.medium))
                            Text(projects.problems[machine.id] ?? "").font(.caption).foregroundStyle(MobileStyle.muted)
                            Button("Reconnect") { runtime.session(for: machine).reconnect() }.font(.subheadline)
                        }
                    }
                }
            }
            if let problem = runtime.problem {
                Section { Text(problem).font(.callout).foregroundStyle(MobileStyle.statusError) }
            }
        }
        .modifier(ProjectListWidth())
        .mobileSheet(item: $newChat) { target in
            if let session = runtime.session(machineID: target.machineID) {
                NewChatSheet(session: session) { place in
                    openWorkspace(MobileWorkspace(session: session, projectID: place.projectID), view: place.viewID)
                }
            }
        }
        .modifier(ProjectsSearch(enabled: !embedded, text: $search))
        .toolbar {
            if !embedded && (runtime.loading || projects.loading) && !visibleProjects.isEmpty {
                ProjectsUpdatingItem()
            }
        }
        .task(id: gitRequestKey) { await refreshGitLines() }
        .refreshable {
            await runtime.refreshMachines()
            projects.reconcile(runtime: runtime)
            await projects.refresh()
            await now?.refresh()
            await refreshGitLines()
        }
        .onAppear { AppUsage.screen(.screenProjects) }
    }

    private var connectionProblems: [Machine] {
        let carded = cards && grouped ? Set(groups.map(\.machine.id)) : []
        return runtime.machines.filter { projects.problems[$0.id] != nil && !carded.contains($0.id) }
    }

    @ViewBuilder private var cardActions: some View {
        if !grouped && !projects.chats.isEmpty {
            ProjectCardRows(
                rows: projects.chats.map { ProjectOverviewRow(row: $0, activity: now?.activity[$0.id]) },
                session: runtime.session(for:)
            ) { overview in
                openWorkspace(overview.row.workspace(runtime))
            }
        }
        ProjectsCapsuleActions(
            machines: runtime.machines, newChat: { newChat = NewChatTarget(machineID: $0.id) },
            showRecent: showRecent)
    }

    private var sidebarActions: some View {
        Section {
            MobileStyle.border.frame(height: 1).padding(.vertical, 10)
                .listRowInsets(EdgeInsets(top: 0, leading: 28, bottom: 0, trailing: 28))
                .accessibilityHidden(true)
            NewChatRow(machines: runtime.machines) { newChat = NewChatTarget(machineID: $0.id) }
            ForEach(grouped ? [] : projects.chats) { row in
                Button {
                    openWorkspace(row.workspace(runtime))
                } label: {
                    ChatsRowLabel(
                        title: String(localized: "Chats"),
                        detail: [
                            projects.chats.count > 1 ? row.machine.name : String(localized: "Earlier chats"),
                            row.connected ? nil : String(localized: "Offline"),
                        ].compactMap { $0 }.joined(separator: " · "),
                        icon: "messages-square")
                }
                .modifier(MobileSidebarRow())
                .accessibilityIdentifier("projects.chats.\(row.machine.id)")
            }
            Button(action: showRecent) {
                HStack(spacing: 12) {
                    Image(lucide: "clock-arrow-left").frame(width: 20, height: 20).frame(width: 32)
                    Text("Recent")
                }
                .modifier(MobileSidebarLabel(disclosure: true))
            }
            .modifier(MobileSidebarRow())
            .accessibilityIdentifier("projects.recent")
        }
    }

    /// Only once a project is open, so the empty and loading states keep their place; Chats then stands in its group.
    private var grouped: Bool { !visibleProjects.isEmpty && !groups.isEmpty }

    private var groups: [ProjectMachineGroup] {
        guard let now, let gitLines else { return [] }
        let activity = now.activity
        return ProjectOverview.groups(
            open: visibleProjects, chats: projects.chats,
            reach: { machine in
                let session = runtime.session(for: machine)
                return MachineLinkState(
                    connected: session.connected, route: session.route, failedAttempts: session.failedAttempts,
                    problem: session.problem)
            },
            activity: { activity[$0] }, git: { gitLines.line($0) })
    }

    private var gitRequestKey: String {
        projects.open.filter(\.connected).map { "\($0.id.machineID)/\($0.id.projectID)" }.joined(separator: "|")
    }

    private func refreshGitLines() async {
        guard let gitLines else { return }
        await gitLines.refresh(projects.open, session: runtime.session(for:))
    }

    private var visibleProjects: [UnifiedProjectRow] { projects.open.filter { $0.matches(search) } }
    private var loadingProjects: Bool {
        runtime.loading || projects.loading
            || (projects.open.isEmpty && projects.recent.isEmpty && !runtime.machines.isEmpty
                && !projects.hasConnectedMachine && runtime.problem == nil && projects.problems.isEmpty)
    }
}

struct ProjectsCapsuleActions: View {
    let machines: [Machine]
    let newChat: (Machine) -> Void
    let showRecent: () -> Void

    var body: some View {
        HStack(spacing: MobileSpacing.small) {
            NewChatRow(machines: machines, capsule: true, start: newChat)
            Button(action: showRecent) {
                ProjectsCapsuleLabel(title: String(localized: "Recent"), icon: "clock-arrow-left")
            }
            .buttonStyle(.mobileCapsule)
            .accessibilityIdentifier("projects.recent")
        }
        .listRowInsets(
            EdgeInsets(
                top: MobileSpacing.large, leading: MobileSpacing.margin, bottom: MobileSpacing.large,
                trailing: MobileSpacing.margin))
    }
}

/// The Search tab finds projects on the iPhone, and a tab's own field would not reach the bar above the tabs.
private struct ProjectsSearch: ViewModifier {
    let enabled: Bool
    @Binding var text: String

    func body(content: Content) -> some View {
        if enabled { content.searchable(text: $text, prompt: "Search projects or machines") } else { content }
    }
}

/// A status, not a control, so it wears no glass and leaves the buttons beside it their own.
struct ProjectsUpdatingItem: ToolbarContent {
    var body: some ToolbarContent {
        ToolbarItem(id: "projects.updating", placement: .topBarTrailing) {
            MobileLoadingRow(String(localized: "Updating projects"))
        }
        .sharedBackgroundVisibility(.hidden)
    }
}
