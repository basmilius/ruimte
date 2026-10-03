import RuimtePulsar
import SwiftUI

// TODO(Bas): becomes the desktop command palette (files and commands too) once that package lands.
/// Finds a view or a project by name over every machine, from what Now and Projects already read.
struct SearchPage: View {
    let now: NowModel
    let projects: UnifiedProjects
    let runtime: AppRuntime
    let open: (ProjectViewTarget) -> Void
    @State private var query = ""
    @Environment(\.openMobileWorkspace) private var openWorkspace

    var body: some View {
        let views = ViewSearch.views(now.entries, query: query)
        let found = ViewSearch.projects(projects.open + projects.recent, query: query)
        MobileList {
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ContentUnavailableView(
                    "Find a view or a project", lucideIcon: "search",
                    description: Text("Search the views and projects on all your machines."))
            } else if views.isEmpty && found.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                if !views.isEmpty {
                    Section("Views") {
                        ForEach(views) { entry in
                            Button {
                                open(entry.target)
                            } label: {
                                MobileRow(
                                    title: entry.title, subtitle: subtitle(entry.projectName, entry.machineName),
                                    symbol: entry.iconName)
                            }
                        }
                    }
                }
                if !found.isEmpty {
                    Section("Projects") {
                        ForEach(found) { row in
                            Button {
                                openWorkspace(
                                    MobileWorkspace(session: runtime.session(for: row.machine), projectID: row.id.projectID))
                            } label: {
                                ProjectHomeRow(
                                    summary: row.summary, machine: row.machine.name, connected: row.connected,
                                    session: runtime.session(for: row.machine))
                            }
                            .disabled(row.summary["available"] == .bool(false))
                        }
                    }
                }
            }
        }
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: "Views and projects")
    }

    private func subtitle(_ project: String, _ machine: String) -> String {
        runtime.machines.count > 1 ? "\(project) · \(machine)" : project
    }
}
