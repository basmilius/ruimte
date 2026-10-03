import RuimtePulsar
import SwiftUI
import UIKit

/// The iPhone: four tabs, with Settings behind the avatar on each. The iPad keeps its split view in `AppHome`.
struct PhoneHome: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    let now: NowModel
    @Bindable var router: PhoneRouter
    let showSettings: () -> Void
    let pair: () -> Void
    let signIn: () -> Void

    var body: some View {
        TabView(selection: $router.tab) {
            Tab(value: PhoneTab.now) {
                NavigationStack {
                    NowPage(
                        runtime: runtime, now: now,
                        open: { router.show($0, from: .now) },
                        openProject: { target in
                            guard let workspace = workspace(for: target) else { return }
                            router.openProject(workspace, view: target.viewID)
                        },
                        pair: pair
                    )
                    .navigationDestination(item: $router.now) { destination($0) }
                }
                .containerBackground(MobileStyle.surface, for: .navigation)
            } label: {
                Label("Now", lucideIcon: "inbox")
            }
            .badge(now.board.needsYou.count)

            Tab(value: PhoneTab.projects) {
                NavigationStack {
                    ProjectsPage(runtime: runtime, projects: projects, showingRecent: $router.showingRecent) {
                        EmptyView()
                    }
                    .navigationTitle("Projects")
                    .navigationDestination(item: $router.project) { WorkspacePage(navigation: $0) }
                }
                .containerBackground(MobileStyle.surface, for: .navigation)
            } label: {
                Label("Projects", lucideIcon: "folders")
            }

            Tab(value: PhoneTab.machines) {
                NavigationStack {
                    MachinesPage(runtime: runtime, showsPairingRow: false, pair: pair)
                        .toolbar {
                            ToolbarItem(id: "machines.add", placement: .topBarTrailing) {
                                Menu {
                                    Button("Use a pairing link", lucideIcon: "link", action: pair)
                                    if runtime.account == nil {
                                        Button("Sign in", lucideIcon: "circle-user-round", action: signIn)
                                    }
                                } label: {
                                    Image(lucide: "plus").accessibilityLabel("Add a machine")
                                }
                            }
                            SettingsToolbarItem(link: settingsLink)
                        }
                }
                .containerBackground(MobileStyle.surface, for: .navigation)
            } label: {
                Label("Machines", lucideIcon: "monitor")
            }

            Tab(value: PhoneTab.search, role: .search) {
                NavigationStack {
                    SearchPage(
                        now: now, projects: projects, runtime: runtime,
                        open: { router.show($0, from: .search) }
                    )
                    .toolbar { SettingsToolbarItem(link: settingsLink) }
                    .navigationDestination(item: $router.search) { destination($0) }
                }
                .containerBackground(MobileStyle.surface, for: .navigation)
            } label: {
                Label("Search", lucideIcon: "search")
            }
        }
        .onChange(of: now.board) { _, board in
            if now.loaded { NeedsYouWidgetRecorder.record(board) }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewSearchActivation(.searchTabSelection)
        .task(id: runtime.account?.id) { await AccountPictures.shared.load(for: runtime.account) }
        .environment(\.settingsLink, settingsLink)
    }

    private var settingsLink: SettingsLink {
        SettingsLink(
            account: runtime.account, picture: AccountPictures.shared.picture(for: runtime.account),
            show: showSettings)
    }

    @ViewBuilder private func destination(_ destination: PhoneDestination) -> some View {
        switch destination {
        case .view(let target):
            ProjectViewPage(runtime: runtime, target: target, preview: now.preview(of: target)).id(target.id)
        case .notification(let notification):
            NotificationRoutePage(runtime: runtime, now: now, destination: notification).id(notification.id)
        }
    }

    private func workspace(for target: ProjectViewTarget) -> MobileWorkspace? {
        guard let machine = runtime.machines.first(where: { $0.id == target.machineID }) else { return nil }
        return MobileWorkspace(session: runtime.session(for: machine), projectID: target.projectID)
    }
}

/// What the avatar needs to open Settings. Only the iPhone sets it; the iPad keeps Settings in its sidebar.
struct SettingsLink {
    let account: Account?
    /// Nil while it loads, and for an account no provider hands a picture out for.
    let picture: UIImage?
    let show: () -> Void
}

extension EnvironmentValues {
    @Entry var settingsLink: SettingsLink?
}

/// The avatar into Settings, under one id on every page that shows it, so the bar of the next page finds it at the
/// same spot and morphs only what changes around it. It goes last in the page's own `.toolbar`: the bar puts the
/// items of a `.toolbar` outside the page before the page's own, which left it on the left of Now's write button.
struct SettingsToolbarItem: ToolbarContent {
    let link: SettingsLink

    var body: some ToolbarContent {
        ToolbarItem(id: "settings", placement: .topBarTrailing) {
            Button(action: link.show) {
                AccountAvatar.image(for: link.account, picture: link.picture)
            }
            .accessibilityLabel("Settings")
            .accessibilityIdentifier("home.settings")
        }
    }
}
