import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// One unmerged file as the phone works on it: the three versions git holds in its index split into
/// stretches, the shape the result is written back in, and the digest of what stood on disk when it was
/// read. A resolution is written over exactly that digest.
struct GitConflictFile: Equatable, Sendable {
    let path: String
    /// `text`, `binary`, `deleted-by-us`, `deleted-by-them` or `submodule`, as `git.conflict` reports it.
    let kind: String
    let blocks: [MergeBlock]
    let shape: MergeTextShape
    private(set) var hash: String
    /// Set when there is nothing to merge line by line: the file is a choice between whole sides.
    let whole: Bool

    init(answer: JSONValue) {
        path = answer.text("path")
        kind = answer.text("kind", fallback: "text")
        let base = answer["base"]?.stringValue
        let ours = answer["ours"]?.stringValue
        let theirs = answer["theirs"]?.stringValue
        whole = kind != "text" || ours == nil || theirs == nil
        blocks =
            whole
            ? []
            : ThreeWayMerge.splitBlocks(
                base: ThreeWayMerge.splitLines(base ?? ""), ours: ThreeWayMerge.splitLines(ours ?? ""),
                theirs: ThreeWayMerge.splitLines(theirs ?? ""))
        // Our side decides the shape: the result goes on the branch the checkout is on.
        shape = ThreeWayMerge.shapeOf(ours ?? theirs ?? base ?? "")
        hash = answer.text("hash")
    }

    var conflictIndexes: [Int] { blocks.indices.filter { blocks[$0].kind == .conflict } }

    /// Whether git still holds the same versions, which a save in an editor leaves alone.
    func sameBlocks(as other: GitConflictFile) -> Bool {
        blocks.count == other.blocks.count
            && zip(blocks, other.blocks).allSatisfy {
                $0.kind == $1.kind && ThreeWayMerge.fingerprint($0) == ThreeWayMerge.fingerprint($1)
            }
    }

    /// The same file with the digest of a later read, for a write that refused while the versions stayed.
    func reread(hash newHash: String) -> GitConflictFile {
        var copy = self
        copy.hash = newHash
        return copy
    }
}

/// What a person, or an agent on their behalf, made of one stretch.
struct GitBlockAnswer: Equatable {
    var lines: [String]
    /// A proposal stays a proposal until it is written, and reads as one so a person checks it first.
    var byAgent = false
}

/// The work on one file so far. Nothing here is written until the person marks the file resolved.
struct GitConflictDraft: Equatable {
    var answers: [Int: GitBlockAnswer] = [:]

    /// What one stretch stands at: its answer, what merges by itself, or our side while it waits.
    func lines(of index: Int, in file: GitConflictFile) -> [String] {
        guard file.blocks.indices.contains(index) else { return [] }
        let block = file.blocks[index]
        return answers[index]?.lines ?? ThreeWayMerge.autoLines(block) ?? block.ours
    }

    func lines(in file: GitConflictFile) -> [String] {
        file.blocks.indices.flatMap { lines(of: $0, in: file) }
    }

    /// The merged file as it goes to disk, in the file's own line endings.
    func content(of file: GitConflictFile) -> String {
        let merged = lines(in: file)
        // The desktop editor holds an empty file and a single empty line as the same text.
        return ThreeWayMerge.joinLines(merged == [""] ? [] : merged, shape: file.shape)
    }

    func open(in file: GitConflictFile) -> [Int] {
        file.conflictIndexes.filter { answers[$0] == nil }
    }

    /// The open conflicts nobody would think twice about, each with what the wand makes of it.
    func wandable(in file: GitConflictFile) -> [(index: Int, lines: [String])] {
        open(in: file).compactMap { index in ThreeWayMerge.wandLines(file.blocks[index]).map { (index, $0) } }
    }

    /// The work carried over to the same file read again. While git holds the same versions the draft
    /// stays whole; otherwise only an answered conflict whose stretch is still the same one comes along.
    func carried(from before: GitConflictFile, to after: GitConflictFile) -> GitConflictDraft {
        if before.sameBlocks(as: after) { return self }
        var free = after.conflictIndexes.map { ($0, ThreeWayMerge.fingerprint(after.blocks[$0])) }
        var next = GitConflictDraft()
        for index in answers.keys.sorted() where before.blocks.indices.contains(index) {
            let block = before.blocks[index]
            guard block.kind == .conflict, let answer = answers[index] else { continue }
            let print = ThreeWayMerge.fingerprint(block)
            if let match = free.firstIndex(where: { $0.1 == print }) {
                next.answers[free[match].0] = answer
                free.remove(at: match)
            }
        }
        return next
    }

