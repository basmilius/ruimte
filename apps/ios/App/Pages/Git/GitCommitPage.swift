import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What is committed and what it is called. The staged files say where it lands, so a message typed here commits
/// every repository that has something staged, and two staged at once are two commits with the same words.
/// Nothing staged while a single repository has changes is the commit that stages it first.
@MainActor @Observable final class GitCommitModel {
    let repositories: GitRepositories
    var subject = ""
    var body = ""
    /// The CLI that writes a message on this machine; nil hides Write with it.
    private(set) var provider: String?
    private(set) var writing = false
    private var writingID: String?

    init(repositories: GitRepositories) {
        self.repositories = repositories
    }

    var plan: (targets: [GitCheckout], stageAll: Bool) { GitPanel.commitTargets(repositories.checkouts) }
    var ready: Bool {
        !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !plan.targets.isEmpty
            && !repositories.busy && !writing
    }
    /// A message is written from one repository's staged diff; over two there is no one diff to read.
    var writeFrom: String? { plan.targets.count == 1 ? plan.targets[0].path : nil }
    var providerName: String {
        switch provider {
        case "claude": "Claude"
        case "codex": "Codex"
        default: provider ?? String(localized: "an agent")
        }
    }

    /// The files that go in, with the repository they go into.
    var files: [(checkout: GitCheckout, file: JSONValue)] {
        let plan = plan
        return plan.targets.flatMap { target in
            target.files.filter { plan.stageAll || $0.text("state") == "staged" }.map { (target, $0) }
        }
    }

    func loadProvider(client: any MachineRequesting) async {
        guard let probe = repositories.checkouts.first?.path else { return }
        let answer = try? await client.request("git.capabilities", payload: .object(["cwd": .string(probe)]))
        provider = answer?["messageProvider"]?.stringValue
    }

    /// Asks the machine's CLI for a message over the staged diff; asked again while it writes, it stops.
    func write(client: any MachineRequesting) async {
        guard let cwd = writeFrom else { return }
        if writing {
            if let running = writingID {
                _ = try? await client.request("git.cancel", payload: .object(["actionId": .string(running)]))
            }
            return
        }
        let actionID = UUID().uuidString
        writingID = actionID
        writing = true
        defer {
            writing = false
            writingID = nil
        }
        var payload: [String: JSONValue] = ["cwd": .string(cwd), "actionId": .string(actionID)]
        if let provider { payload["provider"] = .string(provider) }
        do {
            let suggestion = try await client.request("git.suggestMessage", payload: .object(payload))
            subject = suggestion.text("subject")
            body = suggestion.text("body")
            repositories.problem = nil
        } catch is CancellationError {
        } catch {
            if gitRefusalCode(error) != "cancelled" {
                repositories.problem = gitMessage(
                    error,
                    outdated: String(localized: "Update Ruimte on this machine to write a commit message on the phone.")
                )
            }
        }
    }

    /// Commits, and pushes when asked; the line it returns is what the sheet says afterwards.
    func commit(client: any MachineRequesting, push: Bool) async -> String? {
        let targets = plan.targets
        let ok = await repositories.commit(
            client: client, targets: targets, subject: subject, body: body, stageAll: plan.stageAll, push: push)
        guard ok else { return nil }
        subject = ""
        body = ""
        if targets.count == 1 {
            let label = targets[0].label
            return push
                ? String(localized: "Committed and pushed in \(label).") : String(localized: "Committed in \(label).")
        }
        return push
            ? String(localized: "Committed and pushed in \(targets.count) repositories.")
            : String(localized: "Committed in \(targets.count) repositories.")
    }
}

/// The commit, pushed inside the git sheet rather than a sheet of its own.
struct GitCommitPage: View {
    let client: any MachineRequesting
    let model: GitCommitModel
    let onDone: (String) -> Void
    @State private var diff: GitDiffTarget?
    @Environment(\.dismiss) private var dismiss

    private var repositories: GitRepositories { model.repositories }

