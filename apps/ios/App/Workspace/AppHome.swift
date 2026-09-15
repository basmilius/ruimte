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
            projectSection("", rows: projects.open)
            projectSection("Recently closed", rows: projects.recent)
            if projects.open.isEmpty && projects.recent.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label(
                            runtime.machines.isEmpty ? "Your projects start here" : "Finding your projects",
                            systemImage: "square.stack")
                    } description: {
                        Text(
                            runtime.machines.isEmpty
                                ? "Connect your computer to pick up your projects and conversations."
                                : "Your projects appear here when your computer connects. Keep Ruimte open on it.")
                    } actions: {
                        if runtime.machines.isEmpty {
                            Button("Use a pairing link") { pairing = true }.buttonStyle(.borderedProminent)
                        } else {
                            Button("View machines") { machines = true }
                        }
                    }
                }.listRowBackground(Color.clear)
            } else if !search.isEmpty && filtered(projects.open + projects.recent).isEmpty {
                ContentUnavailableView.search(text: search).listRowBackground(Color.clear)
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
                    Label("Use a pairing link", systemImage: "link").font(.subheadline.weight(.medium))
                }
                Button {
                    machines = true
                } label: {
                    Label("\(runtime.machines.count) machines", systemImage: "desktopcomputer")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }.listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .contentMargins(.horizontal, 12, for: .scrollContent)
        .searchable(
            text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search projects or machines"
        )
        .refreshable {
            await runtime.refreshMachines()
            projects.reconcile(runtime: runtime)
            await projects.refresh()
        }
    }

    @ViewBuilder private func projectSection(_ title: String, rows: [UnifiedProjectRow]) -> some View {
        let visible = filtered(rows)
        if !visible.isEmpty {
            Section {
                ForEach(visible) { row in
                    NavigationLink {
                        WorkspacePage(
                            workspace: MobileWorkspace(
                                session: runtime.session(for: row.machine), projectID: row.summary.text("projectId")))
                    } label: {
                        ProjectHomeRow(summary: row.summary, machine: row.machine.name, connected: row.connected)
                    }
                    .disabled(row.summary["available"] == .bool(false))
                    .listRowInsets(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
                }
            } header: {
                if !title.isEmpty { Text(title) }
            }
        }
    }

    private func filtered(_ rows: [UnifiedProjectRow]) -> [UnifiedProjectRow] {
        rows.filter {
            search.isEmpty || $0.summary.text("name").localizedCaseInsensitiveContains(search)
                || $0.machine.name.localizedCaseInsensitiveContains(search)
        }
    }
}

struct ProjectHomeRow: View {
    let summary: JSONValue
    let machine: String
    let connected: Bool
    var body: some View {
        HStack(spacing: 14) {
            ProjectHomeGlyph(summary: summary)
            VStack(alignment: .leading, spacing: 5) {
                Text(summary.text("name", fallback: "Untitled project"))
                    .font(.body.weight(.semibold)).foregroundStyle(.primary).lineLimit(2)
                HStack(spacing: 5) {
                    Image(systemName: connected ? "desktopcomputer" : "wifi.slash")
                    Text(machine)
                    if !connected { Text("· Offline") }
                }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if summary["available"] == .bool(false) {
                    Text("Folder unavailable").font(.caption).foregroundStyle(.secondary)
                }
            }
        }.padding(.vertical, 2)
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
            } else {
                Text(initial).font(.title3.weight(.semibold)).foregroundStyle(MobileStyle.accent)
            }
        }
        .frame(width: 44, height: 44)
        .background(MobileStyle.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
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
