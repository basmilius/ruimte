import RuimtePulsar
import RuimteTransport
import SwiftUI

/// Forks a chat after a turn with the same choices as the desktop dialog.
struct ChatForkSheet: View {
    let model: ChatModel
    let turnID: String
    let originalTitle: String
    /// Whether the chat is a node or a view in the project; nil where this screen does not know the project.
    let origin: ChatForkShape?
    /// The id of the chat the machine made.
    let forked: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var shape: ChatForkShape = .node
    /// Nil while the machine is asked; a machine that cannot say offers no worktree.
    @State private var folder: JSONValue?
    @State private var unsupported = false
    @State private var inWorktree = true
    @State private var branch: String?
    @State private var filesAfterTurn = true
    @State private var provider: String?
    @State private var modelSlug: String?
    @State private var busy = false
    @State private var failure: String?

    private var info: JSONValue { model.presentation.info }
    private var point: ChatForkPoint? {
        ChatForking.point(
            items: model.presentation.values, turnID: turnID, counted: model.history.cursor == nil)
    }
    private var refusal: String? { model.presentation.forkRefusal(turnID: turnID) }
    private var shapes: [ChatForkShape] { ChatForking.shapes(origin: origin) }
    private var repository: Bool { folder?["repository"]?.boolValue == true }
    private var worktree: Bool { repository && inWorktree }
    private var branchName: String { branch ?? folder?["branch"]?.stringValue ?? "" }
    private var branchProblem: String? {
        worktree
            ? ChatForking.branchRefusal(
                branchName, taken: folder?.list("branches").compactMap(\.stringValue) ?? []) : nil
    }
    private var canRestoreFiles: Bool { folder?["filesAfterTurn"]?.boolValue == true }
    private var originalProvider: String { info.text("provider") }
    private var chosenProvider: String { provider ?? originalProvider }
    private var pickable: [JSONValue] {
        model.providers.filter {
            ChatForking.forkable(provider: $0.text("kind")) && $0["installed"]?.boolValue == true
                && $0["capabilities"]?["chat"]?.boolValue == true
        }
    }
    private func models(of kind: String) -> [JSONValue] {
        pickable.first { $0.text("kind") == kind }?.list("models") ?? []
    }
    private var chosenModel: String { modelSlug ?? info["selection"]?["model"]?.stringValue ?? "" }
    private var ready: Bool {
        !unsupported && refusal == nil && point != nil && folder != nil && branchProblem == nil
            && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    Text(point?.label ?? "This turn is no longer in the conversation.")
                    TextField("Title", text: $title)
                        .onChange(of: title) { _, value in
                            if value.count > ChatForking.titleMax { title = String(value.prefix(ChatForking.titleMax)) }
                        }
                        .accessibilityIdentifier("fork.title")
                    if shapes.count > 1 {
                        Picker("Fork into", selection: $shape) {
                            ForEach(shapes) { Text($0.label).tag($0) }
                        }
                    }
                } footer: {
                    Text(
                        shape == .view
                            ? "A new chat view goes on from there, right after \(origin == .node ? "its canvas" : "the original"). Nothing is sent until you write the first message."
                            : "A new chat node goes on from there, beside the original. Nothing is sent until you write the first message."
                    )
                }
                if !pickable.isEmpty {
                    cliSection
                }
                folderSection
                if let refusal {
                    Section { Text(refusal + ".").foregroundStyle(MobileStyle.muted) }
                }
                if let failure {
                    Section { Text(failure).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Fork conversation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy {
                        ProgressView().accessibilityLabel("Forking")
                    } else {
                        Button("Fork") { Task { await submit() } }
                            .disabled(!ready)
                            .accessibilityIdentifier("fork.submit")
                    }
                }
            }
            .interactiveDismissDisabled(busy)
        }
        .onAppear {
            guard title.isEmpty else { return }
            title = String("\(originalTitle) (fork)".prefix(ChatForking.titleMax))
            shape = shapes.first ?? .node
        }
        .task { await askFolder() }
    }

    private var cliSection: some View {
        Section {
            Picker(
                "Continue with",
                selection: Binding(
                    get: { chosenProvider },
                    set: { kind in
                        provider = kind
                        modelSlug = defaultModel(for: kind)
                    })
            ) {
                ForEach(pickable, id: \.stableKind) { entry in
                    Text(entry.text("name", fallback: entry.text("kind"))).tag(entry.text("kind"))
                }
            }
            let options = models(of: chosenProvider)
            if !options.isEmpty {
                Picker("Model", selection: Binding(get: { chosenModel }, set: { modelSlug = $0 })) {
                    ForEach(options, id: \.stableSlug) { option in
                        Text(option.text("name", fallback: option.text("slug"))).tag(option.text("slug"))
                    }
                }
            }
        } footer: {
            if chosenProvider != originalProvider {
                Text(
                    "The new agent gets the last part of the conversation as text and can read the rest of the original itself."
                )
            }
        }
    }

    @ViewBuilder private var folderSection: some View {
        if unsupported {
            Section { Text("Update Ruimte on this machine to fork conversations.").foregroundStyle(MobileStyle.muted) }
        } else if folder == nil {
            Section {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Looking at the folder...").foregroundStyle(MobileStyle.muted)
                }
            }
        } else if !repository {
            Section {
                Text(
                    "This folder is not in a git repository, so the fork works in the same folder."
                        + (point?.last == false ? " " + sharedFolderNote : "")
                ).foregroundStyle(MobileStyle.muted)
            }
        } else {
            Section {
                Toggle("Work in a git worktree", isOn: $inWorktree)
                if inWorktree {
                    TextField("Branch", text: Binding(get: { branchName }, set: { branch = $0 }))
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("fork.branch")
                    if let branchProblem {
                        Text(branchProblem).font(.footnote).foregroundStyle(.red)
                    }
                    Toggle(
                        point?.last ?? true ? "Take the uncommitted files along" : "Undo the work after this turn",
                        isOn: Binding(get: { filesAfterTurn && canRestoreFiles }, set: { filesAfterTurn = $0 })
                    )
                    .disabled(!canRestoreFiles)
                }
            } footer: {
                if !inWorktree {
                    if point?.last == false { Text(sharedFolderNote) }
                } else if !canRestoreFiles {
                    Text("The files of this turn are no longer in the repository, so the worktree starts from HEAD.")
                } else if filesAfterTurn {
                    Text("The worktree starts from the files as they were after this turn; the original keeps its own.")
                } else {
                    Text("The worktree starts from HEAD, without uncommitted work.")
                }
            }
        }
    }

    private var sharedFolderNote: String {
        "The files stay as they are now; the agent is told the folder is newer than this turn."
    }

    /// The newest pick for a CLI when that model is still offered, else what the machine calls its default.
    private func defaultModel(for kind: String) -> String? {
        let offered = models(of: kind).map { $0.text("slug") }
        if kind == originalProvider, let current = info["selection"]?["model"]?.stringValue { return current }
        if let remembered = ChatPreferences.shared.selections[kind]?["model"]?.stringValue,
            offered.contains(remembered)
        {
            return remembered
        }
        return pickable.first { $0.text("kind") == kind }?["defaultModel"]?.stringValue ?? offered.first
    }

    private func selection(provider kind: String, model slug: String) -> JSONValue {
        if kind == originalProvider, let current = info["selection"], current["model"]?.stringValue == slug {
            return current
        }
        if let remembered = ChatPreferences.shared.selections[kind], remembered["model"]?.stringValue == slug {
            return remembered
        }
        return .object(["model": .string(slug), "options": .object([:])])
    }

    private func askFolder() async {
        do {
            folder = try await model.client.request(
                "chat.forkInfo", payload: .object(["chatId": .string(model.chatID), "turnId": .string(turnID)]))
        } catch is CancellationError {
        } catch {
            if ChatForking.isUnknownRequest(error) { unsupported = true }
            folder = .object(["repository": .bool(false), "branches": .array([]), "filesAfterTurn": .bool(false)])
        }
    }

    private func submit() async {
        guard ready, !busy else { return }
        busy = true
        failure = nil
        defer { busy = false }
        let original = (provider: originalProvider, selection: info["selection"] ?? .null)
        let chosen = (
            provider: chosenProvider,
            selection: chosenModel.isEmpty ? JSONValue.null : selection(provider: chosenProvider, model: chosenModel)
        )
        let payload = ChatForking.payload(
            chatID: model.chatID, turnID: turnID, title: title, shape: shapes.isEmpty ? nil : shape, origin: origin,
            worktree: worktree ? (branchName, filesAfterTurn && canRestoreFiles) : nil,
            original: original, chosen: chosen)
        do {
            let result = try await model.client.request("chat.fork", payload: payload)
            dismiss()
            forked(result.text("nodeId"))
        } catch {
            failure = ChatForking.message(for: error, action: "fork conversations")
        }
    }
}

extension JSONValue {
    fileprivate var stableKind: String { text("kind") }
    fileprivate var stableSlug: String { text("slug") }
}
