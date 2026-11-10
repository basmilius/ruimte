import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What a diff page is asked for: one file of a checkout, a whole commit of it, or everything a checkout
/// holds over the branch it was made from.
struct GitDiffTarget: Hashable, Identifiable {
    let cwd: String
    /// Nil for a whole commit or a whole checkout, which is every file it touched.
    let path: String?
    let staged: Bool
    let commit: String?
    /// What a whole checkout is measured from; nil measures from the repository's base branch. With a path, one
    /// file against that ref, staged and unstaged together.
    var base: String? = nil

    var id: String { "\(cwd)\u{0}\(path ?? "")\u{0}\(commit ?? "")\u{0}\(staged)\u{0}\(base ?? "")" }
    var scope: String { commit != nil ? "commit" : path == nil || base != nil ? "base" : "worktree" }
    var title: String {
        if let path { return (path as NSString).lastPathComponent }
        if let commit { return String(commit.prefix(7)) }
        return (cwd as NSString).lastPathComponent
    }
}

/// The patch itself. One file shows its own hunks; a whole commit shows every file it touched, each
/// under its own heading, which is the only way a commit reads on a phone without a second page.
struct GitDiffPage: View {
    let client: any MachineRequesting
    let target: GitDiffTarget
    @State private var state = RemotePageState()
    @State private var diff: GitDiffResult?

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 16) {
                RemotePageStatus(state: state) { Task { await load() } }
                if let diff {
                    if let commit = diff.commit {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(commit.subject).font(.callout.weight(.medium))
                            Text("\(commit.author) · \(commit.shortHash)")
                                .font(.caption).foregroundStyle(MobileStyle.muted)
                        }
                    }
                    let files = diff.files ?? []
                    if files.isEmpty {
                        patch(diff.diff, omitted: diff.omitted)
                    } else {
                        ForEach(files, id: \.path) { file in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(file.path).font(.caption.monospaced()).foregroundStyle(MobileStyle.muted)
                                patch(file.diff, omitted: file.omitted)
                            }
                        }
                    }
                    if diff.truncated == true {
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
                client: client, events: [.gitStatus], matches: RemotePageLifecycle.typed(GitStatusEvent.self) { $0.cwd == target.cwd },
                watch: { GitPanel.watch(cwd: target.cwd) }, load: load)
        }
    }

    @ViewBuilder private func patch(_ diff: String, omitted: GitDiffOmitted?) -> some View {
        if let omitted {
            ContentUnavailableView(
                omitted == .binary ? String(localized: "Binary file") : String(localized: "Diff too large"),
                lucideIcon: "file-text")
        } else {
            let lines = diff.components(separatedBy: "\n")
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
        await state.read(loaded: diff != nil) { stillTheLatest in
            var fields: [String: JSONValue] = [
                "cwd": .string(target.cwd), "scope": .string(target.scope), "staged": .bool(target.staged),
            ]
            if let path = target.path { fields["path"] = .string(path) }
            if let commit = target.commit { fields["commit"] = .string(commit) }
            if let base = target.base { fields["base"] = .string(base) }
            let result = try await client.request(.gitDiff, payload: .object(fields)).decoded(as: GitDiffResult.self)
            try stillTheLatest()
            diff = result
        }
    }
}

func gitDiffColor(_ line: String) -> Color {
    if line.hasPrefix("+++") || line.hasPrefix("---") { return MobileStyle.muted }
    if line.hasPrefix("+") { return MobileStyle.positive }
    if line.hasPrefix("-") { return MobileStyle.statusError }
    if line.hasPrefix("@@") { return MobileStyle.accent }
    return MobileStyle.text
}
