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
    var id: String
    var name: String
    var kind: LaunchConfigKind
    var cwd = ""
    var command = ""
    var url = ""
    var members: [String] = []
    var autostart = false
    var shared = false
    var env: [LaunchEnvRow] = []
    var fresh: Bool
    /// Where an import read it from.
    var origin: LaunchOrigin?
    var hasOverlay = false
    /// What the machine sent besides the fields above, which a save returns as it came: the overlay of this machine
    /// and any field a newer release writes.
    var rest: [String: JSONValue] = [:]
}

extension LaunchSuggestion: Identifiable {
    public var id: String { launch.id }

    /// A path in it points outside the project, so it stays on this machine.
    var isPrivate: Bool { `private` }
}

enum LaunchDraftProblem: Equatable {
    case name, command, members

    var message: String {
        switch self {
        case .name: String(localized: "Give it a name.")
        case .command: String(localized: "Needs a command.")
        case .members: String(localized: "Check at least one launch.")
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
        var rest = entry.raw.objectValue ?? [:]
        for key in editedKeys { rest.removeValue(forKey: key) }
        return LaunchDraft(
            id: entry.id, name: entry.name, kind: entry.kind, cwd: entry.cwd ?? "", command: entry.command ?? "",
            url: entry.url ?? "", members: entry.members, autostart: entry.autostart, shared: entry.shared, env: env,
            fresh: false, origin: entry.config.origin, hasOverlay: entry.hasOverlay, rest: rest)
    }

    /// The fields of a launch the editor holds apart; `tidy` writes them back.
    private static let editedKeys = ["id", "name", "kind", "cwd", "command", "url", "env", "launches", "autostart", "shared"]

    static func newDraft(id: String, kind: LaunchConfigKind = .service) -> LaunchDraft {
        LaunchDraft(id: id, name: "", kind: kind, fresh: true)
    }

    static func emptyRow(after rows: [LaunchEnvRow]) -> LaunchEnvRow {
        LaunchEnvRow(id: (rows.map(\.id).max() ?? -1) + 1, key: "", value: "")
    }

    /// A launch with only the fields its kind reads, so a launch that was a group once keeps no command.
    private static func tidy(_ draft: LaunchDraft, id: String, rename: [String: String]) -> JSONValue {
        var object = draft.rest
        object["id"] = .string(id)
        object["name"] = .string(draft.name.trimmingCharacters(in: .whitespacesAndNewlines))
        object["kind"] = .string(draft.kind.rawValue)
        object["shared"] = .bool(draft.shared)
        if draft.autostart { object["autostart"] = .bool(true) }
        if draft.kind == .group {
            object["launches"] = .array(draft.members.map { .string(rename[$0] ?? $0) })
            return .object(object)
        }
        object["command"] = .string(draft.command.trimmingCharacters(in: .whitespacesAndNewlines))
        var folder = draft.cwd.trimmingCharacters(in: .whitespacesAndNewlines)
        while folder.hasSuffix("/") { folder.removeLast() }
        if !folder.isEmpty && folder != "." { object["cwd"] = .string(folder) }
        let address = draft.url.trimmingCharacters(in: .whitespacesAndNewlines)
        if draft.kind == .service && !address.isEmpty { object["url"] = .string(address) }
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
            if draft.kind == .group {
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
    static func folderRoots(_ repos: [GitRepo]) -> [String] {
        [""] + repos.filter { $0.kind != .root && !$0.label.hasPrefix("/") && !$0.label.hasPrefix("..") }.map(\.label)
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
        let offered = suggestion.launch
        return !launch.isGroup && (launch.cwd ?? "") == (offered.cwd ?? "")
            && (launch.command ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                == (offered.command ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The file and name an imported launch came from, as the desktop records it.
    private static func origin(_ suggestion: LaunchSuggestion) -> LaunchOrigin {
        LaunchOrigin(source: suggestion.source.rawValue, path: suggestion.path, name: suggestion.launch.name)
    }

    private static func hasOrigin(_ launch: LaunchEntry, _ suggestion: LaunchSuggestion) -> Bool {
        launch.config.origin == origin(suggestion)
    }

    /// What the project offers that is not a launch yet.
    static func newSuggestions(_ suggestions: [LaunchSuggestion], existing: [LaunchEntry]) -> [LaunchSuggestion] {
        suggestions.filter { suggestion in !existing.contains { sameRun($0, suggestion) || hasOrigin($0, suggestion) } }
    }

    /// The launches of a save that an import added: each stays unapproved until a person runs it and says yes.
    static func importedIDs(_ drafts: [LaunchDraft], existing: [LaunchEntry]) -> [String] {
        let known = Set(existing.map(\.id))
        return drafts.filter { $0.origin != nil && !known.contains($0.id) }.map(\.id)
    }

    /// A configuration an IDE keeps, as against the script of a package manifest.
    private static func readsAsRunConfiguration(_ suggestion: LaunchSuggestion) -> Bool {
        suggestion.source == .runXml || suggestion.source == .vscodeLaunch
    }

    /// A launch an import adds, as a save sends it.
    struct ImportedLaunch: Equatable {
        let id: String
        let entry: JSONValue
    }

    /// The launches an import adds. Sharing is the person's choice for the lot, except for one that names a path
    /// outside the project, which would not work on another machine.
    static func imported(_ suggestions: [LaunchSuggestion], share: Bool, existing: [LaunchEntry]) throws
        -> [ImportedLaunch]
    {
        var taken = Set(existing.map(\.id))
        return try suggestions.map { suggestion in
            let offered = suggestion.launch
            let id = uniqueID(offered.id, taken: taken)
            taken.insert(id)
            let entry = LaunchConfigEntry(
                id: id, name: offered.name, kind: offered.kind, cwd: offered.cwd, command: offered.command,
                url: offered.url, env: offered.env, launches: offered.launches, autostart: offered.autostart,
                origin: origin(suggestion), shared: share && !suggestion.isPrivate)
            return ImportedLaunch(id: id, entry: try JSONValue(encoding: entry))
        }
    }

    private static func directory(_ path: String) -> String {
        guard let slash = path.lastIndex(of: "/") else { return "." }
        return String(path[..<slash])
    }

    /// Where a suggestion came from, as the import writes it beside the name.
    static func source(_ suggestion: LaunchSuggestion) -> String {
        if readsAsRunConfiguration(suggestion) { return suggestion.detail }
        let folder = directory(suggestion.path)
        let file = suggestion.path.split(separator: "/").last.map(String.init) ?? suggestion.path
        return folder == "." ? file : "\(folder) · \(file)"
    }

    /// The one place things were found, or how many: "2 folders".
    private static func place(_ places: Set<String>, many: (Int) -> String) -> String {
        places.count == 1 ? places.first ?? "" : many(places.count)
    }

    /// A row under "Found in project" per file things were found in: "3 scripts in package.json".
    static func foundRows(_ suggestions: [LaunchSuggestion]) -> [(id: String, text: String)] {
        let usable = suggestions.filter { $0.unsupported == nil }
        var order: [String] = []
        var counts: [String: (runs: Bool, count: Int)] = [:]
        for suggestion in usable {
            let runs = readsAsRunConfiguration(suggestion)
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

    /// The line under "Found in project": how many of each, and where; nil when there is nothing to import.
    static func foundText(_ suggestions: [LaunchSuggestion]) -> String? {
        let usable = suggestions.filter { $0.unsupported == nil }
        let runFiles = usable.filter(readsAsRunConfiguration)
        let scripts = usable.filter { !readsAsRunConfiguration($0) }
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
