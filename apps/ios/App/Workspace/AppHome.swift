import RuimtePulsar
import SwiftUI
import UIKit

struct AppHome: View {
    @Bindable var runtime: AppRuntime
    @State private var window: UIWindow?
    @State private var settings = false
    @State private var pairing = false
    @State private var sceneID = UUID().uuidString
    @Environment(\.scenePhase) private var phase
    @AppStorage("ruimte.ios.appearance") private var appearance = "system"

    var body: some View {
        NavigationStack {
            List {
                if runtime.account != nil || !runtime.machines.isEmpty {
                    if let account = runtime.account {
                        Section {
                            HStack(spacing: 12) {
                                MobileIcon(symbol: "person.crop.circle", color: .secondary)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(account.login ?? "Your account").font(.subheadline.weight(.semibold))
                                    Text("Your workspace, connected.").font(.caption).foregroundStyle(.secondary)
                                }
                            }.padding(.vertical, 4)
                        }
                    }
                    Section("Your machines") {
                        ForEach(runtime.machines, id: \.id) { machine in
                            NavigationLink {
                                MachineProjectsPage(session: runtime.session(for: machine), runtime: runtime)
                            } label: {
                                MobileRow(
                                    title: machine.name,
                                    subtitle: machine.brokerUrl == nil
                                        ? "Remote connection unavailable" : "Projects and sessions",
                                    symbol: "desktopcomputer")
                            }.disabled(machine.brokerUrl == nil)
                        }
                        if runtime.machines.isEmpty {
                            ContentUnavailableView(
                                "No machines yet", systemImage: "desktopcomputer",
                                description: Text("Sign in to Ruimte on your computer to add it to this account."))
                        }
                    }
                    Section {
                        Button("Refresh machines", systemImage: "arrow.clockwise") {
                            Task { await runtime.refreshMachines() }
                        }
                        .font(.subheadline)
                        .listRowBackground(Color.clear)
                    }
                } else {
                    Section {
                        WelcomeHeader()
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 24, leading: 0, bottom: 28, trailing: 0))
                    }
                    Section {
                        if runtime.loading { ProgressView("Loading your account") }
                        ForEach(runtime.providers, id: \.rawValue) { provider in
                            Button {
                                guard let window else { return }
                                Task { await runtime.signIn(provider, window: window) }
                            } label: {
                                Label(
                                    provider == .apple ? "Continue with Apple" : "Continue with GitHub",
                                    systemImage: provider == .apple ? "apple.logo" : "arrow.right"
                                )
                                .font(.body.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 36)
                            }
                            .buttonStyle(.borderedProminent)
                            .labelStyle(.titleAndIcon)
                            .foregroundStyle(Color(uiColor: .systemBackground))
                            .buttonBorderShape(.roundedRectangle(radius: 14))
                            .disabled(runtime.signingIn || window == nil)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 5, leading: 0, bottom: 5, trailing: 0))
                        }
                        if runtime.signingIn {
                            ProgressView("Signing in")
                            Button("Cancel") { runtime.cancelSignIn() }
                        }
                        if runtime.providers.isEmpty && !runtime.loading {
                            Button("Try again") { Task { await runtime.start() } }
                        }
                    }
                }
                if let problem = runtime.problem {
                    Section { Text(problem).foregroundStyle(.red).textSelection(.enabled) }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Ruimte")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Add machine", systemImage: "plus") { pairing = true }
                    Button("Settings", systemImage: "gearshape") { settings = true }
                }
            }
            .refreshable { await runtime.refreshMachines() }
            .sheet(isPresented: $pairing) { PairMachinePage(runtime: runtime) }
            .sheet(isPresented: $settings) { MobileSettings(runtime: runtime) }
            .background(PresentationWindow { window = $0 }.frame(width: 0, height: 0))
            .task {
                await runtime.start()
                await runtime.notifications.restore()
            }
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
        .onDisappear { runtime.connections.setScene(sceneID, foreground: false) }
    }
}

struct WelcomeHeader: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Image(systemName: "square.stack.3d.up")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(MobileStyle.accent)
                .frame(width: 72, height: 72)
                .background(MobileStyle.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 22))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 12) {
                Text("Make room\nfor your work.")
                    .font(.largeTitle.weight(.bold))
                    .tracking(-0.8)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Your projects, agents and terminals.\nRight where you left them.")
                    .font(.body).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 18) {
                Label("Your machines", systemImage: "desktopcomputer")
                Label("Your workspace", systemImage: "square.stack")
            }.font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
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
