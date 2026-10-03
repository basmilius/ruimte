import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The history of one or more checkouts, read a page at a time and merged newest first.
@MainActor @Observable final class GitHistoryModel {
    private(set) var logs: [GitLoadedLog] = []
    private(set) var loading = true
    private(set) var paging = false
    var problem: String?

    static let page = 30

    var merged: (rows: [GitLogRow], more: Bool) { GitPanel.mergeLogs(logs) }

    func load(client: any MachineRequesting, sources: [GitCheckout]) async {
        loading = logs.isEmpty
        defer { loading = false }
        var loaded: [GitLoadedLog] = []
        var failures = 0
        for checkout in sources {
            do {
                let answer = try await client.request(
                    "git.log", payload: .object(["cwd": .string(checkout.path), "limit": .number(Double(Self.page))]))
                loaded.append(
                    GitLoadedLog(
                        cwd: checkout.path, repo: checkout.label, commits: answer.list("commits"),
                        cursor: answer["cursor"]?.stringValue))
            } catch is CancellationError {
                return
            } catch {
                failures += 1
            }
        }
        // Only a folder where not one repository answered has nothing to say but the failure.
        problem = failures > 0 && loaded.isEmpty ? "The history could not be read." : nil
        logs = loaded
    }

    /// The next page of every repository that still has one, which is one step down the whole log.
    func loadMore(client: any MachineRequesting) async {
        guard !paging else { return }
        paging = true
        defer { paging = false }
        var next: [GitLoadedLog] = []
        for log in logs {
            guard let cursor = log.cursor else {
                next.append(log)
                continue
            }
            var updated = log
            if let answer = try? await client.request(
                "git.log",
                payload: .object([
                    "cwd": .string(log.cwd), "limit": .number(Double(Self.page)), "cursor": .string(cursor),
                ]))
            {
                updated.commits += answer.list("commits")
                updated.cursor = answer["cursor"]?.stringValue
            } else {
                updated.cursor = nil
            }
            next.append(updated)
        }
        logs = next
    }
}

/// The rows of a history, for the History segment of the sheet and the history page of one repository. A row
/// opens the whole commit's diff.
struct GitHistoryRows: View {
    let client: any MachineRequesting
    let history: GitHistoryModel
    let named: Bool
    let reload: () -> Void
    let onOpen: (GitDiffTarget) -> Void

    var body: some View {
        let merged = history.merged
        if let problem = history.problem {
            VStack(alignment: .leading, spacing: 12) {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
                Button("Try again", action: reload)
            }.padding(.vertical, 8)
        }
        if history.loading {
            MobileLoadingRow("Loading").frame(maxWidth: .infinity).padding()
        } else if merged.rows.isEmpty && history.problem == nil {
            ContentUnavailableView("No commits yet", lucideIcon: "git-commit-horizontal")
        }
        ForEach(merged.rows) { row in
            Button {
                onOpen(GitDiffTarget(cwd: row.cwd, path: nil, staged: false, commit: row.commit.text("hash")))
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.commit.text("subject")).lineLimit(2)
                    HStack(spacing: 8) {
                        if named {
                            Text(row.repo).font(.caption).foregroundStyle(MobileStyle.faint).lineLimit(1)
                        }
                        Text(row.commit.text("author")).font(.caption).foregroundStyle(MobileStyle.muted)
                        Text(gitRelativeTime(row.at)).font(.caption).foregroundStyle(MobileStyle.muted)
                        Spacer(minLength: 0)
                        Text(row.commit.text("shortHash")).font(.caption.monospaced()).foregroundStyle(MobileStyle.faint)
                    }
                }.modifier(MobileSidebarLabel(disclosure: true))
            }
            .modifier(MobileSidebarRow())
            .contextMenu {
                Button("Copy hash", lucideIcon: "copy") { UIPasteboard.general.string = row.commit.text("hash") }
                Button("Copy subject", lucideIcon: "copy") { UIPasteboard.general.string = row.commit.text("subject") }
            }
        }
        if merged.more {
            HStack {
                if history.paging {
                    Spinner(size: 14, label: "Loading more commits").foregroundStyle(MobileStyle.muted)
                } else {
                    Button("Load more") { Task { await history.loadMore(client: client) } }
                }
            }.frame(maxWidth: .infinity)
        }
    }
}

/// The history of one repository of the folder, from that repository's own page.
struct GitLogPage: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    let only: String
    @State private var history = GitHistoryModel()
    @State private var diff: GitDiffTarget?

    private var sources: [GitCheckout] { repositories.checkouts.filter { $0.path == only } }

    var body: some View {
        MobileList {
            GitHistoryRows(
                client: client, history: history, named: false,
                reload: { Task { await history.load(client: client, sources: sources) } },
                onOpen: { diff = $0 })
        }
        .navigationTitle(repositories.checkout(only)?.label ?? "History")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $diff) { target in GitDiffPage(client: client, target: target) }
        .task(id: only) { await history.load(client: client, sources: sources) }
        .refreshable { await history.load(client: client, sources: sources) }
    }
}

/// How long ago a commit was written, short enough for the end of a row.
func gitRelativeTime(_ at: Double, now: Date = Date()) -> String {
    let date = Date(timeIntervalSince1970: at)
    let seconds = max(0, now.timeIntervalSince(date))
    if seconds < 7 * 24 * 3600 {
        let style = RelativeDateTimeFormatter()
        style.unitsStyle = .abbreviated
        return style.localizedString(for: date, relativeTo: now)
    }
    return date.formatted(.dateTime.day().month(.abbreviated))
}
