import RuimtePulsar
import SwiftUI

/// The page of a person without a machine yet, which offers to add one.
struct NoMachinesView: View {
    let description: Text
    let add: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(String(localized: "No machines yet"), lucideIcon: "server", iconSize: 48)
        } description: {
            description
        } actions: {
            Button("Add machine", action: add)
        }
    }
}

/// Every machine as a card: how it is reached and how fast, the limits of its CLIs and an update when one is there. A
/// machine opens its page; one that is away offers Retry. Add machine stands under the rows, and on the iPhone's
/// Machines tab the plus as well.
struct MachinesPage: View {
    let runtime: AppRuntime
    let addMachine: () -> Void
    /// Opens a machine by its id, on whichever stack the page stands.
    let open: (String) -> Void
    /// The machine the iPad shows beside the list, whose row is marked.
    var selectedID: String?

    var body: some View {
        MobileList {
            if runtime.machines.isEmpty {
                NoMachinesView(
                    description: Text("Add a machine to see its projects, devices and processes."), add: addMachine)
            } else {
                if showsLegend {
                    MachineLimitLegend().listRowInsets(MachinesPage.textInsets)
                }
                ForEach(runtime.machines.map { MachineItem(session: runtime.session(for: $0)) }) { item in
                    MachineSessionRow(session: item.session, selected: selectedID == item.id) { open(item.id) }
                        .mobileCard(padding: 0, filled: true)
                        .listRowInsets(NowSections.cardInsets)
                }
                Button(action: addMachine) {
                    Label(String(localized: "Add machine"), lucideIcon: "plus")
                }
                .buttonStyle(.mobileCapsule)
                .accessibilityIdentifier("machines.add")
                .listRowInsets(
                    EdgeInsets(
                        top: MobileSpacing.large, leading: MobileSpacing.margin, bottom: MobileSpacing.large,
                        trailing: MobileSpacing.margin))
            }
        }
        .navigationTitle("Machines")
        .navigationBarTitleDisplayMode(MobileDevice.isPad ? .inline : .automatic)
        .onAppear { AppUsage.screen(.screenMachines) }
    }

    /// A row of text alone, such as the legend, on the page's margin.
    static let textInsets = EdgeInsets(
        top: MobileSpacing.small, leading: MobileSpacing.margin, bottom: MobileSpacing.small,
        trailing: MobileSpacing.margin)

    /// The legend shows once some row has limits to read.
    private var showsLegend: Bool {
        runtime.machines.contains { machine in
            let session = runtime.session(for: machine)
            return session.connected && !MachineLimits.card(session.usageWidget).lines.isEmpty
        }
    }
}

private struct MachineItem: Identifiable {
    let session: SharedMachineSession

    var id: String { session.machine.id }
}

/// A machine's row as the session it has stands.
private struct MachineSessionRow: View {
    @Bindable var session: SharedMachineSession
    let selected: Bool
    let open: () -> Void

    var body: some View {
        MachineRow(
            name: session.endpoint.label ?? session.machine.name, icon: session.icons.icon?.value,
            reach: reach, connected: session.connected, update: session.endpoint.update?.installable == true,
            limits: session.connected ? MachineLimits.card(session.usageWidget) : MachineLimits(),
            selected: selected, retry: retries ? { session.reconnect() } : nil, open: open
        )
        .accessibilityIdentifier("machines.\(session.machine.id)")
        .task(id: session.connected) {
            if session.connected { await session.endpoint.followLatency() }
        }
    }

    private var retries: Bool { !session.connected && (session.failedAttempts > 0 || session.problem != nil) }

    private var reach: String {
        MachineReach.line(
            connected: session.connected, connecting: !retries, route: session.route,
            latency: session.endpoint.latency, problem: session.problem, lastSeen: session.lastSeen)
    }
}

/// A machine in the list: its mark, its name over how it is reached, Update when one is there, Retry while it is
/// away, and the limits of its accounts under the name.
struct MachineRow: View {
    let name: String
    let icon: String?
    let reach: String
    let connected: Bool
    var update = false
    var limits = MachineLimits()
    var selected = false
    var retry: (() -> Void)?
    let open: () -> Void
    @ScaledMetric(relativeTo: .subheadline) private var height = MobileMetrics.rowHeight
    @ScaledMetric(relativeTo: .subheadline) private var column = MobileMetrics.statusColumn

    var body: some View {
        HStack(spacing: MobileSpacing.medium) {
            Button(action: open) {
                VStack(alignment: .leading, spacing: MobileSpacing.small) {
                    HStack(spacing: MobileSpacing.medium) {
                        HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.medium) {
                            MobileStatusGlyph(tone: .idle, symbol: icon ?? "server")
                                .centeredOnFirstLine(of: .subheadline)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(verbatim: name).font(.subheadline.weight(.semibold))
                                    .foregroundStyle(connected ? MobileStyle.text : MobileStyle.muted)
                                    .lineLimit(1).truncationMode(.tail)
                                MobileStatus(
                                    title: reach, color: connected ? MobileStyle.positive : MobileStyle.faint)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if update {
                            Text("Update", comment: "Badge on a machine that has a newer version to install")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(MobileStyle.statusRunning)
                        }
                    }
                    if !limits.lines.isEmpty {
                        MachineLimitList(limits: limits).padding(.leading, column + MobileSpacing.medium)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
            if let retry {
                Button("Retry", action: retry).buttonStyle(.mobileCapsuleSmall)
            }
        }
        .padding(.horizontal, MobileSpacing.cardPadding)
        .padding(.vertical, MobileSpacing.medium)
        .frame(maxWidth: .infinity, minHeight: height, alignment: .leading)
        .background(selected ? MobileStyle.active : .clear, in: .rect(cornerRadius: MobileMetrics.cardRadius))
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
        if let session = runtime.session(machineID: machineID) {
            MachinePage(session: session, runtime: runtime, settingsLink: settingsLink)
        }
    }
}

/// The machines on an iPad: the cards and the machine picked among them side by side, while the sidebar stays the
/// project's.
struct PadMachinesPage: View {
    let runtime: AppRuntime
    let addMachine: () -> Void
    @Binding var selectedID: String?

    var body: some View {
        HStack(spacing: 0) {
            NavigationStack {
                MachinesPage(runtime: runtime, addMachine: addMachine, open: { selectedID = $0 }, selectedID: shownID)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button(action: addMachine) {
                                Image(lucide: "plus").accessibilityLabel("Add machine")
                            }
                        }
                    }
            }
            .frame(width: 340)
            MobileStyle.border.frame(width: 1).ignoresSafeArea()
            NavigationStack {
                if let shownID {
                    MachineRoutePage(runtime: runtime, machineID: shownID)
                } else {
                    ContentUnavailableView(
                        String(localized: "No machines yet"), lucideIcon: "server",
                        description: Text("Add a machine to see its projects, devices and processes."))
                }
            }
            .id(shownID)
        }
    }

    /// The machine picked, or the first one until a person picks.
    private var shownID: String? {
        if let selectedID, runtime.machines.contains(where: { $0.id == selectedID }) { return selectedID }
        return runtime.machines.first?.id
    }
}
