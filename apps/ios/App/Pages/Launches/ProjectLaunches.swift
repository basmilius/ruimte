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
    static let outdated = "Update Ruimte on this machine to use launches on the phone."

    static func reason(_ error: any Error) -> String {
        switch error {
        case MachineClientError.server(code: "unknown-request", message: _): outdated
        case LaunchSaveFailure.conflict: "The launches changed elsewhere while you edited them."
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
    private(set) var document: LaunchesDocument?
    /// By launch id: what ran since the machine started.
    private(set) var statuses: [String: LaunchStatus] = [:]
    private(set) var repos: [LaunchRepo] = []
    private(set) var unsupported = false
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
            client.subscribe("launch.status") { [weak self] payload in
                guard let self, payload.text("projectId") == projectID else { return }
                let status = LaunchStatus(json: payload)
                statuses[status.launchID] = status
            })
        subscriptions.append(
            client.subscribe("launches.changed") { [weak self] payload in
                guard let self, payload.text("projectId") == projectID, let document = payload["document"] else { return }
                self.document = LaunchesDocument(json: document)
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
            let answer = try await client.request(
                WireRequest.launchesRead.rawValue, payload: .object(["projectId": .string(projectID)]))
            document = LaunchesDocument(json: answer)
            unsupported = false
        } catch is CancellationError {
            return
        } catch {
            if case MachineClientError.server(code: "unknown-request", message: _) = error {
                unsupported = true
            } else {
                problem = error.localizedDescription
            }
            return
        }
        if let list = try? await client.request(WireRequest.launchList.rawValue, payload: .object([:])) {
            let own = list.list("launches").map(LaunchStatus.init(json:)).filter { $0.projectID == projectID }
            statuses = Dictionary(own.map { ($0.launchID, $0) }, uniquingKeysWith: { _, last in last })
        }
        // A machine from before `git.repos` lists the launches without headings.
        if let answer = try? await client.request("git.repos", payload: .object(["folder": .string(folder)])) {
            repos = answer.list("repos").map(LaunchRepo.init(json:))
        }
    }

    /// Starts a launch, or starts it again; what it has to ask a person first comes back as `ask`. `approve` is only
    /// ever true from the question that showed the person what it runs.
    func run(_ launchID: String, restart: Bool = false, approve: Bool = false, replace: Bool = false) async {
        var payload: [String: JSONValue] = ["projectId": .string(projectID), "launchId": .string(launchID)]
        if approve { payload["approve"] = .bool(true) }
        if replace { payload["replace"] = .bool(true) }
        do {
            let result = try await client.request(
                (restart ? WireRequest.launchRestart : WireRequest.launchStart).rawValue, payload: .object(payload))
            problem = nil
            switch result.text("outcome") {
            case "held":
                ask = .held(
                    launchID: launchID, restart: restart, held: result.list("held").map(LaunchHeld.init(json:)),
                    replace: replace)
            case "busy":
                let busy = result["busy"] ?? .object([:])
                ask = .busy(
                    launchID: launchID, restart: restart, holder: busy.text("launchId"), port: Int(busy.number("port")),
                    approve: approve)
            default:
                ask = nil
            }
        } catch {
            problem = "Could not launch \(name(launchID)): \(message(error))"
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
            _ = try await client.request(WireRequest.launchStop.rawValue, payload: .object(payload))
            problem = nil
        } catch {
            problem = "Could not stop \(name(launchID)): \(message(error))"
        }
    }

    /// Every launch of the project that runs; a group stops through its members.
    func stopAll() async {
        for status in statuses.values where status.live { await stop(status.launchID) }
    }

    /// Saves the whole list against the rev it was read at. A save by a person approves what it adds or changes.
    func save(_ launches: [JSONValue], baseRev: Int) async throws {
        do {
            _ = try await client.request(
                WireRequest.launchesSave.rawValue,
                payload: .object([
                    "projectId": .string(projectID), "baseRev": .number(Double(baseRev)), "launches": .array(launches),
                ]))
        } catch MachineClientError.server(let code, _) where code == "rev-conflict" {
            throw LaunchSaveFailure.conflict
        } catch {
            throw LaunchSaveFailure.failed(message(error))
        }
    }

    func delete(_ launchID: String) async {
        guard let document else { return }
        let drafts = LaunchEditing.without(document.launches.map(LaunchEditing.draft(of:)), id: launchID)
        do {
            try await save(LaunchEditing.saved(drafts), baseRev: document.rev)
            problem = nil
        } catch LaunchSaveFailure.conflict {
            problem = "The launches changed elsewhere. Look again before deleting."
            await load()
        } catch {
            problem = "Could not delete \(name(launchID)): \(LaunchesText.reason(error))"
        }
    }

    /// What the machine finds in the project to import; nil when it could not look.
    func detect() async -> [LaunchSuggestion]? {
        guard
            let result = try? await client.request(
                WireRequest.launchesDetect.rawValue, payload: .object(["projectId": .string(projectID)]))
        else { return nil }
        return result.list("suggestions").map(LaunchSuggestion.init(json:))
    }

    private func message(_ error: any Error) -> String { LaunchesText.reason(error) }
}
