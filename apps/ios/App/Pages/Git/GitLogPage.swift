import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The history under the changes: every repository of the folder at once, newest first, each row
/// saying where it came from. One repository named in `only` reads that repository alone.
struct GitLogPage: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    var only: String?
    @State private var logs: [GitLoadedLog] = []
    @State private var loading = true
    @State private var paging = false
    @State private var problem: String?
    @State private var diff: GitDiffTarget?

    private static let page = 30

    private var sources: [GitCheckout] {
        guard let only else { return repositories.checkouts }
        return repositories.checkouts.filter { $0.path == only }
    }

    var body: some View {
        let merged = GitPanel.mergeLogs(logs)
        MobileList {
            if let problem {
                VStack(alignment: .leading, spacing: 12) {
                    Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
                    Button("Try again") { Task { await load() } }
                }.padding(.vertical, 8)
            }
            if loading {
                MobileLoadingRow("Loading").frame(maxWidth: .infinity).padding()
            } else if merged.rows.isEmpty {
                ContentUnavailableView("No commits yet", lucideIcon: "git-commit-horizontal")
            }
            ForEach(merged.rows) { row in
                Button {
                    diff = GitDiffTarget(cwd: row.cwd, path: nil, staged: false, commit: row.commit.text("hash"))
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.commit.text("subject")).lineLimit(2)
                        HStack(spacing: 8) {
                            if repositories.named && only == nil {
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
                Button(paging ? "Loading" : "Load more") { Task { await loadMore() } }
                    .disabled(paging).frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(only == nil ? "History" : repositories.checkout(only!)?.label ?? "History")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $diff) { target in GitDiffPage(client: client, target: target) }
        .task(id: only ?? "") { await load() }
        .refreshable { await load() }
    }

    private func load() async {
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
    private func loadMore() async {
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
