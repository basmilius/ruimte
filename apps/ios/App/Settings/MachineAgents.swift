import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// One machine's agents as the desktop's agents settings show them: the CLIs it has with their accounts, the defaults
/// a chat starts with and Computer Use. Installing a CLI, adding an account and turning Computer Use on happen on the
/// machine itself; signing a signed-out account in runs the CLI's own login in a terminal there.
@MainActor @Observable final class MachineAgentsModel {
    struct Agent: Identifiable, Equatable {
        let kind: String
        let name: String
        let version: String?
        let chat: Bool
        let models: [JSONValue]
        let defaultModel: String?
        let accounts: [Account]
        var id: String { kind }
    }

    struct Account: Identifiable, Equatable {
        let id: String
        let name: String
        let state: String?
        let detail: String
        var signedOut: Bool { state == "signed-out" }
    }

    let client: any MachineRequesting
    let state = RemotePageState()
    private(set) var agents: [Agent] = []
    /// Per CLI, what the machine types to log in under an account; a CLI without one has no login to offer here.
    private(set) var loginCommands: [String: String] = [:]
    private(set) var endpoint: JSONValue?
    /// Nil for a machine without the helper app, or one from before Computer Use.
    private(set) var computer: JSONValue?

    init(client: any MachineRequesting) {
        self.client = client
    }

    func load() async {
        await state.read(loaded: !agents.isEmpty) { stillTheLatest in
            let providers = try await AgentCatalog.load(client)
            let accounts = try? await client.request(WireRequest.accountsList.rawValue, payload: .object([:]))
            let endpoint = try? await client.request("endpoint.info")
            let computer = try? await client.request("computer.status")
            try stillTheLatest()
            agents = Self.agents(providers: providers, accounts: accounts)
            loginCommands = (accounts?["loginCommands"]?.objectValue ?? [:]).compactMapValues(\.stringValue)
            self.endpoint = endpoint
            self.computer = computer?["present"] == .bool(true) ? computer : nil
        }
    }

    /// Turns a switch the machine keeps in `endpoint.json`, leaving its name and icon as they stand.
    func set(_ key: String, _ value: Bool) async {
        guard let endpoint else { return }
        await state.perform {
            self.endpoint = try await client.request(
                "endpoint.setIdentity", payload: Self.identityPayload(endpoint: endpoint, key: key, value: value))
        }
    }

    /// A machine nobody named answers to its own default, and sending that name back would make it a chosen one.
    static func identityPayload(endpoint: JSONValue, key: String, value: Bool) -> JSONValue {
        let chosen = endpoint["nameSource"] == .string("chosen")
        return .object([
            "name": chosen ? .string(endpoint.text("label")) : .null,
            "icon": endpoint["icon"] ?? .null,
            key: .bool(value),
        ])
    }

    /// The installed CLIs, each with its accounts in the machine's order and what they read as now.
    static func agents(providers: [JSONValue], accounts: JSONValue?) -> [Agent] {
        let list = accounts.map(ProviderAccountList.init)
        let statuses = Dictionary(
            (accounts?.list("statuses") ?? []).map { ($0.text("id"), $0) }, uniquingKeysWith: { first, _ in first })
        return providers.filter { $0["installed"] == .bool(true) }.map { provider in
            let kind = provider.text("kind")
            let entries = list?.accounts(of: kind) ?? []
            return Agent(
                kind: kind, name: provider.text("name", fallback: ProcessesText.agentName(kind)),
                version: provider["version"]?.stringValue, chat: provider["capabilities"]?["chat"] == .bool(true),
                models: provider.list("models").filter { $0["legacy"] != .bool(true) },
                defaultModel: provider["defaultModel"]?.stringValue,
                accounts: entries.map { entry in
                    Account(
                        id: entry.id, name: entry.name(provider: ProcessesText.agentName(kind)),
                        state: entry.enabled ? entry.state : "disabled",
                        detail: detail(state: entry.enabled ? entry.state : "disabled", status: statuses[entry.id]))
                })
        }
    }

    /// What an account reads as in one line: its plan and email once signed in, else why it cannot run.
    static func detail(state: String?, status: JSONValue?) -> String {
        switch state {
        case "ready":
            let parts = [status?["plan"]?.stringValue, status?["email"]?.stringValue].compactMap { $0 }
                .filter { !$0.isEmpty }
            return parts.isEmpty ? String(localized: "Signed in") : parts.joined(separator: " · ")
        case "signed-out": return String(localized: "Signed out")
        case "disabled": return String(localized: "Off", comment: "An agent account that is turned off")
        case "checking", nil: return String(localized: "Checking")
        case "folder-missing": return String(localized: "Its folder is missing")
        case "not-found": return String(localized: "Not installed")
        default: return status?["message"]?.stringValue ?? String(localized: "Unavailable")
        }
    }
}

struct MachineAgentsPage: View {
    let session: SharedMachineSession
    @State private var model: MachineAgentsModel
    @State private var login: AgentLogin?
    private let preferences = ChatPreferences.shared

    init(session: SharedMachineSession) {
        self.session = session
        _model = State(initialValue: MachineAgentsModel(client: session.rpc))
    }

    var body: some View {
        MobileForm {
            RemotePageStatus(state: model.state) { Task { await model.load() } }
            if !model.state.loading || !model.agents.isEmpty {
                installed
                defaults
                computerUse
            }
        }
        .navigationTitle("Agents")
        .navigationSubtitle(session.machine.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await RemotePageLifecycle.run(
                client: session.rpc, events: ["endpoint.changed", "accounts.changed"], load: model.load)
        }
        .mobileSheet(item: $login) { login in
            AccountLoginSheet(
                client: session.rpc, kind: login.kind, accountID: login.accountID, name: login.name)
        }
    }

