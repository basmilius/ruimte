import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// How the palette picks and orders what answers a query: every typed word has to appear, in any order, as on the
/// desktop. A name that starts with the query goes first, then one where every word starts a word of it.
enum PaletteRanking {
    static func words(_ query: String) -> [String] {
        query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    }

    static func matches(_ query: String, _ text: String) -> Bool {
        let haystack = text.lowercased()
        let words = words(query)
        return !words.isEmpty && words.allSatisfy { haystack.contains($0) }
    }

    /// Lower is better; nil when the text does not answer the query at all.
    static func score(_ query: String, _ text: String) -> Int? {
        guard matches(query, text) else { return nil }
        let haystack = text.lowercased()
        if haystack.hasPrefix(query.lowercased().trimmingCharacters(in: .whitespaces)) { return 0 }
        let starts = Set(wordStarts(haystack))
        return words(query).allSatisfy { word in starts.contains { $0.hasPrefix(word) } } ? 1 : 2
    }

    /// What answers the query, best first and otherwise in the order it came in. `extra` is matched but not ranked,
    /// such as the project a view is in.
    static func rank<Item>(
        _ items: [Item], query: String, text: (Item) -> String, extra: (Item) -> String = { _ in "" }
    )
        -> [Item]
    {
        items.enumerated().compactMap { index, item -> (Int, Int, Item)? in
            if let score = score(query, text(item)) { return (score, index, item) }
            return matches(query, "\(text(item)) \(extra(item))") ? (3, index, item) : nil
        }
        .sorted { ($0.0, $0.1) < ($1.0, $1.1) }
        .map(\.2)
    }

    /// The ranges of a name the query's words cover, for the palette to mark.
    static func highlights(_ query: String, in text: String) -> [Range<String.Index>] {
        words(query).compactMap { text.range(of: $0, options: .caseInsensitive) }
    }

    private static func wordStarts(_ text: String) -> [Substring] {
        var starts: [Substring] = []
        var previous: Character?
        for index in text.indices {
            let character = text[index]
            if character.isLetter || character.isNumber, previous.map({ !$0.isLetter && !$0.isNumber }) ?? true {
                starts.append(text[index...])
            }
            previous = character
        }
        return starts
    }
}

/// A command of the desktop's palette that means something on a phone, over every project and machine.
struct PaletteCommand: Identifiable, Equatable {
    enum ProjectAction: Hashable {
        case newView, newTerminal, files, git, launches, settings
    }

    enum Action: Hashable {
        case newChat(machineID: String)
        case project(UnifiedProjectRow.ID, ProjectAction)
        case usage(machineID: String)
        /// The machine's page, which is where a folder is opened as a project.
        case openFolder(machineID: String)
        case recentlyClosed, addMachine, settings
        case appearance(String)
    }

    let title: String
    let icon: String
    let action: Action
    var id: Action { action }
}

enum PaletteCommands {
    /// What the palette offers before anything is typed.
    static func featured(_ commands: [PaletteCommand]) -> [PaletteCommand] {
        commands.filter {
            switch $0.action {
            case .newChat, .recentlyClosed, .addMachine, .settings: true
            default: false
            }
        }
    }