    /// The draft after the whole file was written by hand, put back into stretches the way the desktop's
    /// editor keeps them: every stretch keeps its place through the edit, a conflict whose lines changed
    /// is answered, and one nobody touched stays open. Lines typed on the edge of a conflict go to the
    /// conflict, since that is what they were written against.
    func editedWhole(_ edited: [String], in file: GitConflictFile) -> GitConflictDraft {
        let before = file.blocks.indices.map { lines(of: $0, in: file) }
        let changes = ThreeWayMerge.diffLines(before.flatMap { $0 }, edited)
        var bounds = [0]
        var at = 0
        for index in file.blocks.indices.dropLast() {
            at += before[index].count
            let toEarlier = file.blocks[index].kind == .conflict || file.blocks[index + 1].kind != .conflict
            bounds.append(min(max(Self.map(at, through: changes, toEarlier: toEarlier), bounds[bounds.count - 1]), edited.count))
        }
        bounds.append(edited.count)
        var next = GitConflictDraft()
        for (index, block) in file.blocks.enumerated() {
            let now = Array(edited[bounds[index]..<max(bounds[index], bounds[index + 1])])
            let previous = answers[index]
            if now == before[index] {
                next.answers[index] = previous
            } else if block.kind == .conflict || now != (ThreeWayMerge.autoLines(block) ?? block.ours) {
                next.answers[index] = GitBlockAnswer(lines: now)
            }
        }
        return next
    }

    /// Where a line boundary of the old text lands in the edited one. Lines that replace or join the
    /// boundary go to the stretch before it when `toEarlier`, else to the one after.
    private static func map(_ position: Int, through changes: [MergeChange], toEarlier: Bool) -> Int {
        var offset = 0
        for change in changes {
            if change.baseStart > position { break }
            if change.baseEnd < position {
                offset = change.otherEnd - change.baseEnd
                continue
            }
            if change.baseStart == change.baseEnd { return toEarlier ? change.otherEnd : change.otherStart }
            if position == change.baseStart { return change.otherStart }
            if position == change.baseEnd { return change.otherEnd }
            return toEarlier ? change.otherEnd : change.otherStart
        }
        return position + offset
    }

    /// Proposals put in where nobody answered yet: what a person wrote stays as they left it.
    mutating func propose(_ proposals: [(index: Int, lines: [String])]) {
        for proposal in proposals where answers[proposal.index]?.byAgent != false {
            answers[proposal.index] = GitBlockAnswer(lines: proposal.lines, byAgent: true)
        }
    }
}

enum GitConflictModel {
    /// The proposals that still fit the file in front of us. An answer whose fingerprint does not match
    /// was written for another version of the stretch and is dropped rather than put somewhere it was
    /// never meant.
    static func usable(_ file: GitConflictFile, answers: [JSONValue]) -> [(index: Int, lines: [String])] {
        answers.compactMap { answer in
            let index = Int(answer.number("index", fallback: -1))
            guard file.blocks.indices.contains(index), file.blocks[index].kind == .conflict,
                ThreeWayMerge.fingerprint(file.blocks[index]) == answer.text("fingerprint")
            else { return nil }
            return (index, answer.list("lines").compactMap(\.stringValue))
        }
    }

    /// A stretch as a person typed it: no text is no lines, and every break is a line of its own.
    static func editedLines(_ text: String) -> [String] {
        text.isEmpty ? [] : text.components(separatedBy: "\n")
    }

    static func title(_ operation: String?) -> String {
        switch operation {
        case "merge": String(localized: "Resolve the merge")
        case "rebase": String(localized: "Resolve the rebase")
        case "cherry-pick": String(localized: "Resolve the cherry-pick")
        case "revert": String(localized: "Resolve the revert")
        default: String(localized: "Resolve the conflicts")
        }
    }

    static func continueLabel(_ operation: String) -> String {
        switch operation {
        case "rebase": String(localized: "Continue rebase")
        case "cherry-pick": String(localized: "Finish cherry-pick")
        case "revert": String(localized: "Finish revert")
        default: String(localized: "Finish merge")
        }
    }

