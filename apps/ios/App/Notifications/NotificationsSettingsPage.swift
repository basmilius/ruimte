import RuimtePulsar
import SwiftUI
import UIKit

/// What this phone is notified of: the kinds of notifications, the Live Activity and a choice per project. Every
/// machine is told with `push.subscribe`; a machine from before kinds and projects says it needs an update.
struct NotificationsSettingsPage: View {
    @Bindable var coordinator: NotificationCoordinator
    let projects: UnifiedProjects

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
            } footer: {
                Text("Notifications reach this iPhone while Ruimte is closed. Approval messages are encrypted for it.")
            }
            if coordinator.enabled {
                Section("Notify me when") {
                    kind(.needsYou, "An agent needs you", icon: "hand")
                    Toggle(isOn: $coordinator.approvals) {
                        Label("Answer approvals from the notification", lucideIcon: "shield-check")
                    }
                    .disabled(!coordinator.preferences.notify.contains(.needsYou))
                    kind(.turn, "A turn finishes", icon: "check")
                    kind(.process, "A process misbehaves", icon: "triangle-alert")
                }
                if !outdated.isEmpty {
                    Section {
                        Label(outdatedNotice, lucideIcon: "circle-alert").foregroundStyle(MobileStyle.muted)
                    }
                }
            }
            if coordinator.supportsActivities {
                Section {
                    Toggle(isOn: $coordinator.activities) {
                        Label("While agents work", lucideIcon: "loader")
                    }
                } header: {
                    Text("Live Activity")
                } footer: {
                    Text(
                        "Shows working agents and agents that need you, per machine. Turn on notifications to keep it updated while Ruimte is closed."
                    )
                }
            }
            if coordinator.enabled && !rows.isEmpty {
                Section {
                    ForEach(rows) { row in
                        projectRow(row)
                    }
                } header: {
                    Text("Per project")
                } footer: {
                    Text("Snoozed views stay quiet until their snooze ends, on every device.")
                }
            }
            if let problem = coordinator.problem {
                Section {
                    Text(problem).foregroundStyle(MobileStyle.statusError)
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
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await coordinator.restore()
            await coordinator.readPreferences()
        }
    }

    private var rows: [UnifiedProjectRow] { projects.open }

    private var outdated: [Machine] {
        coordinator.machines.filter { coordinator.outdatedMachines.contains($0.id) }
    }

    private var outdatedNotice: String {
        let names = ListFormatter.localizedString(byJoining: outdated.map(\.name))
        let verb = outdated.count == 1 ? "needs" : "need"
        return "\(names) \(verb) an update before these choices apply there. "
            + "Until then you hear only when an agent needs you."
    }

    private func kind(_ kind: PushNotifyKind, _ title: String, icon: String) -> some View {
        Toggle(
            isOn: Binding(
                get: { coordinator.preferences.notify.contains(kind) },
                set: { on in
                    if on {
                        coordinator.preferences.notify.insert(kind)
                    } else {
                        coordinator.preferences.notify.remove(kind)
                    }
                })
        ) {
            Label(title, lucideIcon: icon)
        }
    }

    private func projectRow(_ row: UnifiedProjectRow) -> some View {
        let machineID = row.machine.id
        let projectID = row.id.projectID
        return Picker(
            selection: Binding(
                get: { coordinator.preferences.choice(machineID: machineID, projectID: projectID) },
                set: { coordinator.preferences.set($0, machineID: machineID, projectID: projectID) })
        ) {
            ForEach(ProjectNotifyChoice.allCases, id: \.self) { choice in
                Text(choice.label).tag(choice)
            }
        } label: {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.summary.text("name", fallback: "Project")).lineLimit(1)
                    if coordinator.machines.count > 1 {
                        Text(row.machine.name).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    }
                }
            } icon: {
                Image(lucide: "folder")
            }
        }
        .pickerStyle(.menu)
    }
}
