import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The output of a launch: the machine's terminal for it, followed and never created here, so its screen outlives the
/// process until the next start. A group shows the member that runs, else the one that failed.
struct LaunchOutputPage: View {
    let store: ProjectLaunches
    let launchID: String

    var body: some View {
        let views = store.views
        Group {
            if let view = views[launchID] {
                content(view, output: LaunchLogic.output(views: views, launch: view.launch))
            } else {
                ContentUnavailableView(String(localized: "This launch was removed"), lucideIcon: "rocket")
            }
        }
        .modifier(MobilePageSurface())
    }

    @ViewBuilder private func content(_ view: LaunchView, output: LaunchView?) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                LaunchStatusIcon(phase: view.phase)
                if let output { commandLine(output) }
                Spacer(minLength: 4)
                LaunchButtons(store: store, view: view)
            }
            .padding(.horizontal, 16).padding(.vertical, 6)
            .background(MobileStyle.canvas)
            if let problem = store.problem {
                Label(problem, lucideIcon: "triangle-alert").font(.caption).foregroundStyle(.red).padding(8)
            }
            if let output, let status = output.status {
                // A start makes a fresh session under the same id, so a new start time attaches afresh.
                TerminalScreen(client: store.client, sessionID: status.sessionID, title: view.launch.name)
                    .id("\(status.sessionID):\(status.startedAt)")
            } else {
                ContentUnavailableView {
                    Label(String(localized: "\(view.launch.name) has not run since the machine started."), lucideIcon: "play", iconSize: 40)
                } actions: {
                    if view.phase != .held {
                        Button("Launch \(view.launch.name)") { Task { await store.press(view.launch) } }
                            .disabled(!store.connected)
                    }
                }
                .navigationTitle(view.launch.name)
                .navigationBarTitleDisplayMode(.inline)
            }
        }
    }

    /// Where the command runs, what it is, and the address it answers on once running. The address is the machine's
    /// own, which a phone cannot open, so it is only shown.
    private func commandLine(_ output: LaunchView) -> some View {
        let launch = output.launch
        let address = output.phase == .running ? launch.url.map(LaunchLogic.shortAddress) : nil
        return VStack(alignment: .leading, spacing: 1) {
            Text(([launch.cwd].compactMap { $0 }.filter { !$0.isEmpty } + ["$", launch.command ?? ""]).joined(separator: " "))
                .lineLimit(1).truncationMode(.middle)
            if let address { Text(address).foregroundStyle(MobileStyle.accent) }
        }
        .font(.caption.monospaced())
        .foregroundStyle(MobileStyle.muted)
        .textSelection(.enabled)
    }
}
