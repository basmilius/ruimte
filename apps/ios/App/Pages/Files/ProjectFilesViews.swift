import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The files of a project: its folder with what git says about each row, Find in files, and what a project gives
/// a file. The git status is read once here for every folder below it.
struct ProjectFilesPage: View {
    let workspace: MobileWorkspace
    var openView: ((String) -> Void)?
    @State private var repositories = GitRepositories()
    @State private var detent = PresentationDetent.large

    var body: some View {
        MachineFilesPage(
            client: workspace.client, path: workspace.folder,
            project: FilesProject(workspace: workspace, openView: openView), marks: repositories
        )
        .task(id: workspace.folder) { await repositories.run(client: workspace.client, folder: workspace.folder) }
        .presentationDetents([.medium, .large], selection: $detent)
    }
}

/// A text file a line at a time, numbered, each changed line marked in the gutter as the desktop's editor marks
/// it, and one line lit when the page opened at it.
struct FileLinesView: View {
    let text: String
    var language: String?
    var changes: FileChangeMarksModel?
    var highlight: Int?
    @Environment(\.colorScheme) private var colorScheme
    @State private var colored: [AttributedString]?

    /// Past this the file stays plain, since coloring it line by line costs more than it gives on a phone.
    private static let colorLimit = 200_000

    var body: some View {
        let lines = text.components(separatedBy: "\n")
        LazyVStack(alignment: .leading, spacing: 3) {
            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                let number = index + 1
                let change = changes?.change(at: number)
                HStack(alignment: .top, spacing: 8) {
                    FileChangeBar(change: change)
                    Text("\(number)").foregroundStyle(MobileStyle.muted).frame(width: 40, alignment: .trailing)
                    Text(
                        colored.flatMap { index < $0.count ? $0[index] : nil }
                            ?? AttributedString(line.isEmpty ? " " : line)
                    )
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
                .font(.system(.caption, design: .monospaced)).monospacedDigit()
                .background(number == highlight ? MobileStyle.active : .clear)
                .accessibilityElement(children: .combine)
                .accessibilityValue(change.map(Self.spoken) ?? "")
                .id(number)
            }
        }
        .task(id: "\(colorScheme == .dark):\(language ?? ""):\(text.hashValue)") {
            guard text.utf8.count <= Self.colorLimit else {
                colored = nil
                return
            }
            let highlighted = await CodeHighlighter.shared.highlight(
                text, language: FileKinds.highlightLanguage(language), dark: colorScheme == .dark)
            guard !Task.isCancelled, let highlighted else { return }
            colored = Self.split(highlighted)
        }
    }

    static func spoken(_ change: FileLineChange) -> String {
        switch change {
        case .added: "Added"
        case .modified: "Changed"
        case .deleted: "Lines removed above"
        }
    }

    /// One attributed string per line, cut at every newline.
    static func split(_ text: AttributedString) -> [AttributedString] {
        var lines: [AttributedString] = []
        var start = text.startIndex
        var index = text.startIndex
        while index < text.endIndex {
            if text.characters[index] == "\n" {
                lines.append(AttributedString(text[start..<index]))
                start = text.characters.index(after: index)
            }
            index = text.characters.index(after: index)
        }
        lines.append(AttributedString(text[start..<text.endIndex]))
        return lines
    }
}

/// The gutter mark of one line: green for a new line, blue for a changed one, a red notch where lines went.
struct FileChangeBar: View {
    let change: FileLineChange?

    var body: some View {
        Group {
            switch change {
            case .added: Rectangle().fill(MobileStyle.positive)
            case .modified: Rectangle().fill(MobileStyle.statusRunning)
            case .deleted:
                VStack(spacing: 0) {
                    Rectangle().fill(Color.red).frame(height: 4)
                    Spacer(minLength: 0)
                }
            case nil: Color.clear
            }
        }
        .frame(width: 3)
        .accessibilityHidden(true)
    }
}

/// The chats a file can be mentioned in, the one opened last first.
struct FileMentionMenu<Label: View>: View {
    let project: FilesProject
    let path: String
    let onMentioned: (String) -> Void
    @ViewBuilder let label: () -> Label

    var body: some View {
        let chats = project.chats
        Menu {
            if chats.isEmpty {
                Text("This project has no chats yet")
            }
            ForEach(chats) { chat in
                Button(chat.current ? "\(chat.title) (last opened)" : chat.title, lucideIcon: "message-square") {
                    Task {
                        if let line = await project.mention(path, in: chat) { onMentioned(line) }
                    }
                }
            }
        } label: {
            label()
        }
        .disabled(FilesMention.relative(folder: project.folder, path: path) == nil)
    }
}

/// The question before a file or folder goes to the machine's trash.
struct FileDeleteConfirmation: ViewModifier {
    let client: any MachineRequesting
    @Binding var path: String?
    let onDeleted: () -> Void
    @State private var problem: String?

    func body(content: Content) -> some View {
        content
            .alert(
                path.map { "Delete \(($0 as NSString).lastPathComponent)?" } ?? "",
                isPresented: Binding(get: { path != nil }, set: { if !$0 { path = nil } }),
                presenting: path
            ) { pending in
                Button("Move to Trash", role: .destructive) {
                    Task {
                        do {
                            _ = try await client.request("fs.delete", payload: .object(["path": .string(pending)]))
                            onDeleted()
                        } catch {
                            problem =
                                gitRefusalCode(error) == "unknown-request"
                                ? "Update Ruimte on this machine to delete files on the phone."
                                : error.localizedDescription
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("It goes to the Trash on the machine, where it can be put back.")
            }
            .alert(
                "Could not delete", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(problem ?? "")
            }
    }
}
