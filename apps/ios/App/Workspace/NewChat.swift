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
    private(set) var providers: [JSONValue]?
    private(set) var limits: JSONValue?
    private(set) var accountsProblem: String?
    private(set) var choices: [String: String] = [:]
    @ObservationIgnored private var reads = 0
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
        reads += 1
        let attempt = reads
        do {
            let providers = try await AgentCatalog.load(client)
            let listed: ProviderAccountList?
            var accountFailure: String?
            do { listed = ProviderAccountList(try await client.request(.accountsList)) } catch {
                listed = nil
                accountFailure = error.localizedDescription
            }
            let limits =
                (client as? MachineFeatures)?.answers(.usageLimits) == true
                ? try? await client.request(.usageLimits) : nil
            try Task.checkCancellation()
            guard attempt == reads else { return }
            self.providers = providers
            agents = AgentCatalog.installed(providers, target: "chat")
            accounts = listed
            accountsProblem = accountFailure
            self.limits = limits
            problem = nil
        } catch is CancellationError {
        } catch {
            guard attempt == reads else { return }
            problem = error.localizedDescription
        }
    }

    func choose(_ account: String?, provider: String) {
        choices[provider] = account
    }

    func account(for provider: String) -> String? {
        if let picked = choices[provider] { return picked }
        let ordered = (client as? MachineFeatures)?.answers(.accountsReorder) == true
        return preferences.account(machineID: machineID, provider: provider, accounts: accounts, ordered: ordered)
    }

    func unavailable(_ entry: ProviderAccountEntry, project: JSONValue? = nil) -> String? {
        if project?["accounts"]?[entry.kind]?.list("off").contains(.string(entry.id)) == true {
            return String(localized: "Off in this project")
        }
        if !entry.enabled { return String(localized: "Off", comment: "An agent account that is turned off") }
        switch entry.state {
        case "disabled": return String(localized: "Off", comment: "An agent account that is turned off")
        case "signed-out": return String(localized: "Not logged in")
        case "folder-missing": return String(localized: "Its folder is missing")
        case "unavailable", "not-found", "failed": return entry.message ?? String(localized: "Unavailable")
        default: return nil
        }
    }

    func refusal(provider: String, project: JSONValue? = nil) -> String? {
        guard let picked = choices[provider] else {
            let entries = accounts?.accounts(of: provider) ?? []
            return !entries.isEmpty && entries.allSatisfy { unavailable($0, project: project) != nil }
                ? String(localized: "No account is available for this chat.") : nil
        }
        guard let entry = accounts?.entries.first(where: { $0.id == picked && $0.kind == provider }) else {
            return accountsProblem ?? String(localized: "This account is no longer available. Choose another account.")
        }
        return unavailable(entry, project: project)
    }

    /// A named choice is checked again before a project edit, so a known refusal does not leave a new view behind.
    func prepare(provider: String, project: JSONValue? = nil) async throws -> String? {
        if (client as? MachineClient)?.isConnected == false { throw MachineClientError.disconnected }
        if let picked = choices[provider] {
            reads += 1
            let attempt = reads
            let listed = try await client.request(.accountsList)
            try Task.checkCancellation()
            guard attempt == reads, choices[provider] == picked else { throw CancellationError() }
            accounts = ProviderAccountList(listed)
            accountsProblem = nil
            if let reason = refusal(provider: provider, project: project) { throw MachineClientError.invalid(reason) }
        }
        if let reason = refusal(provider: provider, project: project) { throw MachineClientError.invalid(reason) }
        if choices[provider] == nil {
            if project?["accounts"]?[provider] != nil { return nil }
            if let remembered = account(for: provider),
                let entry = accounts?.entries.first(where: { $0.id == remembered }),
                unavailable(entry, project: project) != nil
            {
                return nil
            }
        }
        return account(for: provider)
    }

    func start(provider: String) async -> NewChatPlace? {
        guard starting == nil else { return nil }
        starting = provider
        defer { starting = nil }
        do {
            let result = try await client.request(
                .projectNewChat,
                payload: NewChat.payload(provider: provider, account: try await prepare(provider: provider)))
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
        if let account { values["account"] = .string(account) }
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
    @State private var chosenProvider: String?
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
        .task { await RemotePageLifecycle.run(client: session.rpc, events: ["accounts.changed"], load: model.load) }
        .mobileSheet(isPresented: $chosenProvider.isPresent()) {
            if let kind = chosenProvider {
                NewChatAccountSheet(
                    model: model, provider: kind, connected: session.connected, starting: model.starting != nil,
                    start: { start(kind) }, close: { chosenProvider = nil })
            }
        }
    }

    private func start(_ kind: String) {
        Task {
            guard let place = await model.start(provider: kind) else { return }
            chosenProvider = nil
            dismiss()
            opened(place)
        }
    }

    private func row(_ agent: JSONValue) -> some View {
        let kind = agent.agentKind
        let name = agent["name"]?.stringValue ?? kind
        let account = model.account(for: kind).flatMap { id in
            model.accounts?.entries.first { $0.id == id }?.name(provider: name) ?? id
        }
        return Button {
            if (model.accounts?.accounts(of: kind).count ?? 0) > 1 {
                chosenProvider = kind
            } else {
                start(kind)
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
        .disabled(!session.connected || model.refusal(provider: kind) != nil)
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
