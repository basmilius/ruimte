import RuimtePulsar
import RuimteShared
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
    let addMachine: () -> Void
    @State private var newChat = false
    @State private var gitLines = ProjectGitLines()
    @State private var scheduled = ScheduledModel()
    @Environment(\.voiceScene) private var voiceScene

    var body: some View {
        NavigationStack(path: $router.path) {
            TabView(selection: $router.tab) {
                Tab(value: PhoneTab.now) {
                    NowPage(
                        runtime: runtime, now: now, scheduled: scheduled,
                        open: { router.show($0, from: .now) },
                        openProject: { target in
                            guard let workspace = workspace(for: target) else { return }
                            router.openProject(workspace, view: target.viewID)
                        },
                        openRoutine: { router.show($0) },
                        addMachine: addMachine
                    )
                    .background(StackBarTracking())
                } label: {
                    Label(String(localized: "Now"), lucideIcon: "inbox")
                }
                .badge(now.waiting(with: scheduled))

                Tab(value: PhoneTab.projects) {
                    ProjectsPage(
                        runtime: runtime, projects: projects, embedded: true, now: now, gitLines: gitLines,
                        cards: true, showRecent: router.showRecentProjects
                    ) {
                        EmptyView()
                    }
                    .background(StackBarTracking())
                } label: {
                    Label(String(localized: "Projects"), lucideIcon: "folders")
                }

                Tab(value: PhoneTab.scheduled) {
                    ScheduledPage(
                        runtime: runtime, now: now, model: scheduled, open: { router.show($0) },
                        addMachine: addMachine
                    )
                    .background(StackBarTracking())
                } label: {
                    Label(String(localized: "Routines"), lucideIcon: "clock")
                }

                Tab(value: PhoneTab.machines) {
                    MachinesPage(runtime: runtime, addMachine: addMachine, open: router.showMachine)
                        .background(StackBarTracking())
                } label: {
                    Label(String(localized: "Machines"), lucideIcon: "server")
                }

                Tab(value: PhoneTab.search, role: .search) {
                    SearchPage(
                        now: now, projects: projects, runtime: runtime, navigator: router, showSettings: showSettings,
                        addMachine: addMachine)
                } label: {
                    Label(String(localized: "Search"), lucideIcon: "search")
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
        .modifier(
            HomeWatch(runtime: runtime, now: now, scheduled: scheduled) { [router] in
                router.project.map { (VoiceTarget($0.workspace, shown: $0.openedViewID), $0.workspace.session) }
            })
    }

    private var settingsLink: SettingsLink { SettingsLink(runtime: runtime, show: showSettings) }

    @ToolbarContentBuilder private var tabToolbar: some ToolbarContent {
        if router.tab == .now, runtime.showsVoice(in: voiceScene), let voiceScene {
            ToolbarItem(id: "now.voice", placement: .topBarTrailing) {
                VoiceMicButton(voice: runtime.voice, scene: voiceScene, target: runtime.voiceStartingPoint(now: now))
            }
        }
        if router.tab == .now && !runtime.machines.isEmpty {
            ToolbarItem(id: "now.newChat", placement: .topBarTrailing) {
                Button {
                    newChat = true
                } label: {
                    Image(lucide: "message-square-plus").accessibilityLabel("New chat")
                }
                .accessibilityIdentifier("now.newChat")
            }
        }
        if router.tab == .projects && (runtime.loading || projects.loading) && !projects.open.isEmpty {
            ProjectsUpdatingItem()
        }
        if router.tab == .machines {
            ToolbarItem(id: "machines.add", placement: .topBarTrailing) {
                Button(action: addMachine) {
                    Image(lucide: "plus").accessibilityLabel("Add machine")
                }
            }
        }
        SettingsToolbarItem(link: settingsLink)
    }

    @ViewBuilder private func page(for route: PhoneRoute) -> some View {
        switch route {
        case .project(let navigation):
            WorkspacePage(
                navigation: navigation, navigator: router, settingsLink: settingsLink, gitLines: gitLines,
                runtime: runtime)
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
        case .scheduled(let route):
            ScheduledDestination(runtime: runtime, model: scheduled, route: route, open: { router.show($0) })
        }
    }

    private func workspace(for target: ProjectViewTarget) -> MobileWorkspace? {
        guard let session = runtime.session(machineID: target.machineID) else { return nil }
        let id = UnifiedProjectRow.ID(machineID: target.machineID, projectID: target.projectID)
        let row = (projects.open + projects.chats).first { $0.id == id }
        return MobileWorkspace(session: session, projectID: target.projectID, summary: row?.summary ?? .object([:]))
    }
}

/// Hands the stack's bar the list of the tab that appears. The tab bar controller between them reports no content
/// scroll view, so the bar kept following the first tab's list and a later tab scrolled under a title that never folds.
private struct StackBarTracking: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) {}

    final class Controller: UIViewController {
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            var tab: UIViewController? = self
            while let current = tab, !(current.parent is UITabBarController) {
                tab = current.parent
            }
            guard let tab, var stackRoot = tab.parent, let navigation = stackRoot.navigationController else {
                return
            }
            while let parent = stackRoot.parent, parent !== navigation {
                stackRoot = parent
            }
            stackRoot.setContentScrollView(tab.contentScrollView(for: .top), for: .top)
        }
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

extension SettingsLink {
    @MainActor init(runtime: AppRuntime, show: @escaping () -> Void) {
        self.init(
            account: runtime.account, picture: AccountPictures.shared.picture(for: runtime.account), show: show)
    }
}

/// What both homes keep up while they show: the routines, the Needs you widget, the account's picture and where Voice
/// opens what it starts.
struct HomeWatch: ViewModifier {
    let runtime: AppRuntime
    let now: NowModel
    let scheduled: ScheduledModel
    let openTarget: () -> VoiceScene.Place?
    @Environment(\.voiceScene) private var voiceScene

    func body(content: Content) -> some View {
        content
            .modifier(ScheduledWatch(runtime: runtime, model: scheduled))
            .onChange(of: now.board) { _, board in
                if now.loaded { NeedsYouWidgetRecorder.record(board) }
            }
            .task(id: runtime.account?.id) { await AccountPictures.shared.load(for: runtime.account) }
            .onAppear { voiceScene?.openTarget = openTarget }
    }
}

/// The avatar into Settings, under one id on every page that shows it, so the bar of the next page finds it at the
/// same spot and morphs only what changes around it. It goes last in a page's own `.toolbar`: the bar puts the
/// items of a `.toolbar` outside the page before the page's own, which would leave it left of the page's items.
struct SettingsToolbarItem: ToolbarContent {
    let link: SettingsLink

    var body: some ToolbarContent {
        // Gives the avatar a glass of its own instead of sharing one with the page's items before it.
        ToolbarSpacer(.fixed, placement: .topBarTrailing)
        ToolbarItem(id: "settings", placement: .topBarTrailing) {
            Button(action: link.show) {
                AccountAvatar.image(for: link.account, picture: link.picture)
            }
            .accessibilityLabel("Settings")
            .accessibilityIdentifier("home.settings")
        }
    }
}
