import RuimtePulsar
import SwiftUI
import UIKit

struct AppHome: View {
    @Bindable var runtime: AppRuntime
    @State private var projects = UnifiedProjects()
    @State private var window: UIWindow?
    @State private var settings = false
    @State private var pairing = false
    @State private var machines = false
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
        NavigationStack {
            Group {
                if hasWorkspace {
                    projectList
                } else {
                    WelcomePage(runtime: runtime, window: window) { pairing = true }
                }
            }
            .navigationTitle(hasWorkspace ? "Projects" : "")
            .toolbar {
                if hasWorkspace {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Settings", systemImage: "person.crop.circle") { settings = true }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button("Use a pairing link", systemImage: "link") { pairing = true }
                            Button("Machines", systemImage: "desktopcomputer") { machines = true }
                            if runtime.account == nil {
                                Button("Sign in", systemImage: "person.crop.circle") { signIn = true }
                            }
                        } label: {
                            Image(systemName: "plus").accessibilityLabel("Add or connect")
                        }
                    }
                }
            }
            .sheet(isPresented: $pairing) { PairMachinePage(runtime: runtime) }
            .sheet(isPresented: $settings) { MobileSettings(runtime: runtime) }
            .sheet(isPresented: $machines, onDismiss: presentPendingPairing) {
                MachinesSheet(runtime: runtime) { pairAfterDismiss = true }
            }
            .sheet(isPresented: $signIn, onDismiss: presentPendingPairing) {
                NavigationStack {
                    WelcomePage(runtime: runtime, window: window) {
                        pairAfterDismiss = true
                        signIn = false
                    }
                    .toolbar { Button("Done") { signIn = false } }
                }
            }
            .onChange(of: runtime.account?.id) { _, account in if account != nil { signIn = false } }
            .background(PresentationWindow { window = $0 }.frame(width: 0, height: 0))
            .task {
                await runtime.start()
                await runtime.notifications.restore()
            }
            .task(id: machineRevision) { projects.reconcile(runtime: runtime) }
            .navigationDestination(
                item: Binding(
                    get: { runtime.notifications.destination }, set: { runtime.notifications.destination = $0 })
            ) { destination in
                NotificationSessionPage(runtime: runtime, destination: destination)
            }
        }
        .id(runtime.account?.id ?? "signed-out")
        .task(id: runtime.attentionKeys) { await runtime.notifications.syncBadge(liveKeys: runtime.attentionKeys) }
        .onOpenURL { runtime.notifications.openActivityURL($0) }
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
        .onChange(of: phase, initial: true) { _, current in
            runtime.connections.setScene(sceneID, foreground: current != .background)
            if current == .active { Task { await runtime.notifications.syncBadge(liveKeys: runtime.attentionKeys) } }
        }
        .onDisappear {
            projects.stop()
            runtime.connections.setScene(sceneID, foreground: false)
        }
    }

    private func presentPendingPairing() {
        if pairAfterDismiss {
            pairAfterDismiss = false
            pairing = true
        }
    }

    private var projectList: some View {
        List {
            if !visibleProjects.isEmpty {
                Section {
                    ProjectLinks(runtime: runtime, rows: visibleProjects)
                }
                .listSectionSeparator(.hidden, edges: .top)
            } else if loadingProjects {
                Section {
                    ProgressView(
                        runtime.loading || projects.loading ? "Loading projects" : "Connecting to your computers"
                    )
                    .frame(maxWidth: .infinity, minHeight: 120)
                    .accessibilityIdentifier("projects.loading")
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else if !search.isEmpty {
                ContentUnavailableView.search(text: search)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ContentUnavailableView {
                        Label("No open projects", systemImage: "folder")
                    } description: {
                        Text(
                            runtime.machines.isEmpty
                                ? "Connect your computer to pick up your projects and conversations."
                                : "Open a project on your computer or choose one from Recently closed.")
                    } actions: {
                        if runtime.machines.isEmpty {
                            Button("Use a pairing link") { pairing = true }
                                .buttonStyle(.borderedProminent).foregroundStyle(MobileStyle.onAccent)
                        }
                    }
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            Section {
                NavigationLink {
                    RecentProjectsPage(runtime: runtime, projects: projects)
                } label: {
                    Label("Recently closed", systemImage: "clock.arrow.circlepath")
                        .foregroundStyle(.primary)
                }.accessibilityIdentifier("projects.recent")
            }
            if !projects.problems.isEmpty {
                Section("Connections") {
                    ForEach(runtime.machines.filter { projects.problems[$0.id] != nil }, id: \.id) { machine in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(machine.name).font(.subheadline.weight(.medium))
                            Text(projects.problems[machine.id] ?? "").font(.caption).foregroundStyle(.secondary)
                            Button("Reconnect") { runtime.session(for: machine).reconnect() }.font(.subheadline)
                        }
                    }
                }
            }
            if let problem = runtime.problem {
                Section { Text(problem).font(.callout).foregroundStyle(.red) }
            }
            Section {
                Button {
                    pairing = true
                } label: {
                    Label("Use a pairing link", systemImage: "link")
                }
                Button {
                    machines = true
                } label: {
                    Label("Machines", systemImage: "desktopcomputer")
                }
            }
        }
        .listStyle(.insetGrouped)
        .modifier(ProjectListWidth())
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
        List {
            let visible = projects.recent.filter { $0.matches(search) }
            if !visible.isEmpty {
                Section { ProjectLinks(runtime: runtime, rows: visible) }
                    .listSectionSeparator(.hidden, edges: .top)
            } else if projects.loading {
                ProgressView("Loading projects").frame(maxWidth: .infinity, minHeight: 120)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else if !search.isEmpty {
                ContentUnavailableView.search(text: search)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                ContentUnavailableView("No recently closed projects", systemImage: "clock.arrow.circlepath")
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
        }
        .listStyle(.insetGrouped)
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
                content.contentMargins(.horizontal, max(20, (geometry.size.width - 760) / 2), for: .scrollContent)
            }
        } else {
            content
        }
    }
}

private struct ProjectLinks: View {
    let runtime: AppRuntime
    let rows: [UnifiedProjectRow]
    var body: some View {
        ForEach(rows) { row in
            NavigationLink {
                WorkspacePage(
                    workspace: MobileWorkspace(
                        session: runtime.session(for: row.machine), projectID: row.id.projectID))
            } label: {
                ProjectHomeRow(
                    summary: row.summary, machine: row.machine.name, connected: row.connected,
                    session: runtime.session(for: row.machine))
            }
            .disabled(row.summary["available"] == .bool(false))
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
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
                    .font(.body).foregroundStyle(.primary).lineLimit(1).truncationMode(.tail)
                HStack(spacing: 5) {
                    ProjectMachineGlyph(icon: session?.icons.icon)
                    Text(machine).truncationMode(.tail)
                    if !connected { Text("· Offline").fixedSize() }
                }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if summary["available"] == .bool(false) {
                    Text("Folder unavailable").font(.caption).foregroundStyle(.secondary)
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
    let pair: () -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section("Your machines") {
                    ForEach(runtime.machines, id: \.id) { machine in
                        NavigationLink {
                            MachineProjectsPage(session: runtime.session(for: machine), runtime: runtime)
                        } label: {
                            MobileRow(
                                title: machine.name, subtitle: "Projects, files and settings", symbol: "desktopcomputer"
                            )
                        }
                    }
                }
                Button("Use a pairing link", systemImage: "link") {
                    dismiss()
                    pair()
                }
            }
            .navigationTitle("Machines")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
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

struct MobileSettings: View {
    let runtime: AppRuntime
    @Environment(\.dismiss) private var dismiss
    @AppStorage("ruimte.ios.appearance") private var appearance = "system"
    @AppStorage("ruimte.ios.terminalFontSize") private var fontSize = 14.0
    @AppStorage("ruimte.ios.showHiddenFiles") private var hiddenFiles = false
    @State private var confirmSignOut = false
    var body: some View {
        NavigationStack {
            Form {
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
                        .foregroundStyle(.secondary)
                }
            }.navigationTitle("Settings")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .confirmationDialog("Sign out on this device?", isPresented: $confirmSignOut) {
                    Button("Sign out", role: .destructive) {
                        Task {
                            await runtime.signOut()
                            dismiss()
                        }
                    }
                }
        }
    }
}