    static func abortLabel(_ operation: String) -> String {
        switch operation {
        case "rebase": String(localized: "Abort rebase")
        case "cherry-pick": String(localized: "Abort cherry-pick")
        case "revert": String(localized: "Abort revert")
        default: String(localized: "Abort merge")
        }
    }

    static func wholeDetail(kind: String, ours: String, theirs: String) -> String {
        switch kind {
        case "binary": String(localized: "This file is not UTF-8 text. Keep one side whole or drop it.")
        case "deleted-by-them":
            String(localized: "\(theirs) deleted this file while it changed on \(ours).", comment: "Both are git refs")
        case "deleted-by-us":
            String(localized: "\(ours) deleted this file while it changed on \(theirs).", comment: "Both are git refs")
        case "submodule": String(localized: "This is a submodule. Pick the commit one side points at.")
        default: String(localized: "Pick a side for this file.")
        }
    }

    static func blockLabel(_ kind: MergeBlockKind) -> String {
        switch kind {
        case .stable: String(localized: "Unchanged")
        case .ours: String(localized: "Changed on our side")
        case .theirs: String(localized: "Changed on their side")
        case .both: String(localized: "The same change on both sides")
        case .conflict: String(localized: "Conflict")
        }
    }
}

/// What a failed request says, with the refusal of a machine that does not know the request yet in words
/// a person can act on: `outdated`.
func gitMessage(_ error: any Error, outdated: String) -> String {
    if case MachineClientError.server(code: "unknown-request", message: _) = error {
        return outdated
    }
    return error.localizedDescription
}

func gitRefusalCode(_ error: any Error) -> String? {
    if case MachineClientError.server(let code, _) = error { return code }
    return nil
}

/// Every file a checkout waiting halfway holds, and what a person made of each so far. It outlives the
/// pages that draw it, so walking from one file to the next and back lands on the same half-finished work.
@MainActor @Observable final class GitConflictSession {
    struct Entry: Equatable, Identifiable {
        let path: String
        let kind: String
        var id: String { path }
    }

    /// The agent run that answers files now, so the page can say where it is and stop it.
    struct AgentRun: Equatable {
        let actionId: String
        let done: Int
        let total: Int
        let path: String
    }

    let cwd: String
    private(set) var operation: String?
    private(set) var ours = "ours"
    private(set) var theirs = "theirs"
    private(set) var entries: [Entry] = []
    private(set) var loaded = false
    private(set) var unsupported = false
    private(set) var files: [String: GitConflictFile] = [:]
    private(set) var drafts: [String: GitConflictDraft] = [:]
    private(set) var agentRun: AgentRun?
    var problem: String?
    var note: String?
    var busy = false
    var progress: String?

    init(cwd: String) {
        self.cwd = cwd
    }

    func draft(_ path: String) -> GitConflictDraft { drafts[path] ?? GitConflictDraft() }

    /// How many conflicts of a file still wait on a person, or nil for a file not read yet.
    func openCount(_ path: String) -> Int? {
        guard let file = files[path], !file.whole else { return nil }
        return draft(path).open(in: file).count
    }

    /// The text files whose every conflict is answered, which are ready to be written.
    var ready: [String] { entries.map(\.path).filter { openCount($0) == 0 } }

    func load(client: any MachineRequesting) async {
        do {
            let answer = try await client.request("git.conflicts", payload: .object(["cwd": .string(cwd)]))
            operation = answer["operation"]?.stringValue
            ours = answer.text("ours", fallback: "ours")
            theirs = answer.text("theirs", fallback: "theirs")
            entries = answer.list("files").map { Entry(path: $0.text("path"), kind: $0.text("kind", fallback: "text")) }
            let listed = Set(entries.map(\.path))
            files = files.filter { listed.contains($0.key) }
            drafts = drafts.filter { listed.contains($0.key) }
            unsupported = false
        } catch is CancellationError {
            return
        } catch {
            if gitRefusalCode(error) == "unknown-request" { unsupported = true }
            problem = gitMessage(error, outdated: String(localized: "Update Ruimte on this machine to resolve conflicts on the phone."))
        }
        loaded = true
    }

