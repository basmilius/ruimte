import Foundation
import RuimtePulsar
import RuimteTransport

/// A design wherever it stands, a view of its own or a node on a canvas, after `DesignPlace` in the contracts: its
/// chats work on the HTML pages of one folder.
struct DesignPlace: Equatable {
    struct Chat: Equatable, Identifiable {
        let id: String
        let name: String
        /// The session's options, as `ensureSession` reads them.
        let node: JSONValue
    }

    let id: String
    let name: String
    /// A bare folder name under `designs/`, or a folder of the project when it holds a slash.
    let path: String
    /// The first chat under the design's own id, then the later ones, oldest first.
    let chats: [Chat]
    /// The canvas a node stands on; nil for a view.
    let canvasID: String?

    /// Nil for anything that is not a design, or one whose `path` names no folder of its own.
    init?(_ item: JSONValue, canvasID: String? = nil) {
        guard item.text("kind") == "design", Self.isDesignPath(item.text("path")) else { return nil }
        id = item.stableID
        path = item.text("path")
        self.canvasID = canvasID
        let isView = canvasID == nil
        name = item.text(isView ? "name" : "title", fallback: String(localized: "Design"))
        let own = Chat(id: id, name: name, node: isView ? item["node"] ?? .object([:]) : item)
        let later = item.list("chats").compactMap { raw -> Chat? in
            let id = raw.text("id")
            let name = raw.text("name")
            guard !id.isEmpty, !name.isEmpty, let node = raw["node"], node.objectValue != nil else { return nil }
            return Chat(id: id, name: name, node: node)
        }
        chats = [own] + later
    }

    /// Every design of the project: its views and the nodes on its canvases.
    static func all(in views: [JSONValue]) -> [DesignPlace] {
        views.flatMap { view -> [DesignPlace] in
            if view.text("kind") == "canvas" {
                return view.list("nodes").compactMap { DesignPlace($0, canvasID: view.stableID) }
            }
            return DesignPlace(view).map { [$0] } ?? []
        }
    }

    /// Whether a design's `path` names a folder of its own: a bare name that is not hidden, or a relative path
    /// without empty, `.` or `..` parts, with nothing that could break out of the chat's prompt.
    static func isDesignPath(_ path: String) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.hasPrefix("~") else { return false }
        if path.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f || $0 == "`" || $0 == "\\" }) {
            return false
        }
        if !path.contains("/") {
            return !path.hasPrefix(".")
        }
        return path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
            !$0.isEmpty && $0 != "." && $0 != ".."
        }
    }

    /// The folder relative to the project folder: one person's under `.ruimte/private/designs/` until the design is
    /// shared, and the team's under `.ruimte/designs/` from then on.
    func location(shared: [String]) -> String {
        if path.contains("/") {
            return path
        }
        return ".ruimte/\(shared.contains(canvasID ?? id) ? "" : "private/")designs/\(path)"
    }

    /// The chat a person picked while it is still there, else the newest, so a chat just started comes into view.
    func activeChat(picked: String?) -> Chat {
        chats.first { $0.id == picked } ?? chats[chats.count - 1]
    }

    /// The item `ensureSession` starts a chat of the design from.
    static func sessionItem(_ chat: Chat) -> JSONValue {
        .object(["id": .string(chat.id), "kind": .string("chat"), "node": chat.node])
    }
}

/// Making a design and reading its pages, after `apps/client/src/design`.
enum DesignFiles {
    /// The two places design folders live, relative to the project folder.
    static let folders = [".ruimte/private/designs", ".ruimte/designs"]
    static let pageMaxBytes = 16 * 1024 * 1024
    static let assetMaxBytes = 10 * 1024 * 1024

