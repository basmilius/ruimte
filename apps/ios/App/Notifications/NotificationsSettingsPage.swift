import RuimtePulsar
import SwiftUI
import UIKit

struct NotificationsSettingsPage: View {
    @Bindable var coordinator: NotificationCoordinator
    var body: some View {
        Form {
            Section {
                Toggle(
                    "Notifications",
                    isOn: Binding(
                        get: { coordinator.enabled },
                        set: { value in
                            Task { if value { await coordinator.enable() } else { await coordinator.disable() } }
                        })
                ).disabled(coordinator.busy)
                Text(
                    "Receive updates from followed sessions and respond to approval requests when Ruimte is in the background."
                ).font(.footnote).foregroundStyle(.secondary)
            }
            if coordinator.enabled {
                Section {
                    Toggle("Approval requests", isOn: $coordinator.approvals)
                    Toggle("Live Activities", isOn: $coordinator.activities)
                    Text(
                        "Live Activities show a session title and status on the Lock Screen. Approval messages are encrypted for this device."
                    ).font(.footnote).foregroundStyle(.secondary)
                }.onChange(of: coordinator.approvals) { Task { await coordinator.savePreferences() } }
                    .onChange(of: coordinator.activities) { Task { await coordinator.savePreferences() } }
                Section("Follow sessions") {
                    ForEach(coordinator.machines, id: \.id) { machine in
                        NavigationLink(machine.name) {
                            FollowMachineNotificationsPage(coordinator: coordinator, machine: machine)
                        }
                    }
                    if coordinator.machines.isEmpty {
                        Text("Sign in and add a machine to follow its sessions.").foregroundStyle(.secondary)
                    }
                }
            }
            if let problem = coordinator.problem {
                Section {
                    Text(problem).foregroundStyle(.red)
                    Button("Retry registration") { Task { await coordinator.synchronize() } }
                }
            }
            Section {
                Button("Open notification settings") {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
            }
        }.navigationTitle("Notifications")
            .task { await coordinator.restore() }
    }
}

private struct FollowMachineNotificationsPage: View {
    @Bindable var coordinator: NotificationCoordinator
    let machine: Machine
    @State private var sessions: [JSONValue] = []
    @State private var loading = true
    @State private var problem: String?
    var body: some View {
        List {
            if loading { ProgressView("Loading sessions") }
            if let problem { Text(problem).foregroundStyle(.red) }
            ForEach(sessions, id: \.stableID) { session in
                VStack(alignment: .leading, spacing: 10) {
                    Toggle(
                        session.text("title", fallback: session.text("name", fallback: session.stableID)),
                        isOn: Binding(
                            get: { coordinator.follows(machineID: machine.id, nodeID: session.stableID) },
                            set: { value in
                                Task {
                                    await coordinator.follow(
                                        machineID: machine.id, nodeID: session.stableID, enabled: value)
                                }
                            }))
                    Text(session.text("cwd")).font(.caption).foregroundStyle(.secondary)
                    if coordinator.activities {
                        Button("Show Live Activity", systemImage: "waveform.path") {
                            Task {
                                await coordinator.startActivity(
                                    machineID: machine.id, nodeID: session.stableID,
                                    title: session.text("title", fallback: "Agent session"))
                            }
                        }.font(.subheadline)
                    }
                }.padding(.vertical, 5)
            }
            if !loading && sessions.isEmpty { ContentUnavailableView("No active sessions", systemImage: "terminal") }
        }.navigationTitle(machine.name)
            .task { await load() }.refreshable { await load() }
    }
    private func load() async {
        loading = true
        defer { loading = false }
        do {
            sessions = try await coordinator.availableSessions(machine)
            problem = nil
        } catch { problem = error.localizedDescription }
    }
}
