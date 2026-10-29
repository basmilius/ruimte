import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// Where a chat outside any project landed: a chat view in the machine's Chats project.
struct NewChatPlace: Equatable {
    let projectID: String
    let viewID: String
}

/// The machine a new chat is being started on, as a sheet presents it.
struct NewChatTarget: Identifiable, Equatable {
    let machineID: String
    var id: String { machineID }
}

/// Starts a chat outside any project on one machine with `project.newChat`. The machine makes it a chat view in its
/// Chats project, or hands back the chat of that agent nobody wrote in yet.
@MainActor @Observable
final class NewChatModel {
    let client: any MachineRequesting
    let machineID: String
    /// The installed CLIs that open as a chat; nil until the machine answered.
    private(set) var agents: [JSONValue]?
    private(set) var accounts: ProviderAccountList?
    /// The CLI a chat is being made for.
    private(set) var starting: String?
    var problem: String?
    @ObservationIgnored private let preferences: ChatPreferences

    init(client: any MachineRequesting, machineID: String, preferences: ChatPreferences = .shared) {
        self.client = client
        self.machineID = machineID
        self.preferences = preferences
    }

    func load() async {
        do {
            let providers = try await AgentCatalog.load(client)
            agents = AgentCatalog.installed(providers, target: "chat")
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
        accounts = (try? await client.request(.accountsList)).map(ProviderAccountList.init)
    }

    /// The account a new chat of this CLI names, as remembered for this machine; nil leaves it to the machine.
    func account(for provider: String) -> String? {
        let ordered = (client as? MachineFeatures)?.answers(.accountsReorder) == true
        return preferences.account(machineID: machineID, provider: provider, accounts: accounts, ordered: ordered)
    }

    func start(provider: String) async -> NewChatPlace? {
        guard starting == nil else { return nil }
        starting = provider
        defer { starting = nil }
        do {
            let result = try await client.request(
                .projectNewChat, payload: NewChat.payload(provider: provider, account: account(for: provider)))
            guard let projectID = result["summary"]?["projectId"]?.stringValue,
                let viewID = result["viewId"]?.stringValue
            else { throw MachineClientError.invalid(String(localized: "The machine did not say where the chat is.")) }
            AppUsage.count(.chatStarted)
            problem = nil
            return NewChatPlace(projectID: projectID, viewID: viewID)
        } catch {
            problem = NewChat.message(for: error)
            return nil
        }
    }
}

enum NewChat {
    static func payload(provider: String, account: String?) -> JSONValue {
        var values: [String: JSONValue] = ["provider": .string(provider)]
        if let account, account != provider { values["account"] = .string(account) }
        return .object(values)
    }

    /// The refusal a machine gives that a person can do something about, in their own words.
    static func message(for error: Error) -> String {
        if case MachineClientError.server(code: "scratch-unavailable", message: _) = error {
            return String(
                localized:
                    "This machine keeps its Ruimte folder inside a git checkout, so it cannot hold chats outside a project."
            )
        }
        return error.localizedDescription
    }

    /// The Chats project of a machine among its projects, which the lists show apart from the projects.
    static func isChats(_ summary: JSONValue) -> Bool { summary["scratch"]?.boolValue == true }
}

/// Picks the agent for a chat outside any project, the way an empty canvas offers its agents, and opens the chat.
struct NewChatSheet: View {
    let session: SharedMachineSession
    let opened: (NewChatPlace) -> Void
    @State private var model: NewChatModel
    @State private var lease: MachineNavigationLease?
    @Environment(\.dismiss) private var dismiss

    init(session: SharedMachineSession, opened: @escaping (NewChatPlace) -> Void) {
        self.session = session
        self.opened = opened
        _model = State(initialValue: NewChatModel(client: session.rpc, machineID: session.machine.id))
    }

