import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// The folder of each agent a task's row asked about, after `design-agent.ts` on the desktop. A hidden design agent
/// answers `design.agent` with the folder it works in; any other agent with none.
@MainActor @Observable
final class DesignAgentFolders {
    /// By the agent's node id: its folder, absolute, or nil for an agent that makes no design. An agent's folder
    /// never changes, so an answer is kept for good.
    private(set) var folders: [String: String?] = [:]
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private var asking: Set<String> = []

    init(client: any MachineRequesting) {
        self.client = client
    }

    /// The folder of a hidden design agent; nil for any other agent, on a machine from before design agents, and
    /// while the machine has not answered.
    func folder(_ agentID: String) -> String? {
        folders[agentID] ?? nil
    }

    /// Asks once per agent. A failed ask is asked again the next time the row shows, which stays a plain row
    /// meanwhile.
    func ask(project: String, agent: String) async {
        guard folders[agent] == nil, !asking.contains(agent), !project.isEmpty,
            (client as? MachineFeatures)?.answers(.designAgent) == true
        else { return }
        asking.insert(agent)
        defer { asking.remove(agent) }
        guard
            let answer = try? await client.request(
                .designAgent, payload: .object(["projectId": .string(project), "agentId": .string(agent)]))
        else { return }
        folders[agent] = .some(answer["folder"]?.stringValue)
    }
}

/// Which page of a design agent's folder shows, after `design-page.ts` on the desktop.
enum DesignAgentPages {
    /// The page a design agent's card shows: the one a person picked while it is there, else, once the task is done,
    /// the page its result names first, which the agent is asked to name as the one to look at first; else the newest.
    static func cardPage(_ newestFirst: [String], picked: String?, result: String?) -> String? {
        if let picked, newestFirst.contains(picked) {
            return picked
        }
        return result.flatMap { firstNamedPage($0, pages: newestFirst) } ?? newestFirst.first
    }

    /// The page of `pages` that a text names first, by its file name as it stands in a path or on its own, also
    /// percent-encoded as in a link. A name inside a longer one (`Pricing.html` in `Old Pricing.html`) is the longer one.
    static func firstNamedPage(_ text: String, pages: [String]) -> String? {
        let source = text as NSString
        var found: [(page: String, start: Int, end: Int)] = []
        for page in pages {
            for spelled in Set([page, encodedURI(page)]) where !spelled.isEmpty {
                var from = 0
                while from < source.length {
                    let at = source.range(
                        of: spelled, options: .literal, range: NSRange(location: from, length: source.length - from))
                    guard at.location != NSNotFound else { break }
                    let end = NSMaxRange(at)
                    if !continuesName(source, at: at.location - 1), !continuesName(source, at: end) {
                        found.append((page, at.location, end))
                    }
                    from = at.location + 1
                }
            }
        }
        let named = found.filter { match in !found.contains { $0.end == match.end && $0.start < match.start } }
        return named.sorted { $0.start < $1.start }.first?.page
    }

    /// The pages by name, as the picker lists them.
    static func byName(_ pages: [String]) -> [String] {
        pages.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    // What `encodeURI` leaves as it is.
    private static let uriKept = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789;,/?:@&=+$-_.!~*'()#")

    private static func encodedURI(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: uriKept) ?? text
    }

    /// Whether the UTF-16 unit at `index` goes on a name, as `[\w-]` reads it; outside the text nothing does.
    private static func continuesName(_ source: NSString, at index: Int) -> Bool {
        guard index >= 0, index < source.length else { return false }
        let unit = source.character(at: index)
        return (48...57).contains(unit) || (65...90).contains(unit) || (97...122).contains(unit) || unit == 95
            || unit == 45
    }
}

/// The page an opened design shows: it follows the newest page until a person picks one, and starts on the page the
/// card showed.
struct DesignFollow: Equatable {
    private(set) var shown: String?
    private(set) var picked: Bool
    /// The newest page and when it was written, as last seen; a change means the agent wrote a page.
    private var newest: String?

    init(shown: String?, picked: Bool) {
        self.shown = shown
        self.picked = picked
    }

    mutating func pick(_ page: String) {
        shown = page
        picked = true
    }

    /// Takes the pages as they stand now, the most recently changed first.
    mutating func update(_ newestFirst: [FsEntry]) {
        let names = newestFirst.map(\.name)
        let latest = newestFirst.first.map { "\($0.name)\u{0}\($0.mtime)" }
        defer { newest = latest }
        if picked, let shown, names.contains(shown) {
            return
        }
        picked = false
        let written = newest != nil && latest != newest
        if shown == nil || !names.contains(shown ?? "") || written {
            shown = names.first
        }
    }
}
