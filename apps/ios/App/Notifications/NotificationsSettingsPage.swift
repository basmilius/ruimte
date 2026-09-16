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
                    "Receive updates from agents on all your machines and respond to approval requests when Ruimte is in the background."
                ).font(.footnote).foregroundStyle(MobileStyle.muted)
            }
            if coordinator.enabled {
                Section {
                    Toggle("Approval requests", isOn: $coordinator.approvals)
                    Text("Approval messages are encrypted for this device.")
                        .font(.footnote).foregroundStyle(MobileStyle.muted)
                }.onChange(of: coordinator.approvals) { Task { await coordinator.savePreferences() } }
            }

            if coordinator.supportsActivities {
                Section {
                    Toggle("Live Activity", isOn: $coordinator.activities)
                        .onChange(of: coordinator.activities) { Task { await coordinator.savePreferences() } }
                } footer: {
                    Text(
                        "Automatically shows working agents and agents needing your attention, grouped by machine. Enable notifications to keep Live Activities updated while Ruimte is closed."
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
