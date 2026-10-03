import RuimtePulsar
import SwiftUI

/// The iPad's sidebar: Now and Machines, then the open projects per machine as the iPhone's Projects tab lists them.
/// A project opened from here or anywhere else is pushed in it with its views, and going back closes it.
struct PadSidebar: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    let now: NowModel
    let router: PadRouter
    let gitLines: ProjectGitLines
    let settingsLink: SettingsLink

    var body: some View {
        NavigationStack {
            ProjectsPage(
                runtime: runtime, projects: projects, embedded: true, now: now, gitLines: gitLines,
                showRecent: { router.detail = .recentlyClosed }
            ) {
                Section {
                    row("Now", icon: "inbox", detail: .now, id: "sidebar.now") {
                        let waiting = now.board.needsYou.count
                        if waiting > 0 {
                            Text("\(waiting)").font(.caption.weight(.semibold)).monospacedDigit()
                                .foregroundStyle(MobileStyle.statusNeedsYou)
                                .accessibilityLabel(waiting == 1 ? "1 needs you" : "\(waiting) need you")
                        }
                    }
                    row("Machines", icon: "monitor", detail: .machines, id: "sidebar.machines") { EmptyView() }
                }
                .listSectionSeparator(.hidden)
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { SidebarBrand() }
                    .sharedBackgroundVisibility(.hidden)
                SettingsToolbarItem(link: settingsLink)
            }
            .navigationDestination(item: pushedProject) { project in
                WorkspacePage(navigation: project, sidebar: router).id(project.id)
            }
        }
        .containerBackground(MobileStyle.surface, for: .navigation)
    }

    private func row<Trailing: View>(
        _ title: String, icon: String, detail: PadDetail, id: String, @ViewBuilder trailing: () -> Trailing
    ) -> some View {
        Button {
            router.detail = detail
        } label: {
            HStack(spacing: 12) {
                Image(lucide: icon).frame(width: 20, height: 20).frame(width: 32)
                Text(title).frame(maxWidth: .infinity, alignment: .leading)
                trailing()
            }
            .modifier(MobileSidebarLabel())
        }
        .modifier(MobileSidebarRow(selected: router.detail == detail))
        .accessibilityIdentifier(id)
    }

    /// The project in the sidebar, whose back button closes it.
    private var pushedProject: Binding<WorkspaceNavigation?> {
        Binding(
            get: { router.project },
            set: { project in
                if project == nil, router.project != nil { router.closeProject() }
            })
    }
}