    var body: some View {
        NavigationStack {
            MobileList {
                Section {
                    if let agents = model.agents {
                        if agents.isEmpty {
                            Text("Install a CLI or add an account in Ruimte on the machine itself, under Agents.")
                                .foregroundStyle(MobileStyle.muted)
                        }
                        ForEach(agents, id: \.agentKind) { agent in row(agent) }
                    } else if model.problem == nil {
                        MobileLoadingRow(
                            session.connected
                                ? String(localized: "Looking for agents")
                                : String(localized: "Connecting to your machine"))
                    }
                } header: {
                    Text("Chat with")
                } footer: {
                    Text("For a question or a quick task. It is kept under Chats on \(session.machine.name).")
                }
                if let problem = model.problem {
                    Section {
                        Text(problem).foregroundStyle(MobileStyle.statusError)
                        if model.agents == nil { Button("Try again") { Task { await model.load() } } }
                    }
                }
            }
            .navigationTitle("New chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .disabled(model.starting != nil)
        .task { if lease == nil { lease = MachineNavigationLease(session) } }
        .task(id: session.generation) { if session.connected { await model.load() } }
    }

    private func row(_ agent: JSONValue) -> some View {
        let kind = agent.agentKind
        let name = agent["name"]?.stringValue ?? kind
        let account = model.account(for: kind).flatMap { id in
            model.accounts?.entries.first { $0.id == id }?.name(provider: name) ?? id
        }
        return Button {
            Task {
                guard let place = await model.start(provider: kind) else { return }
                dismiss()
                opened(place)
            }
        } label: {
            HStack(spacing: 10) {
                MobileGlyphLabel(
                    title: name,
                    subtitle: account.map { String(localized: "Account \($0)", comment: "%@ is the account name") }
                        ?? "",
                    symbol: "bot")
                if model.starting == kind { ProgressView() }
            }
            .modifier(MobileSidebarLabel())
        }
        .modifier(MobileSidebarRow())
        .disabled(!session.connected)
        .accessibilityIdentifier("newChat.agent.\(kind)")
    }
}

extension JSONValue {
    var agentKind: String { self["kind"]?.stringValue ?? "" }
}

/// "New chat" in a list of projects: one button for one machine, a menu of the machines for several.
struct NewChatRow: View {
    let machines: [Machine]
    /// A capsule beside Recently closed, as the iPhone's Projects tab draws it, instead of a row of the sidebar.
    var capsule = false
    let start: (Machine) -> Void

    var body: some View {
        if machines.count == 1, let machine = machines.first {
            Button {
                start(machine)
            } label: {
                label
            }
            .modifier(NewChatRowStyle(capsule: capsule))
            .accessibilityIdentifier("projects.newChat")
        } else if !machines.isEmpty {
            Menu {
                Section("On which machine?") {
                    ForEach(machines, id: \.id) { machine in
                        Button(machine.name, lucideIcon: machine.icon?.value ?? "server") { start(machine) }
                    }
                }
            } label: {
                label
            }
            .modifier(NewChatRowStyle(capsule: capsule))
            .accessibilityIdentifier("projects.newChat")
        }
    }

    @ViewBuilder private var label: some View {
        if capsule {
            ProjectsCapsuleLabel(title: String(localized: "New chat"), icon: "message-square-plus")
        } else {
            ChatsRowLabel(
                title: String(localized: "New chat"), detail: String(localized: "A question or quick task"),
                icon: "message-square-plus")
        }
    }
}

private struct NewChatRowStyle: ViewModifier {
    let capsule: Bool

    func body(content: Content) -> some View {
        if capsule {
            content.menuStyle(.button).buttonStyle(.mobileCapsule)
        } else {
            content.modifier(MobileSidebarRow())
        }
    }
}

/// The label of one of the two equal capsules under the projects.
struct ProjectsCapsuleLabel: View {
    let title: String
    let icon: String

    var body: some View {
        HStack(spacing: MobileSpacing.small) {
            Image(lucide: icon, size: 16).accessibilityHidden(true)
            Text(title)
        }
        .frame(maxWidth: .infinity)
    }
}

/// A row of the Chats project of a machine, which names no folder: where there is more than one, its second line is
/// the machine.
struct ChatsRowLabel: View {
    let title: String
    let detail: String
    let icon: String

    var body: some View {
        HStack(spacing: 12) {
            Image(lucide: icon).frame(width: 20, height: 20).frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(MobileStyle.text)
                Text(detail).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
            }
        }
        .modifier(MobileSidebarLabel(disclosure: true))
    }
}
