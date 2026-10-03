import RuimtePulsar
import SwiftUI

/// The iPad: the open project's sidebar, floating as glass beside the content, and in the content Now, a project's
/// views, all projects or the machines. Files and Git stand in an inspector beside the content, the palette opens
/// with ⌘K, and settings and pairing are form sheets.
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
    /// What the palette asked for that is a sheet of its own, put up once the palette is gone.
    @State private var afterPalette: (() -> Void)?

    var body: some View {
        NavigationSplitView {
            PadSidebar(
                runtime: runtime, projects: projects, now: now, router: router, settingsLink: settingsLink,
                openPalette: { palette = true }, openTarget: open
            )
            .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 360)
        } detail: {
            PadDetailColumn(
                runtime: runtime, projects: projects, now: now, router: router, gitLines: gitLines,
                openPalette: { palette = true }, open: open, pair: pair)
        }
        .environment(
            \.openMobileWorkspace,
            OpenMobileWorkspaceAction(id: "pad") { workspace, view in
                palette = false
                router.openProject(workspace, view: view)
            }
        )
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

    private var settingsLink: SettingsLink {
        SettingsLink(
            account: runtime.account, picture: AccountPictures.shared.picture(for: runtime.account),
            show: showSettings)
    }

    private var navigator: PadPaletteNavigator {
        PadPaletteNavigator(runtime: runtime, router: router) { palette = false }
    }

    /// Opens a view of any project, which puts that project in the sidebar.
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
