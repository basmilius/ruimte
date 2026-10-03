import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// The project the files belong to, for what only a project gives a file: a mention in one of its chats, a view
/// of its own, and the way to open that view.
@MainActor struct FilesProject {
    let workspace: MobileWorkspace
    /// Opens a view of the project, closing whatever the files were shown in; nil where nothing can open one.
    var openView: ((String) -> Void)?
    /// Shows a file beside the list instead of over it, as the iPad's files inspector does with the content column.
    var showFile: ((String) -> Void)?
    /// The file shown beside the list, which its row marks.
    var shownFile: String?

    var folder: String { workspace.folder }
    var client: any MachineRequesting { workspace.client }
    var chats: [FilesChat] { FilesMention.chats(in: workspace.views, current: workspace.selectedID) }

    /// Adds the file to the chat's draft. The line it returns says where it went.
    func mention(_ path: String, in chat: FilesChat) async -> String? {
        guard let relative = FilesMention.relative(folder: folder, path: path) else { return nil }
        await ChatDraftInbox.mention(relative, machineID: workspace.session.machine.id, chatID: chat.id)
        return "Added @\(relative) to the message in \(chat.title)."
    }

    /// The file as a view of the project, opened; a file that already has one opens that one.
    func openAsView(_ path: String) async {
        let stored = FilesMention.relative(folder: folder, path: path) ?? path
        if let existing = workspace.views.first(where: { $0.text("kind") == "file" && $0.text("path") == stored }) {
            openView?(existing.stableID)
            return
        }
        let id = "file-" + UUID().uuidString
        let view = JSONValue.object([
            "id": .string(id), "kind": .string("file"), "name": .string((path as NSString).lastPathComponent),
            "path": .string(stored),
        ])
        await workspace.edit { $0.setting("views", .array($0.list("views") + [view])) }
        if workspace.problem == nil { openView?(id) }
    }
}

/// A chat of the project a file can be mentioned in: a chat view, or a chat on a canvas.
struct FilesChat: Identifiable, Equatable {
    let id: String
    let title: String
    /// The chat a person last opened in the project, which a mention goes to first.
    let current: Bool
}

enum FilesMention {
    /// What a mention names: the path under the project folder. Nil for the folder itself and anything outside it,
    /// where a mention would name nothing.
    static func relative(folder: String, path: String) -> String? {
        let root = folder.hasSuffix("/") ? String(folder.dropLast()) : folder
        guard path.hasPrefix(root + "/") else { return nil }
        let relative = String(path.dropFirst(root.count + 1))
        let trimmed = relative.hasSuffix("/") ? String(relative.dropLast()) : relative
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Every chat of the project, the current one first and the rest in the order the project lists them.
    static func chats(in views: [JSONValue], current: String?) -> [FilesChat] {
        var chats: [FilesChat] = []
        for view in views {
            if view.text("kind") == "chat" {
                chats.append(
                    FilesChat(
                        id: view.stableID, title: view.text("name", fallback: "Chat"),
                        current: view.stableID == current))
            }
            for node in view.list("nodes") where node.text("kind") == "chat" {
                chats.append(FilesChat(id: node.stableID, title: node.text("title", fallback: "Chat"), current: false))
            }
        }
        return chats.filter(\.current) + chats.filter { !$0.current }
    }
}

/// What git says about the files of a folder, as the letter a row in the files list carries. A folder carries a
/// mark when something under it changed.
struct GitFileMarks: Equatable {
    private(set) var files: [String: String] = [:]
    private(set) var directories: Set<String> = []
    /// Folders git has never seen, whose every file is new.
    private(set) var newDirectories: [String] = []

    init(_ checkouts: [GitCheckout] = []) {
        for checkout in checkouts {
            let root = checkout.status?["root"]?.stringValue ?? checkout.path
            for file in checkout.files {
                let relative = file.text("path")
                let letter = Self.letter(state: file.text("state"), status: file.text("status"))
                if relative.hasSuffix("/") {
                    newDirectories.append(root + "/" + relative.dropLast())
                } else {
                    let path = root + "/" + relative
                    files[path] = Self.stronger(files[path], letter)
                }
                var parent = ((root + "/" + relative) as NSString).deletingLastPathComponent
                while parent.count > root.count, parent.hasPrefix(root) {
                    directories.insert(parent)
                    parent = (parent as NSString).deletingLastPathComponent
                }
            }
        }
    }

    func mark(path: String, directory: Bool) -> String? {
        if let letter = files[path] { return letter }
        if newDirectories.contains(where: { path == $0 || path.hasPrefix($0 + "/") }) { return "A" }
        return directory && directories.contains(path) ? "M" : nil
    }

    /// One letter per state, as a person reads them: new, deleted, renamed, conflicted, or changed.
    static func letter(state: String, status: String) -> String {
        if state == "conflicted" { return "!" }
        switch status.first {
        case "?", "A": return "A"
        case "D": return "D"
        case "R": return "R"
        default: return "M"
        }
    }

    static func spoken(_ mark: String) -> String {
        switch mark {
        case "!": "Conflicted"
        case "A": "New"
        case "D": "Deleted"
        case "R": "Renamed"
        default: "Changed"
        }
    }

