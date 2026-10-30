import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The accounts and defaults of the installed CLIs on one machine. Login stays with the CLI itself.
@MainActor @Observable final class MachineAgentsModel {
    struct Agent: Identifiable, Equatable {
        let kind: String
        let name: String
        let version: String?
        let chat: Bool
        let models: [JSONValue]
        let defaultModel: String?
        var accounts: [Account]
        var id: String { kind }

        /// The top account that is on, where a chat that names none starts; nil while there is no choice to point out.
        var defaultAccount: String? {
            accounts.count > 1 ? accounts.first { $0.state != "disabled" }?.id : nil
        }
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
    /// Whether the machine keeps an order of accounts that a person can change from here.
    private(set) var reorders = false
    private var providers: [JSONValue] = []
    private(set) var rawAccounts: JSONValue?
    private(set) var chatLogins: Set<String> = []
    private(set) var silentLogins: Set<String> = []
    private var mutations = 0
    private var createdAccounts: Set<String> = []

    func answers(_ request: WireRequest) -> Bool { (client as? MachineFeatures)?.answers(request) == true }
    func canLogin(_ account: Account, kind: String) -> Bool {
        guard answers(.sessionLogin), loginCommands[kind] != nil else { return false }
        if account.signedOut { return true }
        if silentLogins.contains(kind), account.state == "failed" { return true }
        return createdAccounts.contains(account.id) && [nil, "checking", "failed"].contains(account.state)
    }

    func canAdd(_ kind: String) -> Bool {
        answers(.accountsCreate) && (loginCommands[kind] != nil || chatLogins.contains(kind))
    }

    /// Per CLI, what the machine types to log in under an account; a CLI without one has no login to offer here.
    private(set) var loginCommands: [String: String] = [:]
    private(set) var endpoint: JSONValue?
    /// Nil for a machine without the helper app.
    private(set) var computer: JSONValue?

    init(client: any MachineRequesting) {
        self.client = client
    }

    func load() async {
        guard !state.busy else { return }
        let mutation = mutations
        await state.read(loaded: !agents.isEmpty) { stillTheLatest in
            let providers = try await AgentCatalog.load(client)
            let accounts = try? await client.request(.accountsList)
            let endpoint = try? await client.request("endpoint.info")
            let computer = try? await client.request("computer.status")
            try stillTheLatest()
            guard mutation == mutations else { throw CancellationError() }
            self.providers = providers
            reorders = (client as? MachineFeatures)?.answers(.accountsReorder) == true
            apply(accounts: accounts)
            self.endpoint = endpoint
            self.computer = computer?["present"] == .bool(true) ? computer : nil
        }
    }

    /// Uses the returned order, so a refused reorder leaves the previous list in place.
    func move(_ agent: Agent, from source: IndexSet, to destination: Int) async {
        guard !state.busy, let index = agents.firstIndex(where: { $0.kind == agent.kind }) else { return }
        guard answers(.accountsReorder) else { return }
        var ordered = agents[index].accounts
        ordered.move(fromOffsets: source, toOffset: destination)
        let payload = Self.reorderPayload(kind: agent.kind, ids: ordered.map(\.id))
        mutations += 1
        await state.perform {
            do {
                apply(accounts: try await client.request(.accountsReorder, payload: payload))
            } catch {
                await load()
                throw error
            }
        }
    }

    static func reorderPayload(kind: String, ids: [String]) -> JSONValue {
        .object(["kind": .string(kind), "ids": .array(ids.map(JSONValue.string))])
    }

    private func apply(accounts: JSONValue?) {
        mutations += 1
        rawAccounts = accounts
        chatLogins = Set(accounts?.list("chatLogins").compactMap(\.stringValue) ?? [])
        silentLogins = Set(accounts?.list("silentLogins").compactMap(\.stringValue) ?? [])
        agents = Self.agents(providers: providers, accounts: accounts)
        loginCommands = (accounts?["loginCommands"]?.objectValue ?? [:]).compactMapValues(\.stringValue)
    }

    static func label(_ text: String, required: Bool) throws -> String {
        let label = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !required || !label.isEmpty, label.utf16.count <= 80 else {
            throw MachineClientError.invalid(String(localized: "Use a name of 1 to 80 characters."))
        }
        return label
    }

    func create(kind: String, label: String) async -> Bool {
        guard !state.busy, canAdd(kind) else { return false }
        mutations += 1
        var saved = false
        await state.perform {
            let label = try Self.label(label, required: true)
            let value = try await client.request(
                .accountsCreate, payload: .object(["kind": .string(kind), "label": .string(label)]))
            apply(accounts: value)
            if let id = value["id"]?.stringValue { createdAccounts.insert(id) }
            saved = true
        }
        return saved
    }

