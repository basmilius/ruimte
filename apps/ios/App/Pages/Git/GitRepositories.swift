import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// Every checkout of a project folder, each with its own watch and its own status. It is what the git
/// page draws a section per repository from: a folder of loose repositories has one per repository, a
/// repository with submodules has one per module, and an ordinary project has exactly one.
@MainActor @Observable final class GitRepositories {
    private(set) var checkouts: [GitCheckout] = []
    private(set) var truncated = false
    /// True until the first list of repositories has landed, which is the only spinner this page shows.
    private(set) var loading = true
    var problem: String?
    var refusal: MachineErrorCode?
    /// An action a person started; what it came from stays disabled until it settles.
    var busy = false
    var progress: String?
    /// Which repository a run over several of them is on, as "backend (2/9)".
    var step: String?

    /// A folder with one repository names none, in the list, the log and the commit box.
    var named: Bool { checkouts.count > 1 }
    var changeCount: Int { checkouts.reduce(0) { $0 + $1.files.count } }
    var ahead: Int { checkouts.reduce(0) { $0 + $1.ahead } }
    var behind: Int { checkouts.reduce(0) { $0 + $1.behind } }

    @ObservationIgnored private var leases: [String: MachineSubscription] = [:]
    /// What was made of the conflicts of every checkout so far, worktrees a merge stopped in included.
    @ObservationIgnored let conflicts = GitCheckoutCache(GitConflictSession.init(cwd:))
    @ObservationIgnored let worktrees = GitCheckoutCache(GitWorktreesState.init(repo:))

    func checkout(_ path: String) -> GitCheckout? { checkouts.first { $0.path == path } }

    /// The whole life of the page: the repositories of the folder, a watch on each of them, and the
    /// statuses the daemon pushes back. A reconnect reads the list again, because a folder can have
    /// gained or lost a repository while the phone was away.
    func run(client: any MachineRequesting, folder: String) async {
        let live = LiveResource(
            client: client, events: [.apply(.gitStatus, raw: { [weak self] in self?.apply($0) })],
            read: { [weak self] in await self?.reload(client: client, folder: folder) })
        await live.run()
        let held = leases
        leases = [:]
        Task { await withTaskCancellationShield { for lease in held.values { await lease.release() } } }
    }

    func reload(client: any MachineRequesting, folder: String) async {
        do {
            let answer = try await client.request(.gitRepos, payload: .object(["folder": .string(folder)]))
                .decoded(as: GitReposResult.self)
            truncated = answer.truncated
            checkouts = answer.repos.map { repo in
                GitCheckout(path: repo.path, label: repo.label, kind: repo.kind, status: checkout(repo.path)?.status)
            }
            problem = nil
        } catch is CancellationError {
            return
        } catch {
            problem = error.localizedDescription
        }
        loading = false
        await watchAll(client: client)
        await refreshAll(client: client)
    }

    private func watchAll(client: any MachineRequesting) async {
        let wanted = Set(checkouts.map(\.path))
        for (path, lease) in leases where !wanted.contains(path) {
            leases.removeValue(forKey: path)
            await lease.release()
        }
        for checkout in checkouts where leases[checkout.path] == nil {
            leases[checkout.path] = client.acquireSubscription(GitPanel.watch(cwd: checkout.path))
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
            let status = try await client.request(.gitStatus, payload: .object(["cwd": .string(cwd)]))
            store(path: cwd, result: .success(try status.decoded(as: GitStatus.self)))
        } catch {
            store(path: cwd, result: .failure(error))
        }
    }

    private func store(path: String, result: Result<GitStatus, any Error>) {
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
        guard let event = try? payload.decoded(as: GitStatusEvent.self),
            let index = checkouts.firstIndex(where: { $0.path == event.cwd })
        else { return }
        checkouts[index].status = hideNested(event.status, root: event.cwd)
        checkouts[index].failure = nil
    }

    private func hideNested(_ status: GitStatus, root: String) -> GitStatus? {
        GitPanel.withoutNestedRepos(status, root: root, others: checkouts.map(\.path))
    }
}
