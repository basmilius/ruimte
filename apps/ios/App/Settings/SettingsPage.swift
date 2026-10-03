import RuimtePulsar
import SwiftUI
import UIKit

/// Settings, a sheet behind the avatar, a form sheet on an iPad. It holds the sections of the
/// desktop's settings that mean something on a phone: the account with its machines, appearance, agents with their
/// notifications, files, the connection and About. The sheet is opaque, since it is content and not a control.
struct MobileSettings: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    @Environment(\.dismiss) private var dismiss
    @AppStorage("ruimte.ios.appearance") private var appearance = "system"
    @AppStorage("ruimte.ios.terminalFontSize") private var fontSize = 14.0
    @AppStorage("ruimte.ios.showHiddenFiles") private var hiddenFiles = false
    @AppStorage("ruimte.chat.streaming") private var streaming: ChatStreamingMode = .words

    var body: some View {
        NavigationStack { content }
    }

    private var content: some View {
        MobileForm {
            Section {
                NavigationLink {
                    AccountSettingsPage(runtime: runtime, closeSettings: { dismiss() })
                } label: {
                    AccountCard(runtime: runtime)
                }
                .accessibilityIdentifier("settings.account")
            }
            Section("Appearance") {
                Picker("Theme", selection: $appearance) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.menu)
                Stepper(value: $fontSize, in: 10...26) {
                    LabeledContent("Terminal font size", value: "\(Int(fontSize))").monospacedDigit()
                }
            }
            Section("Agents") {
                Picker("Show replies", selection: $streaming) {
                    ForEach(ChatStreamingMode.allCases, id: \.self) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("settings.showReplies")
                NavigationLink("Notifications and Live Activities") {
                    NotificationsSettingsPage(coordinator: runtime.notifications, projects: projects)
                }
                ForEach(runtime.machines, id: \.id) { machine in
                    NavigationLink {
                        MachineAgentsPage(session: runtime.session(for: machine))
                    } label: {
                        Label("Agents on \(machine.name)", lucideIcon: machine.icon?.value ?? "monitor")
                    }
                }
            }
            Section("Files and Git") {
                Toggle("Show hidden files", isOn: $hiddenFiles)
            }
            Section {
                NavigationLink {
                    ConnectionScreen(runtime: runtime)
                } label: {
                    Label("Connection diagnostics", lucideIcon: "wifi")
                }
                NavigationLink {
                    AboutPage()
                } label: {
                    Label("About", lucideIcon: "info")
                }
                .accessibilityIdentifier("settings.about")
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(role: .confirm) { dismiss() }
            }
        }
    }
}

/// The account on top of Settings: its picture or initial, its name and how it signed in, and how many machines this
/// phone reaches. Without an account the phone only reaches machines it paired with a link.
private struct AccountCard: View {
    let runtime: AppRuntime

    var body: some View {
        HStack(spacing: 12) {
            AccountPicture(account: runtime.account, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(AccountAvatar.name(of: runtime.account) ?? "Not signed in")
                    .font(.body.weight(.semibold)).lineLimit(1)
                Text(subtitle).font(.footnote).foregroundStyle(MobileStyle.muted).lineLimit(1)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let machines = runtime.machines.count == 1 ? "1 machine" : "\(runtime.machines.count) machines"
        guard let account = runtime.account else { return "Paired with a link · \(machines)" }
        return "Signed in with \(AccountSettingsPage.providerName(account.provider)) · \(machines)"
    }
}

/// The account's picture in a circle of its own size, else its initial, else the person mark.
struct AccountPicture: View {
    let account: Account?
    let size: CGFloat

    var body: some View {
        Group {
            if let picture = AccountPictures.shared.picture(for: account) {
                Image(uiImage: picture).resizable().scaledToFill()
            } else if let initial = AccountAvatar.initial(of: AccountAvatar.name(of: account)) {
                Text(initial).font(.system(size: size * 0.4, weight: .semibold)).foregroundStyle(MobileStyle.text)
            } else {
                Image(lucide: "circle-user-round", size: size * 0.5).foregroundStyle(MobileStyle.muted)
            }
        }
        .frame(width: size, height: size)
        .background(MobileStyle.active, in: .circle)
        .clipShape(.circle)
        .accessibilityHidden(true)
        .task(id: account?.id) { await AccountPictures.shared.load(for: account) }
    }
}
