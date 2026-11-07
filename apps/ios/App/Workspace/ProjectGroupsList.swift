import RuimtePulsar
import RuimteShared
import SwiftUI

/// The iPhone's open projects under the machine each is on, with how that machine is reached, and the machine's Chats
/// among them.
struct ProjectGroupsList: View {
    let runtime: AppRuntime
    let groups: [ProjectMachineGroup]
    /// A card per machine as the iPhone's Projects tab draws them, instead of the rows of the iPad's sidebar.
    var cards = false
    @Environment(\.openMobileWorkspace) private var openWorkspace

    var body: some View {
        if cards {
            ProjectMachineCards(groups: groups, session: runtime.session(for:)) { overview in
                openWorkspace(overview.row.workspace(runtime))
            }
        } else {
            sidebarRows
        }
    }

    private var sidebarRows: some View {
        ForEach(groups) { group in
            Section {
                // A row and not the section's header: a plain list pins its headers, and they piled up under the bar.
                MachineLinkStateHeading(
                    machine: group.machine, icon: runtime.session(for: group.machine).icons.icon?.value,
                    reach: group.reach
                )
                .listRowInsets(EdgeInsets(top: 0, leading: 28, bottom: 2, trailing: 18))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                ForEach(group.rows) { overview in
                    Button {
                        openWorkspace(overview.row.workspace(runtime))
                    } label: {
                        ProjectOverviewLabel(
                            overview: overview, session: runtime.session(for: overview.row.machine),
                            offline: group.reach == .offline
                        )
                        .modifier(MobileSidebarLabel())
                    }
                    .modifier(MobileSidebarRow())
                    .accessibilityIdentifier(overview.accessibilityID)
                }
            }
            .listSectionSeparator(.hidden)
        }
    }
}

/// A machine's name over its projects, with a green dot while it answers and "via relay" when it answers through
/// one.
struct MachineLinkStateHeading: View {
    let machine: Machine
    let icon: String?
    let reach: MachineLinkState
    @ScaledMetric(relativeTo: .caption) private var glyph = 12.0

