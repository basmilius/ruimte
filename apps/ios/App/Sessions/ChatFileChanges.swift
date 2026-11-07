import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

struct ChatFileChange: Equatable, Identifiable {
    var id: String { path }
    let path: String
    var diff: String
    var added: Int
    var deleted: Int
    var omitted: String?
    /// How many changes a call reported for the file, which a card built from them says instead of the lines.
    var edits = 1
}

enum ChatFileChanges {
    static func hasChanges(_ tool: ChatToolItem) -> Bool { !fromTool(tool).isEmpty }

    static func fromTool(_ tool: ChatToolItem) -> [ChatFileChange] {
        let patches = (tool.changes ?? []).filter { !$0.diff.isEmpty }
        if !patches.isEmpty { return patches.map { counted(path: $0.path, diff: $0.diff) } }
        return fromInput(name: tool.name, input: tool.input)
    }

    /// An approval carries the changes its call would make in its input, which has no schema of its own.
    static func fromApproval(_ approval: ChatApprovalItem) -> [ChatFileChange] {
        let patches = approval.input.list("changes").filter { !$0.text("diff").isEmpty }
        if !patches.isEmpty { return patches.map(fromJSON) }
        return fromInput(name: approval.toolName, input: approval.input)
    }

    /// The heads a turn started and ended on, cut short, when the branch moved under it: its diff then also holds what
    /// came in with the move.
    static func baseMoved(_ turn: ChatTurnItem) -> (from: String, to: String)? {
        guard let from = turn.checkpointHead, let to = turn.checkpointHeadAfter, from != to else { return nil }
        return (String(from.prefix(7)), String(to.prefix(7)))
    }

    static func fromFile(_ file: ChatTurnItemCheckpointDiffFilesItem) -> ChatFileChange {
        ChatFileChange(
            path: file.path, diff: file.diff, added: Int(file.added), deleted: Int(file.deleted),
            omitted: file.omitted?.rawValue)
    }

    private static func fromInput(name: String, input: JSONValue) -> [ChatFileChange] {
        let path = input.text("file_path")
        guard !path.isEmpty else { return [] }
        switch name {
        case "Edit": return [replacement(path: path, before: input.text("old_string"), after: input.text("new_string"))]
        case "Write": return [replacement(path: path, before: "", after: input.text("content"))]
        case "MultiEdit":
            return input.list("edits").map {
                replacement(path: path, before: $0.text("old_string"), after: $0.text("new_string"))
            }
        default: return []
        }
    }

    private static func fromJSON(_ value: JSONValue) -> ChatFileChange {
        var change = counted(path: value.text("path"), diff: value.text("diff"))
        if let added = value["added"]?.numberValue { change.added = Int(added) }
        if let deleted = value["deleted"]?.numberValue { change.deleted = Int(deleted) }
        change.omitted = value["omitted"]?.stringValue
        return change
    }

    /// A change that says only its diff, counted from the diff's own lines.
    private static func counted(path: String, diff: String) -> ChatFileChange {
        let lines = diff.components(separatedBy: "\n")
        return ChatFileChange(
            path: path, diff: diff, added: lines.count { $0.hasPrefix("+") && !$0.hasPrefix("+++") },
            deleted: lines.count { $0.hasPrefix("-") && !$0.hasPrefix("---") })
    }

    static func grouped(_ changes: [ChatFileChange]) -> [ChatFileChange] {
        var files: [ChatFileChange] = []
        var positions: [String: Int] = [:]
        for change in changes {
            if let index = positions[change.path] {
                files[index].diff += "\n" + change.diff
                files[index].added += change.added
                files[index].deleted += change.deleted
                files[index].edits += change.edits
            } else {
                positions[change.path] = files.count
                files.append(change)
            }
        }
        return files
    }

    private static func replacement(path: String, before: String, after: String) -> ChatFileChange {
        let old = before.isEmpty ? [] : before.components(separatedBy: "\n")
        let new = after.isEmpty ? [] : after.components(separatedBy: "\n")
        // Provider edits describe a replacement fragment, not the complete file or its line numbers.
        let diff =
            String(localized: "Replacement", comment: "Header of a diff that shows a replaced fragment") + "\n"
            + (old.map { "-" + $0 } + new.map { "+" + $0 }).joined(separator: "\n")
        return ChatFileChange(path: path, diff: diff, added: new.count, deleted: old.count)
    }
}