    /// Every command: per machine, per open project, and the app's own. A machine is named only once there are
    /// several.
    static func all(projects: [UnifiedProjectRow], machines: [Machine], appearance: String) -> [PaletteCommand] {
        let several = machines.count > 1
        var commands: [PaletteCommand] = []
        for machine in machines {
            commands.append(
                PaletteCommand(
                    title: several ? String(localized: "New chat on \(machine.name)") : String(localized: "New chat"),
                    icon: "message-square-plus",
                    action: .newChat(machineID: machine.id)))
        }
        for row in projects where !NewChat.isChats(row.summary) && row.summary["available"] != .bool(false) {
            let name = row.summary.text("name", fallback: String(localized: "Untitled project"))
            let entries: [(String, String, PaletteCommand.ProjectAction)] = [
                (String(localized: "New view in \(name)…"), "plus", .newView),
                (String(localized: "New terminal in \(name)"), "terminal", .newTerminal),
                (String(localized: "Files of \(name)"), "folder", .files),
                (String(localized: "Git of \(name)"), "git-branch", .git),
                (String(localized: "Launches of \(name)"), "play", .launches),
                (String(localized: "Settings of \(name)"), "settings-2", .settings),
            ]
            commands += entries.map { PaletteCommand(title: $0.0, icon: $0.1, action: .project(row.id, $0.2)) }
        }
        for machine in machines {
            commands.append(
                PaletteCommand(
                    title: several
                        ? String(localized: "Open a folder on \(machine.name)…")
                        : String(localized: "Open a folder as a project…"),
                    icon: "folder-open", action: .openFolder(machineID: machine.id)))
            commands.append(
                PaletteCommand(
                    title: several ? String(localized: "Usage of \(machine.name)") : String(localized: "Usage"),
                    icon: "chart-no-axes-column",
                    action: .usage(machineID: machine.id)))
        }
        commands.append(
            PaletteCommand(
                title: String(localized: "Recently closed"), icon: "clock-arrow-left", action: .recentlyClosed))
        commands.append(PaletteCommand(title: String(localized: "Add a machine"), icon: "plus", action: .addMachine))
        commands.append(PaletteCommand(title: String(localized: "Settings"), icon: "settings", action: .settings))
        let looks = [
            ("light", String(localized: "Use the light appearance"), "sun"),
            ("dark", String(localized: "Use the dark appearance"), "moon"),
            ("system", String(localized: "Follow the system appearance"), "sun-moon"),
        ]
        for (value, title, icon) in looks where value != appearance {
            commands.append(PaletteCommand(title: title, icon: icon, action: .appearance(value)))
        }
        return commands
    }
}

/// A file Search found in an open project.
struct PaletteFile: Identifiable, Equatable {
    let project: UnifiedProjectRow.ID
    let projectName: String
    /// Relative to the project folder.
    let path: String
    let folder: String
    var id: String { "\(project.machineID):\(project.projectID):\(path)" }
    var name: String { (path as NSString).lastPathComponent }
    /// Where the file sits, from the project folder's own name down.
    var place: String {
        let directory = (path as NSString).deletingLastPathComponent
        let root = (folder as NSString).lastPathComponent
        return directory.isEmpty ? root : "\(root)/\(directory)"
    }
    var absolutePath: String { folder.hasSuffix("/") ? folder + path : folder + "/" + path }
}

struct PaletteFileFailure: Identifiable {
    let project: UnifiedProjectRow.ID
    let name: String
    let message: String
    var id: String { "\(project.machineID):\(project.projectID)" }
}

@MainActor @Observable
final class PaletteFiles {
    static let perProject = 5
    static let shortest = 2
    private(set) var query = ""
    private(set) var results: [PaletteFile] = []
    private(set) var failures: [PaletteFileFailure] = []
    private(set) var searching = false
    @ObservationIgnored private var generation = 0

    // Retire requests before the debounce, so a previous query cannot arrive during the wait.
    func invalidate(_ query: String) {
        generation += 1
        self.query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        results = []
        failures = []
        searching = self.query.count >= Self.shortest
    }

    func search(_ query: String, projects: [UnifiedProjectRow], client: (Machine) -> any MachineRequesting) async {
        invalidate(query)
        let current = generation
        let typed = self.query
        guard typed.count >= Self.shortest else { return }
        let asked = projects.filter {
            $0.connected && !NewChat.isChats($0.summary) && $0.summary["available"] != .bool(false)
        }
        let tasks = asked.map { row in
            let machineClient = client(row.machine)
            let folder = row.summary.text("folder")
            let name = row.summary.text("name", fallback: String(localized: "Untitled project"))
            return Task { () -> ([PaletteFile], PaletteFileFailure?) in
                do {
                    let answer = try await machineClient.request(
                        "fs.search",
                        payload: .object([
                            "cwd": .string(folder), "query": .string(typed),
                            "limit": .number(Double(Self.perProject)),
                        ]))
                    return (
                        answer.list("files").compactMap(\.stringValue).map {
                            PaletteFile(project: row.id, projectName: name, path: $0, folder: folder)
                        }, nil
                    )
                } catch {
                    return ([], PaletteFileFailure(project: row.id, name: name, message: error.localizedDescription))
                }
            }
        }
        var found: [PaletteFile] = []
        var failed: [PaletteFileFailure] = []
        for task in tasks {
            let (files, failure) = await task.value
            found += files
            if let failure { failed.append(failure) }
        }
        guard current == generation && !Task.isCancelled else { return }
        results = found
        failures = failed
        searching = false
    }
}
