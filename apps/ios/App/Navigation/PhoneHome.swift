import RuimtePulsar
import SwiftUI
import UIKit

/// The iPhone: four tabs under one stack, with Settings behind the avatar on each. A page pushed on the stack covers
/// the tab bar, so the bar leaves with the push and comes back with the pop, a swipe back included. The iPad keeps
/// its split view in `AppHome`.
///
/// A tab's page is hosted apart from the stack's bar, so its own title and `.toolbar` never reach that bar; the
/// tabs' title and items sit on the `TabView`, chosen by the selected tab.
struct PhoneHome: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    let now: NowModel
    @Bindable var router: PhoneRouter
    let showSettings: () -> Void
    let pair: () -> Void
    let signIn: () -> Void
    @State private var newChat = false
    @State private var gitLines = ProjectGitLines()

    var body: some View {
        NavigationStack(path: $router.path) {
            TabView(selection: $router.tab) {
                Tab(value: PhoneTab.now) {
                    NowPage(
                        runtime: runtime, now: now,
                        open: { router.show($0, from: .now) },
                        openProject: { target in
                            guard let workspace = workspace(for: target) else { return }
                            router.openProject(workspace, view: target.viewID)
                        },
                        pair: pair
                    )
                } label: {
                    Label("Now", lucideIcon: "inbox")
                }
                .badge(now.board.needsYou.count)

                Tab(value: PhoneTab.projects) {
                    ProjectsPage(
                        runtime: runtime, projects: projects, inTabs: true, now: now, gitLines: gitLines,
                        showRecent: router.showRecentProjects
                    ) {
                        EmptyView()
                    }
                } label: {
                    Label("Projects", lucideIcon: "folders")
                }

                Tab(value: PhoneTab.machines) {
                    MachinesPage(runtime: runtime, pair: pair, open: router.showMachine)
                } label: {
                    Label("Machines", lucideIcon: "monitor")
                }

                Tab(value: PhoneTab.search, role: .search) {
                    SearchPage(
                        now: now, projects: projects, runtime: runtime, router: router, showSettings: showSettings,
                        pair: pair)
                } label: {
                    Label("Search", lucideIcon: "search")
                }
            }
            .tabBarMinimizeBehavior(.onScrollDown)
            .tabViewSearchActivation(.searchTabSelection)
            .navigationTitle(router.tab.title)
            .navigationBarTitleDisplayMode(.large)
            .toolbar { tabToolbar }
            .navigationDestination(for: PhoneRoute.self) { page(for: $0) }
            .mobileSheet(isPresented: $newChat) {
                NowNewChatSheet(runtime: runtime, now: now) { router.show($0, from: .now) }
            }
        }
        .containerBackground(MobileStyle.surface, for: .navigation)
        .onChange(of: now.board) { _, board in
            if now.loaded { NeedsYouWidgetRecorder.record(board) }
        }
        .task(id: runtime.account?.id) { await AccountPictures.shared.load(for: runtime.account) }
    }

    private var settingsLink: SettingsLink {
        SettingsLink(
            account: runtime.account, picture: AccountPictures.shared.picture(for: runtime.account),
            show: showSettings)
    }

    @ToolbarContentBuilder private var tabToolbar: some ToolbarContent {
        if router.tab == .now && !runtime.machines.isEmpty {
            ToolbarItem(id: "now.newChat", placement: .topBarTrailing) {
                Button {
                    newChat = true
                } label: {
                    Image(lucide: "square-pen").accessibilityLabel("New chat")
                }
                .accessibilityIdentifier("now.newChat")
            }
        }
        if router.tab == .projects && (runtime.loading || projects.loading) && !projects.open.isEmpty {
            ProjectsUpdatingItem()
        }
        if router.tab == .machines {
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
        }
        SettingsToolbarItem(link: settingsLink)
    }

    @ViewBuilder private func page(for route: PhoneRoute) -> some View {
        switch route {
        case .project(let navigation):
            WorkspacePage(navigation: navigation, settingsLink: settingsLink, gitLines: gitLines, runtime: runtime)
        case .view(let target):
            ProjectViewPage(runtime: runtime, target: target, preview: now.preview(of: target)).id(target.id)
        case .notification(let notification):
            NotificationRoutePage(runtime: runtime, now: now, destination: notification).id(notification.id)
        case .recentProjects:
            RecentProjectsPage(runtime: runtime, projects: projects)
        case .machine(let id):
            MachineRoutePage(runtime: runtime, machineID: id, settingsLink: settingsLink)
        case .file(let target):
            ProjectFilePage(runtime: runtime, target: target) { router.openProject($0, view: $1) }.id(target)
        }
    }

    private func workspace(for target: ProjectViewTarget) -> MobileWorkspace? {
        guard let machine = runtime.machines.first(where: { $0.id == target.machineID }) else { return nil }
        let id = UnifiedProjectRow.ID(machineID: target.machineID, projectID: target.projectID)
        let row = (projects.open + projects.chats).first { $0.id == id }
        return MobileWorkspace(
            session: runtime.session(for: machine), projectID: target.projectID, summary: row?.summary ?? .object([:]))
    }
}

/// What the avatar needs to open Settings. Only the iPhone hands it to a page, through the page's route, so the bar
/// has the avatar from the first pass of the push; the iPad keeps Settings in its sidebar.
struct SettingsLink {
    let account: Account?
    /// Nil while it loads, and for an account no provider hands a picture out for.
    let picture: UIImage?
    let show: () -> Void
}

/// The avatar into Settings, under one id on every page that shows it, so the bar of the next page finds it at the
/// same spot and morphs only what changes around it. It goes last in a page's own `.toolbar`: the bar puts the
/// items of a `.toolbar` outside the page before the page's own, which would leave it left of the page's items.
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
