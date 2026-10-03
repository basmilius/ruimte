import RuimtePulsar
import SwiftUI
import UIKit

struct AppHome: View {
    @Bindable var runtime: AppRuntime
    @State private var projects = UnifiedProjects()
    @State private var activeProject: WorkspaceNavigation?
    @State private var homeSection: HomeSection? = .projects
    @State private var detailPath = NavigationPath()
    @State private var sidebarVisibility = NavigationSplitViewVisibility.automatic
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var window: UIWindow?
    @State private var settings = false
    @State private var releaseNotes: ReleaseNotes?
    @State private var pairing = false
    @State private var recentProjects = false
    @State private var selectedMachine: String?
    @State private var signIn = false
    @State private var pairAfterDismiss = false
    @State private var now = NowModel()
    @State private var router = PhoneRouter()
    @State private var sceneID = UUID().uuidString
    @State private var restoreAttempted = false
    /// The project a cold start reopened on an iPad, until it opens or fails. An iPhone opens on Now instead.
    @State private var restoring: WorkspaceNavigation?
    @State private var restoreProblem: String?
    @Environment(\.scenePhase) private var phase
    @AppStorage("ruimte.ios.appearance") private var appearance = "system"

    init(runtime: AppRuntime, projects: UnifiedProjects = UnifiedProjects()) {
        self.runtime = runtime
        _projects = State(initialValue: projects)
    }

    private var hasWorkspace: Bool { runtime.account != nil || !runtime.machines.isEmpty }
    private var machineRevision: String {
        ([runtime.key?.publicKey ?? "", String(runtime.connectionRevision)]
            + runtime.machines.map {
                "\($0.id):\($0.publicKey):\($0.brokerUrl ?? ""):\($0.name)"
            }).joined(separator: "|")
    }

    var body: some View {
        Group {
            if usesSidebar {
                tabletNavigation
            } else if hasWorkspace {
                PhoneHome(
                    runtime: runtime, projects: projects, now: now, router: router,
                    showSettings: { settings = true }, pair: { pairing = true }, signIn: { signIn = true })
            } else {
                NavigationStack {
                    WelcomePage(runtime: runtime, window: window) { pairing = true }
                }
                .containerBackground(MobileStyle.surface, for: .navigation)
            }
        }
        .environment(\.openMobileWorkspace, OpenMobileWorkspaceAction(id: sceneID, action: openWorkspace))
        .mobileSheet(isPresented: $pairing) { PairMachinePage(runtime: runtime) }
        .mobileSheet(isPresented: $settings) { MobileSettings(runtime: runtime, projects: projects) }
        .mobileSheet(item: $releaseNotes) { ReleaseNotesSheet(notes: $0) }
        .mobileSheet(isPresented: $signIn, onDismiss: presentPendingPairing) {
            NavigationStack {
                WelcomePage(runtime: runtime, window: window) {
                    pairAfterDismiss = true
                    signIn = false
                }
                .toolbar { Button("Done") { signIn = false } }
            }
        }
        .id(runtime.account?.id ?? "signed-out")
        .background(PresentationWindow { window = $0 }.frame(width: 0, height: 0))
        .task {
            let notes = ReleaseNotes.bundled()
            if ReleaseNotesGate.check(notes: notes, app: AppVersion.marketing) { releaseNotes = notes }
            await runtime.start()
            await runtime.notifications.restore()
            if usesSidebar { restoreLastProject() }
        }
        .task(id: machineRevision) {
            projects.reconcile(runtime: runtime)
            if !isPad { now.reconcile(runtime: runtime) }
        }
        .task(id: runtime.attentionKeys) { await runtime.notifications.syncBadge(liveKeys: runtime.attentionKeys) }
        .onOpenURL { runtime.notifications.openActivityURL($0) }
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
        .onChange(of: restoreFailure) { _, failure in
            guard let failure, let restoring else { return }
            restoreProblem =
                "Could not reopen your last project on \(restoring.workspace.session.machine.name). \(failure)"
            self.restoring = nil
            if activeProject === restoring { activeProject = nil }
        }
        .onChange(of: restoring?.workspace.ready) { _, ready in
            if ready == true { restoring = nil }
        }
        .onChange(of: runtime.account?.id) { _, account in
            // The account restored on launch may land after the last project reopened.
            if restoring == nil || activeProject !== restoring { activeProject = nil }
            router.reset()
            if account != nil { signIn = false }
        }
        .onChange(of: runtime.notifications.destination) { _, destination in
            guard let destination else { return }
            settings = false
            releaseNotes = nil
            pairing = false
            recentProjects = false
            signIn = false
            if isPad {
                activeProject = nil
            } else {
                router.open(destination)
                runtime.notifications.destination = nil
            }
        }
        .onChange(of: phase, initial: true) { _, current in
            runtime.connections.setScene(sceneID, foreground: current != .background)
            if current == .active { Task { await runtime.notifications.syncBadge(liveKeys: runtime.attentionKeys) } }
            if current == .background, !runtime.machines.isEmpty { UsageWidgetRefresh.schedule() }
        }
        .onDisappear {
            projects.stop()
            now.stop()
            runtime.connections.setScene(sceneID, foreground: false)
        }
    }

    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    private var usesSidebar: Bool { isPad && hasWorkspace }

