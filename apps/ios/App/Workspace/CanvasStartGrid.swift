import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The agent CLIs a machine reports through `provider.list`, the one source for which agents it offers.
@MainActor
enum AgentCatalog {
    static func load(_ client: any MachineRequesting) async throws -> [JSONValue] {
        try await client.request("provider.list", payload: .object([:]))["providers"]?.arrayValue ?? []
    }

    /// Installed CLIs that open as `target`, a chat or a terminal.
    static func installed(_ providers: [JSONValue], target: String) -> [JSONValue] {
        providers.filter { $0["installed"] == .bool(true) && $0["capabilities"]?[target] == .bool(true) }
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
    @State private var providers: [JSONValue]?
    @State private var saving = false

    private var agents: [JSONValue] {
        (providers ?? []).filter {
            $0["installed"] == .bool(true)
                && ($0["capabilities"]?["chat"] == .bool(true) || $0["capabilities"]?["terminal"] == .bool(true))
        }
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
                    section("Add") {
                        tile("Chat", detail: "Choose a model", icon: "message-square") {
                            insert(kind: "chat", title: "Chat")
                        }
                        tile("Terminal", detail: "A shell", icon: "terminal") {
                            insert(kind: "terminal", title: "Terminal")
                        }
                        tile("Browser", detail: "A web page", icon: "globe") { compose("browser") }
                        tile("File", detail: "From the machine", icon: "file-text") { compose("file") }
                        tile("Note", detail: "Markdown", icon: "sticky-note") { compose("note") }
                        tile("Group", detail: "Holds nodes", icon: "layout-grid") {
                            insert(kind: "group", title: "Group", extra: ["memberIds": .array([])])
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
        .task(id: workspace.session.generation) {
            guard workspace.session.connected else { return }
            do {
                let loaded = try await AgentCatalog.load(workspace.client)
                if !Task.isCancelled { providers = loaded }
            } catch {
                // Without a list the agent tiles stay away; the other tiles still work.
            }
        }
    }

    @ViewBuilder private var agentSection: some View {
        if providers == nil {
            if workspace.session.connected {
                ProgressView().accessibilityLabel("Looking for agents").frame(maxWidth: .infinity)
            }
        } else if agents.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("No agents on this machine").font(.callout.weight(.medium)).foregroundStyle(MobileStyle.text)
                Text("Install an agent CLI, then set it up under Agents in Ruimte's settings on your computer.")
                    .font(.caption).foregroundStyle(MobileStyle.muted)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(MobileStyle.panel, in: .rect(cornerRadius: 16))
            .accessibilityElement(children: .combine)
        } else {
            section("Agents") {
                ForEach(agents, id: \.stableKind) { provider in
                    let chat = provider["capabilities"]?["chat"] == .bool(true)
                    tile(
                        provider.text("name", fallback: provider.text("kind")), detail: chat ? "Chat" : "Terminal",
                        icon: "bot"
                    ) {
                        insert(
                            kind: chat ? "chat" : "terminal", title: provider.text("name", fallback: "Agent"),
                            extra: chat
                                ? ["provider": .string(provider.text("kind")), "providerFixed": .bool(true)]
                                : ["provider": .string(provider.text("kind"))])
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

extension JSONValue {
    fileprivate var stableKind: String { text("kind") }
}
