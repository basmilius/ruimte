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
    /// What groups the list per machine and counts what each project holds.
    var now: NowModel? = nil
    var gitLines: ProjectGitLines? = nil
    let showRecent: () -> Void
    @ViewBuilder let notice: () -> Notice
    @State private var search = ""
    @State private var newChat: NewChatTarget?
    @Environment(\.openMobileWorkspace) private var openWorkspace

    var body: some View {
        MobileList {
            notice()
            if grouped {
                ProjectGroupsList(runtime: runtime, groups: groups)
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
                ContentUnavailableView.search(text: search)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ContentUnavailableView {
                        Label(String(localized: "No open projects"), lucideIcon: "folder", iconSize: 48)
                    } description: {
                        Text(
                            runtime.machines.isEmpty
                                ? "Connect your computer to pick up your projects and conversations."
                                : "Open a project on your computer or choose one from Recently closed.")
                    }
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            Section {
                MobileStyle.border.frame(height: 1).padding(.vertical, 10)
                    .listRowInsets(EdgeInsets(top: 0, leading: 28, bottom: 0, trailing: 28))
                    .accessibilityHidden(true)
                NewChatRow(machines: runtime.machines) { newChat = NewChatTarget(machineID: $0.id) }
                ForEach(grouped ? [] : projects.chats) { row in
                    Button {
                        openWorkspace(
                            MobileWorkspace(
                                session: runtime.session(for: row.machine), projectID: row.id.projectID,
                                summary: row.summary))
                    } label: {
                        ChatsRowLabel(
                            title: String(localized: "Chats"),
                            detail: [
                                projects.chats.count > 1 ? row.machine.name : String(localized: "Your earlier chats"),
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
                        Text("Recently closed")
                    }
                    .modifier(MobileSidebarLabel(disclosure: true))
                }
                .modifier(MobileSidebarRow())
                .accessibilityIdentifier("projects.recent")
            }
            if !projects.problems.isEmpty {
                Section("Connections") {
                    ForEach(runtime.machines.filter { projects.problems[$0.id] != nil }, id: \.id) { machine in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(machine.name).font(.subheadline.weight(.medium))
                            Text(projects.problems[machine.id] ?? "").font(.caption).foregroundStyle(MobileStyle.muted)
                            Button("Reconnect") { runtime.session(for: machine).reconnect() }.font(.subheadline)
                        }
                    }
                }
            }
            if let problem = runtime.problem {
                Section { Text(problem).font(.callout).foregroundStyle(.red) }
            }
        }
        .modifier(ProjectListWidth())
        .mobileSheet(item: $newChat) { target in
            if let machine = runtime.machines.first(where: { $0.id == target.machineID }) {
                let session = runtime.session(for: machine)
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
                    connected: session.connected, relayed: session.relayed, failedAttempts: session.failedAttempts,
                    problem: session.problem)
            },
            activity: { activity[$0] }, git: { gitLines.line($0) })
    }

    /// Asks again for the branches whenever a project opens or closes, or a machine comes back.
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
