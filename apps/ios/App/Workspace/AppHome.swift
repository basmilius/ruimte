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
    @State private var pairing = false
    @State private var machines = false
    @State private var recentProjects = false
    @State private var signIn = false
    @State private var pairAfterDismiss = false
    @State private var search = ""
    @State private var sceneID = UUID().uuidString
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
            if usesSidebar { tabletNavigation } else { projectNavigation }
        }
        .environment(\.openMobileWorkspace, openWorkspace)
        .mobileSheet(isPresented: $pairing) { PairMachinePage(runtime: runtime) }
        .mobileSheet(isPresented: $settings) { MobileSettings(runtime: runtime) }
        .mobileSheet(isPresented: $machines, onDismiss: presentPendingPairing) {
            MachinesSheet(runtime: runtime) { pairAfterDismiss = true }
        }
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
            await runtime.start()
            await runtime.notifications.restore()
        }
        .task(id: machineRevision) { projects.reconcile(runtime: runtime) }
        .task(id: runtime.attentionKeys) { await runtime.notifications.syncBadge(liveKeys: runtime.attentionKeys) }
        .onOpenURL { runtime.notifications.openActivityURL($0) }
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
        .onChange(of: runtime.account?.id) { _, account in
            activeProject = nil
            if account != nil { signIn = false }
        }
        .onChange(of: runtime.notifications.destination) { _, destination in
            if destination != nil { activeProject = nil }
        }
        .onChange(of: phase, initial: true) { _, current in
            runtime.connections.setScene(sceneID, foreground: current != .background)
            if current == .active { Task { await runtime.notifications.syncBadge(liveKeys: runtime.attentionKeys) } }
        }
        .onDisappear {
            projects.stop()
            runtime.connections.setScene(sceneID, foreground: false)
        }
    }

    private var usesSidebar: Bool { UIDevice.current.userInterfaceIdiom == .pad && hasWorkspace }

    private var projectNavigation: some View {
        NavigationStack {
            homeContent
                .navigationDestination(item: $activeProject) { project in
                    WorkspacePage(navigation: project)
                }
                .navigationDestination(
                    item: Binding(
                        get: { runtime.notifications.destination }, set: { runtime.notifications.destination = $0 })
                ) { destination in
                    NotificationSessionPage(runtime: runtime, destination: destination)
                }
        }
        .containerBackground(MobileStyle.surface, for: .navigation)
    }

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
                .navigationDestination(item: $activeProject) { project in
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
                        NotificationSessionPage(runtime: runtime, destination: destination)
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
        .onChange(of: homeSection) { _, _ in detailPath = NavigationPath() }
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
            case .machines: MachinesSheet(runtime: runtime, embedded: true) { pairing = true }
            case .settings: MobileSettings(runtime: runtime, embedded: true)
            }
        }
    }

    private var homeContent: some View {
        Group {
            if hasWorkspace {
                projectList
            } else {
                WelcomePage(runtime: runtime, window: window) { pairing = true }
            }
        }
        .navigationTitle(hasWorkspace ? "Projects" : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if hasWorkspace {
                if !usesSidebar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Settings", lucideIcon: "circle-user-round") { settings = true }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Use a pairing link", lucideIcon: "link") { pairing = true }
                        Button("Machines", lucideIcon: "monitor") { showMachines() }
                        if runtime.account == nil {
                            Button("Sign in", lucideIcon: "circle-user-round") { signIn = true }
                        }
                    } label: {
                        Image(lucide: "plus").accessibilityLabel("Add or connect")
                    }
                }
            }
        }
    }

    private func openWorkspace(_ workspace: MobileWorkspace) {
        machines = false
        withAnimation(reduceMotion ? nil : .default) {
            activeProject = WorkspaceNavigation(workspace: workspace)
        }
    }

    private func showMachines() {
        if usesSidebar { homeSection = .machines } else { machines = true }
    }

    private func presentPendingPairing() {
        if pairAfterDismiss {
            pairAfterDismiss = false
            pairing = true
        }
    }

    private var projectList: some View {
        MobileList {
            if !visibleProjects.isEmpty {
                Section {
                    ProjectLinks(runtime: runtime, rows: visibleProjects)
                }
                .listSectionSeparator(.hidden, edges: .top)
            } else if loadingProjects {
                Section {
                    ProgressView().accessibilityLabel("Loading projects")
                        .frame(maxWidth: .infinity, minHeight: 120)
                        .accessibilityIdentifier("projects.loading")
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else if !search.isEmpty {
                ContentUnavailableView.search(text: search)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ContentUnavailableView {
                        Label("No open projects", lucideIcon: "folder", iconSize: 48)
                    } description: {
                        Text(
                            runtime.machines.isEmpty
                                ? "Connect your computer to pick up your projects and conversations."
                                : "Open a project on your computer or choose one from Recently closed.")
                    }
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            Section {
                MobileStyle.border.frame(height: 1).padding(.vertical, 10)
                    .listRowInsets(EdgeInsets(top: 0, leading: 28, bottom: 0, trailing: 28))
                    .accessibilityHidden(true)
                Button {
                    recentProjects = true
                } label: {
                    Label("Recently closed", lucideIcon: "clock-arrow-left")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .modifier(MobileSidebarLabel(disclosure: true))
                }
                .modifier(MobileSidebarRow())
                .accessibilityIdentifier("projects.recent")
            }
            if !projects.problems.isEmpty {
                Section("Connections") {
                    ForEach(runtime.machines.filter { projects.problems[$0.id] != nil }, id: \.id) { machine in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(machine.name).font(.subheadline.weight(.medium))
                            Text(projects.problems[machine.id] ?? "").font(.caption).foregroundStyle(MobileStyle.muted)
                            Button("Reconnect") { runtime.session(for: machine).reconnect() }.font(.subheadline)
                        }
                    }
                }
            }
            if let problem = runtime.problem {
                Section { Text(problem).font(.callout).foregroundStyle(.red) }
            }
        }
        .modifier(ProjectListWidth())
        .navigationDestination(isPresented: $recentProjects) {
            RecentProjectsPage(runtime: runtime, projects: projects)
        }
        .searchable(text: $search, prompt: "Search projects or machines")
        .toolbar {
            if (runtime.loading || projects.loading) && !visibleProjects.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    ProgressView().accessibilityLabel("Updating projects")
                }
            }
        }
        .refreshable {
            await runtime.refreshMachines()
            projects.reconcile(runtime: runtime)
            await projects.refresh()
        }
    }

    private var visibleProjects: [UnifiedProjectRow] { projects.open.filter { $0.matches(search) } }
    private var loadingProjects: Bool {
        runtime.loading || projects.loading
            || (projects.open.isEmpty && projects.recent.isEmpty && !runtime.machines.isEmpty
                && !projects.hasConnectedMachine && runtime.problem == nil && projects.problems.isEmpty)
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
                ProgressView().accessibilityLabel("Loading projects").frame(maxWidth: .infinity, minHeight: 120)
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

private struct ProjectListWidth: ViewModifier {
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

private struct ProjectLinks: View {
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
        Group {
            if let icon, icon.kind == .emoji {
                Text(icon.value).font(.system(size: size - 2)).frame(width: size, height: size)
            } else {
                LucideIcon(name: icon?.value ?? "server", size: size)
            }
        }.accessibilityHidden(true)
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
            if summary["icon"]?.text("kind") == "emoji" {
                Text(summary["icon"]!.text("value")).font(.title2)
            } else if summary["icon"]?.text("kind") == "lucide" {
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

private struct MachinesSheet: View {
    let runtime: AppRuntime
    var embedded = false
    let pair: () -> Void
    @State private var selectedMachine: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        if embedded { content } else { NavigationStack { content } }
    }
    private var content: some View {
        MobileList {
            Section("Your machines") {
                ForEach(runtime.machines, id: \.id) { machine in
                    Button {
                        selectedMachine = machine.id
                    } label: {
                        MobileRow(
                            title: machine.name, subtitle: "Projects, files and settings", symbol: "monitor"
                        )
                        .modifier(MobileSidebarLabel(disclosure: true))
                    }
                    .modifier(MobileSidebarRow())
                }
            }
            Button {
                if !embedded { dismiss() }
                pair()
            } label: {
                Label("Use a pairing link", lucideIcon: "link").modifier(MobileSidebarLabel())
            }
            .modifier(MobileSidebarRow())
        }
        .navigationDestination(item: $selectedMachine) { id in
            if let machine = runtime.machines.first(where: { $0.id == id }) {
                MachineProjectsPage(session: runtime.session(for: machine), runtime: runtime)
            }
        }
        .navigationTitle("Machines")
        .navigationBarTitleDisplayMode(UIDevice.current.userInterfaceIdiom == .pad ? .inline : .automatic)
        .toolbar { if !embedded { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } } }
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

struct MobileSettings: View {
    let runtime: AppRuntime
    var embedded = false
    @Environment(\.dismiss) private var dismiss
    @AppStorage("ruimte.ios.appearance") private var appearance = "system"
    @AppStorage("ruimte.ios.terminalFontSize") private var fontSize = 14.0
    @AppStorage("ruimte.ios.showHiddenFiles") private var hiddenFiles = false
    @State private var confirmSignOut = false
    var body: some View {
        if embedded { content } else { NavigationStack { content } }
    }
    private var content: some View {
        MobileForm {
            Section("Appearance") {
                Picker("Theme", selection: $appearance) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                Stepper("Terminal size: \(Int(fontSize))", value: $fontSize, in: 10...26).monospacedDigit()
            }
            Section("Files and agents") {
                Toggle("Show hidden files", isOn: $hiddenFiles)
            }
            Section("Notifications") {
                NavigationLink("Notifications and Live Activities") {
                    NotificationsSettingsPage(coordinator: runtime.notifications)
                }
            }
            Section("Account") {
                if let account = runtime.account {
                    LabeledContent("Signed in", value: account.login ?? account.provider.rawValue)
                }
                NavigationLink("Connection diagnostics") { ConnectionScreen(runtime: runtime) }
                if runtime.account != nil { Button("Sign out", role: .destructive) { confirmSignOut = true } }
            }
            Section("About") {
                LabeledContent(
                    "Ruimte", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
                )
                Text("Projects and sessions stay on your machines. This app connects to them remotely.")
                    .foregroundStyle(MobileStyle.muted)
            }
        }.navigationTitle("Settings")
            .navigationBarTitleDisplayMode(UIDevice.current.userInterfaceIdiom == .pad ? .inline : .automatic)
            .toolbar { if !embedded { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } } }
            .confirmationDialog("Sign out on this device?", isPresented: $confirmSignOut) {
                Button("Sign out", role: .destructive) {
                    Task {
                        await runtime.signOut()
                        if !embedded { dismiss() }
                    }
                }
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
