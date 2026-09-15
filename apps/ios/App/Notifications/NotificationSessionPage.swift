import RuimtePulsar
import SwiftUI

struct NotificationSessionPage: View {
    let runtime: AppRuntime
    let destination: NotificationDestination
    @State private var lease: MachineNavigationLease?
    @State private var session: SharedMachineSession?
    @State private var target = "unknown"
    @State private var problem: String?
    var body: some View {
        Group {
            if let session, session.connected {
                if target == "chat" {
                    ChatScreen(client: session.rpc, chatID: destination.nodeID, title: "Chat")
                } else if target == "terminal" {
                    TerminalScreen(client: session.rpc, sessionID: destination.nodeID, title: "Terminal")
                } else if let problem {
                    ContentUnavailableView(
                        "Session unavailable", systemImage: "exclamationmark.triangle", description: Text(problem))
                } else {
                    ProgressView("Finding session")
                }
            } else if let problem {
                ContentUnavailableView(
                    "Machine unavailable", systemImage: "wifi.exclamationmark", description: Text(problem))
            } else {
                ProgressView("Connecting to your machine")
            }
        }
        .task {
            guard lease == nil else { return }
            guard let machine = runtime.machines.first(where: { $0.id == destination.machineID }) else {
                problem = "This machine is no longer in your account. Refresh your machines and try again."
                return
            }
            let shared = runtime.session(for: machine)
            session = shared
            lease = MachineNavigationLease(shared)
            target = destination.target
            await shared.markSeen(destination.nodeID)
        }
        .task(id: session?.generation) {
            guard let session, session.connected, target == "unknown" else { return }
            do {
                let chats = try await session.rpc.request("chat.list").list("chats")
                if chats.contains(where: { $0.text("chatId", fallback: $0.stableID) == destination.nodeID }) {
                    target = "chat"
                    return
                }
                let terminals = try await session.rpc.request("session.list").list("sessions")
                if terminals.contains(where: { $0.text("sessionId") == destination.nodeID }) {
                    target = "terminal"
                } else {
                    problem = "This session has ended or was removed."
                }
            } catch { problem = error.localizedDescription }
        }
    }
}
