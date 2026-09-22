import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What is committed and what it is called. The staged files say where it lands, so a message typed
/// here commits every repository that has something staged, and two staged at once are two commits
/// with the same words. Nothing staged while a single repository has changes is the commit that
/// stages it first, which is the commit a person means with only unstaged work in front of them.
struct GitCommitSheet: View {
    let client: any MachineRequesting
    let repositories: GitRepositories
    @Binding var isPresented: Bool
    let onResult: (String) -> Void
    @State private var subject = ""
    @State private var body_ = ""
    @State private var provider: String?
    @State private var writing = false
    @State private var writingId: String?

    private var plan: (targets: [GitCheckout], stageAll: Bool) { GitPanel.commitTargets(repositories.checkouts) }
    private var ready: Bool {
        !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !plan.targets.isEmpty && !repositories.busy
    }
    /// A message is written from one repository's staged diff; over two there is no one diff to read.
    private var writeFrom: String? { plan.targets.count == 1 ? plan.targets[0].path : nil }

    var body: some View {
        NavigationStack {
            MobileForm {
                Section("Message") {
                    TextField("Summary", text: $subject)
                    TextField("Description (optional)", text: $body_, axis: .vertical).lineLimit(4...10)
                }
                if provider != nil {
                    Section {
                        Button {
                            Task { await write() }
                        } label: {
                            Label(
                                writing ? "Writing the message" : "Let \(provider ?? "an agent") write it",
                                lucideIcon: writing ? "loader-circle" : "sparkles")
                        }
                        .disabled(repositories.busy || writeFrom == nil)
                        if writeFrom == nil {
                            Text("A message is written from one repository at a time.")
                                .font(.caption).foregroundStyle(MobileStyle.muted)
                        }
                    }
                }
                Section(plan.stageAll ? "Everything that changed" : "Staged") {
                    if plan.targets.isEmpty {
                        Text("Stage what belongs in this commit first.").foregroundStyle(MobileStyle.muted)
                    }
                    ForEach(plan.targets) { target in
                        ForEach(target.files.filter { plan.stageAll || $0.text("state") == "staged" }, id: \.stableID) { file in
                            HStack(spacing: 8) {
                                if repositories.named {
                                    Text(target.label).font(.caption).foregroundStyle(MobileStyle.faint).lineLimit(1)
                                }
                                Text(file.text("path")).lineLimit(1).truncationMode(.head)
                            }
                        }
                    }
                }
                if let problem = repositories.problem {
                    Section { Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red) }
                }
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }.disabled(repositories.busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Menu {
                        Button(plan.stageAll ? "Stage all and commit" : "Commit") { Task { await commit(push: false) } }
                        Button("Commit and push") { Task { await commit(push: true) } }
                    } label: {
                        Text("Commit")
                    }.disabled(!ready)
                }
            }
        }
        .interactiveDismissDisabled(repositories.busy)
        .task {
            guard let probe = repositories.checkouts.first?.path else { return }
            let answer = try? await client.request("git.capabilities", payload: .object(["cwd": .string(probe)]))
            provider = answer?["messageProvider"]?.stringValue
        }
    }

    private var title: String {
        guard repositories.named, !plan.targets.isEmpty else { return "Commit" }
        return "Commit in " + plan.targets.map(\.label).joined(separator: ", ")
    }

    private func commit(push: Bool) async {
        let targets = plan.targets
        let ok = await repositories.commit(
            client: client, targets: targets, subject: subject, body: body_, stageAll: plan.stageAll, push: push)
        if ok {
            onResult(
                targets.count == 1
                    ? "Committed in \(targets[0].label)." : "Committed in \(targets.count) repositories.")
            subject = ""
            body_ = ""
            isPresented = false
        }
    }

    private func write() async {
        guard let cwd = writeFrom else { return }
        if writing {
            if let running = writingId {
                _ = try? await client.request("git.cancel", payload: .object(["actionId": .string(running)]))
            }
            return
        }
        let actionId = UUID().uuidString
        writingId = actionId
        writing = true
        defer {
            writing = false
            writingId = nil
        }
        if let suggestion = try? await client.request(
            "git.suggestMessage", payload: .object(["cwd": .string(cwd), "actionId": .string(actionId)]))
        {
            subject = suggestion.text("subject")
            body_ = suggestion.text("body")
        }
    }
}
