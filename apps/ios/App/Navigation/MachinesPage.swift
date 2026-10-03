import RuimtePulsar
import SwiftUI

/// Every machine as a card: how it is reached and how fast, the limits of its CLIs and an update when one is there. A
/// machine opens its page; one that is away offers Retry. A pairing link is the row at the end, and on the iPhone's
/// Machines tab the plus as well.
struct MachinesPage: View {
    let runtime: AppRuntime
    let pair: () -> Void
    /// Opens a machine by its id, on whichever stack the page stands.
    let open: (String) -> Void

    var body: some View {
        MobileForm {
            ForEach(runtime.machines, id: \.id) { machine in
                Section {
                    MachineCard(session: runtime.session(for: machine)) { open(machine.id) }
                }
            }
            Section {
                Button(action: pair) {
                    MachineLinkLabel(title: "Use a pairing link", icon: "link")
                }
                .foregroundStyle(MobileStyle.text)
            }
        }
        .listSectionSpacing(10)
        .navigationTitle("Machines")
        .navigationBarTitleDisplayMode(UIDevice.current.userInterfaceIdiom == .pad ? .inline : .automatic)
    }
}

private struct MachineCard: View {
    @Bindable var session: SharedMachineSession
    let open: () -> Void

    var body: some View {
        let lines = MachineLimitLine.lines(session.usageWidget.providers)
        Button(action: open) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 11) {
                    LucideIcon(name: session.icons.icon?.value ?? "server", size: 18)
                        .foregroundStyle(session.connected ? MobileStyle.text : MobileStyle.faint)
                        .frame(width: 36, height: 36)
                        .background(MobileStyle.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.endpoint.label ?? session.machine.name).font(.body.weight(.semibold))
                            .foregroundStyle(session.connected ? MobileStyle.text : MobileStyle.muted)
                            .lineLimit(1)
                        MobileStatus(title: reach, color: session.connected ? MobileStyle.positive : MobileStyle.faint)
                    }
                    Spacer(minLength: 8)
                    if session.endpoint.update?.installable == true {
                        Text("Update").font(.caption.weight(.semibold))
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .foregroundStyle(MobileStyle.statusRunning)
                            .background(MobileStyle.statusRunning.opacity(0.12), in: Capsule())
                    }
                    if retries {
                        Button("Retry") { session.reconnect() }
                            .font(.subheadline)
                            .buttonStyle(.borderless)
                    } else {
                        Image(lucide: "chevron-right", size: 13).foregroundStyle(MobileStyle.faint)
                            .accessibilityHidden(true)
                    }
                }
                if session.connected && !lines.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(lines) { MachineLimitRow(line: $0) }
                    }
                }
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("machines.\(session.machine.id)")
        .task(id: session.connected) {
            if session.connected { await session.endpoint.followLatency() }
        }
    }

    private var retries: Bool { !session.connected && (session.failedAttempts > 0 || session.problem != nil) }

    private var reach: String {
        MachineReach.line(
            connected: session.connected, connecting: !retries, relayed: session.relayed,
            latency: session.endpoint.latency, problem: session.problem, lastSeen: session.lastSeen)
    }
}

extension SharedMachineSession {
    /// When the machine was last there: for the address book or for this phone, whichever is later.
    var lastSeen: Date? {
        let book = machine.lastSeenAt.map { Date(timeIntervalSince1970: Double($0) / 1000) }
        return [book, endpoint.lastConnected].compactMap { $0 }.max()
    }
}

struct MachineRoutePage: View {
    let runtime: AppRuntime
    let machineID: String
    var settingsLink: SettingsLink?

    var body: some View {
        if let machine = runtime.machines.first(where: { $0.id == machineID }) {
            MachinePage(session: runtime.session(for: machine), runtime: runtime, settingsLink: settingsLink)
        }
    }
}
