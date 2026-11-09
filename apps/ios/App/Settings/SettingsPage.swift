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
    @AppStorage(Settings.appearance) private var appearance
    @AppStorage(Settings.terminalFontSize) private var fontSize
    @AppStorage(Settings.showHiddenFiles) private var hiddenFiles
    @AppStorage(Settings.chatStreaming) private var streaming
    @AppStorage(UiMapSetting.key) private var mapTiles = true
    @AppStorage(ChatToolCallsSetting.key) private var hidesToolCalls = false

    var body: some View {
        NavigationStack { content }
            .onAppear { AppUsage.screen(.screenSettings) }
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
                // The setting hides; the row asks whether to show, so on means more, as on the desktop.
                Toggle(isOn: Binding(get: { !hidesToolCalls }, set: { hidesToolCalls = !$0 })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Show what an agent reads and runs")
                        Text("The files an agent read and the commands it ran.")
                            .font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                }
                .accessibilityIdentifier("settings.showToolCalls")
                Toggle(isOn: $mapTiles) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Map tiles")
                        Text(
                            "Draws maps in chats with Apple Maps, which sees the area you look at. Off, maps show only their places."
                        )
                        .font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                }
                .accessibilityIdentifier("settings.mapTiles")
                NavigationLink {
                    NotificationsSettingsPage(coordinator: runtime.notifications, projects: projects)
                } label: {
                    Label(String(localized: "Notifications and Live Activities"), lucideIcon: "bell")
                }
                if runtime.voice.declaresMicrophone {
                    NavigationLink {
                        VoiceSettingsPage(runtime: runtime)
                    } label: {
                        Label(String(localized: "Voice"), lucideIcon: "mic")
                    }
                    .accessibilityIdentifier("settings.voice")
                }
                ForEach(runtime.machines, id: \.id) { machine in
                    NavigationLink {
                        MachineAgentsPage(session: runtime.session(for: machine))
                    } label: {
                        Label(
                            String(localized: "Agents on \(machine.name)"),
                            lucideIcon: machine.icon?.value ?? "server")
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
                    Label(String(localized: "Connection diagnostics"), lucideIcon: "wifi")
                }
                NavigationLink {
                    AboutPage()
                } label: {
                    Label(String(localized: "About"), lucideIcon: "info")
                }
                .accessibilityIdentifier("settings.about")
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(role: .close) { dismiss() }
            }
        }
    }
}

/// The account on top of Settings: its picture or initial, its name and how it signed in, and how many machines this
/// phone reaches.
private struct AccountCard: View {
    let runtime: AppRuntime

    var body: some View {
        HStack(spacing: 12) {
            AccountPicture(account: runtime.account, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(AccountAvatar.title(of: runtime.account))
                    .font(.body.weight(.semibold)).lineLimit(1)
                Text(subtitle).font(.footnote).foregroundStyle(MobileStyle.muted).lineLimit(1)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let machines = runtime.machines.count
        guard let account = runtime.account else { return String(localized: "Sign in to reach your machines.") }
        return String(
            localized: "Signed in with \(AccountSettingsPage.providerName(account.provider)) · \(machines) machines",
            comment: "%@ is the sign-in provider, GitHub or Apple")
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
                Image(lucide: "user", size: size * 0.5).foregroundStyle(MobileStyle.muted)
            }
        }
        .frame(width: size, height: size)
        .background(MobileStyle.active, in: .circle)
        .clipShape(.circle)
        .accessibilityHidden(true)
        .task(id: account?.id) { await AccountPictures.shared.load(for: account) }
    }
}
