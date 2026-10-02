import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What a conflict page is pointed at: a checkout, and one file of it for a file page.
struct GitConflictTarget: Hashable, Identifiable {
    let cwd: String
    let path: String

    var id: String { "\(cwd)\u{0}\(path)" }
}

/// What a pull, a merge or a rebase left behind in one checkout: every file that waits on a person, and
/// the operation itself, which is only finished or taken back from here.
struct GitConflictsPage: View {
    let client: any MachineRequesting
    let session: GitConflictSession
    @State private var confirmAbort = false

    var body: some View {
        MobileList {
            GitConflictStatusRows(client: client, session: session)
            if session.unsupported {
                ContentUnavailableView(
                    "Needs an update", lucideIcon: "circle-alert",
                    description: Text("Update Ruimte on this machine to resolve conflicts on the phone."))
            } else if !session.loaded {
                MobileLoadingRow("Loading").frame(maxWidth: .infinity).padding()
            } else {
                files
                GitOperationSection(client: client, session: session, confirmAbort: $confirmAbort)
            }
        }
        .navigationTitle(GitConflictModel.title(session.operation))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem {
                let text = session.entries.filter { $0.kind == "text" }.map(\.path)
                Button("Ask an agent about every file", lucideIcon: "sparkles") {
                    Task { await session.ask(client: client, paths: text) }
                }.disabled(session.busy || text.isEmpty)
            }
        }
        .task(id: session.cwd) {
            await RemotePageLifecycle.run(
                client: client, events: ["git.status"], matches: { $0.text("cwd") == session.cwd },
                subscription: {
                    let payload: JSONValue = .object(["cwd": .string(session.cwd)])
                    return client.acquireSubscription(
                        start: "git.watch", stop: "git.unwatch", payload: payload, stopPayload: payload)
                }, load: { await session.load(client: client) })
        }
        .refreshable { await session.load(client: client) }
        .modifier(
            GitAbortConfirmation(operation: session.operation ?? "merge", isPresented: $confirmAbort) {
                Task { await session.finish(client: client, action: "abort") }
            })
    }

    @ViewBuilder private var files: some View {
        Section {
            if session.entries.isEmpty {
                ContentUnavailableView(
                    "Nothing conflicts any more", lucideIcon: "circle-check",
                    description: Text(
                        session.operation.map { "Everything is resolved. Finish the \($0) below." }
                            ?? "Nothing waits on you in this checkout."))
            }
            ForEach(session.entries) { entry in
                NavigationLink {
                    GitConflictFilePage(client: client, session: session, path: entry.path)
                } label: {
                    fileRow(entry)
                }.disabled(session.busy)
            }
        } header: {
            Text("\(session.ours) against \(session.theirs)")
        }
        let ready = session.ready
        if ready.count > 1 {
            Button("Mark \(ready.count) files resolved", lucideIcon: "check") {
                Task { await session.save(client: client, paths: ready) }
            }.disabled(session.busy)
        }
    }

    private func fileRow(_ entry: GitConflictSession.Entry) -> some View {
        let open = session.openCount(entry.path)
        return HStack(spacing: 10) {
            Image(lucide: open == 0 ? "check" : "file-exclamation-point", size: 15)
                .foregroundStyle(open == 0 ? MobileStyle.statusIdle : MobileStyle.statusNeedsYou)
            VStack(alignment: .leading, spacing: 3) {
                Text((entry.path as NSString).lastPathComponent).lineLimit(1)
                Text(entry.path).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1).truncationMode(.head)
            }
            Spacer(minLength: 8)
            if let open, open > 0 {
                Text("\(open)").font(.caption.monospacedDigit()).foregroundStyle(MobileStyle.faint)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// What is going on in a conflict session right now: the agent at work, a step git is on, what went wrong
/// and what went through.
struct GitConflictStatusRows: View {
    let client: any MachineRequesting
    let session: GitConflictSession

    var body: some View {
        if let run = session.agentRun {
            HStack(spacing: 10) {
                MobileLoadingRow("Asking an agent")
                Text("Asking an agent: \((run.path as NSString).lastPathComponent), \(run.done + 1) of \(run.total)")
                    .font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                Spacer(minLength: 8)
                Button("Cancel") { Task { await session.cancelAgent(client: client) } }.font(.caption)
            }
        } else if session.busy {
            HStack(spacing: 10) {
                MobileLoadingRow("Working")
                Text(session.progress ?? "Working").font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
            }
        }
        if let problem = session.problem, !session.unsupported {
            Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
        }
        if let note = session.note {
            Text(note).font(.caption).foregroundStyle(MobileStyle.muted)
        }
    }
}

/// Finishing or taking back the operation that waits in a checkout. Finishing waits until no file conflicts.
struct GitOperationSection: View {
    let client: any MachineRequesting
    let session: GitConflictSession
    @Binding var confirmAbort: Bool

    var body: some View {
        if let operation = session.operation {
            Section {
                Button(GitConflictModel.continueLabel(operation), lucideIcon: "git-merge") {
                    Task { await session.finish(client: client, action: "continue") }
                }.disabled(session.busy || !session.entries.isEmpty)
                Button(GitConflictModel.abortLabel(operation), lucideIcon: "ban", role: .destructive) {
                    confirmAbort = true
                }.disabled(session.busy)
            } footer: {
                Text(
                    session.entries.isEmpty
                        ? "Every file is resolved."
                        : session.entries.count == 1 ? "1 file left." : "\(session.entries.count) files left.")
            }
        }
    }
}

/// The question before a halfway operation is taken back, since what was resolved goes with it.
struct GitAbortConfirmation: ViewModifier {
    let operation: String
    @Binding var isPresented: Bool
    let onAbort: () -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog(
            "Abort the \(operation)?", isPresented: $isPresented, titleVisibility: .visible
        ) {
            Button(GitConflictModel.abortLabel(operation), role: .destructive, action: onAbort)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The checkout goes back to how it was before the \(operation). What was resolved so far is lost.")
        }
    }
}

/// One stretch being edited by hand.
private struct GitBlockEdit: Identifiable {
    let block: Int
    let text: String
    var id: Int { block }
}

/// One unmerged file. The stretches that merge by themselves are folded; every conflict shows both sides
/// and what it stands at, and nothing is written until the file is marked resolved.
struct GitConflictFilePage: View {
    let client: any MachineRequesting
    let session: GitConflictSession
    let path: String
    @State private var editing: GitBlockEdit?
    @State private var confirmDrop = false
    @Environment(\.dismiss) private var dismiss

    private var file: GitConflictFile? { session.files[path] }
    private var draft: GitConflictDraft { session.draft(path) }

    var body: some View {
        MobileList {
            GitConflictStatusRows(client: client, session: session)
            if let file {
                if file.whole {
                    whole(file)
                } else {
                    summary(file)
                    ForEach(file.blocks.indices, id: \.self) { index in
                        if file.blocks[index].kind == .conflict {
                            GitConflictBlockView(
                                block: file.blocks[index], number: (file.conflictIndexes.firstIndex(of: index) ?? 0) + 1,
                                total: file.conflictIndexes.count, answer: draft.answers[index], ours: session.ours,
                                theirs: session.theirs, busy: session.busy,
                                onAnswer: { session.answer(path, block: index, lines: $0) },
                                onClear: { session.clear(path, block: index) },
                                onEdit: { editing = GitBlockEdit(block: index, text: draft.lines(of: index, in: file).joined(separator: "\n")) })
                        } else {
                            GitMergedBlockView(
                                kind: file.blocks[index].kind, lines: draft.lines(of: index, in: file),
                                edited: draft.answers[index] != nil
                            ) {
                                editing = GitBlockEdit(block: index, text: draft.lines(of: index, in: file).joined(separator: "\n"))
                            }
                        }
                    }
                }
            } else if session.problem == nil {
                MobileLoadingRow("Reading the file").frame(maxWidth: .infinity).padding()
            }
        }
        .navigationTitle((path as NSString).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let file, !file.whole {
                ToolbarItem {
                    Menu {
                        let wandable = draft.wandable(in: file).count
                        Button(
                            wandable == 0 ? "Nothing left that resolves itself" : "Resolve the \(wandable) that need no choice",
                            lucideIcon: "wand-sparkles"
                        ) { session.wand(path) }.disabled(wandable == 0)
                        Button("Ask an agent about this file", lucideIcon: "sparkles") {
                            Task { await session.ask(client: client, paths: [path]) }
                        }
                    } label: {
                        Label("Resolve for me", lucideIcon: "sparkles")
                    }.disabled(session.busy)
                }
                ToolbarItem {
                    Button("Mark resolved", lucideIcon: "check") {
                        Task {
                            if await session.save(client: client, paths: [path]) { dismiss() }
                        }
                    }.disabled(session.busy || !draft.open(in: file).isEmpty)
                }
            }
        }
        .task(id: path) {
            if !session.loaded { await session.load(client: client) }
            await session.open(client: client, path: path)
        }
        .mobileSheet(item: $editing) { edit in
            GitBlockEditSheet(initial: edit.text) { text in
                session.answer(path, block: edit.block, lines: GitConflictModel.editedLines(text))
                editing = nil
            } onCancel: {
                editing = nil
            }
        }
        .confirmationDialog("Drop \((path as NSString).lastPathComponent)?", isPresented: $confirmDrop, titleVisibility: .visible) {
            Button("Drop the file", role: .destructive) { Task { await take("delete") } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The file is taken out of the checkout on both sides of the \(session.operation ?? "merge").")
        }
    }

    private func summary(_ file: GitConflictFile) -> some View {
        let open = draft.open(in: file).count
        let total = file.conflictIndexes.count
        return VStack(alignment: .leading, spacing: 4) {
            Text(path).font(.caption.monospaced()).foregroundStyle(MobileStyle.muted).lineLimit(2).truncationMode(.head)
            Text(total == 0 ? "Nothing in this file needs a choice." : "\(open) of \(total) open")
                .font(.caption.monospacedDigit()).foregroundStyle(open == 0 ? MobileStyle.statusIdle : MobileStyle.statusNeedsYou)
        }
    }

    @ViewBuilder private func whole(_ file: GitConflictFile) -> some View {
        Section {
            Text(GitConflictModel.wholeDetail(kind: file.kind, ours: session.ours, theirs: session.theirs))
            Button("Keep \(session.ours)", lucideIcon: "check") { Task { await take("ours") } }
                .disabled(session.busy || file.kind == "deleted-by-us")
            Button("Take \(session.theirs)", lucideIcon: "check") { Task { await take("theirs") } }
                .disabled(session.busy || file.kind == "deleted-by-them")
            Button("Drop the file", lucideIcon: "trash-2", role: .destructive) { confirmDrop = true }
                .disabled(session.busy)
        } header: {
            Text(path).textCase(nil)
        }
    }

    private func take(_ side: String) async {
        if await session.take(client: client, path: path, side: side) { dismiss() }
    }
}

/// A stretch that merged by itself, folded to one line; it opens to show what it holds and can be edited.
private struct GitMergedBlockView: View {
    let kind: MergeBlockKind
    let lines: [String]
    let edited: Bool
    let onEdit: () -> Void

    var body: some View {
        DisclosureGroup {
            GitLinesView(lines: lines, tint: kind == .stable ? nil : MobileStyle.accent)
        } label: {
            HStack(spacing: 8) {
                Text(edited ? "Edited by you" : GitConflictModel.blockLabel(kind))
                    .font(.caption).foregroundStyle(kind == .stable ? MobileStyle.faint : MobileStyle.muted)
                Spacer(minLength: 8)
                Text(lines.count == 1 ? "1 line" : "\(lines.count) lines")
                    .font(.caption.monospacedDigit()).foregroundStyle(MobileStyle.faint)
            }
        }
        .contextMenu {
            Button("Edit", lucideIcon: "pencil", action: onEdit)
        }
    }
}

/// One conflict: what it stands at, the two sides it came from, and a button for each answer.
private struct GitConflictBlockView: View {
    let block: MergeBlock
    let number: Int
    let total: Int
    let answer: GitBlockAnswer?
    let ours: String
    let theirs: String
    let busy: Bool
    let onAnswer: ([String]) -> Void
    let onClear: () -> Void
    let onEdit: () -> Void

    private var state: String {
        guard let answer else { return "Open" }
        return answer.byAgent ? "Proposed by an agent" : "Answered"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("Conflict \(number) of \(total)").font(.callout.weight(.medium))
                Spacer(minLength: 8)
                MobileStatus(
                    title: state,
                    color: answer == nil ? MobileStyle.statusNeedsYou : answer!.byAgent ? MobileStyle.accent : MobileStyle.statusIdle)
            }
            if let answer {
                side(answer.byAgent ? "The agent's proposal" : "Result", lines: answer.lines, tint: MobileStyle.statusIdle)
            }
            side(ours, lines: block.ours, tint: MobileStyle.accent)
            side(theirs, lines: block.theirs, tint: MobileStyle.statusNeedsYou)
            HStack(spacing: 8) {
                Button("Take \(ours)") { onAnswer(block.ours) }
                Button("Take \(theirs)") { onAnswer(block.theirs) }
                Spacer(minLength: 0)
                Menu {
                    Button("Both, \(ours) first") { onAnswer(ThreeWayMerge.bothLines(block, oursFirst: true)) }
                    Button("Both, \(theirs) first") { onAnswer(ThreeWayMerge.bothLines(block, oursFirst: false)) }
                    Button(answer?.byAgent == true ? "Edit the proposal" : "Edit by hand", lucideIcon: "pencil", action: onEdit)
                    if answer != nil {
                        Button("Clear the answer", lucideIcon: "rotate-ccw", role: .destructive, action: onClear)
                    }
                } label: {
                    Label("More answers", lucideIcon: "ellipsis")
                        .labelStyle(.iconOnly)
                }
            }
            .font(.caption)
            .buttonStyle(.bordered)
            .lineLimit(1)
            .disabled(busy)
        }
        .padding(.vertical, 4)
    }

    private func side(_ title: String, lines: [String], tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1).truncationMode(.middle)
            if lines.isEmpty {
                Text("This side holds nothing here.").font(.caption).foregroundStyle(MobileStyle.faint)
            } else {
                GitLinesView(lines: lines, tint: tint)
            }
        }
    }
}

/// Lines of source as the file holds them, scrolled sideways rather than wrapped.
private struct GitLinesView: View {
    /// A stretch longer than this is drawn by its first lines alone; nobody reads a thousand rows on a phone.
    private static let shown = 200

    let lines: [String]
    let tint: Color?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ScrollView(.horizontal) {
                Text(lines.prefix(Self.shown).map { $0.isEmpty ? " " : $0 }.joined(separator: "\n"))
                    .font(.caption.monospaced()).textSelection(.enabled).fixedSize()
                    .padding(8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background((tint ?? MobileStyle.muted).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            if lines.count > Self.shown {
                Text("\(lines.count - Self.shown) more lines").font(.caption).foregroundStyle(MobileStyle.faint)
            }
        }
    }
}

/// One stretch written by hand, starting from what it stands at now.
private struct GitBlockEditSheet: View {
    let initial: String
    let onSave: (String) -> Void
    let onCancel: () -> Void
    @State private var text = ""

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .font(.callout.monospaced())
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .padding(.horizontal)
                .navigationTitle("Edit stretch")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { onSave(text) } }
                }
        }
        .task { text = initial }
    }
}