struct ChatDiffView: View {
    let diff: String
    @State private var showAll = false
    private var lines: [String] { diff.components(separatedBy: "\n") }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // A plain stack: a lazy one does not report the width of its widest line, so nothing scrolled sideways.
            ScrollView(.horizontal) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array((showAll ? lines : Array(lines.prefix(400))).enumerated()), id: \.offset) { _, line in
                        Text(line.isEmpty ? " " : line)
                            .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                            .fixedSize(horizontal: true, vertical: false)
                            .foregroundStyle(
                                line.hasPrefix("+") ? MobileStyle.positive : line.hasPrefix("-") ? MobileStyle.statusError : MobileStyle.muted
                            )
                            .padding(.horizontal, 12).padding(.vertical, 2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                line.hasPrefix("+")
                                    ? MobileStyle.positive.opacity(0.08) : line.hasPrefix("-") ? MobileStyle.statusError.opacity(0.08) : .clear
                            )
                    }
                }.fixedSize(horizontal: true, vertical: false)
            }
            .fixedSize(horizontal: false, vertical: true)
            if lines.count > 400 && !showAll {
                ChatExpansionButton(expanding: true) {
                    showAll = true
                } label: {
                    Text("Show all \(lines.count) lines")
                }.font(.caption).frame(minHeight: 44).padding(
                    .horizontal, 12)
            }
        }
        .contextMenu {
            Button(String(localized: "Copy diff"), lucideIcon: "copy") { UIPasteboard.general.string = diff }
        }
    }
}

/// A file of a changes card on one line, which opens its diff under it.
struct ChatFileChangeView: View {
    let change: ChatFileChange
    /// Whether a line separates the file from what is above it in the card.
    var ruled = true
    /// Offered by a file whose diff the thread held back, which then reads the turn's whole diff.
    var whole: ChatFileChangeWhole? = nil
    /// Built from what the calls reported rather than a checkpoint, whose line counts say nothing about the file.
    var reported = false
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if ruled { ChatCardRule() }
            ChatExpansionButton(expanding: !expanded) {
                expanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(lucide: expanded ? "chevron-down" : "chevron-right", size: 12)
                        .foregroundStyle(MobileStyle.faint)
                    Text(change.path).font(.system(.caption, design: .monospaced)).foregroundStyle(MobileStyle.text)
                        .lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 0)
                    Group {
                        if reported {
                            Text("\(change.edits) edits").foregroundStyle(MobileStyle.faint)
                        } else {
                            Text("+\(change.added)").foregroundStyle(MobileStyle.positive)
                            Text("-\(change.deleted)").foregroundStyle(MobileStyle.statusError)
                        }
                    }
                    .fixedSize()
                }
                .font(.caption).monospacedDigit().foregroundStyle(MobileStyle.muted)
                .padding(.horizontal, 12).frame(minHeight: 32).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            if expanded {
                ChatCardRule()
                if let omitted = change.omitted {
                    Text(omitted == "binary" ? "Binary file, no diff" : "Too large to show")
                        .font(.caption).foregroundStyle(MobileStyle.muted).padding(12)
                } else if let whole, change.diff.isEmpty {
                    ChatWholeBar(
                        whole: whole.state, label: "Show full diff", failedLabel: "Could not load the full diff",
                        read: whole.read
                    )
                    .padding(.horizontal, 12)
                } else {
                    ChatDiffView(diff: change.diff)
                }
            }
        }
    }
}

/// The turn's whole diff, which every held-back file of its card offers and one read fills in for all of them.
struct ChatFileChangeWhole {
    let state: ChatWhole<ChatTurnItemCheckpointDiff>
    let read: () async throws -> ChatTurnItemCheckpointDiff?
}

struct ChatCardRule: View {
    var body: some View { Rectangle().fill(MobileStyle.border).frame(height: 1) }
}

