import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// An open project a chat can start in, as Now read it.
struct NowChatProject: Identifiable, Hashable {
    let machineID: String
    let projectID: String
    let name: String
    var id: String { "\(machineID):\(projectID)" }
}

extension NowModel {
    /// The open projects of a machine, without its Chats, in the order Now reads them.
    func chatProjects(on machineID: String) -> [NowChatProject] {
        (feeds[machineID]?.projects ?? []).compactMap { project in
            guard let summary = project["summary"], !NewChat.isChats(summary),
                let projectID = summary["projectId"]?.stringValue
            else { return nil }
            return NowChatProject(
                machineID: machineID, projectID: projectID,
                name: summary.text("name", fallback: String(localized: "Untitled project")))
        }
    }
}

extension NewChat {
    /// A chat view at the end of a project's list. It carries no name of a person's, so the agent's title takes over.
    static func projectView(id: String, provider: String, account: String?) -> JSONValue {
        var node: [String: JSONValue] = ["provider": .string(provider)]
        if let account, account != provider { node["account"] = .string(account) }
        return .object([
            "id": .string(id), "kind": .string("chat"), "name": .string("New chat"), "node": .object(node),
        ])
    }
}

/// The New chat sheet of Now: which agent, and where the chat lives, a machine's Chats or one of its open projects.
@MainActor @Observable
final class NowNewChatModel {
    var machineID: String {
        didSet {
            guard machineID != oldValue else { return }
            projectID = nil
            catalog = nil
        }
    }
    /// The project the chat starts in; nil is the machine's Chats.
    var projectID: String?
    var provider: String?
    private(set) var catalog: NewChatModel?
    private(set) var starting = false
    var problem: String?

    init(machineID: String) { self.machineID = machineID }

    func load(_ session: SharedMachineSession) async {
        let catalog = catalog ?? NewChatModel(client: session.rpc, machineID: session.machine.id)
        self.catalog = catalog
        await catalog.load()
        let agents = (catalog.agents ?? []).map { $0.text("kind") }
        if provider.map({ !agents.contains($0) }) ?? true { provider = agents.first }
    }

    func start(_ session: SharedMachineSession) async -> ProjectViewTarget? {
        guard !starting, let provider, let catalog else { return nil }
        starting = true
        defer { starting = false }
        problem = nil
        let machineID = session.machine.id
        guard let projectID else {
            guard let place = await catalog.start(provider: provider) else {
                problem = catalog.problem
                return nil
            }
            return ProjectViewTarget(
                machineID: machineID, projectID: place.projectID, viewID: place.viewID, itemID: place.viewID)
        }
        let workspace = MobileWorkspace(session: session, projectID: projectID)
        workspace.start()
        defer { workspace.stop() }
        for _ in 0..<150 where !workspace.ready {
            do { try await Task.sleep(for: .milliseconds(100)) } catch { return nil }
        }
        guard workspace.ready else {
            problem = workspace.problem ?? String(localized: "The project did not open in time.")
            return nil
        }
        let id = "chat-" + UUID().uuidString
        let view = NewChat.projectView(id: id, provider: provider, account: catalog.account(for: provider))
        await workspace.edit { $0.setting("views", .array($0.list("views") + [view])) }
        if let failure = workspace.problem {
            problem = failure
            return nil
        }
        return ProjectViewTarget(machineID: machineID, projectID: projectID, viewID: id, itemID: id)
    }
}

struct NowNewChatSheet: View {
    let runtime: AppRuntime
    let now: NowModel
    let opened: (ProjectViewTarget) -> Void
    @State private var model: NowNewChatModel
    @State private var lease: MachineNavigationLease?
    @Environment(\.dismiss) private var dismiss

    /// `project` is where the chat starts unless a person picks another place, such as the project an iPad has open.
    init(
        runtime: AppRuntime, now: NowModel, project: NowChatProject? = nil,
        opened: @escaping (ProjectViewTarget) -> Void
    ) {
        self.runtime = runtime
        self.now = now
        self.opened = opened
        let first = runtime.machines.first { now.connected($0.id) } ?? runtime.machines.first
        let model = NowNewChatModel(machineID: project?.machineID ?? first?.id ?? "")
        model.projectID = project?.projectID
        _model = State(initialValue: model)
    }

    private var session: SharedMachineSession? {
        runtime.machines.first { $0.id == model.machineID }.map(runtime.session(for:))
    }

    var body: some View {
        NavigationStack {
            MobileForm {
                if runtime.machines.count > 1 {
                    Picker("Machine", selection: $model.machineID) {
                        ForEach(runtime.machines, id: \.id) { machine in Text(machine.name).tag(machine.id) }
                    }
                }
                Section("Chat with") {
                    if let agents = model.catalog?.agents {
                        if agents.isEmpty {
                            Text("Install an agent CLI, then set it up under Agents in Ruimte's settings on your computer.")
                                .foregroundStyle(MobileStyle.muted)
                        }
                        ForEach(agents, id: \.agentKind) { agent in
                            let kind = agent.text("kind")
                            choice(agent.text("name", fallback: kind), icon: "bot", picked: model.provider == kind) {
                                model.provider = kind
                            }
                        }
                    } else if model.catalog?.problem == nil {
                        MobileLoadingRow(
                            session?.connected == true
                                ? String(localized: "Looking for agents")
                                : String(localized: "Connecting to your machine"))
                    }
                }
                Section {
                    choice(
                        session.map { String(localized: "Chats on \($0.machine.name)") }
                            ?? String(localized: "Chats on this machine"),
                        icon: "messages-square",
                        picked: model.projectID == nil
                    ) { model.projectID = nil }
                    ForEach(now.chatProjects(on: model.machineID)) { project in
                        choice(project.name, icon: "folder", picked: model.projectID == project.projectID) {
                            model.projectID = project.projectID
                        }
                    }
                } header: {
                    Text("Where")
                } footer: {
                    Text(
                        model.projectID == nil
                            ? "A chat in Chats has no folder of a project."
                            : "The chat works in the project's folder and is listed with its views.")
                }
                if let problem = model.problem ?? model.catalog?.problem {
                    Section { Text(problem).foregroundStyle(MobileStyle.statusError) }
                }
            }
            .navigationTitle("New chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start chat") {
                        guard let session else { return }
                        Task {
                            guard let target = await model.start(session) else { return }
                            dismiss()
                            opened(target)
                        }
                    }
                    .disabled(model.starting || model.provider == nil || session?.connected != true)
                    .accessibilityIdentifier("now.newChat.start")
                }
            }
        }
        .disabled(model.starting)
        .task(id: model.machineID) {
            guard let session else { return }
            lease = MachineNavigationLease(session)
        }
        .task(id: "\(model.machineID):\(session?.generation ?? 0)") {
            guard let session, session.connected else { return }
            await model.load(session)
        }
    }

    private func choice(_ title: String, icon: String, picked: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(lucide: icon, size: 18).foregroundStyle(MobileStyle.muted)
                Text(title).foregroundStyle(MobileStyle.text).lineLimit(1)
                Spacer(minLength: 8)
                if picked { Image(lucide: "check", size: 16).foregroundStyle(MobileStyle.accent) }
            }
        }
        .accessibilityAddTraits(picked ? .isSelected : [])
    }
}
