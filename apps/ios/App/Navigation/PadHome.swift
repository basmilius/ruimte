import RuimtePulsar
import SwiftUI

/// The iPad: a sidebar with Now, the machines and the open projects, which pushes a project's views when one opens,
/// and beside it Now, the machines or the project's view. Files and Git stand in an inspector beside the content, the
/// palette opens with ⌘K, and settings and pairing are form sheets.
struct PadHome: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    let now: NowModel
    let router: PadRouter
    let showSettings: () -> Void
    let pair: () -> Void
    let signIn: () -> Void
    @State private var gitLines = ProjectGitLines()
    @State private var palette = false
    @State private var sidebarVisibility = NavigationSplitViewVisibility.automatic
    /// What the palette asked for that is a sheet of its own, put up once the palette is gone.
    @State private var afterPalette: (() -> Void)?

    var body: some View {
        NavigationSplitView(columnVisibility: $sidebarVisibility) {
            PadSidebar(
                runtime: runtime, projects: projects, now: now, router: router, gitLines: gitLines,
                settingsLink: settingsLink
            )
            .anchorPreference(key: SidebarBounds.self, value: .bounds) { $0 }
            .navigationSplitViewColumnWidth(min: 280, ideal: 340, max: 420)
        } detail: {
            PadDetailColumn(
                runtime: runtime, projects: projects, now: now, router: router,
                openPalette: { palette = true }, open: open, pair: pair, signIn: signIn)
        }
        .navigationSplitViewStyle(.balanced)
        .inspector(isPresented: inspectorShown) {
            PadInspectorPane(router: router).inspectorColumnWidth(min: 300, ideal: 360, max: 520)
        }
        .overlayPreferenceValue(SidebarBounds.self) { anchor in
            GeometryReader { geometry in
                if let anchor, sidebarVisibility != .detailOnly {
                    let bounds = geometry[anchor]
                    if bounds.minX >= 0 && bounds.maxX > 1 && bounds.maxX < geometry.size.width {
                        SidebarDivider().offset(x: bounds.maxX - 1)
                    }
                }
            }
            .ignoresSafeArea(.container, edges: .vertical)
            .allowsHitTesting(false)
        }
        // On the window rather than a page's bar, so ⌘K opens the palette whatever the content column shows.
        .background {
            Button("Search") { palette = true }
                .keyboardShortcut("k", modifiers: .command)
                .opacity(0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .environment(\.openMobileWorkspace, router.openAction { palette = false })
        .mobileSheet(isPresented: $palette, onDismiss: runAfterPalette) {
            NavigationStack {
                SearchPage(
                    now: now, projects: projects, runtime: runtime, navigator: navigator,
                    showSettings: { closePalette(then: showSettings) }, pair: { closePalette(then: pair) }
                )
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(role: .close) { palette = false } }
                }
            }
        }
        .onChange(of: now.board) { _, board in
            if now.loaded { NeedsYouWidgetRecorder.record(board) }
        }
        .task(id: runtime.account?.id) { await AccountPictures.shared.load(for: runtime.account) }
    }

    private var inspectorShown: Binding<Bool> {
        Binding(get: { router.showsInspector }, set: { if !$0 { router.inspector = nil } })
    }

    private var settingsLink: SettingsLink {
        SettingsLink(
            account: runtime.account, picture: AccountPictures.shared.picture(for: runtime.account),
            show: showSettings)
    }

    private var navigator: PadPaletteNavigator {
        PadPaletteNavigator(runtime: runtime, router: router) { palette = false }
    }

    /// Opens a view of any project, which pushes that project in the sidebar.
    private func open(_ target: ProjectViewTarget) {
        PadPaletteNavigator(runtime: runtime, router: router) {}.show(view: target)
    }

    private func closePalette(then action: @escaping () -> Void) {
        afterPalette = action
        palette = false
    }

    private func runAfterPalette() {
        let action = afterPalette
        afterPalette = nil
        action?()
    }
}

/// The palette on an iPad: what it finds opens in the sidebar's project and the content beside it, once the palette
/// closed.
struct PadPaletteNavigator: PaletteNavigator {
    let runtime: AppRuntime
    let router: PadRouter
    let close: () -> Void

    func show(view target: ProjectViewTarget) {
        guard let workspace = workspace(target.machineID, target.projectID) else { return }
        close()
        router.openProject(workspace, view: target.itemID)
    }

    func show(file: ProjectFileTarget) {
        guard let workspace = workspace(file.machineID, file.projectID) else { return }
        close()
        router.openProject(workspace)
        router.show(file: file.path)
    }

    func showMachine(_ id: String) {
        close()
        router.machineID = id
        router.detail = .machines
    }

    func showRecentProjects() {
        close()
        router.detail = .recentlyClosed
    }

    func openProject(_ workspace: MobileWorkspace) -> WorkspaceNavigation {
        close()
        return router.openProject(workspace)
    }

    private func workspace(_ machineID: String, _ projectID: String) -> MobileWorkspace? {
        guard let machine = runtime.machines.first(where: { $0.id == machineID }) else { return nil }
        return MobileWorkspace(session: runtime.session(for: machine), projectID: projectID)
    }
}
