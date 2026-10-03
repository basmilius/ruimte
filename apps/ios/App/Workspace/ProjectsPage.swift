import RuimtePulsar
import SwiftUI

/// The open projects of every machine, with New chat, each machine's Chats and Recently closed under them.
struct ProjectsPage<Notice: View>: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    @Binding var showingRecent: Bool
    @ViewBuilder let notice: () -> Notice
    @State private var search = ""
    @State private var newChat: NewChatTarget?
    @Environment(\.openMobileWorkspace) private var openWorkspace

    var body: some View {
        MobileList {
            notice()
            if !visibleProjects.isEmpty {
                Section {
                    ProjectLinks(runtime: runtime, rows: visibleProjects)
                }
                .listSectionSeparator(.hidden, edges: .top)
            } else if loadingProjects {
                Section {
                    MobileLoadingRow("Loading projects")
                        .frame(maxWidth: .infinity, minHeight: 120)
                        .accessibilityIdentifier("projects.loading")
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else if !search.isEmpty {
                ContentUnavailableView.search(text: search)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ContentUnavailableView {
                        Label("No open projects", lucideIcon: "folder", iconSize: 48)
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
                ForEach(projects.chats) { row in
                    Button {
                        openWorkspace(
                            MobileWorkspace(session: runtime.session(for: row.machine), projectID: row.id.projectID))
                    } label: {
                        ChatsRowLabel(
                            title: "Chats",
                            detail: [
                                projects.chats.count > 1 ? row.machine.name : "Your earlier chats",
                                row.connected ? nil : "Offline",
                            ].compactMap { $0 }.joined(separator: " · "),
                            icon: "messages-square")
                    }
                    .modifier(MobileSidebarRow())
                    .accessibilityIdentifier("projects.chats.\(row.machine.id)")
                }
                Button {
                    showingRecent = true
                } label: {
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
        .navigationDestination(isPresented: $showingRecent) {
            RecentProjectsPage(runtime: runtime, projects: projects)
        }
        .mobileSheet(item: $newChat) { target in
            if let machine = runtime.machines.first(where: { $0.id == target.machineID }) {
                let session = runtime.session(for: machine)
                NewChatSheet(session: session) { place in
                    openWorkspace(MobileWorkspace(session: session, projectID: place.projectID), view: place.viewID)
                }
            }
        }
        .searchable(text: $search, prompt: "Search projects or machines")
        .toolbar {
            if (runtime.loading || projects.loading) && !visibleProjects.isEmpty {
                // A status, not a control, so it wears no glass and leaves the buttons beside it their own.
                ToolbarItem(id: "projects.updating", placement: .topBarTrailing) {
                    MobileLoadingRow("Updating projects")
                }
                .sharedBackgroundVisibility(.hidden)
            }
        }
        .refreshable {
            await runtime.refreshMachines()
            projects.reconcile(runtime: runtime)
            await projects.refresh()
        }
    }

    private var visibleProjects: [UnifiedProjectRow] { projects.open.filter { $0.matches(search) } }
    private var loadingProjects: Bool {
        runtime.loading || projects.loading
            || (projects.open.isEmpty && projects.recent.isEmpty && !runtime.machines.isEmpty
                && !projects.hasConnectedMachine && runtime.problem == nil && projects.problems.isEmpty)
    }
}
