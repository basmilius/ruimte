import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// Why a save of the launches did not land.
enum LaunchSaveFailure: Error, Equatable {
    /// The launches changed elsewhere since they were read; start over from the latest.
    case conflict
    case failed(String)
}

enum LaunchesText {
    static func reason(_ error: any Error) -> String {
        switch error {
        case LaunchSaveFailure.conflict: String(localized: "The launches changed elsewhere.")
        case LaunchSaveFailure.failed(let reason): reason
        default: error.localizedDescription
        }
    }
}

/// The launches of one project with the state of each, and everything done to them from the phone. Every request
/// here speaks for a person, as the daemon reads any client's: a start may approve what it runs, and that approval is
/// only ever sent after a person said yes to the command, folder and variables the machine showed.
@MainActor @Observable final class ProjectLaunches {
    let client: any MachineRequesting
    let projectID: String
    let folder: String
    /// Nil until the machine answered.
    private(set) var document: LaunchBook?
    /// By launch id: what ran since the machine started.
    private(set) var statuses: [String: LaunchStatus] = [:]
    private(set) var repos: [GitRepo] = []
    private(set) var connected = false
    var problem: String?
    var ask: LaunchAsk?
    private var subscriptions: [() -> Void] = []

    init(client: any MachineRequesting, projectID: String, folder: String) {
        self.client = client
        self.projectID = projectID
        self.folder = folder
    }

    var views: [String: LaunchView] {
        guard let document else { return [:] }
        return LaunchLogic.views(document: document, statuses: statuses)
    }

    var sections: [LaunchSection] {
        LaunchLogic.sections(document?.launches ?? [], folder: folder, repos: repos)
    }

    var anyLive: Bool { statuses.values.contains(where: \.live) }

    func name(_ launchID: String) -> String { document?.launch(launchID)?.name ?? launchID }

    func start() {
        guard subscriptions.isEmpty else { return }
        subscriptions.append(
            client.subscribe(.launchStatus) { [weak self] payload in
                guard let self, let status = try? payload.decoded(as: LaunchStatus.self), status.projectId == projectID
                else { return }
                statuses[status.launchId] = status
            })
        subscriptions.append(
            client.subscribe(.launchesChanged) { [weak self] payload in
                guard let self, let change = try? payload.decoded(as: LaunchesChanged.self),
                    change.projectId == projectID
                else { return }
                document = change.document
            })
        subscriptions.append(
            client.observeConnection { [weak self] available in
                guard let self else { return }
                connected = available
                // What changed while the link was down was pushed to nobody.
                if available { Task { await self.load() } }
            })
    }

    func stop() {
        subscriptions.forEach { $0() }
        subscriptions.removeAll()
    }

    func load() async {
        do {
            document = try await client.request(.launchesRead, payload: .object(["projectId": .string(projectID)]))
                .decoded(as: LaunchBook.self)
        } catch is CancellationError {
            return
        } catch {
            problem = error.localizedDescription
            return
        }
        if let list = try? await client.request(.launchList).decoded(as: LaunchListResult.self) {
            let own = list.launches.filter { $0.projectId == projectID }
            statuses = Dictionary(own.map { ($0.launchId, $0) }, uniquingKeysWith: { _, last in last })
        }
        // Without the repositories the launches list without headings.
        if let answer = try? await client.request(.gitRepos, payload: .object(["folder": .string(folder)]))
            .decoded(as: GitReposResult.self)
        {
            repos = answer.repos
        }
    }

    /// Starts a launch, or starts it again; what it has to ask a person first comes back as `ask`. `approve` is only
    /// ever true from the question that showed the person what it runs.
    func run(_ launchID: String, restart: Bool = false, approve: Bool = false, replace: Bool = false) async {
        var payload: [String: JSONValue] = ["projectId": .string(projectID), "launchId": .string(launchID)]
        if approve { payload["approve"] = .bool(true) }
        if replace { payload["replace"] = .bool(true) }
        do {
            let result = try await client.request(restart ? .launchRestart : .launchStart, payload: .object(payload))
                .decoded(as: LaunchStartResult.self)
            problem = nil
            switch result.outcome {
            case .held:
                ask = .held(launchID: launchID, restart: restart, held: result.held ?? [], replace: replace)
            case .busy:
                if let busy = result.busy {
                    ask = .busy(
                        launchID: launchID, restart: restart, holder: busy.launchId, port: Int(busy.port),
                        approve: approve)
                } else {
                    ask = nil
                }
            case .started:
                ask = nil
            }
        } catch {
            problem = String(localized: "Could not launch \(name(launchID)): \(error.localizedDescription)")
        }
    }

    /// The press on a launch's play button: a start, or a restart while what it runs still runs.
    func press(_ launch: LaunchEntry) async {
        await run(launch.id, restart: LaunchLogic.runs(launch, statuses: statuses))
    }

    /// `force` is SIGKILL at once, which only a person's Force stop asks for.
    func stop(_ launchID: String, force: Bool = false) async {
        var payload: [String: JSONValue] = ["projectId": .string(projectID), "launchId": .string(launchID)]
        if force { payload["force"] = .bool(true) }
        do {
            _ = try await client.request(.launchStop, payload: .object(payload))
            problem = nil
        } catch {
            problem = String(localized: "Could not stop \(name(launchID)): \(error.localizedDescription)")
        }
    }

    /// Every launch of the project that runs; a group stops through its members.
    func stopAll() async {
        for status in statuses.values where status.live { await stop(status.launchId) }
    }

    /// Saves the whole list against the rev it was read at. A save by a person approves what it adds or changes.
    /// `imported` names the launches an import added, which a person has not approved yet.
    func save(_ launches: [JSONValue], baseRev: Int, imported: [String] = []) async throws {
        var payload: [String: JSONValue] = [
            "projectId": .string(projectID), "baseRev": .number(Double(baseRev)), "launches": .array(launches),
        ]
        if !imported.isEmpty { payload["imported"] = .array(imported.map { .string($0) }) }
        do {
            _ = try await client.request(.launchesSave, payload: .object(payload))
        } catch MachineClientError.server(let code, _) where code == "rev-conflict" {
            throw LaunchSaveFailure.conflict
        } catch {
            throw LaunchSaveFailure.failed(error.localizedDescription)
        }
    }

    func delete(_ launchID: String) async {
        guard let document else { return }
        let drafts = LaunchEditing.without(document.launches.map(LaunchEditing.draft(of:)), id: launchID)
        do {
            try await save(LaunchEditing.saved(drafts), baseRev: document.rev)
            problem = nil
        } catch LaunchSaveFailure.conflict {
            problem = String(localized: "The launches changed elsewhere. Look again before deleting.")
            await load()
        } catch {
            problem = String(localized: "Could not delete \(name(launchID)): \(LaunchesText.reason(error))")
        }
    }

    /// What the machine finds in the project to import; nil when it could not look.
    func detect() async -> [LaunchSuggestion]? {
        guard
            let result = try? await client.request(
                .launchesDetect,
                payload: .object(["projectId": .string(projectID), "sources": .array([.string("vscode-launch")])])
            ).decoded(as: LaunchesDetectResult.self)
        else { return nil }
        return result.suggestions
    }
}
