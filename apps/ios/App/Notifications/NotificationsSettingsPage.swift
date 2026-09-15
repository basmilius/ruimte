import RuimtePulsar
import SwiftUI
import UIKit

struct NotificationsSettingsPage: View {
    @Bindable var coordinator: NotificationCoordinator
    var body: some View {
        MobileForm {
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
                ).font(.footnote).foregroundStyle(MobileStyle.muted)
            }
            if coordinator.enabled {
                Section {
                    Toggle("Approval requests", isOn: $coordinator.approvals)
                    Text("Approval messages are encrypted for this device.")
                        .font(.footnote).foregroundStyle(MobileStyle.muted)
                }.onChange(of: coordinator.approvals) { Task { await coordinator.savePreferences() } }
                Section("Follow sessions") {
                    ForEach(coordinator.machines, id: \.id) { machine in
                        NavigationLink(machine.name) {
                            FollowMachineNotificationsPage(coordinator: coordinator, machine: machine)
                        }
                    }
                    if coordinator.machines.isEmpty {
                        Text("Sign in and add a machine to follow its sessions.").foregroundStyle(MobileStyle.muted)
                    }
                }
            }
            if coordinator.supportsActivities {
                Section {
                    Toggle("Live Activity", isOn: $coordinator.activities)
                        .onChange(of: coordinator.activities) { Task { await coordinator.savePreferences() } }
                } footer: {
                    Text(
                        "Shows the last chat you opened on your Lock Screen and Dynamic Island. Opening another chat replaces it. Enable notifications to keep it updated while Ruimte is closed."
                    )
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
        MobileList {
            if loading { ProgressView().accessibilityLabel("Loading sessions") }
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
                    Text(session.text("cwd")).font(.caption).foregroundStyle(MobileStyle.muted)
                }.padding(.vertical, 5)
            }
            if !loading && sessions.isEmpty { ContentUnavailableView("No active sessions", lucideIcon: "terminal") }
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