    /// A file staged one way and changed another shows the mark that says more.
    private static func stronger(_ old: String?, _ new: String) -> String {
        let order = ["!", "A", "D", "R", "M"]
        guard let old else { return new }
        return (order.firstIndex(of: new) ?? 4) < (order.firstIndex(of: old) ?? 4) ? new : old
    }
}

/// How a line of a file differs from the last commit.
enum FileLineChange: Equatable {
    case added, modified
    /// Lines were taken away just above this one.
    case deleted
}

enum FileLineChanges {
    /// The changed lines of a unified diff of one file, by their number in the new file.
    static func parse(_ diff: String) -> [Int: FileLineChange] {
        var marks: [Int: FileLineChange] = [:]
        var line = 0
        var removed = 0
        var inHunk = false
        let flush = { (at: Int) in
            if removed > 0 && at > 0 && marks[at] == nil { marks[at] = .deleted }
            removed = 0
        }
        let body = diff.hasSuffix("\n") ? String(diff.dropLast()) : diff
        for raw in body.split(separator: "\n", omittingEmptySubsequences: false) {
            if raw.hasPrefix("@@") {
                flush(line)
                line = newStart(raw) ?? line
                inHunk = true
                continue
            }
            guard inHunk else { continue }
            if raw.hasPrefix("+") {
                marks[line] = removed > 0 ? .modified : .added
                if removed > 0 { removed -= 1 }
                line += 1
            } else if raw.hasPrefix("-") {
                removed += 1
            } else if raw.hasPrefix("\\") {
                continue
            } else {
                // A context line, which some tools write without the space when the line itself is empty.
                flush(line)
                line += 1
            }
        }
        flush(max(1, line - 1))
        return marks
    }

    /// Where a hunk starts in the new file, from `@@ -a,b +c,d @@`.
    private static func newStart(_ header: Substring) -> Int? {
        guard let plus = header.firstIndex(of: "+") else { return nil }
        let digits = header[header.index(after: plus)...].prefix { $0.isNumber }
        guard let start = Int(digits) else { return nil }
        // A hunk that adds to an empty file starts at line 0 in the header and at line 1 in the file.
        return max(start, 1)
    }
}

/// The changed lines of one file against the last commit, read from the checkout it is in.
@MainActor @Observable final class FileChangeMarksModel {
    private(set) var marks: [Int: FileLineChange] = [:]
    /// A file git has never seen, whose every line is new.
    private(set) var untracked = false
    /// The diff of this file a person can open, nil when it has none.
    private(set) var diff: GitDiffTarget?

    var isEmpty: Bool { marks.isEmpty && !untracked }

    func change(at line: Int) -> FileLineChange? { untracked ? .added : marks[line] }

    func load(client: any MachineRequesting, path: String) async {
        let parent = (path as NSString).deletingLastPathComponent
        guard
            let status = try? await client.request("git.status", payload: .object(["cwd": .string(parent)])),
            status["repo"] == .bool(true), let root = status["root"]?.stringValue,
            let relative = FilesMention.relative(folder: root, path: path)
        else {
            clear()
            return
        }
        let entries = status.list("files").filter { $0.text("path") == relative }
        guard !entries.isEmpty else {
            clear()
            return
        }
        if entries.contains(where: { $0.text("state") == "untracked" }) {
            untracked = true
            marks = [:]
            diff = GitDiffTarget(cwd: root, path: relative, staged: false, commit: nil)
            return
        }
        untracked = false
        let target = GitDiffTarget(cwd: root, path: relative, staged: false, commit: nil, base: "HEAD")
        diff = target
        let payload: JSONValue = .object([
            "cwd": .string(root), "scope": .string("base"), "staged": .bool(false), "path": .string(relative),
            "base": .string("HEAD"),
        ])
        guard let answer = try? await client.request("git.diff", payload: payload) else { return }
        marks = FileLineChanges.parse(answer.text("diff"))
    }

    private func clear() {
        marks = [:]
        untracked = false
        diff = nil
    }
}

/// A text file being edited on the phone. The write goes over the version it was read at, so a file that moved on
/// the machine in between refuses instead of losing what moved it.
@MainActor @Observable final class FileEditModel {
    private(set) var editing = false
    var text = ""
    private(set) var original = ""
    /// The version the edit started from, as `fs.read` answered it.
    private(set) var mtime: Double = 0
    private(set) var saving = false
    /// The machine refused because the file changed since it was read.
    var stale = false
    var problem: String?

    var changed: Bool { text != original }

    func begin(text: String, mtime: Double) {
        self.text = text
        original = text
        self.mtime = mtime
        problem = nil
        stale = false
        editing = true
    }

    func cancel() {
        editing = false
        stale = false
        problem = nil
    }

    /// True once the machine holds the edit.
    func save(client: any MachineRequesting, path: String) async -> Bool {
        guard editing, !saving else { return false }
        saving = true
        defer { saving = false }
        do {
            let result = try await client.request(
                "fs.write",
                payload: .object(["path": .string(path), "text": .string(text), "expectedMtime": .number(mtime)]))
            mtime = result.number("mtime")
            original = text
            editing = false
            problem = nil
            return true
        } catch {
            switch gitRefusalCode(error) {
            case "stale":
                stale = true
                problem = "This file changed on the machine since you opened it. Your edits are still here."
            case "unknown-request":
                problem = "Update Ruimte on this machine to edit files on the phone."
            default:
                problem = error.localizedDescription
            }
            return false
        }
    }
}
