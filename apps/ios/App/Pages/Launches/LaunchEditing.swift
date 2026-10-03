import Foundation
import RuimtePulsar

/// A variable of a launch while it is edited; a key being typed is not a key yet.
struct LaunchEnvRow: Equatable, Identifiable {
    var id: Int
    var key: String
    var value: String
}

/// A launch while the editor holds it. A new launch has a stand-in id until the save names it after the launch.
struct LaunchDraft: Equatable, Identifiable {
    var entry: JSONValue
    var env: [LaunchEnvRow]
    var fresh: Bool

    var id: String { entry.text("id") }
    var name: String {
        get { entry.text("name") }
        set { entry = entry.setting("name", .string(newValue)) }
    }
    var kind: String {
        get { entry.text("kind", fallback: "service") }
        set { entry = entry.setting("kind", .string(newValue)) }
    }
    var cwd: String {
        get { entry.text("cwd") }
        set { entry = entry.setting("cwd", .string(newValue)) }
    }
    var command: String {
        get { entry.text("command") }
        set { entry = entry.setting("command", .string(newValue)) }
    }
    var url: String {
        get { entry.text("url") }
        set { entry = entry.setting("url", .string(newValue)) }
    }
    var members: [String] {
        get { entry.list("launches").compactMap(\.stringValue) }
        set { entry = entry.setting("launches", .array(newValue.map(JSONValue.string))) }
    }
    var autostart: Bool {
        get { entry["autostart"]?.boolValue == true }
        set { entry = entry.setting("autostart", .bool(newValue)) }
    }
    var shared: Bool {
        get { entry["shared"]?.boolValue == true }
        set { entry = entry.setting("shared", .bool(newValue)) }
    }
    var hasOverlay: Bool { LaunchEntry(raw: entry).hasOverlay }
}

/// A launch the machine found in the project's own files, ready to import.
struct LaunchSuggestion: Equatable, Identifiable {
    var launch: JSONValue
    /// `run-xml`, `package-json` or `composer-json`.
    var source: String
    /// The file it came from, relative to the project folder.
    var path: String
    var detail: String
    /// A path in it points outside the project, so it stays on this machine.
    var isPrivate: Bool
    /// The type of run configuration the import cannot read; shown, but never imported.
    var unsupported: String?

    var id: String { launch.text("id") }

    init(json: JSONValue) {
        launch = json["launch"] ?? .object([:])
        source = json.text("source")
        path = json.text("path")
        detail = json.text("detail")
        isPrivate = json["private"]?.boolValue ?? false
        unsupported = json["unsupported"]?.stringValue
    }
}

enum LaunchDraftProblem: Equatable {
    case name, command, members

    var message: String {
        switch self {
        case .name: String(localized: "Give this launch a name.")
        case .command: String(localized: "A service or a task needs a command.")
        case .members: String(localized: "Check at least one launch for this group.")
        }
    }
}