    /// The pages of a design, the HTML files right in its folder, the most recently changed first; a tie keeps the
    /// order of their names.
    static func pages(_ entries: [JSONValue]) -> [JSONValue] {
        entries
            .filter { $0.text("kind") == "file" && $0.text("name").range(of: #"\.html?$"#, options: [.regularExpression, .caseInsensitive]) != nil }
            .sorted { one, other in
                let first = one.number("mtime")
                let second = other.number("mtime")
                return first == second
                    ? one.text("name").localizedStandardCompare(other.text("name")) == .orderedAscending : first > second
            }
    }

    /// A page as a person names it: its file without the extension.
    static func pageName(_ file: String) -> String {
        file.replacingOccurrences(of: #"\.html?$"#, with: "", options: [.regularExpression, .caseInsensitive])
    }

    /// Whether a change the machine reports touches the folder. A parent counts only while the folder is not there
    /// yet, since that is how the chat making it shows.
    static func changeReaches(_ changed: String, folder: String, found: Bool) -> Bool {
        changed == folder || changed.hasPrefix(folder + "/") || (!found && folder.hasPrefix(changed + "/"))
    }

    /// A folder name a person reads back in a path: the name in lowercase words joined by dashes.
    static func slug(_ name: String) -> String {
        let plain = name.folding(options: [.diacriticInsensitive, .widthInsensitive], locale: nil).lowercased()
        let slug = plain.replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return slug.isEmpty ? "design" : slug
    }

    /// A folder no other design of the project has and none left on disk, so a new design never opens on another's
    /// files.
    static func freeFolder(_ views: [JSONValue], name: String, onDisk: [String]) -> String {
        let taken = Set(DesignPlace.all(in: views).map(\.path) + onDisk)
        let base = slug(name)
        guard taken.contains(base) else { return base }
        var number = 2
        while taken.contains("\(base)-\(number)") { number += 1 }
        return "\(base)-\(number)"
    }

    /// "Design", then "Design 2", over every design of the project.
    static func freeName(_ views: [JSONValue]) -> String {
        let taken = Set(DesignPlace.all(in: views).map(\.name))
        var name = "Design"
        var number = 2
        while taken.contains(name) {
            name = "Design \(number)"
            number += 1
        }
        return name
    }

    /// A new design view, its chat on `agent`, keeping its pages in `path`.
    static func view(agent: String, name: String, path: String) -> JSONValue {
        .object([
            "id": .string("design-" + UUID().uuidString), "kind": .string("design"), "name": .string(name),
            "node": .object(["provider": .string(agent), "providerFixed": .bool(true)]), "path": .string(path),
        ])
    }

    /// A further chat of a design, named after its CLI and its place among the design's chats.
    static func chat(agent: (kind: String, name: String), count: Int) -> JSONValue {
        .object([
            "id": .string("chat-" + UUID().uuidString), "name": .string("\(agent.name) \(count + 1)"),
            "node": .object(["provider": .string(agent.kind), "providerFixed": .bool(true)]),
        ])
    }

    /// The design with `chat` added after its later chats, wherever it stands.
    static func adding(_ chat: JSONValue, to design: DesignPlace, in document: JSONValue) -> JSONValue {
        let views = document.list("views").map { view -> JSONValue in
            if design.canvasID == nil {
                return view.stableID == design.id ? view.setting("chats", .array(view.list("chats") + [chat])) : view
            }
            guard view.stableID == design.canvasID else { return view }
            let nodes = view.list("nodes").map { node in
                node.stableID == design.id ? node.setting("chats", .array(node.list("chats") + [chat])) : node
            }
            return view.setting("nodes", .array(nodes))
        }
        return document.setting("views", .array(views))
    }

    // A reference with a scheme, `//`, `/` or `#` loads as it is; only a path into the folder rides along.
    private static let loadsAsItIs = try! NSRegularExpression(pattern: #"^(?:[a-z][a-z0-9+.-]*:|//|/|#)"#, options: .caseInsensitive)
    private static let attributeReference = try! NSRegularExpression(
        pattern: #"\b(src|href|poster)\s*=\s*(["'])([^"']*)\2"#, options: .caseInsensitive)
    private static let cssReference = try! NSRegularExpression(pattern: #"url\(\s*(["']?)([^"')]+)\1\s*\)"#, options: .caseInsensitive)

    /// The file a relative reference names inside the design folder, or nil when it leaves the folder or loads on
    /// its own.
    static func assetPath(_ reference: String) -> String? {
        let path = String(reference.split(whereSeparator: { $0 == "?" || $0 == "#" }).first ?? "")
        let range = NSRange(reference.startIndex..., in: reference)
        guard !path.isEmpty, reference.first != "?", loadsAsItIs.firstMatch(in: reference, range: range) == nil
        else { return nil }
        var parts: [Substring] = []
        for part in (path.removingPercentEncoding ?? path).split(separator: "/", omittingEmptySubsequences: false) {
            if part.isEmpty || part == "." {
                continue
            }
            if part == ".." {
                guard !parts.isEmpty else { return nil }
                parts.removeLast()
                continue
            }
            parts.append(part)
        }
        return parts.isEmpty ? nil : parts.joined(separator: "/")
    }

    /// Every file of the folder a page pulls in through an attribute or a CSS `url()`, once each, leaving out other
    /// pages: a page that links to another keeps its path.
    static func assetReferences(_ html: String) -> [String] {
        let range = NSRange(html.startIndex..., in: html)
        var found: [String] = []
        let references =
            attributeReference.matches(in: html, range: range).compactMap { Range($0.range(at: 3), in: html) }
            + cssReference.matches(in: html, range: range).compactMap { Range($0.range(at: 2), in: html) }
        for match in references {
            let reference = String(html[match])
            guard let path = assetPath(reference), !isPage(path), !found.contains(reference) else { continue }
            found.append(reference)
        }
        return found
    }

    static func isPage(_ path: String) -> Bool {
        path.range(of: #"\.html?$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// The page with each reference replaced by the bytes it names; one without bytes stays as it was.
    static func withAssets(_ html: String, inline: [String: String]) -> String {
        var page = replacing(attributeReference, in: html) { match, text in
            guard let reference = Range(match.range(at: 3), in: text).map({ String(text[$0]) }),
                let url = inline[reference],
                let name = Range(match.range(at: 1), in: text).map({ text[$0] }),
                let quote = Range(match.range(at: 2), in: text).map({ text[$0] })
            else { return nil }
            return "\(name)=\(quote)\(url)\(quote)"
        }
        page = replacing(cssReference, in: page) { match, text in
            guard let reference = Range(match.range(at: 2), in: text).map({ String(text[$0]) }),
                let url = inline[reference],
                let quote = Range(match.range(at: 1), in: text).map({ text[$0] })
            else { return nil }
            return "url(\(quote)\(url)\(quote))"
        }
        return page
    }

    private static func replacing(
        _ pattern: NSRegularExpression, in text: String, with replacement: (NSTextCheckingResult, String) -> String?
    ) -> String {
        var result = ""
        var last = text.startIndex
        for match in pattern.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let whole = Range(match.range, in: text) else { continue }
            result += text[last..<whole.lowerBound]
            result += replacement(match, text) ?? String(text[whole])
            last = whole.upperBound
        }
        return result + text[last...]
    }

    /// One page standing on its own, every file it pulls in riding along as a data URL up to the bounds of a visual.
    /// A file that cannot be read stays a reference that loads nothing, as a broken path does in a browser.
    @MainActor static func standalonePage(
        _ file: String, folder: String, read: (String, Int) async throws -> MachineResource
    ) async throws -> Data {
        let page = try await read("\(folder)/\(file)", pageMaxBytes)
        let html = String(decoding: page.data, as: UTF8.self)
        var total = page.data.count
        var inline: [String: String] = [:]
        for reference in assetReferences(html) {
            guard let path = assetPath(reference),
                let asset = try? await read("\(folder)/\(path)", assetMaxBytes)
            else { continue }
            if total + asset.data.count > pageMaxBytes {
                break
            }
            total += asset.data.count
            inline[reference] = "data:\(asset.mime);base64,\(asset.data.base64EncodedString())"
        }
        return Data(withAssets(html, inline: inline).utf8)
    }
}