    /// Reads a file once; a file already read keeps what was made of it.
    func open(client: any MachineRequesting, path: String) async {
        guard files[path] == nil else { return }
        do {
            files[path] = try await read(client: client, path: path)
        } catch is CancellationError {
        } catch {
            problem = gitMessage(error, outdated: String(localized: "Update Ruimte on this machine to resolve conflicts on the phone."))
        }
    }

    func answer(_ path: String, block: Int, lines: [String]) {
        var draft = draft(path)
        draft.answers[block] = GitBlockAnswer(lines: lines)
        drafts[path] = draft
    }

    func editWhole(_ path: String, text: String) {
        guard let file = files[path] else { return }
        drafts[path] = draft(path).editedWhole(GitConflictModel.editedLines(text), in: file)
    }

    func clear(_ path: String, block: Int) {
        var draft = draft(path)
        draft.answers[block] = nil
        drafts[path] = draft
    }

    /// Every open conflict of the file that needs no choice, closed in one go.
    func wand(_ path: String) {
        guard let file = files[path] else { return }
        var draft = draft(path)
        for entry in draft.wandable(in: file) {
            draft.answers[entry.index] = GitBlockAnswer(lines: entry.lines)
        }
        drafts[path] = draft
    }

    /// The files written as they stand, each over the version it was read at, and staged. A file that
    /// moved on disk since refuses; it is read again so the next try is not refused for the same reason,
    /// and the answers that still fit stay.
    @discardableResult func save(client: any MachineRequesting, paths: [String]) async -> Bool {
        guard !busy else { return false }
        busy = true
        defer { busy = false }
        for path in paths {
            guard let file = files[path] else { continue }
            let content = draft(path).content(of: file)
            do {
                _ = try await client.request(
                    "git.resolve",
                    payload: .object([
                        "cwd": .string(cwd), "path": .string(path), "content": .string(content),
                        "hash": .string(file.hash),
                    ]))
                files[path] = nil
                drafts[path] = nil
            } catch {
                problem = gitMessage(error, outdated: String(localized: "Update Ruimte on this machine to resolve conflicts on the phone."))
                await reread(client: client, path: path)
                await load(client: client)
                return false
            }
        }
        problem = nil
        note =
            paths.count == 1
            ? String(localized: "Marked \((paths[0] as NSString).lastPathComponent) resolved.")
            : String(localized: "Marked \(paths.count) files resolved.")
        await load(client: client)
        return true
    }

    /// One side of a file nobody merges line by line, or the file taken out.
    @discardableResult func take(client: any MachineRequesting, path: String, side: String) async -> Bool {
        guard !busy else { return false }
        busy = true
        defer { busy = false }
        var payload: [String: JSONValue] = ["cwd": .string(cwd), "path": .string(path), "take": .string(side)]
        if let hash = files[path]?.hash { payload["hash"] = .string(hash) }
        do {
            _ = try await client.request("git.resolve", payload: .object(payload))
            files[path] = nil
            drafts[path] = nil
            problem = nil
            await load(client: client)
            return true
        } catch {
            problem = gitMessage(error, outdated: String(localized: "Update Ruimte on this machine to resolve conflicts on the phone."))
            if files[path] != nil { await reread(client: client, path: path) }
            return false
        }
    }

    /// The files answered by the CLI on the machine. A proposal lands as an answer a person can read,
    /// change or clear; it is written only when they mark the file resolved.
    func ask(client: any MachineRequesting, paths: [String]) async {
        guard !busy else { return }
        busy = true
        defer {
            busy = false
            agentRun = nil
        }
        let actionId = UUID().uuidString
        var answered = 0
        var notes: [String] = []
        do {
            for (index, path) in paths.enumerated() {
                agentRun = AgentRun(actionId: actionId, done: index, total: paths.count, path: path)
                if files[path] == nil { files[path] = try await read(client: client, path: path) }
                guard let file = files[path], !file.whole else { continue }
                let result = try await client.request(
                    "git.resolveAi",
                    payload: .object(["cwd": .string(cwd), "path": .string(path), "actionId": .string(actionId)]))
                let usable = GitConflictModel.usable(file, answers: result.list("blocks"))
                var draft = draft(path)
                draft.propose(usable)
                drafts[path] = draft
                answered += usable.count
                if let line = result["note"]?.stringValue, !line.isEmpty { notes.append(line) }
            }
            problem = nil
            let summary =
                answered == 0
                ? String(localized: "The agent left every conflict to you.")
                : String(localized: "An agent proposed answers for \(answered) conflicts.")
            note = ([summary] + notes).joined(separator: "\n")
        } catch is CancellationError {
        } catch {
            problem = gitMessage(error, outdated: String(localized: "Update Ruimte on this machine to ask an agent to resolve conflicts."))
        }
    }