    private var tabletNavigation: some View {
        NavigationSplitView(columnVisibility: $sidebarVisibility) {
            NavigationStack {
                List {
                    Section {
                        ForEach(HomeSection.allCases) { section in
                            Button {
                                withAnimation(reduceMotion ? nil : .default) { homeSection = section }
                            } label: {
                                HStack(spacing: 10) {
                                    Image(lucide: section.icon, size: 20)
                                    Text(section.title).lineLimit(1).truncationMode(.tail)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .modifier(MobileSidebarLabel())
                            }
                            .modifier(MobileSidebarRow(selected: homeSection == section && activeProject == nil))
                            .accessibilityIdentifier("sidebar.\(section.rawValue)")
                        }
                    }.listSectionSeparator(.hidden)
                }
                .modifier(MobileSidebarList())
                .navigationTitle("")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    if activeProject == nil {
                        ToolbarItem(placement: .topBarLeading) { SidebarBrand() }
                            .sharedBackgroundVisibility(.hidden)
                    }
                }
                .navigationDestination(item: sidebarProject) { project in
                    WorkspacePage(navigation: project, isSidebar: true)
                }
            }
            .containerBackground(MobileStyle.surface, for: .navigation)
            .anchorPreference(key: SidebarBounds.self, value: .bounds) { $0 }
            .navigationSplitViewColumnWidth(min: 280, ideal: 340, max: 420)
        } detail: {
            NavigationStack(path: $detailPath) {
                tabletDetail
                    .navigationDestination(
                        item: Binding(
                            get: { runtime.notifications.destination }, set: { runtime.notifications.destination = $0 })
                    ) { destination in
                        NotificationSessionPage(runtime: runtime, destination: destination).id(destination.id)
                    }
            }
            .containerBackground(MobileStyle.surface, for: .navigation)
        }
        .navigationSplitViewStyle(.balanced)
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
        .onChange(of: homeSection) { _, _ in
            detailPath = NavigationPath()
            selectedMachine = nil
        }
        .onChange(of: activeProject?.id) { _, _ in detailPath = NavigationPath() }
        .onChange(of: activeProject?.section) { _, _ in detailPath = NavigationPath() }
        .onChange(of: activeProject?.selectedViewID) { _, _ in detailPath = NavigationPath() }
    }

    @ViewBuilder private var tabletDetail: some View {
        if let activeProject {
            WorkspaceDetail(navigation: activeProject)
        } else {
            switch homeSection ?? .projects {
            case .projects: homeContent
            case .machines:
                MachinesPage(runtime: runtime, pair: { pairing = true }, open: { selectedMachine = $0 })
                    .navigationDestination(item: $selectedMachine) { MachineRoutePage(runtime: runtime, machineID: $0) }
            case .settings: MobileSettings(runtime: runtime, projects: projects, embedded: true)
            }
        }
    }

