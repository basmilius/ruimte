import RuimtePulsar
import SwiftUI
import UIKit

struct AppHome: View {
    @Bindable var runtime: AppRuntime
    @State private var projects = UnifiedProjects()
    @State private var window: UIWindow?
    @State private var settings = false
    @State private var releaseNotes: ReleaseNotes?
    @State private var pairing = false
    @State private var signIn = false
    @State private var pairAfterDismiss = false
    @State private var now = NowModel()
    @State private var onboarding = Onboarding()
    @State private var router = PhoneRouter()
    @State private var padRouter = PadRouter()
    @State private var sceneID = UUID().uuidString
    @Environment(\.scenePhase) private var phase
    @AppStorage("ruimte.ios.appearance") private var appearance = "system"

    init(runtime: AppRuntime, projects: UnifiedProjects = UnifiedProjects()) {
        self.runtime = runtime
        _projects = State(initialValue: projects)
    }

    private var hasWorkspace: Bool { runtime.account != nil || !runtime.machines.isEmpty }
    private var onboardingStep: OnboardingStep {
        onboarding.step(
            signedIn: runtime.account != nil, machines: runtime.machines.count,
            notificationsEnabled: runtime.notifications.enabled)
    }
    private var machineRevision: String {
        ([runtime.key?.publicKey ?? "", String(runtime.connectionRevision)]
            + runtime.machines.map {
                "\($0.id):\($0.publicKey):\($0.brokerUrl ?? ""):\($0.name)"
            }).joined(separator: "|")
    }

    var body: some View {
        Group {
            if onboardingStep == .notifications {
                notificationStep
            } else if usesSidebar {
                PadHome(
                    runtime: runtime, projects: projects, now: now, router: padRouter,
                    showSettings: { settings = true }, pair: { pairing = true }, signIn: { signIn = true })
            } else if hasWorkspace {
                PhoneHome(
                    runtime: runtime, projects: projects, now: now, router: router,
                    showSettings: { settings = true }, pair: { pairing = true }, signIn: { signIn = true })
            } else {
                NavigationStack {
                    WelcomePage(runtime: runtime, window: window, pair: { pairing = true }, begin: onboarding.begin)
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
        }
        .task(id: machineRevision) {
            projects.reconcile(runtime: runtime)
            now.reconcile(runtime: runtime)
        }
        .onChange(of: now.entries) { _, entries in
            if now.loaded { ProjectWidgetRecorder.record(entries) }
        }
        .task(id: runtime.attentionKeys) { await runtime.notifications.syncBadge(liveKeys: runtime.attentionKeys) }
        .onOpenURL { runtime.notifications.openActivityURL($0) }
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
        .onChange(of: runtime.account?.id) { _, account in
            router = PhoneRouter()
            padRouter = PadRouter()
            if account != nil { signIn = false }
        }
        .onChange(of: runtime.notifications.enabled) { _, enabled in
            if enabled { onboarding.finish() }
        }
        .onChange(of: runtime.notifications.destination) { _, destination in
            guard let destination else { return }
            settings = false
            releaseNotes = nil
            pairing = false
            signIn = false
            if isPad {
                padRouter.open(destination)
            } else {
                router.open(destination)
            }
            runtime.notifications.destination = nil
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

    private var notificationStep: some View {
        NotificationStepPage(
            coordinator: runtime.notifications, onboarding: onboarding, machines: runtime.machines.map(\.name))
    }

    private func openWorkspace(_ workspace: MobileWorkspace, view: String?) {
        guard isPad else {
            // The stack animates its push itself. Inside an animation of ours the page's bar items would animate in
            // after it starts instead of being there for the bar to morph into.
            router.openProject(workspace, view: view)
            return
        }
        padRouter.openProject(workspace, view: view)
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
                MobileLoadingRow(String(localized: "Loading projects")).frame(maxWidth: .infinity, minHeight: 120)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else if !search.isEmpty {
                ContentUnavailableView.search(text: search)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                ContentUnavailableView(String(localized: "No recently closed projects"), lucideIcon: "clock-arrow-left")
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
                openWorkspace(
                    MobileWorkspace(
                        session: runtime.session(for: row.machine), projectID: row.id.projectID, summary: row.summary))
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
                Text(summary.text("name", fallback: String(localized: "Untitled project")))
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