    var body: some View {
        HStack(spacing: 7) {
            LucideIcon(name: icon ?? machine.icon?.value ?? "server", size: glyph).accessibilityHidden(true)
            Text(machine.name).lineLimit(1).truncationMode(.tail)
            switch reach {
            case .connected(let relayed):
                if relayed { Text("via relay").foregroundStyle(MobileStyle.faint).fontWeight(.medium) }
                Circle().fill(MobileStyle.positive).frame(width: 6, height: 6).padding(.leading, 2)
                    .accessibilityLabel(relayed ? "Connected via relay" : "Connected")
            case .connecting:
                Text("Connecting").foregroundStyle(MobileStyle.faint).fontWeight(.medium)
            case .offline:
                Text("Offline").foregroundStyle(MobileStyle.faint).fontWeight(.medium)
            }
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(MobileStyle.muted)
        .textCase(nil)
        .padding(.top, 10)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

struct ProjectOverviewLabel: View {
    let overview: ProjectOverviewRow
    let session: SharedMachineSession
    var offline = false

    var body: some View {
        HStack(spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                ProjectBadge(
                    summary: overview.row.summary, session: session, chats: overview.isChats, size: 20, tile: false
                )
                .frame(width: 32)
                .centeredOnFirstLine(of: .body)
                VStack(alignment: .leading, spacing: 1) {
                    Text(overview.title)
                        .foregroundStyle(offline ? MobileStyle.muted : MobileStyle.text)
                        .lineLimit(1).truncationMode(.tail)
                    if let detail = overview.detail {
                        Text(detail).font(.caption).foregroundStyle(MobileStyle.muted)
                            .lineLimit(1).truncationMode(.middle)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let activity = overview.activity {
                if activity.needsYou > 0 {
                    Text("\(activity.needsYou)").font(.footnote.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(MobileStyle.statusNeedsYou)
                        .accessibilityLabel("\(activity.needsYou) need you")
                }
                if activity.working > 0 {
                    Spinner(size: 12, label: String(localized: "Working")).foregroundStyle(MobileStyle.statusRunning)
                }
            }
        }
        .frame(minHeight: 40)
        .accessibilityElement(children: .combine)
    }
}

/// The open projects of every machine as cards, each under the machine's name and how it is reached. The name is a
/// row of the list, not a section's header, so it scrolls with its card instead of pinning under the bar.
struct ProjectMachineCards: View {
    let groups: [ProjectMachineGroup]
    let session: (Machine) -> SharedMachineSession
    let open: (ProjectOverviewRow) -> Void

    var body: some View {
        ForEach(Array(groups.enumerated()), id: \.element.id) { index, group in
            Section {
                ProjectMachineHeading(machine: group.machine, session: session(group.machine), reach: group.reach)
                    .listRowInsets(
                        EdgeInsets(
                            top: index == 0 ? 0 : MobileSpacing.large, leading: MobileSpacing.margin, bottom: 0,
                            trailing: MobileSpacing.margin))
                ProjectCardRows(rows: group.rows, session: session, offline: group.reach == .offline, open: open)
            }
        }
    }
}

/// The rows of one card of projects. A machine that does not answer offers Reconnect on its first row.
struct ProjectCardRows: View {
    let rows: [ProjectOverviewRow]
    let session: (Machine) -> SharedMachineSession
    var offline = false
    let open: (ProjectOverviewRow) -> Void

    var body: some View {
        MobileRowGroup(items: rows) { overview in
            let machineSession = session(overview.row.machine)
            HStack(spacing: 0) {
                Button {
                    open(overview)
                } label: {
                    ProjectCardRow(overview: overview, session: machineSession, offline: offline)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(overview.accessibilityID)
                if offline && overview.id == rows.first?.id {
                    Button("Reconnect") { machineSession.reconnect() }
                        .buttonStyle(.mobileCapsuleSmall)
                        .padding(.trailing, MobileSpacing.cardPadding)
                }
            }
        }
        .listRowInsets(NowSections.cardInsets)
    }
}

/// A machine's name over its card, with its round trip while it answers and since when it is gone once it does not.
struct ProjectMachineHeading: View {
    let machine: Machine
    let session: SharedMachineSession
    let reach: MachineLinkState
    @ScaledMetric(relativeTo: .subheadline) private var glyph = 14.0

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.small) {
            LucideIcon(name: session.icons.icon?.value ?? machine.icon?.value ?? "server", size: glyph)
                .foregroundStyle(MobileStyle.muted)
                .centeredOnFirstLine(of: .subheadline)
                .accessibilityHidden(true)
            Text(verbatim: machine.name).font(.subheadline.weight(.semibold))
                .foregroundStyle(reach == .offline ? MobileStyle.muted : MobileStyle.text)
                .lineLimit(1).truncationMode(.tail)
            Spacer(minLength: MobileSpacing.small)
            HStack(spacing: 6) {
                Circle().fill(reach == .offline || reach == .connecting ? MobileStyle.faint : MobileStyle.positive)
                    .frame(width: 7, height: 7)
                Text(verbatim: state).monospacedDigit().lineLimit(1)
            }
            .font(.footnote)
            .foregroundStyle(MobileStyle.muted)
        }
        .padding(.top, MobileSpacing.small)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .task(id: reach) {
            if case .connected = reach { await session.endpoint.followLatency() }
        }
    }

    private var state: String {
        ProjectMachineHeading.state(reach: reach, latency: session.endpoint.latency, lastSeen: session.lastSeen)
    }

    static func state(reach: MachineLinkState, latency: Int?, lastSeen: Date?, now: Date = .now) -> String {
        switch reach {
        case .connected(let relayed):
            guard let latency else { return relayed ? String(localized: "via relay") : String(localized: "Connected") }
            let time = String(localized: "\(latency) ms", comment: "A round trip to a machine in milliseconds")
            return relayed
                ? String(localized: "via relay · \(time)", comment: "%@ is a round trip, such as 12 ms") : time
        case .connecting:
            return String(localized: "Connecting")
        case .offline:
            guard let lastSeen else { return String(localized: "Offline") }
            return String(
                localized: "Offline since \(Format.moment(lastSeen, now: now))",
                comment: "%@ is when the machine was last connected, such as 06:12")
        }
    }
}

/// A project in its machine's card: its mark, its name, and the branch with what waits and works, with a dot for
/// each node that waits and the spinner while one works. Chats counts its chats instead.
struct ProjectCardRow: View {
    let overview: ProjectOverviewRow
    let session: SharedMachineSession
    var offline = false
    @ScaledMetric(relativeTo: .subheadline) private var column = MobileMetrics.statusColumn
    @ScaledMetric(relativeTo: .caption) private var branchGlyph = 11.0

    var body: some View {
        MobileCardRow {
            ProjectBadge(
                summary: overview.row.summary, session: session, chats: overview.isChats, size: column.rounded(),
                tile: false
            )
            .opacity(offline ? 0.6 : 1)
            .frame(width: column)
            .centeredOnFirstLine(of: .subheadline)
        } text: {
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: overview.title).font(.subheadline.weight(overview.isChats ? .regular : .semibold))
                    .foregroundStyle(offline ? MobileStyle.muted : MobileStyle.text)
                    .lineLimit(1).truncationMode(.tail)
                if !overview.isChats, let detail = overview.detail {
                    HStack(spacing: MobileSpacing.xSmall) {
                        if overview.git?.branch != nil {
                            LucideIcon(name: "git-branch", size: branchGlyph).accessibilityHidden(true)
                        }
                        Text(verbatim: detail).lineLimit(1).truncationMode(.middle)
                    }
                    .font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
        } trailing: {
            trailing
        }
    }

    @ViewBuilder private var trailing: some View {
        if overview.isChats {
            if let chats = overview.activity?.chats, chats > 0 {
                MobileRowValue(text: Format.number(Double(chats)))
            }
        } else if !offline, let activity = overview.activity {
            HStack(spacing: 3) {
                ForEach(0..<min(activity.needsYou, 3), id: \.self) { _ in
                    Circle().fill(MobileStyle.statusNeedsYou).frame(width: 7, height: 7)
                }
                if activity.working > 0 {
                    Spinner(size: 12, label: String(localized: "Working")).foregroundStyle(MobileStyle.statusRunning)
                        .padding(.leading, activity.needsYou > 0 ? 3 : 0)
                }
            }
            .accessibilityHidden(true)
        }
    }
}

/// A project's mark at the size of a list row: its initial on its own color, the symbol picked for it, or the image
/// its folder declares.
struct ProjectBadge: View {
    let summary: ProjectSummary
    let session: SharedMachineSession
    var chats = false
    var size: CGFloat = 26
    /// Without the tile, the mark stands in a list's icon column as the other rows' icons do.
    var tile = true

    var body: some View {
        if tile { tiled } else { bare }
    }

    private var bare: some View {
        Group {
            if chats {
                Image(lucide: "messages-square", size: size)
            } else if case .image = summary.icon {
                ProjectArtwork(session: session, project: summary, size: size, inset: 0)
            } else if case .lucide(let icon) = summary.icon {
                Image(lucide: icon.value, size: size)
            } else {
                Text(initial)
                    .font(.system(size: (size * 0.8).rounded(), weight: .bold))
                    .foregroundStyle(Color(projectHex: summary.color) ?? MobileStyle.accent)
            }
        }
        .frame(width: size, height: size)
        .foregroundStyle(MobileStyle.text)
        .accessibilityHidden(true)
    }

    private var tiled: some View {
        let corner = (size * 0.27).rounded()
        return Group {
            if chats {
                LucideIcon(name: "messages-square", size: (size * 0.54).rounded())
                    .frame(width: size, height: size).background(MobileStyle.hover, in: .rect(cornerRadius: corner))
            } else if case .image = summary.icon {
                ProjectArtwork(session: session, project: summary, size: size)
                    .background(MobileStyle.hover, in: .rect(cornerRadius: corner))
            } else if case .lucide(let icon) = summary.icon {
                LucideIcon(name: icon.value, size: (size * 0.54).rounded())
                    .frame(width: size, height: size).background(MobileStyle.hover, in: .rect(cornerRadius: corner))
            } else {
                Text(initial)
                    .font(.system(size: (size * 0.5).rounded(), weight: .bold)).foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(
                        Color(projectHex: summary.color) ?? MobileStyle.accent, in: .rect(cornerRadius: corner))
            }
        }
        .foregroundStyle(MobileStyle.text)
        .accessibilityHidden(true)
    }

    private var initial: String {
        let picked: String
        if case .initial(let icon) = summary.icon { picked = icon.value } else { picked = "" }
        return picked.isEmpty ? String(summary.name.prefix(1)).uppercased() : picked
    }
}
