import RuimtePulsar
import SwiftUI
import UIKit

/// The iPhone: four tabs, each a stack of its own (`PhoneTabController`), with Settings behind the avatar on each,
/// inside one stack that holds the views over them (`PhoneRootController`). Every page is SwiftUI in a hosting
/// controller of its own, so its title, `.toolbar` and `.searchable` go to that controller's navigation item. The
/// bars of the tabs, a project and a machine are UIKit's (`PhoneBar`). The iPad keeps its split view in `AppHome`.
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
            root: root, page: page,
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

    private var bars: PhoneBars {
        PhoneBars(runtime: runtime, showSettings: showSettings)
    }

    /// A hosting controller starts a SwiftUI hierarchy of its own, so what the pages read from above is set again.
    private func hosted(_ content: some View) -> AnyView {
        AnyView(
            content
                .environment(\.openMobileWorkspace, openWorkspace)
                .environment(\.openProjectView, OpenProjectViewAction { router.openView($0, in: $1) })
                .foregroundStyle(MobileStyle.text)
                .tint(MobileStyle.accent)
                .toggleStyle(SystemToggleStyle()))
    }

    private func root(_ tab: PhoneTab) -> PhonePageController {
        switch tab {
        case .now:
            let requests = BarRequests()
            let page = NowPage(
                runtime: runtime, now: now, requests: requests,
                open: { router.show($0, from: .now) },
                openProject: { target in
                    guard let workspace = workspace(for: target) else { return }
                    router.openProject(workspace, view: target.viewID)
                },
                pair: pair
            )
            return PhonePageController(route: nil, page: hosted(page), bar: bars.now(requests: requests))
        case .projects:
            let page = ProjectsPage(
                runtime: runtime, projects: projects, inTabs: true, showRecent: router.showRecentProjects
            ) {
                EmptyView()
            }
            .navigationTitle("Projects")
            .navigationBarTitleDisplayMode(.large)
            return PhonePageController(route: nil, page: hosted(page), bar: bars.projects(projects))
        case .machines:
            let page = MachinesPage(runtime: runtime, showsPairingRow: false, pair: pair, open: router.showMachine)
            return PhonePageController(
                route: nil, page: hosted(page), bar: bars.machines(pair: pair, signIn: signIn))
        case .search:
            let page = SearchPage(
                now: now, projects: projects, runtime: runtime,
                open: { router.show($0, from: .search) }
            )
            return PhonePageController(route: nil, page: hosted(page), bar: bars.search())
        }
    }

    private func page(_ route: PhoneRoute) -> PhonePageController {
        switch route {
        case .project(let navigation):
            return PhonePageController(
                route: route, page: hosted(WorkspacePage(navigation: navigation)), bar: bars.project(navigation))
        case .projectView(let navigation, let id):
            return PhonePageController(
                route: route, page: hosted(ProjectViewDestination(workspace: navigation.workspace, id: id)))
        case .view(let target):
            return PhonePageController(
                route: route,
                page: hosted(ProjectViewPage(runtime: runtime, target: target, preview: now.preview(of: target))))
        case .notification(let notification):
            return PhonePageController(
                route: route, page: hosted(NotificationRoutePage(runtime: runtime, now: now, destination: notification)))
        case .recentProjects:
            return PhonePageController(
                route: route, page: hosted(RecentProjectsPage(runtime: runtime, projects: projects)))
        case .machine(let id):
            let requests = BarRequests()
            let session = runtime.machines.first { $0.id == id }.map { runtime.session(for: $0) }
            return PhonePageController(
                route: route, page: hosted(MachineRoutePage(runtime: runtime, machineID: id, requests: requests)),
                bar: bars.machine(session, requests: requests))
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
    let root: (PhoneTab) -> PhonePageController
    let page: (PhoneRoute) -> PhonePageController
    let selected: (PhoneTab) -> Void
    let settled: (PhoneTab, [PhoneRoute]) -> Void
    let settledViews: ([PhoneRoute]) -> Void

    func makeUIViewController(context: Context) -> PhoneRootController {
        let roots = Dictionary(uniqueKeysWithValues: PhoneTab.allCases.map { ($0, root($0)) })
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
        for (phoneTab, stack) in controller.tabs.stacks {
            stack.appeared = selected
            stack.makePage = page
            stack.settled = { [settled] in settled(phoneTab, $0) }
        }
        controller.makePage = page
        controller.settled = settledViews
    }
}

/// Opens a view of a project over the project's page on an iPhone.
struct OpenProjectViewAction {
    let action: (String, WorkspaceNavigation) -> Void

    func callAsFunction(_ id: String, in navigation: WorkspaceNavigation) {
        action(id, navigation)
    }
}

extension EnvironmentValues {
    /// Only the iPhone sets it; the iPad shows a project's view in its detail column.
    @Entry var openProjectView: OpenProjectViewAction?
}
