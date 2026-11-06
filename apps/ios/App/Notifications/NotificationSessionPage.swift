import RuimtePulsar
import RuimteTransport
import SwiftUI

struct NotificationSessionPage: View {
    let runtime: AppRuntime
    let destination: NotificationDestination
    @State private var lease: MachineNavigationLease?
    @State private var session: SharedMachineSession?
    @State private var target = "unknown"
    @State private var work = RemotePageState()
    /// Once up, a screen stays through a reconnect, which it rides out itself; taking it down lost the keyboard, the
    /// scroll position and the terminal with it.
    @State private var screenShown = false
    private var screenUp: Bool { session?.connected == true && ["machine", "chat", "terminal"].contains(target) }
    var body: some View {
        Group {
            if let session, session.connected || screenShown {
                if target == "machine" {
                    MachineActivityPage(session: session)
                } else if target == "chat" {
                    ChatScreen(
                        client: session.rpc, chatID: destination.nodeID, title: String(localized: "Chat"),
                        session: session)
                } else if target == "terminal" {
                    TerminalScreen(
                        client: session.rpc, sessionID: destination.nodeID, title: String(localized: "Terminal"))
                } else if let problem = work.problem {
                    ContentUnavailableView(
                        String(localized: "Session unavailable"), lucideIcon: "triangle-alert",
                        description: Text(problem))
                } else {
                    MobileLoadingRow(String(localized: "Finding session"))
                }
            } else if let problem = work.problem {
                ContentUnavailableView(
                    String(localized: "Machine unavailable"), lucideIcon: "triangle-alert",
                    description: Text(problem))
            } else if let session, session.failedAttempts >= 3 {
                ContentUnavailableView {
                    Label(String(localized: "Machine unavailable"), lucideIcon: "triangle-alert")
                } description: {
                    Text("Could not reconnect to your machine.")
                } actions: {
                    Button("Try again") { session.reconnect() }
                }
            } else {
                MobileLoadingRow(String(localized: "Connecting to your machine"))
            }
        }
        .modifier(MobilePageSurface())
        .onChange(of: screenUp, initial: true) { _, up in
            if up { screenShown = true }
        }
        .task {
            guard lease == nil else { return }
            guard let shared = runtime.session(machineID: destination.machineID) else {
                work.problem = String(
                    localized: "This machine is no longer in your account. Refresh your machines and try again.")
                return
            }
            session = shared
            lease = MachineNavigationLease(shared)
            // A view from the project widget that no open project holds can only still be a session, so it is looked up.
            target = destination.target == "view" ? "unknown" : destination.target
            if target != "machine" { await shared.markSeen(destination.nodeID) }
        }
        .task(id: session?.generation) {
            guard let session, session.connected, target == "unknown" else { return }
            // Nothing here is on screen yet, so the page draws its own spinner and this read shows none.
            await work.read(loaded: true) { stillTheLatest in
                let chats = try await session.rpc.request(.chatList).decoded(as: ChatListResult.self).chats
                try stillTheLatest()
                if chats.contains(where: { $0.chatId == destination.nodeID }) {
                    target = "chat"
                    return
                }
                let terminals = try await session.rpc.request(.sessionList).decoded(as: SessionListResult.self)
                    .sessions
                try stillTheLatest()
                guard terminals.contains(where: { $0.sessionId == destination.nodeID }) else {
                    // A node that is in neither list is why this read found nothing, so it reads as the failure.
                    throw TransportFailure.invalid(String(localized: "This session has ended or was removed."))
                }
                target = "terminal"
            }
        }
    }
}

private struct MachineActivityPage: View {
    let session: SharedMachineSession
    @State private var sessions: [SessionInfo] = []
    @State private var chats: [ChatInfo] = []
    @State private var work = RemotePageState()
    @State private var subscriptions: [() -> Void] = []

    var body: some View {
        MobileList {
            if let problem = work.problem { Text(problem).foregroundStyle(MobileStyle.statusError) }
            Section("Needs your attention") { rows(status: "needs-you") }
            Section("Working") { rows(status: "running") }
            if !sessions.contains(where: { active($0.agent.present?.status) })
                && !chats.contains(where: { active($0.status) })
            {
                ContentUnavailableView(
                    String(localized: "All caught up"), lucideIcon: "circle-check",
                    description: Text("No agents are working or waiting for you on this machine."))
            }
        }
        .navigationTitle(session.machine.name)
        .task(id: session.generation) {
            subscriptions.forEach { $0() }
            subscriptions = [.sessionStatus, .sessionListChanged, .chatEvent].map { event in
                session.rpc.subscribe(event) { payload in
                    if event == .chatEvent {
                        guard let envelope = try? payload.decoded(as: ChatEventEnvelope.self),
                            case .info = envelope.event
                        else { return }
                    }
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
        ForEach(chats.filter { $0.status == status }, id: \.chatId) { chat in
            let title = chat.suggestedTitle ?? String(localized: "Chat")
            NavigationLink(title) {
                ChatScreen(client: session.rpc, chatID: chat.chatId, title: title, session: session)
            }
        }
        ForEach(sessions.filter { $0.agent.present?.status == status }, id: \.sessionId) { terminal in
            let title = terminal.agent.present?.suggestedTitle ?? String(localized: "Terminal")
            NavigationLink(title) {
                TerminalScreen(client: session.rpc, sessionID: terminal.sessionId, title: title)
            }
        }
    }

    private func active(_ status: String?) -> Bool { status == "running" || status == "needs-you" }

    private func load() async {
        await work.read(loaded: true) { stillTheLatest in
            async let terminalResult = session.rpc.request(.sessionList)
            async let chatResult = session.rpc.request(.chatList)
            let terminals = try await terminalResult.decoded(as: SessionListResult.self).sessions
            let listed = try await chatResult.decoded(as: ChatListResult.self).chats
            try stillTheLatest()
            sessions = terminals.filter { !$0.exited }
            chats = listed
        }
    }
}
