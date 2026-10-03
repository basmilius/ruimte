import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// A pull request for the branch a repository has out: its title and description, and what it carries over the
/// base. The machine publishes the branch first when the remote has never seen it, and `gh` opens it on the
/// remote's default branch.
@MainActor @Observable final class GitPullRequestModel {
    let repositories: GitRepositories
    let path: String
    var title: String
    var body = ""
    /// Files and lines the branch changes over its base, once read.
    private(set) var stats: (files: Int, added: Int, deleted: Int)?
    private(set) var url: URL?

    init(repositories: GitRepositories, path: String, subject: String) {
        self.repositories = repositories
        self.path = path
        title = subject
    }

    var checkout: GitCheckout? { repositories.checkout(path) }
    var ready: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !repositories.busy }

    static func summary(files: Int, added: Int, deleted: Int) -> String {
        let count = files == 1 ? "1 file" : "\(files) files"
        return "\(count) · +\(added) −\(deleted)"
    }

    /// What the branch carries over its base, and the last commit's subject as a title when none was given.
    func load(client: any MachineRequesting) async {
        if title.isEmpty,
            let log = try? await client.request(
                "git.log", payload: .object(["cwd": .string(path), "limit": .number(1)]))
        {
            title = log.list("commits").first?.text("subject") ?? ""
        }
        var payload: [String: JSONValue] = [
            "cwd": .string(path), "scope": .string("base"), "staged": .bool(false),
        ]
        if let base = checkout?.status?["base"]?.stringValue { payload["base"] = .string(base) }
        guard let diff = try? await client.request("git.diff", payload: .object(payload)) else { return }
        let files = diff.list("files")
        stats = (
            files.count, files.reduce(0) { $0 + Int($1.number("added")) },
            files.reduce(0) { $0 + Int($1.number("deleted")) }
        )
    }

    /// Opens the pull request; the line it returns is what the sheet says afterwards.
    func create(client: any MachineRequesting) async -> String? {
        let result = await repositories.act(
            client: client, cwd: path, kind: "create-pr",
            extra: ["subject": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)), "body": .string(body)])
        guard let result else { return nil }
        url = result["url"]?.stringValue.flatMap(URL.init(string:))
        return result.text("summary", fallback: "The pull request is open.")
    }
}

struct GitPullRequestPage: View {
    let client: any MachineRequesting
    let onDone: (String) -> Void
    @State private var model: GitPullRequestModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    init(
        client: any MachineRequesting, repositories: GitRepositories, path: String, subject: String,
        onDone: @escaping (String) -> Void
    ) {
        self.client = client
        self.onDone = onDone
        _model = State(initialValue: GitPullRequestModel(repositories: repositories, path: path, subject: subject))
    }

    var body: some View {
        MobileForm {
            Section {
                HStack(spacing: 8) {
                    branchChip(model.checkout?.status?["base"]?.stringValue ?? "default branch")
                    Image(lucide: "arrow-left", size: 14).foregroundStyle(MobileStyle.faint)
                        .accessibilityLabel("from")
                    branchChip(model.checkout?.branch ?? "HEAD")
                }
            }
            Section("Title") {
                TextField("Title", text: $model.title, axis: .vertical).lineLimit(1...3)
            }
            Section("Description") {
                TextField("What changes and how it was tested", text: $model.body, axis: .vertical).lineLimit(4...12)
            }
            Section {
                if let stats = model.stats {
                    Text(GitPullRequestModel.summary(files: stats.files, added: stats.added, deleted: stats.deleted))
                        .font(.callout.monospacedDigit())
                }
            } footer: {
                Text("Publishes the branch first if needed. The pull request opens in your browser.")
            }
            if model.repositories.busy {
                Section { GitBusyRow(text: model.repositories.progress ?? "Opening the pull request") }
            }
            if let problem = model.repositories.problem {
                Section { Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red) }
            }
        }
        .navigationTitle("Open a pull request")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            GitBottomBar {
                GitBarButton(title: "Create pull request") { Task { await create() } }.disabled(!model.ready)
            }
        }
        .task { await model.load(client: client) }
    }

    private func branchChip(_ name: String) -> some View {
        Text(name).font(.callout.monospaced()).lineLimit(1).truncationMode(.middle)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(MobileStyle.active, in: Capsule())
    }

    private func create() async {
        guard let line = await model.create(client: client) else { return }
        if let url = model.url { openURL(url) }
        onDone(line)
        dismiss()
    }
}
