import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// One line `fs.grep` found, where the hit sits in it counted in UTF-16 as the machine counts.
struct FileGrepHit: Identifiable, Equatable {
    let line: Int
    let column: Int
    let length: Int
    let text: String

    var id: String { "\(line):\(column)" }

    /// The line around the hit, cut where the hit starts and ends.
    var parts: (before: String, match: String, after: String) {
        let utf16 = text.utf16
        let start = utf16.index(utf16.startIndex, offsetBy: min(column, utf16.count), limitedBy: utf16.endIndex)
        let end = start.flatMap { utf16.index($0, offsetBy: length, limitedBy: utf16.endIndex) }
        guard let start, let end, let lower = String.Index(start, within: text),
            let upper = String.Index(end, within: text)
        else {
            return (text, "", "")
        }
        return (String(text[..<lower]), String(text[lower..<upper]), String(text[upper...]))
    }
}

/// The hits of one file, which is how the results read.
struct FileGrepGroup: Identifiable, Equatable {
    let path: String
    let hits: [FileGrepHit]

    var id: String { path }
}

/// Find in files: a text search through the files under a folder, as the desktop palette's find-in-files mode.
@MainActor @Observable final class FileGrepModel {
    let cwd: String
    var query = ""
    var caseSensitive = false
    var wholeWord = false
    var regex = false
    private(set) var groups: [FileGrepGroup] = []
    private(set) var fileCount = 0
    private(set) var truncated = false
    private(set) var searching = false
    /// The query the results answer, which the field has moved on from while a search runs.
    private(set) var answered: String?
    var problem: String?
    private var generation = 0

    init(cwd: String) {
        self.cwd = cwd
    }

    var options: String { "\(caseSensitive)\(wholeWord)\(regex)" }
    var hitCount: Int { groups.reduce(0) { $0 + $1.hits.count } }

    static func group(_ matches: [JSONValue]) -> [FileGrepGroup] {
        var order: [String] = []
        var hits: [String: [FileGrepHit]] = [:]
        for match in matches {
            let path = match.text("path")
            if hits[path] == nil { order.append(path) }
            hits[path, default: []].append(
                FileGrepHit(
                    line: Int(match.number("line")), column: Int(match.number("column")),
                    length: Int(match.number("length")), text: match.text("text")))
        }
        return order.map { FileGrepGroup(path: $0, hits: hits[$0] ?? []) }
    }

    func search(client: any MachineRequesting) async {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        generation += 1
        let mine = generation
        guard !needle.isEmpty else {
            groups = []
            answered = nil
            problem = nil
            searching = false
            return
        }
        searching = true
        defer { if mine == generation { searching = false } }
        var payload: [String: JSONValue] = ["cwd": .string(cwd), "query": .string(needle)]
        if caseSensitive { payload["caseSensitive"] = .bool(true) }
        if wholeWord { payload["wholeWord"] = .bool(true) }
        if regex { payload["regex"] = .bool(true) }
        do {
            let answer = try await client.request("fs.grep", payload: .object(payload))
            guard mine == generation else { return }
            groups = Self.group(answer.list("matches"))
            fileCount = Int(answer.number("files"))
            truncated = answer["truncated"] == .bool(true)
            answered = needle
            problem = nil
        } catch is CancellationError {
        } catch {
            guard mine == generation else { return }
            groups = []
            answered = needle
            problem =
                gitRefusalCode(error) == "unknown-request"
                ? "Update Ruimte on this machine to search in files on the phone." : error.localizedDescription
        }
    }
}

struct FileGrepPage: View {
    let client: any MachineRequesting
    var project: FilesProject?
    @State private var model: FileGrepModel
    @State private var opened: FileGrepTarget?

    init(client: any MachineRequesting, cwd: String, project: FilesProject?) {
        self.client = client
        self.project = project
        _model = State(initialValue: FileGrepModel(cwd: cwd))
    }

    var body: some View {
        MobileList {
            if model.searching {
                HStack(spacing: 10) {
                    Spinner(size: 14, label: "Searching").foregroundStyle(MobileStyle.statusRunning)
                    Text("Searching").font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
            if let problem = model.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            if let answered = model.answered, model.groups.isEmpty, model.problem == nil, !model.searching {
                ContentUnavailableView("Nothing matches \(answered)", lucideIcon: "text-search")
            } else if model.answered == nil && !model.searching {
                ContentUnavailableView(
                    "Find in files", lucideIcon: "text-search",
                    description: Text(
                        "Searches the text of every file under \((model.cwd as NSString).lastPathComponent)."))
            }
            if !model.groups.isEmpty {
                Text(summary).font(.caption).foregroundStyle(MobileStyle.muted)
            }
            ForEach(model.groups) { group in
                Section {
                    ForEach(group.hits) { hit in
                        Button {
                            let target = FileGrepTarget(path: absolute(group.path), line: hit.line)
                            if let openFile = project?.openFile {
                                openFile(target.path, target.line)
                            } else {
                                opened = target
                            }
                        } label: {
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text("\(hit.line)").font(.caption.monospacedDigit()).foregroundStyle(MobileStyle.faint)
                                    .frame(minWidth: 32, alignment: .trailing)
                                Text(highlighted(hit)).font(.system(.caption, design: .monospaced)).lineLimit(2)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    HStack(spacing: 8) {
                        Image(lucide: FileKinds.icon(name: group.path, kind: "file"), size: 14)
                        Text((group.path as NSString).lastPathComponent).foregroundStyle(MobileStyle.text)
                        Text((group.path as NSString).deletingLastPathComponent).lineLimit(1).truncationMode(.head)
                        Spacer(minLength: 4)
                        Text("\(group.hits.count)").monospacedDigit()
                    }
                    .font(.footnote).foregroundStyle(MobileStyle.muted).textCase(nil)
                }
            }
        }
        .searchable(text: $model.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find in files")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .navigationTitle("Find in files")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Toggle("Match case", isOn: $model.caseSensitive)
                    Toggle("Whole word", isOn: $model.wholeWord)
                    Toggle("Regular expression", isOn: $model.regex)
                } label: {
                    Label("Search options", lucideIcon: "sliders-horizontal")
                }
            }
        }
        .navigationDestination(item: $opened) { target in
            FileContentPage(client: client, path: target.path, initialLine: target.line, project: project)
        }
        .task(id: model.query + model.options) {
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            await model.search(client: client)
        }
    }

    private var summary: String {
        let hits = model.hitCount == 1 ? "1 match" : "\(model.hitCount) matches"
        let files = model.fileCount == 1 ? "1 file" : "\(model.fileCount) files"
        return model.truncated
            ? "The first \(hits) in \(files). Narrow the search for the rest." : "\(hits) in \(files)"
    }

    private func absolute(_ path: String) -> String {
        path.hasPrefix("/") ? path : model.cwd + "/" + path
    }

    private func highlighted(_ hit: FileGrepHit) -> AttributedString {
        let parts = hit.parts
        var result = AttributedString(parts.before)
        var match = AttributedString(parts.match)
        match.foregroundColor = MobileStyle.accent
        match.inlinePresentationIntent = .stronglyEmphasized
        result += match
        result += AttributedString(parts.after)
        return result
    }
}

private struct FileGrepTarget: Hashable, Identifiable {
    let path: String
    let line: Int

    var id: String { "\(path):\(line)" }
}
