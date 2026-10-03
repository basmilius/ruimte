import RuimtePulsar
import SwiftUI
import UIKit

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
                    .toolbar { SettingsToolbarItem(link: settingsLink) }
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
                    .toolbar { SettingsToolbarItem(link: settingsLink) }
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
        .tabViewBottomAccessory(isEnabled: router.showsProjectAccessory) {
            if let project = router.project { ProjectAccessory(navigation: project) }
        }
        .environment(\.settingsLink, settingsLink)
    }

    private var settingsLink: SettingsLink { SettingsLink(account: runtime.account, show: showSettings) }

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

/// What the avatar needs to open Settings. Only the iPhone sets it; the iPad keeps Settings in its sidebar.
struct SettingsLink {
    let account: Account?
    let show: () -> Void
}

extension EnvironmentValues {
    @Entry var settingsLink: SettingsLink?
}

/// The avatar into Settings, apart from the items before it and under one id on every page that shows it, so the
/// bar of the next page finds it at the same spot and morphs only what changes around it.
struct SettingsToolbarItem: ToolbarContent {
    let link: SettingsLink

    var body: some ToolbarContent {
        ToolbarSpacer(.fixed, placement: .topBarTrailing)
        ToolbarItem(id: "settings", placement: .topBarTrailing) {
            Button(action: link.show) {
                AccountAvatar.image(for: link.account)
            }
            .accessibilityLabel("Settings")
            .accessibilityIdentifier("home.settings")
        }
    }
}

/// The account's initial, or the person mark while nobody is signed in, as the way into Settings. Both are a bare
/// image the size of an icon: the bar gives an image a glass circle of the system's size, which no Dynamic Type size
/// stretches, and anything else a capsule around whatever it draws.
enum AccountAvatar {
    static let glyphSize = CGSize(width: 20, height: 20)
    @MainActor private static var glyphs: [String: Image] = [:]

    static func initial(of login: String?) -> String? {
        login?.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() }
    }

    @MainActor static func image(for account: Account?) -> Image {
        guard let initial = initial(of: account?.login) else { return Image(lucide: "circle-user-round") }
        if let image = glyphs[initial] { return image }
        let image = Image(uiImage: glyph(initial))
        glyphs[initial] = image
        return image
    }

    /// The letter in the weight and size of a bar button's title, centered on its capitals so a letter without a
    /// descender sits in the middle of the circle.
    static func glyph(_ initial: String) -> UIImage {
        let font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        let text = NSAttributedString(string: initial, attributes: [.font: font, .foregroundColor: UIColor.black])
        let width = text.size().width
        let baseline = (glyphSize.height + font.capHeight) / 2
        return UIGraphicsImageRenderer(size: glyphSize).image { _ in
            text.draw(at: CGPoint(x: (glyphSize.width - width) / 2, y: baseline - font.ascender))
        }
        .withRenderingMode(.alwaysTemplate)
    }
}
