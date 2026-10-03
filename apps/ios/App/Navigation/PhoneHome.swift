import RuimtePulsar
import SwiftUI
import UIKit

/// The iPhone: four tabs, each a stack of its own (`PhoneTabController`), with Settings behind the avatar on each,
/// inside one stack that holds the views over them (`PhoneRootController`). Every page is SwiftUI in a hosting
/// controller of its own, so its title, `.toolbar` and `.searchable` go to that controller's navigation item. The
/// iPad keeps its split view in `AppHome`.
struct PhoneHome: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    let now: NowModel
    let router: PhoneRouter
    let showSettings: () -> Void
    let pair: () -> Void
    let signIn: () -> Void
    @Environment(\.openMobileWorkspace) private var openWorkspace

    var body: some View {
        PhoneStacks(
            tab: router.tab, paths: router.paths, views: router.views, needsYou: now.board.needsYou.count,
            root: { hosted(root($0)) }, page: { hosted(page(for: $0)) },
            selected: { tab in
                if router.tab != tab { router.tab = tab }
            },
            settled: { router.settle($0, path: $1) },
            settledViews: { router.settleViews($0) }
        )
        .ignoresSafeArea()
        .onChange(of: now.board) { _, board in
            if now.loaded { NeedsYouWidgetRecorder.record(board) }
        }
        .task(id: runtime.account?.id) { await AccountPictures.shared.load(for: runtime.account) }
    }

    /// A hosting controller starts a SwiftUI hierarchy of its own, so what the pages read from above is set again.
    private func hosted(_ content: some View) -> AnyView {
        AnyView(
            PhoneHostedPage(runtime: runtime, showSettings: showSettings) { content }
                .environment(\.openMobileWorkspace, openWorkspace)
                .environment(\.openProjectView, OpenProjectViewAction { router.openView($0, in: $1) })
                .foregroundStyle(MobileStyle.text)
                .tint(MobileStyle.accent)
                .toggleStyle(SystemToggleStyle()))
    }

    @ViewBuilder private func root(_ tab: PhoneTab) -> some View {
        switch tab {
        case .now:
            NowPage(
                runtime: runtime, now: now,
                open: { router.show($0, from: .now) },
                openProject: { target in
                    guard let workspace = workspace(for: target) else { return }
                    router.openProject(workspace, view: target.viewID)
                },
                pair: pair
            )
        case .projects:
            ProjectsPage(runtime: runtime, projects: projects, inTabs: true, showRecent: router.showRecentProjects) {
                EmptyView()
            }
            .navigationTitle("Projects")
            .navigationBarTitleDisplayMode(.large)
        case .machines:
            MachinesPage(runtime: runtime, showsPairingRow: false, pair: pair, open: router.showMachine)
                .modifier(MachinesToolbar(runtime: runtime, pair: pair, signIn: signIn))
        case .search:
            SearchPage(
                now: now, projects: projects, runtime: runtime,
                open: { router.show($0, from: .search) }
            )
        }
    }

    @ViewBuilder private func page(for route: PhoneRoute) -> some View {
        switch route {
        case .project(let navigation):
            WorkspacePage(navigation: navigation)
        case .projectView(let navigation, let id):
            ProjectViewDestination(workspace: navigation.workspace, id: id)
        case .view(let target):
            ProjectViewPage(runtime: runtime, target: target, preview: now.preview(of: target))
        case .notification(let notification):
            NotificationRoutePage(runtime: runtime, now: now, destination: notification)
        case .recentProjects:
            RecentProjectsPage(runtime: runtime, projects: projects)
        case .machine(let id):
            MachineRoutePage(runtime: runtime, machineID: id)
        }
    }

    private func workspace(for target: ProjectViewTarget) -> MobileWorkspace? {
        guard let machine = runtime.machines.first(where: { $0.id == target.machineID }) else { return nil }
        return MobileWorkspace(session: runtime.session(for: machine), projectID: target.projectID)
    }
}

/// Bridges `PhoneRootController` into SwiftUI and keeps it on the router's state.
private struct PhoneStacks: UIViewControllerRepresentable {
    let tab: PhoneTab
    let paths: [PhoneTab: [PhoneRoute]]
    let views: [PhoneRoute]
    let needsYou: Int
    let root: (PhoneTab) -> AnyView
    let page: (PhoneRoute) -> AnyView
    let selected: (PhoneTab) -> Void
    let settled: (PhoneTab, [PhoneRoute]) -> Void
    let settledViews: ([PhoneRoute]) -> Void

    func makeUIViewController(context: Context) -> PhoneRootController {
        let roots = Dictionary(
            uniqueKeysWithValues: PhoneTab.allCases.map { ($0, PhonePageController(route: nil, page: root($0))) })
        let controller = PhoneRootController(tabs: PhoneTabController(roots: roots))
        connect(controller)
        controller.show(tab: tab, paths: paths, views: views, needsYou: needsYou)
        return controller
    }

    func updateUIViewController(_ controller: PhoneRootController, context: Context) {
        connect(controller)
        controller.show(tab: tab, paths: paths, views: views, needsYou: needsYou)
    }

    private func connect(_ controller: PhoneRootController) {
        let makePage = { [page] (route: PhoneRoute) in PhonePageController(route: route, page: page(route)) }
        for (phoneTab, stack) in controller.tabs.stacks {
            stack.appeared = selected
            stack.makePage = makePage
            stack.settled = { [settled] in settled(phoneTab, $0) }
        }
        controller.makePage = makePage
        controller.settled = settledViews
    }
}

/// Sets the avatar's link on a hosted page, following the account and its picture as they load.
private struct PhoneHostedPage<Content: View>: View {
    let runtime: AppRuntime
    let showSettings: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        content.environment(
            \.settingsLink,
            SettingsLink(
                account: runtime.account, picture: AccountPictures.shared.picture(for: runtime.account),
                show: showSettings))
    }
}

/// The plus of the Machines tab beside the avatar.
private struct MachinesToolbar: ViewModifier {
    let runtime: AppRuntime
    let pair: () -> Void
    let signIn: () -> Void
    @Environment(\.settingsLink) private var settingsLink

    func body(content: Content) -> some View {
        content.toolbar {
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
            if let settingsLink {
                SettingsToolbarItem(link: settingsLink)
            }
        }
    }
}

/// Opens a view of a project over the project's page on an iPhone.
struct OpenProjectViewAction {
    let action: (String, WorkspaceNavigation) -> Void

    func callAsFunction(_ id: String, in navigation: WorkspaceNavigation) {
        action(id, navigation)
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
    /// Only the iPhone sets it; the iPad shows a project's view in its detail column.
    @Entry var openProjectView: OpenProjectViewAction?
}

/// The avatar into Settings, under one id on every page that shows it, so the bar of the next page finds it at the
/// same spot and morphs only what changes around it. It goes last in a page's `.toolbar`, so it stands right of the
/// page's other items.
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