    func save(id: String, kind: String, label: String?, enabled: Bool?) async -> Bool {
        guard !state.busy, answers(.accountsSave) else { return false }
        if label == nil && enabled == nil { return true }
        mutations += 1
        var saved = false
        await state.perform {
            let label = try label.map { try Self.label($0, required: false) }
            let latest = try await client.request(.accountsList)
            guard var accounts = latest["accounts"]?.objectValue,
                var entry = accounts[id]?.objectValue, entry["kind"] == .string(kind)
            else {
                throw MachineClientError.invalid(
                    String(localized: "This account is no longer available. Choose another account."))
            }
            if let label { entry["label"] = label.isEmpty ? nil : .string(label) }
            if let enabled { entry["enabled"] = .bool(enabled) }
            accounts[id] = .object(entry)
            guard answers(.accountsSave) else { throw MachineClientError.disconnected }
            apply(accounts: try await client.request(.accountsSave, payload: .object(["accounts": .object(accounts)])))
            saved = true
        }
        return saved
    }

    func refresh() async {
        guard !state.busy, answers(.accountsRefresh) else { return }
        mutations += 1
        await state.perform { apply(accounts: try await client.request(.accountsRefresh)) }
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
                    let state = entry.enabled ? entry.state : "disabled"
                    return Account(
                        id: entry.id, name: entry.name(provider: ProcessesText.agentName(kind)), state: state,
                        detail: detail(state: state, status: statuses[entry.id]))
                })
        }
    }

    /// What an account reads as in one line: its plan and email once signed in, else why it cannot run.
    static func detail(state: String?, status: JSONValue?) -> String {
        switch state {
        case "ready":
            let parts = [status?["plan"]?.stringValue, status?["email"]?.stringValue].compactMap { $0 }
                .filter { !$0.isEmpty }
            return parts.isEmpty ? String(localized: "Logged in") : parts.joined(separator: " · ")
        case "signed-out": return String(localized: "Not logged in")
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
    @State private var editor: ProviderAccountEditorTarget?
    @State private var editMode: EditMode = .inactive
    private let preferences = ChatPreferences.shared

    init(session: SharedMachineSession) {
        self.session = session
        _model = State(initialValue: MachineAgentsModel(client: session.rpc))
    }

    var body: some View {
        MobileForm {
            RemotePageStatus(state: model.state) { Task { await model.load() } }
            if !model.state.loading || !model.agents.isEmpty {
                if editMode.isEditing && canOrder {
                    ordering
                } else {
                    installed
                }
                defaults
                computerUse
            }
        }
        .navigationTitle("Agents")
        .navigationSubtitle(session.machine.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canOrder {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(String(localized: "Recheck accounts"), lucideIcon: "refresh-cw") {
                    Task { await model.refresh() }
                }
                .disabled(!session.connected || model.state.busy || !model.answers(.accountsRefresh))
            }
        }
        .environment(\.editMode, $editMode)
        .task {
            await RemotePageLifecycle.run(
                client: session.rpc, events: ["endpoint.changed", "accounts.changed"], load: model.load)
        }
        .mobileSheet(item: $editor) { target in
            ProviderAccountEditor(model: model, target: target, connected: session.connected)
        }
        .mobileSheet(item: $login) { login in
            AccountLoginSheet(
                client: session.rpc, kind: login.kind, accountID: login.accountID, name: login.name,
                silent: model.silentLogins.contains(login.kind))
        }
    }

    private func edit(_ agent: MachineAgentsModel.Agent, _ account: MachineAgentsModel.Account) {
        editor = ProviderAccountEditorTarget(
            kind: agent.kind, accountID: account.id,
            label: model.rawAccounts?["accounts"]?[account.id]?["label"]?.stringValue ?? "",
            enabled: model.rawAccounts?["accounts"]?[account.id]?["enabled"]?.boolValue ?? true)
        model.state.problem = nil
    }

    @ViewBuilder private var installed: some View {
        Section {
            ForEach(model.agents) { agent in
                agentRow(agent)
                if model.canAdd(agent.kind) {
                    Button(String(localized: "Add account for \(agent.name)"), lucideIcon: "plus") {
                        model.state.problem = nil
                        editor = ProviderAccountEditorTarget(kind: agent.kind)
                    }
                    .disabled(model.state.busy || !session.connected)
                    .accessibilityIdentifier("accounts.add.\(agent.kind)")
                }
            }
            if model.agents.isEmpty {
                Text("No agent CLI on this machine.").foregroundStyle(MobileStyle.muted)
            }
        } header: {
            Text("Installed")
        } footer: {
            Text("Accounts and logins belong to this machine. Install a missing CLI on the machine itself.")
            if !session.connected {
                Text("Connect to this machine to manage its accounts.")
            } else if !model.answers(.accountsSave) || !model.answers(.accountsCreate)
                || !model.answers(.accountsRefresh)
            {
                Text("Update this machine to manage accounts from your phone.")
            }
        }
    }

    private func agentRow(_ agent: MachineAgentsModel.Agent) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: MobileSpacing.medium) {
                ChatProviderMark(provider: agent.kind, size: MobileMetrics.statusGlyph)
                    .foregroundStyle(MobileStyle.muted)
                    .frame(width: MobileMetrics.statusColumn)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(agent.name)
                    Text(agentSubtitle(agent)).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                        .truncationMode(.middle)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if agent.accounts.count == 1, let account = agent.accounts.first {
                    accountActions(agent, account)
                }
            }
            if agent.accounts.count > 1 {
                ForEach(agent.accounts) { account in
                    HStack(spacing: 10) {
                        accountLabel(agent, account)
                        accountActions(agent, account)
                    }
                    .padding(.leading, MobileMetrics.statusColumn + MobileSpacing.medium)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func accountLabel(_ agent: MachineAgentsModel.Agent, _ account: MachineAgentsModel.Account) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(account.name).font(.subheadline)
                if account.id == agent.defaultAccount {
                    Text("Default").font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
            Text(account.detail).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                .truncationMode(.middle)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// A machine that keeps an order of accounts lets a CLI with a choice of them be ordered here.
    private var canOrder: Bool {
        model.reorders && model.agents.contains { $0.accounts.count > 1 }
    }

    @ViewBuilder private var ordering: some View {
        ForEach(model.agents.filter { $0.accounts.count > 1 }) { agent in
            Section {
                ForEach(agent.accounts) { account in
                    accountLabel(agent, account).moveDisabled(model.state.busy || !session.connected)
                }
                .onMove { source, destination in
                    Task { await model.move(agent, from: source, to: destination) }
                }
            } header: {
                Text(agent.name)
            } footer: {
                Text("A chat that names no account starts under the top one that is on.")
            }
        }
    }

    private func agentSubtitle(_ agent: MachineAgentsModel.Agent) -> String {
        var parts = [agent.version].compactMap { $0 }
        if agent.accounts.count == 1, let account = agent.accounts.first { parts.append(account.detail) }
        if agent.accounts.count > 1 { parts.append(String(localized: "\(agent.accounts.count) accounts")) }
        return parts.joined(separator: " · ")
    }

    private func accountActions(_ agent: MachineAgentsModel.Agent, _ account: MachineAgentsModel.Account) -> some View {
        HStack(spacing: 8) {
            loginButton(agent, account)
            if model.answers(.accountsSave) {
                Button("Edit") { edit(agent, account) }
                    .buttonStyle(.mobileCapsuleSmall)
                    .accessibilityLabel("Edit \(account.name)")
                    .accessibilityIdentifier("accounts.edit.\(account.id)")
            }
        }
        .disabled(!session.connected || model.state.busy)
    }

    @ViewBuilder private func loginButton(_ agent: MachineAgentsModel.Agent, _ account: MachineAgentsModel.Account)
        -> some View
    {
        if model.canLogin(account, kind: agent.kind) {
            Button(account.signedOut ? String(localized: "Sign in again") : String(localized: "Sign in")) {
                login = AgentLogin(kind: agent.kind, accountID: account.id, name: account.name)
            }
            .buttonStyle(.mobileCapsuleSmall)
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
            ForEach(
                model.agents.filter { $0.chat && !$0.models.isEmpty && ChatPreferences.providers.contains($0.kind) }
            ) { agent in
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
            if model.endpoint?["reachOpenProjects"]?.boolValue != nil {
                Toggle("Agents may reach all open projects", isOn: endpointBinding("reachOpenProjects"))
                    .disabled(model.state.busy)
            }
            if model.endpoint?["visualReplies"]?.boolValue != nil {
                Toggle(isOn: endpointBinding("visualReplies")) {
                    Text("Visual replies")
                    Text(
                        "Agents may show a chart, table or mockup above a reply. Off, they answer in text. Existing visuals stay."
                    )
                }
                .disabled(model.state.busy)
            }
        } header: {
            Text("Defaults")
        } footer: {
            Text("The chats this iPhone starts use these, on every machine.")
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
                    Label(String(localized: "Computer Use"), lucideIcon: "mouse-pointer-2")
                }
            } header: {
                Text("On this machine")
            } footer: {
                Text("Turn on Computer Use and let an agent into an app on the machine itself.")
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
