import RuimtePulsar
import SwiftUI
import UIKit

/// What this phone is notified of: the kinds of notifications, the Live Activity and a choice per project. Every
/// machine is told with `push.subscribe`.
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
                Text("Get notified on this iPhone while Ruimte is closed.")
            }
            if coordinator.enabled {
                Section("Notify me when") {
                    kind(.needsYou, String(localized: "An agent needs you"), icon: "hand")
                    Toggle(isOn: $coordinator.approvals) {
                        Label(String(localized: "Approval requests"), lucideIcon: "shield-check")
                    }
                    .disabled(!coordinator.preferences.notify.contains(.needsYou))
                    kind(.turn, String(localized: "A turn finishes"), icon: "circle-check")
                    kind(.process, String(localized: "A process misbehaves"), icon: "triangle-alert")
                }
            }
            if coordinator.enabled {
                quietHoursSection
            }
            if coordinator.supportsActivities {
                Section {
                    Toggle(isOn: $coordinator.activities) {
                        Label(String(localized: "While agents work"), lucideIcon: "loader-circle")
                    }
                } header: {
                    Text("Live Activity")
                } footer: {
                    Text(
                        "Shows working agents and agents that need you, per machine. Turn on notifications to keep it updated while Ruimte is closed."
                    )
                }
            }
            if coordinator.enabled && !projects.open.isEmpty {
                Section {
                    ForEach(projects.open) { row in
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
                    Button("Try again") { Task { await coordinator.synchronize() } }
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

    /// Hours in which no machine pushes to this phone. They follow this phone's clock and time zone.
    private var quietHoursSection: some View {
        Section {
            Toggle(isOn: quietBinding(\.on)) {
                Label(String(localized: "Keep quiet in these hours"), lucideIcon: "moon")
            }
            if coordinator.preferences.quiet.on {
                HStack(spacing: 6) {
                    ForEach(1...7, id: \.self) { day in
                        dayChip(day)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(String(localized: "Days"))
                DatePicker(
                    String(localized: "From"), selection: timeBinding(\.start), displayedComponents: .hourAndMinute)
                DatePicker(
                    String(localized: "Until"), selection: timeBinding(\.end), displayedComponents: .hourAndMinute)
            }
        } header: {
            Text("Quiet hours")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text(
                    "No alert on this iPhone in these hours. Agents keep working, and what still waits is announced when they end."
                )
                if coordinator.preferences.quiet.on, !outdatedMachines.isEmpty {
                    Text("\(outdatedMachines.joined(separator: ", ")) needs an update to hold alerts in quiet hours.")
                        .foregroundStyle(MobileStyle.statusNeedsYou)
                }
            }
        }
    }

    private var outdatedMachines: [String] {
        coordinator.machines.filter { coordinator.machinesWithoutQuietHours.contains($0.id) }.map(\.name)
    }

    private func quietBinding<Value>(_ keyPath: WritableKeyPath<QuietHours, Value>) -> Binding<Value> {
        Binding(
            get: { coordinator.preferences.quiet[keyPath: keyPath] },
            set: { coordinator.preferences.quiet[keyPath: keyPath] = $0 })
    }

    /// A time of day as the picker wants it, a date today whose clock is the minutes.
    private func timeBinding(_ keyPath: WritableKeyPath<QuietHours, Int>) -> Binding<Date> {
        Binding(
            get: {
                let minutes = coordinator.preferences.quiet[keyPath: keyPath]
                return Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date())
                    ?? Date()
            },
            set: { date in
                let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                coordinator.preferences.quiet[keyPath: keyPath] = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
            })
    }

    private func dayChip(_ day: Int) -> some View {
        let listed = coordinator.preferences.quiet.days.contains(day)
        // ISO weekdays count from Monday and the calendar's symbols from Sunday.
        let name = Calendar.current.shortStandaloneWeekdaySymbols[day % 7]
        return Button {
            var days = coordinator.preferences.quiet.days
            if listed {
                // Hours on no day would be hours that are on and never quiet.
                if days.count > 1 { days.remove(day) }
            } else {
                days.insert(day)
            }
            coordinator.preferences.quiet.days = days
        } label: {
            Text(name)
                .font(.caption)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, minHeight: 32)
                .background(listed ? MobileStyle.active : Color.clear, in: Capsule())
                .overlay(Capsule().strokeBorder(MobileStyle.border))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(listed ? .isSelected : [])
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
                    Text(row.summary.text("name", fallback: String(localized: "Project"))).lineLimit(1)
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