/// The files a settled turn changed, as a card that opens to a line per file.
struct ChatChangedFilesRow: View {
    let turn: ChatItemState
    let tools: [ChatItemState]
    let client: any MachineRequesting
    let chatID: String
    @State private var work = RemotePageState()
    @State private var fetched: ChatTurnItemCheckpointDiff?
    @State private var fetchedOnce = false
    @State private var expanded = false
    @State private var whole = ChatWhole<ChatTurnItemCheckpointDiff>()
    private var item: ChatTurnItem? { turn.item.turnItem }
    private var stored: ChatTurnItemCheckpointDiff? { whole.value ?? item?.checkpointDiff }
    /// The checkpoint's diff while it has files; a turn without one falls back to what its calls reported.
    private var checkpointFiles: [ChatFileChange]? {
        guard let diff = stored ?? fetched, !diff.files.isEmpty else { return nil }
        return ChatFileChanges.grouped(diff.files.map(ChatFileChanges.fromFile))
    }
    private var files: [ChatFileChange] {
        checkpointFiles
            ?? ChatFileChanges.grouped(tools.compactMap(\.item.toolItem).flatMap(ChatFileChanges.fromTool))
    }

    var body: some View {
        let files = files
        let reported = checkpointFiles == nil
        let moved = item.flatMap(ChatFileChanges.baseMoved)
        VStack(alignment: .leading, spacing: 0) {
            if !files.isEmpty || work.loading || work.problem != nil {
                VStack(alignment: .leading, spacing: 0) {
                    if !files.isEmpty {
                        header(files, moved: reported ? nil : moved, totals: !reported)
                        if !reported, let moved {
                            Text(
                                "Branch moved this turn (\(moved.from) to \(moved.to)). Includes its incoming changes."
                            )
                            .font(.caption).foregroundStyle(MobileStyle.muted)
                            .padding(.leading, 34).padding(.trailing, 12).padding(.bottom, 10)
                        }
                        if expanded {
                            let whole = heldBack
                            ForEach(files) { change in
                                ChatFileChangeView(change: change, whole: whole, reported: reported)
                            }
                        }
                    }
                    if work.loading { ProgressView("Loading changes…").font(.caption).padding(12) }
                    if let problem = work.problem {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(problem).font(.caption).foregroundStyle(MobileStyle.muted)
                            Button("Retry") { Task { await load() } }.frame(minHeight: 44)
                        }.padding(.horizontal, 12).padding(.top, 8)
                    }
                }
                .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 12))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
            }
        }.task(id: turn.id) { await load() }
    }

    private func header(_ files: [ChatFileChange], moved: (from: String, to: String)?, totals: Bool) -> some View {
        ChatExpansionButton(expanding: !expanded) {
            expanded.toggle()
        } label: {
            HStack(spacing: 8) {
                Image(lucide: "file-diff", size: 14)
                Text(
                    moved == nil
                        ? String(localized: "\(files.count) changed files")
                        : String(localized: "\(files.count) folder changes this turn")
                )
                .font(.footnote.weight(.medium)).foregroundStyle(MobileStyle.text).lineLimit(1).layoutPriority(1)
                if totals, (stored ?? fetched)?.truncated == true {
                    Text("and more").foregroundStyle(MobileStyle.faint).lineLimit(1)
                }
                Spacer(minLength: 0)
                Group {
                    if totals {
                        Text("+\(files.reduce(0) { $0 + $1.added })").foregroundStyle(MobileStyle.positive)
                        Text("-\(files.reduce(0) { $0 + $1.deleted })").foregroundStyle(MobileStyle.statusError)
                    }
                    Image(lucide: expanded ? "chevron-down" : "chevron-right", size: 12)
                        .foregroundStyle(MobileStyle.faint)
                }
                .fixedSize()
            }
            .font(.footnote).monospacedDigit().foregroundStyle(MobileStyle.muted)
            .padding(.horizontal, 12).frame(minHeight: 32).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
    }

    /// The whole diff behind a card whose later files the thread held back, until it is read.
    private var heldBack: ChatFileChangeWhole? {
        guard let item, item.checkpointDiffRef != nil, whole.value == nil else { return nil }
        let client = client
        let chatID = chatID
        let turnID = item.turnId ?? item.id
        return ChatFileChangeWhole(state: whole) {
            try await ChatWholeReads.turnDiff(client: client, chatID: chatID, turnID: turnID)
        }
    }

    private func load() async {
        guard stored == nil, !fetchedOnce, let item, item.checkpoint != nil, !work.loading else { return }
        await work.read { stillTheLatest in
            let result = try await client.request(
                "chat.turnDiff",
                payload: .object(["chatId": .string(chatID), "turnId": .string(item.turnId ?? item.id)]))
            try stillTheLatest()
            // A turn whose diff is empty still counts as read: a second attempt would answer the same.
            fetched = try? result["diff"]?.decoded(as: ChatTurnItemCheckpointDiff.self)
            fetchedOnce = true
        }
    }
}