    /// The Projects section of the iPad, which keeps its plus menu for pairing, machines and signing in.
    private var homeContent: some View {
        ProjectsPage(runtime: runtime, projects: projects, showRecent: { recentProjects = true }) {
            if let restoreProblem {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(restoreProblem).font(.subheadline).foregroundStyle(MobileStyle.text)
                        HStack(spacing: 16) {
                            if LastProject.read() != nil {
                                Button("Try again") { retryRestore() }
                            }
                            Button("Dismiss") {
                                self.restoreProblem = nil
                                LastProject.forget()
                            }
                        }
                        .buttonStyle(.borderless).font(.subheadline)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(MobileStyle.panel, in: .rect(cornerRadius: 16))
                    .accessibilityIdentifier("projects.restoreProblem")
                }
                .listSectionSeparator(.hidden, edges: .top)
            }
        }
        .navigationTitle("Projects")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $recentProjects) {
            RecentProjectsPage(runtime: runtime, projects: projects)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Use a pairing link", lucideIcon: "link") { pairing = true }
                    Button("Machines", lucideIcon: "monitor") { homeSection = .machines }
                    if runtime.account == nil {
                        Button("Sign in", lucideIcon: "circle-user-round") { signIn = true }
                    }
                } label: {
                    Image(lucide: "plus").accessibilityLabel("Add or connect")
                }
            }
        }
    }

    private var sidebarProject: Binding<WorkspaceNavigation?> {
        Binding(
            get: { activeProject },
            set: { project in
                if let project {
                    activeProject = project
                } else if activeProject != nil {
                    closeProject()
                }
            })
    }

    private var restoreFailure: String? {
        guard let restoring, !restoring.workspace.ready else { return nil }
        let workspace = restoring.workspace
        if let problem = workspace.problem { return problem }
        return workspace.session.failedAttempts >= 3
            ? workspace.session.problem ?? "The machine is not answering." : nil
    }

    private func restoreLastProject() {
        guard !restoreAttempted else { return }
        restoreAttempted = true
        guard let last = LastProject.read(), activeProject == nil, runtime.notifications.destination == nil else {
            return
        }
        guard let machine = runtime.machines.first(where: { $0.id == last.machineID }) else {
            restoreProblem = "Could not reopen your last project. Its machine is no longer connected to this device."
            // Keep it when the machine list itself failed to load, so the next start tries again.
            if runtime.problem == nil { LastProject.forget() }
            return
        }
        let navigation = WorkspaceNavigation(
            workspace: MobileWorkspace(session: runtime.session(for: machine), projectID: last.projectID))
        restoring = navigation
        activeProject = navigation
    }

    private func retryRestore() {
        restoreProblem = nil
        restoreAttempted = false
        restoreLastProject()
    }

    private func closeProject() {
        activeProject = nil
        restoring = nil
        LastProject.forget()
    }

    private func openWorkspace(_ workspace: MobileWorkspace, view: String?) {
        guard isPad else {
            router.openProject(workspace, view: view)
            return
        }
        restoreProblem = nil
        restoring = nil
        LastProject.remember(machineID: workspace.session.machine.id, projectID: workspace.projectID)
        let navigation = WorkspaceNavigation(workspace: workspace)
        navigation.pendingViewID = view
        withAnimation(reduceMotion ? nil : .default) {
            runtime.notifications.destination = nil
            activeProject = navigation
        }
    }

    private func presentPendingPairing() {
        if pairAfterDismiss {
            pairAfterDismiss = false
            pairing = true
        }
    }

}

struct RecentProjectsPage: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    @State private var search = ""

    var body: some View {
        MobileList {
            let visible = projects.recent.filter { $0.matches(search) }
            if !visible.isEmpty {
                Section { ProjectLinks(runtime: runtime, rows: visible) }
                    .listSectionSeparator(.hidden, edges: .top)
            } else if projects.loading {
                MobileLoadingRow("Loading projects").frame(maxWidth: .infinity, minHeight: 120)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else if !search.isEmpty {
                ContentUnavailableView.search(text: search)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                ContentUnavailableView("No recently closed projects", lucideIcon: "clock-arrow-left")
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
        }
        .modifier(ProjectListWidth())
        .navigationTitle("Recently closed")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "Search projects or machines")
        .refreshable { await projects.refresh() }
    }
}

struct ProjectListWidth: ViewModifier {
    @Environment(\.horizontalSizeClass) private var sizeClass

    func body(content: Content) -> some View {
        if sizeClass == .regular {
            GeometryReader { geometry in
                let width = geometry.size.width - geometry.safeAreaInsets.leading - geometry.safeAreaInsets.trailing
                content.safeAreaPadding(.horizontal, max(0, (width - 760) / 2))
            }
        } else {
            content
        }
    }
}

struct ProjectLinks: View {
    let runtime: AppRuntime
    let rows: [UnifiedProjectRow]
    @Environment(\.openMobileWorkspace) private var openWorkspace
    var body: some View {
        ForEach(rows) { row in
            Button {
                openWorkspace(MobileWorkspace(session: runtime.session(for: row.machine), projectID: row.id.projectID))
            } label: {
                ProjectHomeRow(
                    summary: row.summary, machine: row.machine.name, connected: row.connected,
                    session: runtime.session(for: row.machine)
                )
                .modifier(MobileSidebarLabel())
            }
            .disabled(row.summary["available"] == .bool(false))
            .modifier(MobileSidebarRow())
            .accessibilityIdentifier("projects.project.\(row.id.projectID)")
        }
    }
}

