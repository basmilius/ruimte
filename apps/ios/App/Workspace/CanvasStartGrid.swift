import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The agent CLIs a machine reports through `provider.list`, the one source for which agents it offers.
@MainActor
enum AgentCatalog {
    static func load(_ client: any MachineRequesting) async throws -> [ProviderInfo] {
        let providers = try await client.request(.providerList, payload: .object([:]))
            .decoded(as: ProviderListResult.self).providers
        AgentDirectory.shared.learn(providers)
        return providers
    }

    /// Installed CLIs that open as a chat.
    nonisolated static func installedChats(_ providers: [ProviderInfo]) -> [ProviderInfo] {
        providers.filter { $0.installed && $0.capabilities.chat }
    }
}

/// What an empty canvas offers: one tile per installed agent and one per kind of node. It goes away with the first
/// node or text, because the canvas no longer needs it.
struct CanvasStartGrid: View {
    let workspace: MobileWorkspace
    let viewID: String
    /// Opens the add sheet for a kind that needs more than a tap, like a URL or a path.
    let compose: (String) -> Void
    let added: () -> Void
    @State private var catalog: NewChatModel
    @State private var chatProvider: String?

    init(workspace: MobileWorkspace, viewID: String, compose: @escaping (String) -> Void, added: @escaping () -> Void) {
        self.workspace = workspace
        self.viewID = viewID
        self.compose = compose
        self.added = added
        _catalog = State(initialValue: NewChatModel(client: workspace.client, machineID: workspace.session.machine.id))
    }

    private var providers: [ProviderInfo]? { catalog.providers }
    @State private var saving = false

    private var agents: [ProviderInfo] {
        (providers ?? []).filter { $0.installed && ($0.capabilities.chat || $0.capabilities.terminal) }
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(spacing: 6) {
                        Text("An open canvas").font(.title3.weight(.semibold)).foregroundStyle(MobileStyle.text)
                        Text("Put something on it to get started.").font(.subheadline)
                            .foregroundStyle(MobileStyle.muted)
                    }
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    agentSection
                    section(String(localized: "Add")) {
                        tile(
                            String(localized: "Chat"), detail: String(localized: "Choose a model"),
                            icon: "message-square"
                        ) {
                            insert(kind: "chat", title: "Chat")
                        }
                        tile(String(localized: "Terminal"), detail: String(localized: "Shell"), icon: "terminal") {
                            insert(kind: "terminal", title: "Terminal")
                        }
                        tile(String(localized: "Browser"), detail: String(localized: "Web page"), icon: "globe") {
                            compose("browser")
                        }
                        tile(
                            String(localized: "File"), detail: String(localized: "From the machine"), icon: "file-text"
                        ) {
                            compose("file")
                        }
                        tile(String(localized: "Note"), detail: String(localized: "Markdown"), icon: "sticky-note") {
                            compose("note")
                        }
                        tile(
                            String(localized: "Group"), detail: String(localized: "Holds nodes"), icon: "layout-grid"
                        ) {
                            insert(
                                kind: "group", title: "Group",
                                extra: ["memberIds": .array([]), "membersListed": .bool(true)])
                        }
                    }
                }
                .frame(maxWidth: 560)
                .padding(24)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .disabled(saving)
        .accessibilityIdentifier("canvas.startGrid")
        .task {
            await RemotePageLifecycle.run(client: workspace.client, events: [.accountsChanged], load: catalog.load)
        }
        .mobileSheet(isPresented: $chatProvider.isPresent()) {
            if let kind = chatProvider {
                NewChatAccountSheet(
                    model: catalog, provider: kind, project: workspace.document, connected: workspace.session.connected,
                    starting: saving,
                    start: { insertChat(kind) }, close: { chatProvider = nil })
            }
        }
    }

    @ViewBuilder private var agentSection: some View {
        if providers == nil {
            if workspace.session.connected {
                MobileLoadingRow(String(localized: "Looking for agents")).frame(maxWidth: .infinity)
            }
        } else if agents.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("No agents on this machine").font(.callout.weight(.medium)).foregroundStyle(MobileStyle.text)
                Text("Install a CLI or add an account in Ruimte on the machine itself, under Agents.")
                    .font(.caption).foregroundStyle(MobileStyle.muted)
            }
            .mobileCard(padding: 14)
            .accessibilityElement(children: .combine)
        } else {
            section(String(localized: "Agents")) {
                ForEach(agents, id: \.kind) { provider in
                    let chat = provider.capabilities.chat
                    tile(
                        provider.name,
                        detail: chat ? String(localized: "Chat") : String(localized: "Terminal"), icon: "bot"
                    ) {
                        if chat && catalog.needsAccountChoice(provider: provider.kind, project: workspace.document) {
                            chatProvider = provider.kind
                        } else if chat {
                            insertChat(provider.kind)
                        } else {
                            insert(kind: "terminal", title: provider.name, extra: ["provider": .string(provider.kind)])
                        }
                    }
                }
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.footnote).foregroundStyle(MobileStyle.muted).accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) { content() }
        }
    }

    private func tile(_ title: String, detail: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                Image(lucide: icon, size: 20).foregroundStyle(MobileStyle.text)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.callout.weight(.medium)).foregroundStyle(MobileStyle.text)
                    Text(detail).font(.caption).foregroundStyle(MobileStyle.muted)
                }
                .lineLimit(1).truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .padding(14)
            .contentShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 16))
        .hoverEffect(.highlight)
    }

    private func insertChat(_ provider: String) {
        saving = true
        Task {
            defer { saving = false }
            do {
                let account = try await catalog.prepare(provider: provider, project: workspace.document)
                var extra: [String: JSONValue] = ["provider": .string(provider), "providerFixed": .bool(true)]
                if let account { extra["account"] = .string(account) }
                await workspace.updateView(viewID) { view in
                    view.setting(
                        "nodes",
                        .array(
                            view.list("nodes") + [
                                newCanvasNode(
                                    kind: "chat", title: AgentDirectory.shared.name(provider), after: view.list("nodes"),
                                    extra: extra)
                            ]))
                }
                if workspace.problem == nil {
                    chatProvider = nil
                    added()
                }
            } catch {
                catalog.problem = error.localizedDescription
                workspace.problem = error.localizedDescription
            }
        }
    }

    private func insert(kind: String, title: String, extra: [String: JSONValue] = [:]) {
        saving = true
        Task {
            await workspace.updateView(viewID) { view in
                view.setting(
                    "nodes",
                    .array(
                        view.list("nodes") + [
                            newCanvasNode(kind: kind, title: title, after: view.list("nodes"), extra: extra)
                        ]))
            }
            saving = false
            if workspace.problem == nil { added() }
        }
    }
}
