import RuimtePulsar
import SwiftUI

/// Something a person types before it can run. Every one of them names the repository it acts on,
/// because with more than one on screen "the checkout" is not a thing to point at.
enum GitPrompt: Identifiable {
    case stash(cwd: String)
    case pullRequest(cwd: String, subject: String)
    case createBranch(cwd: String)
    case renameBranch(cwd: String, branch: String)

    var id: String {
        switch self {
        case .stash(let cwd): "stash\u{0}\(cwd)"
        case .pullRequest(let cwd, _): "pr\u{0}\(cwd)"
        case .createBranch(let cwd): "create\u{0}\(cwd)"
        case .renameBranch(let cwd, let branch): "rename\u{0}\(cwd)\u{0}\(branch)"
        }
    }

    var title: String {
        switch self {
        case .stash: "Stash changes"
        case .pullRequest: "Create pull request"
        case .createBranch: "New branch"
        case .renameBranch: "Rename branch"
        }
    }

    var detail: String {
        switch self {
        case .stash: "Everything that changed is set aside and the working tree goes back to HEAD."
        case .pullRequest: "Opens a pull request for this branch on the remote it tracks."
        case .createBranch: "Branches off what is checked out now and switches to it."
        case .renameBranch: "Renames the branch that is checked out here."
        }
    }

    var fieldLabel: String {
        switch self {
        case .stash: "Message (optional)"
        case .pullRequest: "Title"
        default: "Name"
        }
    }

    var initial: String {
        switch self {
        case .pullRequest(_, let subject): subject
        case .renameBranch(_, let branch): branch
        default: ""
        }
    }

    var placeholder: String {
        switch self {
        case .createBranch: "feature/what-it-does"
        default: ""
        }
    }

    /// Only a pull request has a body under its one line.
    var hasBody: Bool { if case .pullRequest = self { true } else { false } }

    /// A stash without a message is a stash git names itself.
    var needsText: Bool { if case .stash = self { false } else { true } }

    var confirmLabel: String {
        switch self {
        case .stash: "Stash"
        case .pullRequest: "Create"
        case .createBranch: "Create"
        case .renameBranch: "Rename"
        }
    }
}

/// The one sheet every typed git action uses, so a name, a message and a pull request title are asked
/// for the same way.
struct GitPromptSheet: View {
    let pending: GitPrompt
    let onConfirm: (String, String) -> Void
    let onCancel: () -> Void
    @State private var first = ""
    @State private var second = ""

    private var ready: Bool { !pending.needsText || !first.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    TextField(pending.placeholder.isEmpty ? pending.fieldLabel : pending.placeholder, text: $first)
                        .font(pending.hasBody ? .body : .body.monospaced())
                        .autocorrectionDisabled(!pending.hasBody)
                        .textInputAutocapitalization(pending.hasBody ? .sentences : .never)
                    if pending.hasBody {
                        TextField("Description (optional)", text: $second, axis: .vertical).lineLimit(4...10)
                    }
                } header: {
                    Text(pending.fieldLabel)
                } footer: {
                    Text(pending.detail)
                }
            }
            .navigationTitle(pending.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(pending.confirmLabel) { onConfirm(first, second) }.disabled(!ready)
                }
            }
        }
        .task { first = pending.initial }
    }
}
