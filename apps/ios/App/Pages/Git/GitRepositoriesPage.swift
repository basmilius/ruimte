import RuimtePulsar
import RuimteTransport
import SwiftUI

/// Every repository the project folder holds, from the pill of the git sheet. Changes, fetch, pull and push cover
/// all of them, and the actions over all say how many they move; a repository opens its own page for what names
/// one repository. One that moved on both sides asks how it comes together.
struct GitRepositoriesPage: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    var workspace: MobileWorkspace?
    let title: String

    private var checkouts: [GitCheckout] { repositories.checkouts }
    private var pushable: [(checkout: GitCheckout, kind: String)] { GitPanel.pushable(checkouts) }

    var body: some View {
        MobileList {
            Text(
                "This project holds \(checkouts.count) repositories. Changes, fetch, pull and push cover all of them; branches, stashes and pull requests belong to one."
            ).font(.callout).foregroundStyle(MobileStyle.muted)
            if repositories.busy {
                GitBusyRow(text: repositories.step ?? repositories.progress ?? "Working")
            }
            if let problem = repositories.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            ForEach(checkouts) { checkout in
                NavigationLink {
                    GitRepositoryPage(
                        client: client, repositories: repositories, path: checkout.path, workspace: workspace)
                } label: {
                    row(checkout)
                }
                if GitPanel.diverged(checkout) {
                    GitDivergedRow(client: client, repositories: repositories, checkout: checkout, named: true)
                }
            }
            if repositories.truncated {
                Text("This folder holds more repositories than the list carries.")
                    .font(.caption).foregroundStyle(MobileStyle.muted)
            }
        }
        .navigationTitle("Repositories")
        .navigationSubtitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            GitBottomBar {
                GitBarButton(title: "Pull all", prominent: false) {
                    Task { await repositories.actAll(client: client, kind: "pull") }
                }.disabled(repositories.busy)
                GitBarButton(title: pushable.count == 1 ? "Push 1 repository" : "Push \(pushable.count) repositories") {
                    Task { await repositories.pushAll(client: client) }
                }.disabled(repositories.busy || pushable.isEmpty)
            }
        }
    }

    private func row(_ checkout: GitCheckout) -> some View {
        HStack(spacing: 10) {
            Image(lucide: gitRepoIcon(checkout.kind), size: 16).foregroundStyle(MobileStyle.muted)
            VStack(alignment: .leading, spacing: 3) {
                Text(checkout.label).lineLimit(1)
                HStack(spacing: 6) {
                    if let branch = checkout.branch {
                        Text(branch).font(.caption.monospaced())
                    }
                    Text(GitPanel.repositoryState(checkout)).font(.caption)
                        .foregroundStyle(
                            checkout.failure != nil
                                ? .red : GitPanel.diverged(checkout) ? MobileStyle.statusNeedsYou : MobileStyle.muted)
                }
                .foregroundStyle(MobileStyle.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            GitAheadBehind(ahead: checkout.ahead, behind: checkout.behind)
        }
    }
}

extension GitRepositories {
    /// Every repository that has something to push, one after another. A branch git has never seen is published
    /// with an upstream in the same push, which is a different flag for git.
    func pushAll(client: any MachineRequesting) async {
        for entry in GitPanel.pushable(checkouts) {
            await act(client: client, cwd: entry.checkout.path, kind: entry.kind)
        }
    }
}
