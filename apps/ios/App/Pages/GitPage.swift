import RuimtePulsar
import RuimteTransport
import SwiftUI

struct GitPage: View {
    let client: any MachineRequesting
    let cwd: String
    @State private var state = RemotePageState()
    @State private var subject = ""
    @State private var message = ""
    @State private var commitSheet = false
    @State private var resultMessage: String?
    var body: some View {
        MobileList {
            RemotePageStatus(state: state) { Task { await load() } }
            if let status = state.value {
                if status["repo"] == .bool(false) {
                    ContentUnavailableView(
                        "No Git repository", lucideIcon: "git-branch", description: Text(cwd))
                } else {
                    Section {
                        LabeledContent(
                            "Branch",
                            value: status.text(
                                "branch", fallback: status["detached"] == .bool(true) ? "Detached HEAD" : "No commits"))
                        if let upstream = status["upstream"]?.stringValue {
                            LabeledContent("Upstream", value: upstream)
                        }
                        LabeledContent(
                            "Ahead / behind", value: "\(Int(status.number("ahead"))) / \(Int(status.number("behind")))")
                        if status["live"] == .bool(false) {
                            Label("Pull to refresh this repository", lucideIcon: "refresh-cw", iconSize: 14).font(
                                .caption
                            )
                            .foregroundStyle(MobileStyle.muted)
                        }
                    }
                    ForEach(["conflicted", "staged", "unstaged", "untracked"], id: \.self) { group in
                        let files = status.list("files").filter { $0.text("state") == group }
                        if !files.isEmpty {
                            Section(group.capitalized) {
                                ForEach(files, id: \.stableID) { file in
                                    NavigationLink {
                                        GitDiffPage(
                                            client: client, cwd: cwd, path: file.text("path"), staged: group == "staged"
                                        )
                                    } label: {
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(file.text("path")).lineLimit(2)
                                            Text("+\(Int(file.number("added")))  −\(Int(file.number("deleted")))").font(
                                                .caption.monospacedDigit()
                                            ).foregroundStyle(MobileStyle.muted)
                                        }
                                    }
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                        Button(group == "staged" ? "Unstage" : "Stage") {
                                            Task { await stage(file, staged: group != "staged") }
                                        }.tint(MobileStyle.accent).disabled(state.busy)
                                    }
                                    .contextMenu {
                                        Button(group == "staged" ? "Unstage file" : "Stage file") {
                                            Task { await stage(file, staged: group != "staged") }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if status.list("files").isEmpty {
                        ContentUnavailableView("Working tree clean", lucideIcon: "circle-check")
                    }
                    if status["truncated"] == .bool(true) {
                        Text("Some changed files were omitted from this list.").foregroundStyle(MobileStyle.muted)
                    }
                    if let resultMessage { Text(resultMessage).foregroundStyle(MobileStyle.muted) }
                }
            }
        }
        .navigationTitle("Git")
        .toolbar {
            Button("Commit", lucideIcon: "circle-check") { commitSheet = true }.disabled(
                state.busy || !(state.value?.list("files").contains { $0.text("state") == "staged" } ?? false))
        }
        .task(id: cwd) {
            await RemotePageLifecycle.run(
                client: client, events: ["git.status"], matches: { $0.text("cwd") == cwd },
                subscription: {
                    let payload: JSONValue = .object(["cwd": .string(cwd)])
                    return client.acquireSubscription(
                        start: "git.watch", stop: "git.unwatch", payload: payload, stopPayload: payload)
                }, load: load)
        }
        .refreshable { await load() }
        .mobileSheet(isPresented: $commitSheet) {
            NavigationStack {
                MobileForm {
                    Section("Commit message") {
                        TextField("Subject", text: $subject)
                        TextField("Description (optional)", text: $message, axis: .vertical).lineLimit(4...10)
                    }
                    Section("Staged files") {
                        ForEach(
                            state.value?.list("files").filter { $0.text("state") == "staged" } ?? [], id: \.stableID
                        ) { Text($0.text("path")) }
                    }
                    RemotePageStatus(state: state) {}
                }.navigationTitle("Commit staged changes")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { commitSheet = false }.disabled(state.busy)
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Commit") { Task { await commit() } }.disabled(
                                state.busy || subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
            }.interactiveDismissDisabled(state.busy)
        }
    }
    private func load() async {
        await state.load { try await client.request("git.status", payload: .object(["cwd": .string(cwd)])) }
    }
    private func stage(_ file: JSONValue, staged: Bool) async {
        await state.perform {
            _ = try await client.request(
                "git.stage",
                payload: .object([
                    "cwd": .string(cwd), "paths": .array([.string(file.text("path"))]), "staged": .bool(staged),
                ]))
            await load()
        }
    }
    private func commit() async {
        await state.perform {
            let result = try await client.request(
                "git.action",
                payload: .object([
                    "cwd": .string(cwd), "actionId": .string(UUID().uuidString), "kind": .string("commit"),
                    "subject": .string(subject), "body": .string(message), "stageAll": .bool(false),
                ]))
            resultMessage = result.text("summary")
            subject = ""
            message = ""
            commitSheet = false
            await load()
        }
    }
}

struct GitDiffPage: View {
    let client: any MachineRequesting
    let cwd: String
    let path: String
    let staged: Bool
    @State private var state = RemotePageState()
    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 0) {
                RemotePageStatus(state: state) { Task { await load() } }
                if let diff = state.value {
                    if let omitted = diff["omitted"]?.stringValue {
                        ContentUnavailableView(
                            omitted == "binary" ? "Binary file" : "Diff too large", lucideIcon: "file-text")
                    } else {
                        ForEach(Array(diff.text("diff").components(separatedBy: "\n").enumerated()), id: \.offset) {
                            item in
                            Text(item.element.isEmpty ? " " : item.element)
                                .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                                .foregroundStyle(
                                    item.element.hasPrefix("+")
                                        ? Color.green : item.element.hasPrefix("-") ? Color.red : Color.primary)
                        }
                    }
                }
            }.padding()
        }.navigationTitle(URL(fileURLWithPath: path).lastPathComponent)
            .task {
                await RemotePageLifecycle.run(
                    client: client, events: ["git.status"], matches: { $0.text("cwd") == cwd },
                    subscription: {
                        let payload: JSONValue = .object(["cwd": .string(cwd)])
                        return client.acquireSubscription(
                            start: "git.watch", stop: "git.unwatch", payload: payload, stopPayload: payload)
                    }, load: load)
            }
    }
    private func load() async {
        await state.load {
            try await client.request(
                "git.diff",
                payload: .object([
                    "cwd": .string(cwd), "path": .string(path), "scope": .string("worktree"), "staged": .bool(staged),
                ]))
        }
    }
}
