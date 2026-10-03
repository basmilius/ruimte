import RuimtePulsar
import SwiftUI

/// The iPhone's open projects under the machine each is on, with how that machine is reached, and the machine's Chats
/// among them.
struct ProjectGroupsList: View {
    let runtime: AppRuntime
    let groups: [ProjectMachineGroup]
    @Environment(\.openMobileWorkspace) private var openWorkspace

    var body: some View {
        ForEach(groups) { group in
            Section {
                ForEach(group.rows) { overview in
                    Button {
                        openWorkspace(
                            MobileWorkspace(
                                session: runtime.session(for: overview.row.machine), projectID: overview.id.projectID,
                                summary: overview.row.summary))
                    } label: {
                        ProjectOverviewLabel(
                            overview: overview, session: runtime.session(for: overview.row.machine),
                            offline: group.reach == .offline
                        )
                        .modifier(MobileSidebarLabel())
                    }
                    .disabled(overview.unavailable)
                    .modifier(MobileSidebarRow())
                    .accessibilityIdentifier(
                        overview.isChats
                            ? "projects.chats.\(overview.row.machine.id)" : "projects.project.\(overview.id.projectID)")
                }
            } header: {
                MachineLinkStateHeading(
                    machine: group.machine, icon: runtime.session(for: group.machine).icons.icon?.value,
                    reach: group.reach)
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
        HStack(spacing: 11) {
            ProjectBadge(summary: overview.row.summary, session: session, chats: overview.isChats)
            VStack(alignment: .leading, spacing: 1) {
                Text(overview.isChats ? "Chats" : overview.row.summary.text("name", fallback: "Untitled project"))
                    .foregroundStyle(overview.unavailable || offline ? MobileStyle.muted : MobileStyle.text)
                    .lineLimit(1).truncationMode(.tail)
                if let detail = overview.detail {
                    Text(detail).font(.caption)
                        .foregroundStyle(overview.unavailable ? MobileStyle.faint : MobileStyle.muted)
                        .lineLimit(1).truncationMode(.middle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let activity = overview.activity {
                if activity.needsYou > 0 {
                    Text("\(activity.needsYou)").font(.footnote.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(MobileStyle.statusNeedsYou)
                        .accessibilityLabel(activity.needsYou == 1 ? "1 needs you" : "\(activity.needsYou) need you")
                }
                if activity.working {
                    Spinner(size: 12, label: "Working").foregroundStyle(MobileStyle.statusRunning)
                }
            }
        }
        .frame(minHeight: 40)
        .accessibilityElement(children: .combine)
    }
}

/// A project's mark at the size of a list row: its initial on its own color, the symbol picked for it, or the image
/// its folder declares.
struct ProjectBadge: View {
    let summary: JSONValue
    let session: SharedMachineSession
    var chats = false
    var size: CGFloat = 26

    var body: some View {
        let icon = summary["icon"]
        let corner = (size * 0.27).rounded()
        Group {
            if chats {
                LucideIcon(name: "messages-square", size: (size * 0.54).rounded())
                    .frame(width: size, height: size).background(MobileStyle.hover, in: .rect(cornerRadius: corner))
            } else if icon?.text("kind") == "image" {
                ProjectArtwork(session: session, project: summary, size: size)
                    .background(MobileStyle.hover, in: .rect(cornerRadius: corner))
            } else if icon?.text("kind") == "lucide" {
                LucideIcon(name: icon?.text("value") ?? "folder", size: (size * 0.54).rounded())
                    .frame(width: size, height: size).background(MobileStyle.hover, in: .rect(cornerRadius: corner))
            } else {
                Text(initial)
                    .font(.system(size: (size * 0.5).rounded(), weight: .bold)).foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(
                        Color(projectHex: summary.text("color")) ?? MobileStyle.accent, in: .rect(cornerRadius: corner))
            }
        }
        .foregroundStyle(MobileStyle.text)
        .accessibilityHidden(true)
    }

    private var initial: String {
        let picked = summary["icon"]?.text("kind") == "initial" ? summary["icon"]?.text("value") ?? "" : ""
        return picked.isEmpty ? String(summary.text("name", fallback: "?").prefix(1)).uppercased() : picked
    }
}