struct ProjectHomeRow: View {
    let summary: JSONValue
    let machine: String
    let connected: Bool
    var session: SharedMachineSession? = nil
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if summary["icon"]?.text("kind") == "image", let session {
                ProjectArtwork(session: session, project: summary, size: 32)
            } else {
                ProjectHomeGlyph(summary: summary)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(summary.text("name", fallback: "Untitled project"))
                    .font(.callout).foregroundStyle(MobileStyle.text).lineLimit(1).truncationMode(.tail)
                HStack(spacing: 5) {
                    ProjectMachineGlyph(icon: session?.icons.icon)
                    Text(machine).truncationMode(.tail)
                    if !connected { Text("· Offline").fixedSize() }
                }.font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                if summary["available"] == .bool(false) {
                    Text("Folder unavailable").font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
        }.frame(minHeight: 44)
    }
}

private struct ProjectMachineGlyph: View {
    let icon: MachineIcon?
    @ScaledMetric(relativeTo: .caption) private var size = 12.0

    var body: some View {
        LucideIcon(name: icon?.value ?? "server", size: size).accessibilityHidden(true)
    }
}

private struct ProjectHomeGlyph: View {
    let summary: JSONValue
    private var initial: String {
        summary["icon"]?.text("kind") == "initial"
            ? summary["icon"]!.text("value") : String(summary.text("name").prefix(1)).uppercased()
    }
    var body: some View {
        Group {
            if summary["icon"]?.text("kind") == "lucide" {
                LucideIcon(name: summary["icon"]!.text("value"), size: 20)
                    .foregroundStyle(MobileStyle.accent)
            } else {
                Text(initial).font(.title3.weight(.semibold)).foregroundStyle(MobileStyle.accent)
            }
        }
        .frame(width: 32, height: 32)
        .accessibilityHidden(true)
    }
}

/// Every machine with how it is reached; a machine opens its projects, files, processes, usage and settings. The
/// iPhone's Machines tab pairs from its plus, the iPad's section from a row of its own.
struct MachinesPage: View {
    let runtime: AppRuntime
    var showsPairingRow = true
    let pair: () -> Void
    /// Opens a machine by its id, on whichever stack the page stands.
    let open: (String) -> Void

    var body: some View {
        MobileList {
            Section("Your machines") {
                ForEach(runtime.machines, id: \.id) { machine in
                    Button {
                        open(machine.id)
                    } label: {
                        MobileRow(
                            title: machine.name, subtitle: reach(runtime.session(for: machine)),
                            symbol: machine.icon?.value ?? "monitor"
                        )
                        .modifier(MobileSidebarLabel(disclosure: true))
                    }
                    .modifier(MobileSidebarRow())
                    .accessibilityIdentifier("machines.\(machine.id)")
                }
            }
            if showsPairingRow {
                Button(action: pair) {
                    Label("Use a pairing link", lucideIcon: "link").modifier(MobileSidebarLabel())
                }
                .modifier(MobileSidebarRow())
            }
        }
        .navigationTitle("Machines")
        .navigationBarTitleDisplayMode(UIDevice.current.userInterfaceIdiom == .pad ? .inline : .automatic)
    }

    private func reach(_ session: SharedMachineSession) -> String {
        if session.connected { return session.relayed == true ? "Connected via relay" : "Connected" }
        return session.problem ?? "Not connected"
    }
}

struct MachineRoutePage: View {
    let runtime: AppRuntime
    let machineID: String
    var requests: BarRequests? = nil

    var body: some View {
        if let machine = runtime.machines.first(where: { $0.id == machineID }) {
            MachineProjectsPage(session: runtime.session(for: machine), runtime: runtime, barRequests: requests)
        }
    }
}

private struct PresentationWindow: UIViewRepresentable {
    let found: (UIWindow?) -> Void
    func makeUIView(context: Context) -> Reader {
        let view = Reader()
        view.found = found
        return view
    }
    func updateUIView(_ view: Reader, context: Context) { view.found = found }
    final class Reader: UIView {
        var found: ((UIWindow?) -> Void)?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            found?(window)
        }
    }
}

private enum HomeSection: String, CaseIterable, Identifiable {
    case projects, machines, settings
    var id: Self { self }
    var title: String { rawValue.capitalized }
    var icon: String {
        switch self {
        case .projects: "folders"
        case .machines: "monitor"
        case .settings: "settings"
        }
    }
}
