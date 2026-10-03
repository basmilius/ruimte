import RuimtePulsar
import SwiftUI

enum MachineLost {
    /// The link of the project's machine is down and at least one try to bring it back failed; a link that is merely
    /// opening says nothing yet, as on the desktop.
    static func isLost(connected: Bool, failedAttempts: Int, problem: String?) -> Bool {
        !connected && (failedAttempts > 0 || problem != nil)
    }

    /// The phone keeps trying on its own until its third try failed; after that only Try again does.
    static func retrying(failedAttempts: Int) -> Bool { failedAttempts < 3 }

    /// "Last connected 4 minutes ago", from when this phone last had a link, else when the machine was last seen.
    static func lastConnected(_ moment: Date?, now: Date) -> String? {
        guard let moment else { return nil }
        if now.timeIntervalSince(moment) < 60 { return "Last connected just now" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return "Last connected \(formatter.localizedString(for: moment, relativeTo: now))"
    }
}

/// The desktop's machine-lost screen as a card over the dimmed project, so the list behind it still says where you
/// were. It goes the moment the machine answers again.
struct MachineLostCard: View {
    let session: SharedMachineSession
    /// Nil where this page cannot open the connection diagnostics.
    let diagnostics: (() -> Void)?
    let otherProject: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            LucideIcon(name: "wifi-off", size: 20)
                .foregroundStyle(MobileStyle.statusError)
                .frame(width: 44, height: 44)
                .background(MobileStyle.statusError.opacity(0.14), in: .circle)
                .padding(.bottom, 4)
            Text("\(session.machine.name) is not answering").font(.headline).multilineTextAlignment(.center)
            if MachineLost.retrying(failedAttempts: session.failedAttempts) {
                HStack(spacing: 6) {
                    Spinner(size: 12)
                    Text("Trying to reach the machine again…")
                }
                .font(.footnote).foregroundStyle(MobileStyle.muted)
            } else {
                Text(session.problem ?? "The machine stopped answering.")
                    .font(.footnote).foregroundStyle(MobileStyle.muted).multilineTextAlignment(.center)
                Button("Try again") { session.reconnect() }.font(.footnote.weight(.semibold))
            }
            TimelineView(.periodic(from: .now, by: 60)) { context in
                if let line = MachineLost.lastConnected(lastSeen, now: context.date) {
                    Text(line).font(.caption).foregroundStyle(MobileStyle.faint)
                }
            }
            HStack(spacing: 8) {
                if let diagnostics {
                    Button(action: diagnostics) {
                        Text("Diagnostics").frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.glass)
                }
                Button(action: otherProject) {
                    Text("Other project").frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.glassProminent)
            }
            .font(.subheadline.weight(.semibold))
            .padding(.top, 8)
        }
        .padding(.horizontal, 18).padding(.top, 20).padding(.bottom, 16)
        .frame(maxWidth: 520)
        .glassEffect(.regular, in: .rect(cornerRadius: 30))
        .padding(.horizontal, 12).padding(.bottom, 8)
        .accessibilityElement(children: .contain)
    }

    private var lastSeen: Date? {
        session.lastConnectedAt ?? session.machine.lastSeenAt.map { Date(timeIntervalSince1970: Double($0) / 1000) }
    }
}
