import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What a diff page is asked for: one file of a checkout, or a whole commit of it.
struct GitDiffTarget: Hashable, Identifiable {
    let cwd: String
    /// Nil for a whole commit, which is every file it touched.
    let path: String?
    let staged: Bool
    let commit: String?

    var id: String { "\(cwd)\u{0}\(path ?? "")\u{0}\(commit ?? "")\u{0}\(staged)" }
    var scope: String { commit == nil ? "worktree" : "commit" }
    var title: String {
        if let path { return (path as NSString).lastPathComponent }
        return String((commit ?? "").prefix(7))
    }
}

/// The patch itself. One file shows its own hunks; a whole commit shows every file it touched, each
/// under its own heading, which is the only way a commit reads on a phone without a second page.
struct GitDiffPage: View {
    let client: any MachineRequesting
    let target: GitDiffTarget
    @State private var state = RemotePageState()

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 16) {
                RemotePageStatus(state: state) { Task { await load() } }
                if let diff = state.value {
                    if let commit = diff["commit"] {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(commit.text("subject")).font(.callout.weight(.medium))
                            Text("\(commit.text("author")) · \(commit.text("shortHash"))")
                                .font(.caption).foregroundStyle(MobileStyle.muted)
                        }
                    }
                    let files = diff.list("files")
                    if files.isEmpty {
                        patch(diff)
                    } else {
                        ForEach(files, id: \.stableID) { file in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(file.text("path")).font(.caption.monospaced()).foregroundStyle(MobileStyle.muted)
                                patch(file)
                            }
                        }
                    }
                    if diff["truncated"] == .bool(true) {
                        Text("Some files of this commit were left out.")
                            .font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                }
            }.padding()
        }
        .navigationTitle(target.title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: target.id) {
            // A commit never changes, so only a working-tree diff follows the repository it came from.
            if target.commit != nil {
                await load()
                return
            }
            await RemotePageLifecycle.run(
                client: client, events: ["git.status"], matches: { $0.text("cwd") == target.cwd },
                subscription: {
                    let payload: JSONValue = .object(["cwd": .string(target.cwd)])
                    return client.acquireSubscription(
                        start: "git.watch", stop: "git.unwatch", payload: payload, stopPayload: payload)
                }, load: load)
        }
    }

    @ViewBuilder private func patch(_ file: JSONValue) -> some View {
        if let omitted = file["omitted"]?.stringValue {
            ContentUnavailableView(
                omitted == "binary" ? "Binary file" : "Diff too large", lucideIcon: "file-text")
        } else {
            let lines = file.text("diff").components(separatedBy: "\n")
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { item in
                    Text(item.element.isEmpty ? " " : item.element)
                        .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                        .foregroundStyle(gitDiffColor(item.element))
                }
            }
        }
    }

    private func load() async {
        await state.load {
            var fields: [String: JSONValue] = [
                "cwd": .string(target.cwd), "scope": .string(target.scope), "staged": .bool(target.staged),
            ]
            if let path = target.path { fields["path"] = .string(path) }
            if let commit = target.commit { fields["commit"] = .string(commit) }
            return try await client.request("git.diff", payload: .object(fields))
        }
    }
}

func gitDiffColor(_ line: String) -> Color {
    if line.hasPrefix("+++") || line.hasPrefix("---") { return MobileStyle.muted }
    if line.hasPrefix("+") { return .green }
    if line.hasPrefix("-") { return .red }
    if line.hasPrefix("@@") { return MobileStyle.accent }
    return MobileStyle.text
}