    var body: some View {
        @Bindable var model = model
        MobileList {
            if repositories.busy {
                GitBusyRow(text: repositories.step ?? repositories.progress ?? String(localized: "Committing"))
            }
            if let problem = repositories.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    TextField("Summary", text: $model.subject, axis: .vertical)
                        .font(.body.weight(.semibold)).lineLimit(1...3)
                    TextField("Description (optional)", text: $model.body, axis: .vertical)
                        .font(.callout).foregroundStyle(MobileStyle.muted).lineLimit(3...10)
                }
                .padding(14)
                .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 14))
                .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(MobileStyle.border) }
                if model.provider != nil {
                    Button {
                        Task { await model.write(client: client) }
                    } label: {
                        HStack(spacing: 8) {
                            if model.writing {
                                Spinner(size: 14, label: String(localized: "Writing the message"))
                                Text("Writing the message")
                            } else {
                                Image(lucide: "sparkles", size: 16)
                                Text("Write with \(model.providerName)")
                            }
                        }
                        .font(.callout).foregroundStyle(MobileStyle.accent)
                    }
                    .buttonStyle(.plain)
                    .disabled(repositories.busy || model.writeFrom == nil)
                    .accessibilityHint(model.writing ? "Stops writing" : "")
                    if model.writeFrom == nil && !model.plan.targets.isEmpty {
                        Text("A message is written from one repository at a time.")
                            .font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                }
            }
            Section {
                if model.plan.targets.isEmpty {
                    Text("Stage what belongs in this commit first.").foregroundStyle(MobileStyle.muted)
                }
                ForEach(model.files, id: \.file.stableID) { entry in
                    fileRow(entry.checkout, entry.file)
                }
            } header: {
                Text(model.plan.stageAll ? "Everything that changed" : "Staged").font(.footnote)
                    .foregroundStyle(MobileStyle.muted).textCase(nil)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $diff) { target in GitDiffPage(client: client, target: target) }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            GitBottomBar {
                GitBarButton(title: String(localized: "Commit and push")) { Task { await commit(push: true) } }
                    .disabled(!model.ready)
                GitBarButton(
                    title: model.plan.stageAll
                        ? String(localized: "Stage all and commit")
                        : String(localized: "Commit", comment: "Git commit button"),
                    prominent: false
                ) {
                    Task { await commit(push: false) }
                }.disabled(!model.ready)
            }
        }
        .task { await model.loadProvider(client: client) }
    }

    private var title: String {
        guard repositories.named, !model.plan.targets.isEmpty else {
            return String(localized: "Commit", comment: "Git commit button")
        }
        let labels = model.plan.targets.map(\.label).joined(separator: ", ")
        return String(localized: "Commit in \(labels)", comment: "%@ lists repositories")
    }

    private func fileRow(_ checkout: GitCheckout, _ file: JSONValue) -> some View {
        Button {
            diff = GitDiffTarget(
                cwd: checkout.path, path: file.text("path"), staged: file.text("state") == "staged", commit: nil)
        } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text((file.text("path") as NSString).lastPathComponent).lineLimit(1)
                    Text(repositories.named ? "\(checkout.label) · \(file.text("path"))" : file.text("path"))
                        .font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1).truncationMode(.head)
                }
                Spacer(minLength: 8)
                GitLineCounts(file: file)
            }.modifier(MobileSidebarLabel(disclosure: true))
        }
        .modifier(MobileSidebarRow())
    }

    private func commit(push: Bool) async {
        guard let line = await model.commit(client: client, push: push) else { return }
        onDone(line)
        dismiss()
    }
}

/// The lines a change adds and takes away, green and red as every diff draws them.
struct GitLineCounts: View {
    let file: JSONValue

    var body: some View {
        if file["binary"] == .bool(true) {
            Text("binary").font(.caption).foregroundStyle(MobileStyle.faint)
        } else {
            HStack(spacing: 6) {
                let added = Int(file.number("added"))
                let deleted = Int(file.number("deleted"))
                if added > 0 { Text("+\(added)").foregroundStyle(.green) }
                if deleted > 0 { Text("−\(deleted)").foregroundStyle(.red) }
            }
            .font(.caption.monospacedDigit())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(Int(file.number("added"))) added, \(Int(file.number("deleted"))) removed")
        }
    }
}
