import RuimtePulsar
import SwiftUI

/// The iPhone: four tabs, Settings behind the avatar on each, and the project's New view and Usage as the tab bar's
/// accessory. The iPad keeps its split view in `AppHome`.
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
                    .toolbar { avatar }
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
                    .toolbar { avatar }
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
                            ToolbarItem(placement: .topBarTrailing) {
                                Menu {
                                    Button("Use a pairing link", lucideIcon: "link", action: pair)
                                    if runtime.account == nil {
                                        Button("Sign in", lucideIcon: "circle-user-round", action: signIn)
                                    }
                                } label: {
                                    Image(lucide: "plus").accessibilityLabel("Add a machine")
                                }
                            }
                            avatar
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
                    .toolbar { avatar }
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
        .tabViewBottomAccessory(isEnabled: router.showsProjectAccessory) {
            if let project = router.project { ProjectAccessory(navigation: project) }
        }
    }

    @ToolbarContentBuilder private var avatar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button(action: showSettings) {
                AccountAvatar(account: runtime.account)
            }
            .accessibilityLabel("Settings")
            .accessibilityIdentifier("home.settings")
        }
    }

    @ViewBuilder private func destination(_ destination: PhoneDestination) -> some View {
        switch destination {
        case .view(let target):
            ProjectViewPage(runtime: runtime, target: target).id(target.id)
        case .notification(let notification):
            NotificationRoutePage(runtime: runtime, now: now, destination: notification).id(notification.id)
        }
    }

    private func workspace(for target: ProjectViewTarget) -> MobileWorkspace? {
        guard let machine = runtime.machines.first(where: { $0.id == target.machineID }) else { return nil }
        return MobileWorkspace(session: runtime.session(for: machine), projectID: target.projectID)
    }
}

/// New view, or New chat in the Chats project, beside the machine's usage. It rides in the tab bar and shrinks to
/// its icons once the tab bar folds in.
private struct ProjectAccessory: View {
    let navigation: WorkspaceNavigation
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        let scratch = navigation.workspace.isScratch
        HStack(spacing: 12) {
            Button {
                if scratch { navigation.newChat = true } else { navigation.adding = true }
            } label: {
                let label = Label(
                    scratch ? "New chat" : "New view", lucideIcon: scratch ? "message-square-plus" : "plus")
                if placement == .inline { label.labelStyle(.iconOnly) } else { label.labelStyle(.titleAndIcon) }
            }
            .accessibilityIdentifier("project.newView")
            Spacer(minLength: 0)
            Button {
                navigation.showingUsage = true
            } label: {
                Label("Usage", lucideIcon: "chart-no-axes-column")
            }
            .labelStyle(.iconOnly)
            .accessibilityIdentifier("project.usage")
        }
        .font(.callout.weight(.medium))
        .foregroundStyle(MobileStyle.text)
        .padding(.horizontal, 16)
    }
}

/// The account's initial, or the person mark while nobody is signed in, as the way into Settings.
struct AccountAvatar: View {
    let account: Account?

    var body: some View {
        if let initial = (account?.login ?? "").first.map({ String($0).uppercased() }) {
            Text(initial)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(MobileStyle.onAccent)
                .frame(width: 28, height: 28)
                .background(MobileStyle.accent, in: .circle)
        } else {
            Image(lucide: "circle-user-round")
        }
    }
}
