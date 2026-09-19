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
                if target == "machine" {
                    MachineActivityPage(session: session)
                } else if target == "chat" {
                    ChatScreen(client: session.rpc, chatID: destination.nodeID, title: "Chat", session: session)
                } else if target == "terminal" {
                    TerminalScreen(client: session.rpc, sessionID: destination.nodeID, title: "Terminal")
                } else if let problem {
                    ContentUnavailableView(
                        "Session unavailable", lucideIcon: "triangle-alert", description: Text(problem))
                } else {
                    MobileLoadingRow("Finding session")
                }
            } else if let problem {
                ContentUnavailableView(
                    "Machine unavailable", lucideIcon: "triangle-alert", description: Text(problem))
            } else if let session, session.failedAttempts >= 3 {
                ContentUnavailableView {
                    Label("Machine unavailable", lucideIcon: "triangle-alert")
                } description: {
                    Text("Could not reconnect to your machine.")
                } actions: {
                    Button("Try again") { session.reconnect() }
                }
            } else {
                MobileLoadingRow("Connecting to your machine")
            }
        }
        .modifier(MobilePageSurface())
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
            if target != "machine" { await shared.markSeen(destination.nodeID) }
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

private struct MachineActivityPage: View {
    let session: SharedMachineSession
    @State private var sessions: [JSONValue] = []
    @State private var chats: [JSONValue] = []
    @State private var problem: String?
    @State private var subscriptions: [() -> Void] = []

    var body: some View {
        MobileList {
            if let problem { Text(problem).foregroundStyle(.red) }
            Section("Needs your attention") { rows(status: "needs-you") }
            Section("Working") { rows(status: "running") }
            if !sessions.contains(where: { active($0["agent"]?.text("status")) })
                && !chats.contains(where: { active($0.text("status")) })
            {
                ContentUnavailableView(
                    "All caught up", lucideIcon: "circle-check",
                    description: Text("No agents are working or waiting for you on this machine."))
            }
        }
        .navigationTitle(session.machine.name)
        .task(id: session.generation) {
            subscriptions.forEach { $0() }
            subscriptions = ["session.status", "session.list-changed", "chat.event"].map { event in
                session.rpc.subscribe(event) { payload in
                    if event == "chat.event", payload["event"]?.text("type") != "info" { return }
                    Task { await load() }
                }
            }
            await load()
        }
        .refreshable { await load() }
        .onDisappear {
            subscriptions.forEach { $0() }
            subscriptions.removeAll()
        }
    }

    @ViewBuilder private func rows(status: String) -> some View {
        ForEach(chats.filter { $0.text("status") == status }, id: \.stableID) { chat in
            NavigationLink {
                ChatScreen(
                    client: session.rpc, chatID: chat.text("chatId", fallback: chat.stableID),
                    title: chat.text("suggestedTitle", fallback: "Chat"), session: session)
            } label: {
                Text(chat.text("suggestedTitle", fallback: "Chat"))
            }
        }
        ForEach(sessions.filter { $0["agent"]?.text("status") == status }, id: \.stableID) { terminal in
            NavigationLink {
                TerminalScreen(
                    client: session.rpc, sessionID: terminal.text("sessionId"),
                    title: terminal["agent"]?.text("suggestedTitle", fallback: "Terminal") ?? "Terminal")
            } label: {
                Text(terminal["agent"]?.text("suggestedTitle", fallback: "Terminal") ?? "Terminal")
            }
        }
    }

    private func active(_ status: String?) -> Bool { status == "running" || status == "needs-you" }

    private func load() async {
        do {
            async let terminalResult = session.rpc.request("session.list")
            async let chatResult = session.rpc.request("chat.list")
            sessions = try await terminalResult.list("sessions").filter { $0["exited"] != .bool(true) }.map {
                $0.setting("id", $0["sessionId"])
            }
            chats = try await chatResult.list("chats").map { $0.setting("id", $0["chatId"] ?? $0["id"]) }
            problem = nil
        } catch { problem = error.localizedDescription }
    }
}