    @ViewBuilder private var installed: some View {
        Section {
            ForEach(model.agents) { agent in
                agentRow(agent)
            }
            if model.agents.isEmpty {
                Text("No agent CLI on this machine.").foregroundStyle(MobileStyle.muted)
            }
        } header: {
            Text("Installed")
        } footer: {
            Text("Install a CLI or add an account in Ruimte on the machine itself, under Agents.")
        }
    }

    private func agentRow(_ agent: MachineAgentsModel.Agent) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(lucide: "bot", size: 18).foregroundStyle(MobileStyle.muted)
                VStack(alignment: .leading, spacing: 2) {
                    Text(agent.name)
                    Text(agentSubtitle(agent)).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                        .truncationMode(.middle)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if agent.accounts.count == 1, let account = agent.accounts.first { loginButton(agent, account) }
            }
            if agent.accounts.count > 1 {
                ForEach(agent.accounts) { account in
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(account.name).font(.subheadline)
                            Text(account.detail).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                                .truncationMode(.middle)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        loginButton(agent, account)
                    }
                    .padding(.leading, 28)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func agentSubtitle(_ agent: MachineAgentsModel.Agent) -> String {
        var parts = [agent.version].compactMap { $0 }
        if agent.accounts.count == 1, let account = agent.accounts.first { parts.append(account.detail) }
        if agent.accounts.count > 1 { parts.append(String(localized: "\(agent.accounts.count) accounts")) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private func loginButton(_ agent: MachineAgentsModel.Agent, _ account: MachineAgentsModel.Account)
        -> some View
    {
        if account.signedOut && model.loginCommands[agent.kind] != nil {
            Button("Sign in again") {
                login = AgentLogin(kind: agent.kind, accountID: account.id, name: account.name)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    @ViewBuilder private var defaults: some View {
        Section {
            Picker(
                "Permissions",
                selection: Binding(
                    get: { preferences.runtimeMode }, set: { preferences.rememberRuntimeMode($0) })
            ) {
                ForEach(ChatRuntimeMode.all, id: \.self) { mode in
                    Text(ChatRuntimeMode.label(mode)).tag(mode)
                }
            }
            .pickerStyle(.menu)
            ForEach(model.agents.filter { $0.chat && !$0.models.isEmpty && ChatPreferences.providers.contains($0.kind) })
            { agent in
                modelPicker(agent)
            }
            if model.endpoint?["resumeAtReset"]?.boolValue != nil {
                Toggle("Chats resume after a limit", isOn: endpointBinding("resumeAtReset"))
                    .disabled(model.state.busy)
            }
            if model.endpoint?["agentsDeleteAnyView"]?.boolValue != nil {
                Toggle("Agents may delete any view or node", isOn: endpointBinding("agentsDeleteAnyView"))
                    .disabled(model.state.busy)
            }
            if model.endpoint?["visualReplies"]?.boolValue != nil {
                Toggle(isOn: endpointBinding("visualReplies")) {
                    Text("Visual replies")
                    Text(
                        "On, an agent may show a chart, table or mockup above its reply, as a page. Off, it answers in text. Visuals already in a chat stay."
                    )
                }
                .disabled(model.state.busy)
            }
        } header: {
            Text("Defaults")
        } footer: {
            Text(
                "The permissions and models are this iPhone's picks for the chats it starts, and every machine hears of them."
            )
        }
    }

    private func modelPicker(_ agent: MachineAgentsModel.Agent) -> some View {
        Picker(
            "\(agent.name) model",
            selection: Binding(
                get: {
                    preferences.selections[agent.kind]?["model"]?.stringValue ?? agent.defaultModel
                        ?? agent.models.first?.text("slug") ?? ""
                },
                set: { slug in
                    preferences.rememberSelection(
                        .object(["model": .string(slug), "options": .object([:])]), provider: agent.kind)
                })
        ) {
            ForEach(agent.models.map { $0.text("slug") }, id: \.self) { slug in
                Text(ModelName.of(slug, in: agent.models)).tag(slug)
            }
        }
        .pickerStyle(.menu)
    }

    private func endpointBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: { model.endpoint?[key]?.boolValue ?? false },
            set: { value in Task { await model.set(key, value) } })
    }

    @ViewBuilder private var computerUse: some View {
        if let computer = model.computer {
            Section {
                LabeledContent {
                    Text(computerState(computer))
                } label: {
                    Label(String(localized: "Computer Use"), lucideIcon: "monitor")
                }
            } header: {
                Text("On this machine")
            } footer: {
                Text("Turning Computer Use on and letting an agent into an app happens on the machine itself.")
            }
        }
    }

    private func computerState(_ computer: JSONValue) -> String {
        guard computer["enabled"] == .bool(true) else {
            return String(localized: "Off", comment: "Computer Use is turned off")
        }
        if computer["running"] != .bool(true) { return String(localized: "On, not running") }
        if computer["accessibility"] == .bool(false) || computer["screenRecording"] == .bool(false) {
            return String(localized: "Needs permission")
        }
        return String(localized: "On", comment: "Computer Use is turned on")
    }
}

private struct AgentLogin: Identifiable {
    let kind: String
    let accountID: String
    let name: String
    var id: String { accountID }
}