    func cancelAgent(client: any MachineRequesting) async {
        guard let run = agentRun else { return }
        _ = try? await client.request("git.cancel", payload: .object(["actionId": .string(run.actionId)]))
    }

    /// Finishing or taking back the operation that waits. True once nothing waits in the checkout any more.
    @discardableResult func finish(client: any MachineRequesting, action: String) async -> Bool {
        guard !busy else { return false }
        busy = true
        defer {
            busy = false
            progress = nil
        }
        if !loaded { await load(client: client) }
        let actionId = UUID().uuidString
        let cancel = client.subscribe("git.progress") { [weak self] payload in
            guard payload.text("actionId") == actionId else { return }
            let line = payload.text("line")
            self?.progress = line.isEmpty ? nil : line
        }
        defer { cancel() }
        let waiting = operation ?? "merge"
        do {
            let result = try await client.request(
                "git.operation",
                payload: .object(["cwd": .string(cwd), "actionId": .string(actionId), "action": .string(action)]))
            let left = result.list("conflicts").count
            files = [:]
            drafts = [:]
            problem = nil
            if action == "abort" {
                note = Self.takenBack(waiting)
            } else if left > 0 {
                note = String(localized: "\(left) files conflict in the next commit.")
            } else {
                note = Self.finished(waiting)
            }
            await load(client: client)
            return left == 0
        } catch {
            problem = gitMessage(error, outdated: Self.outdatedFinish(waiting))
            return false
        }
    }

    private static func takenBack(_ operation: String) -> String {
        switch operation {
        case "merge": String(localized: "The merge was taken back.")
        case "rebase": String(localized: "The rebase was taken back.")
        case "cherry-pick": String(localized: "The cherry-pick was taken back.")
        case "revert": String(localized: "The revert was taken back.")
        default: String(localized: "The operation was taken back.")
        }
    }

    private static func finished(_ operation: String) -> String {
        switch operation {
        case "merge": String(localized: "The merge is finished.")
        case "rebase": String(localized: "The rebase is finished.")
        case "cherry-pick": String(localized: "The cherry-pick is finished.")
        case "revert": String(localized: "The revert is finished.")
        default: String(localized: "The operation is finished.")
        }
    }

    private static func outdatedFinish(_ operation: String) -> String {
        switch operation {
        case "merge": String(localized: "Update Ruimte on this machine to finish a merge on the phone.")
        case "rebase": String(localized: "Update Ruimte on this machine to finish a rebase on the phone.")
        case "cherry-pick": String(localized: "Update Ruimte on this machine to finish a cherry-pick on the phone.")
        case "revert": String(localized: "Update Ruimte on this machine to finish a revert on the phone.")
        default: String(localized: "Update Ruimte on this machine to finish this operation on the phone.")
        }
    }

    /// The split runs off the main actor: a long file with many changes takes a moment to walk.
    private func read(client: any MachineRequesting, path: String) async throws -> GitConflictFile {
        let answer = try await client.request("git.conflict", payload: .object(["cwd": .string(cwd), "path": .string(path)]))
        return await Task.detached { GitConflictFile(answer: answer) }.value
    }

    /// A file read again after a refusal, so the next write goes over what stands on disk now.
    private func reread(client: any MachineRequesting, path: String) async {
        guard let before = files[path], let after = try? await read(client: client, path: path) else { return }
        if before.sameBlocks(as: after) {
            files[path] = before.reread(hash: after.hash)
        } else {
            files[path] = after
            drafts[path] = draft(path).carried(from: before, to: after)
            note = String(localized: "The file changed on the machine and was read again. Answers that still fit were kept.")
        }
    }
}

/// The conflict sessions of the checkouts a git page reaches, worktrees a merge stopped in included.
@MainActor final class GitConflictStore {
    private var sessions: [String: GitConflictSession] = [:]

    func session(_ cwd: String) -> GitConflictSession {
        if let known = sessions[cwd] { return known }
        let made = GitConflictSession(cwd: cwd)
        sessions[cwd] = made
        return made
    }
}
