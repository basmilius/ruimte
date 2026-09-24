import RuimtePulsar
import SwiftUI
import UIKit

struct ConnectionScreen: View {
    @Bindable var runtime: AppRuntime
    @State private var probe = ConnectionProbe()
    @State private var sceneID = UUID().uuidString
    @State private var window: UIWindow?
    @Environment(\.scenePhase) private var phase

    var body: some View {
        NavigationStack {
            MobileList {
                Section {
                    Text("Connect to one of your machines to test sign-in, WebRTC and reconnecting.")
                        .foregroundStyle(MobileStyle.muted)
                    LabeledContent("Protocol", value: String(WireConstants.protocolVersion))
                    Toggle("Require relay for this test", isOn: $runtime.relayOnly)
                        .onChange(of: runtime.relayOnly) { _, _ in probe.reconnect(runtime: runtime) }
                } header: {
                    Text("Connection test")
                }
                Section("Account") {
                    if let account = runtime.account {
                        LabeledContent("Signed in", value: account.login ?? account.provider.rawValue.capitalized)
                        Button("Refresh machines") { Task { await runtime.refreshMachines() } }
                        Button("Sign out", role: .destructive) {
                            probe.disconnect()
                            Task { await runtime.signOut() }
                        }
                    } else if runtime.loading {
                        MobileLoadingRow("Loading sign-in options")
                    } else {
                        ForEach(runtime.providers, id: \.rawValue) { provider in
                            Button(provider == .github ? "Continue with GitHub" : "Continue with Apple") {
                                guard let window else { return }
                                Task { await runtime.signIn(provider, window: window) }
                            }
                            .disabled(runtime.signingIn || runtime.signingOut || window == nil)
                        }
                        if runtime.providers.isEmpty {
                            Text("No sign-in providers are available.").foregroundStyle(MobileStyle.muted)
                            Button("Retry") { Task { await runtime.start() } }
                        }
                        if runtime.signingIn {
                            MobileLoadingRow("Signing in")
                            Button("Cancel sign-in") { runtime.cancelSignIn() }
                        }
                        if runtime.signingOut { MobileLoadingRow("Signing out") }
                    }
                    if let problem = runtime.problem {
                        Text(problem).foregroundStyle(.red).textSelection(.enabled)
                    }
                }
                if runtime.account != nil {
                    Section("Machines") {
                        if runtime.machines.isEmpty {
                            Text("No machines on this account.").foregroundStyle(MobileStyle.muted)
                        }
                        ForEach(runtime.machines, id: \.id) { machine in
                            Button {
                                probe.connect(machine, runtime: runtime)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(machine.name)
                                    Text(machine.brokerUrl == nil ? "No broker configured" : machine.id)
                                        .font(.caption).foregroundStyle(MobileStyle.muted)
                                }
                            }
                            .disabled(machine.brokerUrl == nil)
                        }
                    }
                }
                if let machine = probe.machine {
                    Section(machine.name) {
                        LabeledContent("Status", value: probe.status)
                        LabeledContent(
                            "Selected ICE path",
                            value: probe.relayed.map { $0 ? "Via relay" : "Direct" } ?? "Not measured")
                        if let elapsed = probe.elapsedMilliseconds {
                            LabeledContent("Connection to server.hello", value: "\(elapsed) ms").monospacedDigit()
                        }
                        Button("Reconnect") { probe.reconnect(runtime: runtime) }
                        Button("Disconnect", role: .destructive) { probe.disconnect() }
                    }
                }
                if let hello = probe.hello {
                    Section("server.hello") {
                        LabeledContent("Version", value: hello.version)
                        LabeledContent("Platform", value: hello.platform)
                        if let model = hello.model { LabeledContent("Model", value: model) }
                        LabeledContent("Home", value: hello.home)
                    }
                    .textSelection(.enabled)
                }
                if !probe.history.isEmpty {
                    Section("Recent checks") {
                        ForEach(Array(probe.history.enumerated()), id: \.offset) { _, entry in
                            Text(entry).font(.caption.monospaced()).textSelection(.enabled)
                        }
                    }
                }
                if let publicKey = runtime.key?.publicKey {
                    Section("Device key") {
                        Text(publicKey).font(.caption.monospaced()).textSelection(.enabled)
                        Text("Match this public key in the machine's Apps with access list.").font(.caption)
                            .foregroundStyle(MobileStyle.muted)
                    }
                }
            }
            .navigationTitle("Ruimte")
            .background(WindowReader { window = $0 }.frame(width: 0, height: 0))
            .task { await runtime.start() }
            .onChange(of: phase, initial: true) { previous, current in
                if previous == .background && current != .background { probe.foregrounded() }
                runtime.connections.setScene(sceneID, foreground: current != .background)
            }
            .onChange(of: runtime.account?.id) { _, accountID in
                if accountID == nil { probe.disconnect() }
            }
            .onDisappear {
                probe.disconnect()
                runtime.relayOnly = false
                runtime.connections.setScene(sceneID, foreground: false)
            }
        }
    }
}

private struct WindowReader: UIViewRepresentable {
    let found: (UIWindow?) -> Void
    func makeUIView(context: Context) -> WindowView {
        let view = WindowView()
        view.found = found
        return view
    }
    func updateUIView(_ view: WindowView, context: Context) { view.found = found }
    final class WindowView: UIView {
        var found: ((UIWindow?) -> Void)?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            found?(window)
        }
    }
}