/// The editor's rules, as the desktop dialog keeps them, so a launch saved from the phone reads the same.
enum LaunchEditing {
    /// The daemon's import writes ids the same way, so an imported launch and a typed one read alike.
    static func slug(_ name: String) -> String {
        var slug = ""
        var gap = false
        for scalar in name.lowercased().unicodeScalars {
            if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) {
                if gap && !slug.isEmpty { slug += "-" }
                gap = false
                slug.unicodeScalars.append(scalar)
            } else {
                gap = true
            }
        }
        return slug.isEmpty ? "launch" : slug
    }

    static func uniqueID(_ name: String, taken: Set<String>) -> String {
        let base = slug(name)
        guard taken.contains(base) else { return base }
        var index = 2
        while taken.contains("\(base)-\(index)") { index += 1 }
        return "\(base)-\(index)"
    }

    static func draft(of entry: LaunchEntry) -> LaunchDraft {
        let env = entry.env.sorted { $0.key < $1.key }.enumerated().map {
            LaunchEnvRow(id: $0.offset, key: $0.element.key, value: $0.element.value)
        }
        return LaunchDraft(entry: entry.raw, env: env, fresh: false)
    }

    static func newDraft(id: String, kind: String = "service") -> LaunchDraft {
        LaunchDraft(
            entry: .object(["id": .string(id), "name": .string(""), "kind": .string(kind), "shared": .bool(false)]),
            env: [], fresh: true)
    }

    static func emptyRow(after rows: [LaunchEnvRow]) -> LaunchEnvRow {
        LaunchEnvRow(id: (rows.map(\.id).max() ?? -1) + 1, key: "", value: "")
    }

    /// A launch with only the fields its kind reads, so a launch that was a group once keeps no command.
    private static func tidy(_ draft: LaunchDraft, id: String, rename: [String: String]) -> JSONValue {
        var object = draft.entry.objectValue ?? [:]
        let cwd = object["cwd"]?.stringValue ?? ""
        let command = object["command"]?.stringValue ?? ""
        let url = object["url"]?.stringValue ?? ""
        let members = object["launches"]?.arrayValue?.compactMap(\.stringValue) ?? []
        let autostart = object["autostart"]?.boolValue == true
        for key in ["cwd", "command", "url", "launches", "autostart", "env"] { object.removeValue(forKey: key) }
        object["id"] = .string(id)
        object["name"] = .string(draft.name.trimmingCharacters(in: .whitespacesAndNewlines))
        if autostart { object["autostart"] = .bool(true) }
        if draft.kind == "group" {
            object["launches"] = .array(members.map { .string(rename[$0] ?? $0) })
            return .object(object)
        }
        object["command"] = .string(command.trimmingCharacters(in: .whitespacesAndNewlines))
        var folder = cwd.trimmingCharacters(in: .whitespacesAndNewlines)
        while folder.hasSuffix("/") { folder.removeLast() }
        if !folder.isEmpty && folder != "." { object["cwd"] = .string(folder) }
        let address = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if draft.kind == "service" && !address.isEmpty { object["url"] = .string(address) }
        var env: [String: JSONValue] = [:]
        for row in draft.env {
            let key = row.key.trimmingCharacters(in: .whitespacesAndNewlines)
            if !key.isEmpty { env[key] = .string(row.value) }
        }
        if !env.isEmpty { object["env"] = .object(env) }
        return .object(object)
    }

    /// What a save sends: every launch tidied, and each new one named after itself.
    static func saved(_ drafts: [LaunchDraft]) -> [JSONValue] {
        var taken = Set(drafts.filter { !$0.fresh }.map(\.id))
        var rename: [String: String] = [:]
        for draft in drafts where draft.fresh {
            let id = uniqueID(draft.name, taken: taken)
            taken.insert(id)
            rename[draft.id] = id
        }
        return drafts.map { tidy($0, id: rename[$0.id] ?? $0.id, rename: rename) }
    }

    /// The first launch the editor cannot save; the daemon checks the rest.
    static func problem(_ drafts: [LaunchDraft]) -> (id: String, problem: LaunchDraftProblem)? {
        for draft in drafts {
            if draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return (draft.id, .name) }
            if draft.kind == "group" {
                if draft.members.isEmpty { return (draft.id, .members) }
            } else if draft.command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return (draft.id, .command)
            }
        }
        return nil
    }

    /// A launch that goes gets out of every group that started it.
    static func without(_ drafts: [LaunchDraft], id: String) -> [LaunchDraft] {
        drafts.filter { $0.id != id }.map { draft in
            guard draft.members.contains(id) else { return draft }
            var changed = draft
            changed.members = draft.members.filter { $0 != id }
            return changed
        }
    }

    /// The folders a launch picks from: the project folder itself (""), then each checkout inside it, by its path there.
    static func folderRoots(_ repos: [LaunchRepo]) -> [String] {
        [""] + repos.filter { $0.kind != "root" && !$0.label.hasPrefix("/") && !$0.label.hasPrefix("..") }.map(\.label)
    }

    /// A launch's folder as the checkout it is in and the path below that.
    static func splitFolder(_ cwd: String, roots: [String]) -> (root: String, sub: String) {
        var folder = cwd.trimmingCharacters(in: .whitespaces)
        if folder.hasPrefix("./") {
            folder.removeFirst(2)
        } else if folder == "." {
            folder = ""
        }
        let root = roots.filter { !$0.isEmpty && (folder == $0 || folder.hasPrefix($0 + "/")) }
            .max { $0.count < $1.count }
        guard let root else { return ("", folder) }
        var sub = String(folder.dropFirst(root.count))
        while sub.hasPrefix("/") { sub.removeFirst() }
        return (root, sub)
    }

    static func joinFolder(root: String, sub: String) -> String {
        var below = sub.trimmingCharacters(in: .whitespaces)
        while below.hasPrefix("./") { below.removeFirst(2) }
        if below.hasPrefix("/") || root.isEmpty { return below }
        return below.isEmpty ? root : "\(root)/\(below)"
    }

    private static func sameRun(_ launch: LaunchEntry, _ suggestion: LaunchSuggestion) -> Bool {
        let offered = LaunchEntry(raw: suggestion.launch)
        return !launch.isGroup && (launch.cwd ?? "") == (offered.cwd ?? "")
            && (launch.command ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                == (offered.command ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// What the project offers that is not a launch yet.
    static func newSuggestions(_ suggestions: [LaunchSuggestion], existing: [LaunchEntry]) -> [LaunchSuggestion] {
        suggestions.filter { suggestion in !existing.contains { sameRun($0, suggestion) } }
    }

    /// The launches an import adds. Sharing is the person's choice for the lot, except for one that names a path
    /// outside the project, which would not work on another machine.
    static func imported(_ suggestions: [LaunchSuggestion], share: Bool, existing: [LaunchEntry]) -> [JSONValue] {
        var taken = Set(existing.map(\.id))
        return suggestions.map { suggestion in
            let id = uniqueID(suggestion.launch.text("id"), taken: taken)
            taken.insert(id)
            return suggestion.launch.setting("id", .string(id)).setting("shared", .bool(share && !suggestion.isPrivate))
        }
    }

    private static func directory(_ path: String) -> String {
        guard let slash = path.lastIndex(of: "/") else { return "." }
        return String(path[..<slash])
    }

    /// Where a suggestion came from, as the import writes it beside the name.
    static func source(_ suggestion: LaunchSuggestion) -> String {
        if suggestion.source == "run-xml" { return suggestion.detail }
        let folder = directory(suggestion.path)
        let file = suggestion.path.split(separator: "/").last.map(String.init) ?? suggestion.path
        return folder == "." ? file : "\(folder) · \(file)"
    }

    /// The one place things were found, or how many: "2 folders".
    private static func place(_ places: Set<String>, many: (Int) -> String) -> String {
        places.count == 1 ? places.first ?? "" : many(places.count)
    }

    /// A row under "Found in this project" per file things were found in: "3 scripts in package.json".
    static func foundRows(_ suggestions: [LaunchSuggestion]) -> [(id: String, text: String)] {
        let usable = suggestions.filter { $0.unsupported == nil }
        var order: [String] = []
        var counts: [String: (runs: Bool, count: Int)] = [:]
        for suggestion in usable {
            let runs = suggestion.source == "run-xml"
            let place = runs ? directory(suggestion.path) : suggestion.path
            let key = (runs ? "run:" : "script:") + place
            if counts[key] == nil { order.append(key) }
            counts[key, default: (runs, 0)].count += 1
        }
        return order.compactMap { key in
            guard let entry = counts[key] else { return nil }
            let place = String(key.drop { $0 != ":" }.dropFirst())
            let text =
                entry.runs
                ? String(localized: "\(entry.count) run configurations in \(place)")
                : String(localized: "\(entry.count) scripts in \(place)")
            return (key, text)
        }
    }

    /// The line under "Found in this project": how many of each, and where; nil when there is nothing to import.
    static func foundText(_ suggestions: [LaunchSuggestion]) -> String? {
        let usable = suggestions.filter { $0.unsupported == nil }
        let runFiles = usable.filter { $0.source == "run-xml" }
        let scripts = usable.filter { $0.source != "run-xml" }
        var parts: [String] = []
        if !runFiles.isEmpty {
            let location = place(Set(runFiles.map { directory($0.path) })) { String(localized: "\($0) folders") }
            parts.append(String(localized: "\(runFiles.count) run configurations in \(location)"))
        }
        if !scripts.isEmpty {
            let location = place(Set(scripts.map(\.path))) { String(localized: "\($0) files") }
            parts.append(String(localized: "\(scripts.count) scripts in \(location)"))
        }
        guard let first = parts.first else { return nil }
        return parts.count == 1
            ? "\(first)."
            : String(localized: "\(first) and \(parts[1]).", comment: "Two counts of what was found, joined")
    }
}
