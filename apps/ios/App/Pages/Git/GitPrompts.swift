import RuimtePulsar
import SwiftUI

/// Something a person types before it can run. Every one of them names the repository it acts on,
/// because with more than one on screen "the checkout" is not a thing to point at.
enum GitPrompt: Identifiable {
    case stash(cwd: String)
    case createBranch(cwd: String)
    case renameBranch(cwd: String, branch: String)
    case createWorktree(repo: String)

    var id: String {
        switch self {
        case .stash(let cwd): "stash\u{0}\(cwd)"
        case .createBranch(let cwd): "create\u{0}\(cwd)"
        case .renameBranch(let cwd, let branch): "rename\u{0}\(cwd)\u{0}\(branch)"
        case .createWorktree(let repo): "worktree\u{0}\(repo)"
        }
    }

    var title: String {
        switch self {
        case .stash: String(localized: "Stash changes")
        case .createBranch: String(localized: "New branch")
        case .renameBranch: String(localized: "Rename branch")
        case .createWorktree: String(localized: "New worktree")
        }
    }

    var detail: String {
        switch self {
        case .stash: String(localized: "Everything that changed is set aside and the working tree goes back to HEAD.")
        case .createBranch: String(localized: "Branches off what is checked out now and switches to it.")
        case .renameBranch: String(localized: "Renames the branch that is checked out here.")
        case .createWorktree:
            String(
                localized:
                    "Makes a second checkout of this branch beside the project. A branch that does not exist yet starts from what is checked out here."
            )
        }
    }

    var fieldLabel: String {
        switch self {
        case .stash: String(localized: "Message (optional)")
        default: String(localized: "Name")
        }
    }

    var initial: String {
        switch self {
        case .renameBranch(_, let branch): branch
        default: ""
        }
    }

    var placeholder: String {
        switch self {
        case .createBranch, .createWorktree:
            String(
                localized: "feature/what-it-does", comment: "Example of a git branch name, lowercase and without spaces"
            )
        default: ""
        }
    }

    /// A stash without a message is a stash git names itself.
    var needsText: Bool { if case .stash = self { false } else { true } }

    var confirmLabel: String {
        switch self {
        case .stash: String(localized: "Stash", comment: "Button that stashes git changes")
        case .createBranch: String(localized: "Create")
        case .renameBranch: String(localized: "Rename")
        case .createWorktree: String(localized: "Create")
        }
    }
}

/// The one sheet every typed git action uses, so a name and a message are asked for the same way.
struct GitPromptSheet: View {
    let pending: GitPrompt
    let onConfirm: (String) -> Void
    let onCancel: () -> Void
    @State private var first = ""

    private var ready: Bool { !pending.needsText || !first.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    TextField(pending.placeholder.isEmpty ? pending.fieldLabel : pending.placeholder, text: $first)
                        .font(pending.needsText ? .body.monospaced() : .body)
                        .autocorrectionDisabled(pending.needsText)
                        .textInputAutocapitalization(pending.needsText ? .never : .sentences)
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
                    Button(pending.confirmLabel) { onConfirm(first) }.disabled(!ready)
                }
            }
        }
        .task { first = pending.initial }
    }
}
