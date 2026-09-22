import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// Every checkout of a project folder, each with its own watch and its own status. It is what the git
/// page draws a section per repository from: a folder of loose repositories has one per repository, a
/// repository with submodules has one per module, and an ordinary project has exactly one.
@MainActor @Observable final class GitRepositories {
    private(set) var checkouts: [GitCheckout] = []
    /// Set when the folder holds more repositories than the list carries.
    private(set) var truncated = false
    /// True until the first list of repositories has landed, which is the only spinner this page shows.
    private(set) var loading = true
    var problem: String?
    /// An action a person started; what it came from stays disabled until it settles.
    var busy = false
    /// The last line git wrote while an action runs, which is where a slow push says where it is.
    var progress: String?
    /// Which repository a run over several of them is on, as "backend (2/9)".
    var step: String?

    /// A folder with one repository names none, in the list, the log and the commit box.
    var named: Bool { checkouts.count > 1 }
    var changeCount: Int { checkouts.reduce(0) { $0 + $1.files.count } }
    var ahead: Int { checkouts.reduce(0) { $0 + $1.ahead } }
    var behind: Int { checkouts.reduce(0) { $0 + $1.behind } }

    @ObservationIgnored private var leases: [String: MachineSubscription] = [:]

    func checkout(_ path: String) -> GitCheckout? { checkouts.first { $0.path == path } }

    private enum Signal {
        case connected
        case status(JSONValue)
    }

    /// The whole life of the page: the repositories of the folder, a watch on each of them, and the
    /// statuses the daemon pushes back. A reconnect reads the list again, because a folder can have
    /// gained or lost a repository while the phone was away.
    func run(client: any MachineRequesting, folder: String) async {
        let (stream, continuation) = AsyncStream<Signal>.makeStream(bufferingPolicy: .unbounded)
        let cancelConnection = client.observeConnection { if $0 { continuation.yield(.connected) } }
        let cancelStatus = client.subscribe("git.status") { continuation.yield(.status($0)) }
        defer {
            cancelConnection()
            cancelStatus()
            continuation.finish()
            let held = leases
            leases = [:]
            Task { await withTaskCancellationShield { for lease in held.values { await lease.release() } } }
        }
        for await signal in stream {
            if Task.isCancelled { break }
            switch signal {
            case .connected:
                await reload(client: client, folder: folder)
            case .status(let payload):
                apply(payload)
            }
        }
    }

    /// Reads which repositories the folder holds, then takes a watch and a first status on each.
    func reload(client: any MachineRequesting, folder: String) async {
        do {
            let answer = try await client.request("git.repos", payload: .object(["folder": .string(folder)]))
            let repos = answer.list("repos")
            truncated = answer["truncated"] == .bool(true)
            checkouts = repos.map { repo in
                let path = repo.text("path")
                return GitCheckout(
                    path: path, label: repo.text("label", fallback: GitPanel.label(folder: folder, path: path)),
                    kind: repo.text("kind", fallback: "nested"), status: checkout(path)?.status)
            }
            problem = nil
        } catch is CancellationError {
            return
        } catch {
            // A machine from before `git.repos` still has the folder itself, which is what the page used to show.
            if checkouts.isEmpty {
                checkouts = [GitCheckout(path: folder, label: GitPanel.label(folder: folder, path: folder), kind: "root")]
            }
        }
        loading = false
        await watchAll(client: client)
        await refreshAll(client: client)
    }

    /// One watch per repository, and none for a repository that is no longer in the list.
    private func watchAll(client: any MachineRequesting) async {
        let wanted = Set(checkouts.map(\.path))
        for (path, lease) in leases where !wanted.contains(path) {
            leases.removeValue(forKey: path)
            await lease.release()
        }
        for checkout in checkouts where leases[checkout.path] == nil {
            let payload: JSONValue = .object(["cwd": .string(checkout.path)])
            leases[checkout.path] = client.acquireSubscription(
                start: "git.watch", stop: "git.unwatch", payload: payload, stopPayload: payload)
        }
        for lease in leases.values { _ = try? await lease.refresh() }
    }

    /// One status after another: they all go down the same socket, so asking for nine at once would
    /// only put nine git runs on the machine at the same time.
    func refreshAll(client: any MachineRequesting) async {
        for path in checkouts.map(\.path) {
            if Task.isCancelled { return }
            await refresh(client: client, cwd: path)
        }
    }

    func refresh(client: any MachineRequesting, cwd: String) async {
        do {
            store(path: cwd, result: .success(try await client.request("git.status", payload: .object(["cwd": .string(cwd)]))))
        } catch {
            store(path: cwd, result: .failure(error))
        }
    }

    private func store(path: String, result: Result<JSONValue, any Error>) {
        guard let index = checkouts.firstIndex(where: { $0.path == path }) else { return }
        switch result {
        case .success(let status):
            checkouts[index].status = hideNested(status, root: path)
            checkouts[index].failure = nil
        case .failure(let error):
            if error is CancellationError { return }
            checkouts[index].failure = error.localizedDescription
        }
    }

    private func apply(_ payload: JSONValue) {
        let cwd = payload.text("cwd")
        guard let status = payload["status"], let index = checkouts.firstIndex(where: { $0.path == cwd }) else { return }
        checkouts[index].status = hideNested(status, root: cwd)
        checkouts[index].failure = nil
    }

    private func hideNested(_ status: JSONValue, root: String) -> JSONValue? {
        GitPanel.withoutNestedRepos(status, root: root, others: checkouts.map(\.path))
    }
}
