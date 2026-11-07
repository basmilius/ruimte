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

    /// What the pages list shows. Only a missing folder is a design without pages; any other failed read keeps what
    /// the list had and says so, so a dropped connection never reads as an empty design.
    struct Listing: Equatable {
        var pages: [JSONValue]?
        var found = false
        var problem: String?

        /// The listing after a read of the design folder: the entries it listed, or the error that stopped it.
        func after(_ outcome: Result<[JSONValue], Error>) -> Listing {
            switch outcome {
            case .success(let entries):
                return Listing(pages: DesignFiles.pages(entries), found: true, problem: nil)
            case .failure(MachineClientError.server(let code, _)) where code == "not-found":
                return Listing(pages: [], found: false, problem: nil)
            case .failure(let error):
                return Listing(pages: pages, found: found, problem: error.localizedDescription)
            }
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
    private static let pageMention = try! NSRegularExpression(
        pattern: #"[A-Za-z0-9_%./-]+\.html?(?![A-Za-z0-9_-]|\.[A-Za-z0-9_])"#, options: .caseInsensitive)
    private static let pageURLPrefix = "data:text/html;charset=utf-8,"

    /// The file a relative reference of a page names, relative to the design folder, or nil when it leaves the folder
    /// or loads on its own. `from` is the folder of the page that makes the reference, inside the design folder.
    static func assetPath(_ reference: String, from: String = "") -> String? {
        let cut = reference.firstIndex { $0 == "?" || $0 == "#" } ?? reference.endIndex
        let path = String(reference[..<cut])
        let range = NSRange(reference.startIndex..., in: reference)
        guard !path.isEmpty, loadsAsItIs.firstMatch(in: reference, range: range) == nil else { return nil }
        var parts = from.split(separator: "/").map(String.init)
        for part in (path.removingPercentEncoding ?? path).split(separator: "/", omittingEmptySubsequences: false) {
            if part.isEmpty || part == "." {
                continue
            }
            if part == ".." {
                guard !parts.isEmpty else { return nil }
                parts.removeLast()
                continue
            }
            parts.append(String(part))
        }
        return parts.isEmpty ? nil : parts.joined(separator: "/")
    }

    /// Every file of the folder a page in `from` pulls in through an attribute or a CSS `url()`, once each, other
    /// pages included: a page it frames rides along as a page.
    static func assetReferences(_ html: String, from: String = "") -> [String] {
        let range = NSRange(html.startIndex..., in: html)
        var found: [String] = []
        let references =
            attributeReference.matches(in: html, range: range).compactMap { Range($0.range(at: 3), in: html) }
            + cssReference.matches(in: html, range: range).compactMap { Range($0.range(at: 2), in: html) }
        for match in references {
            let reference = String(html[match])
            guard assetPath(reference, from: from) != nil, !found.contains(reference) else { continue }
            found.append(reference)
        }
        return found
    }

    /// Whether a file of the folder is a page, which a page frames as a page of its own rather than as bytes.
    static func isPage(_ path: String) -> Bool {
        path.range(of: #"\.html?$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// Every page a page names anywhere, in an attribute or inside its own script, once each: a script that builds
    /// `page.html?theme=dark` to frame it names the page only as text.
    static func pageMentions(_ html: String) -> [String] {
        var found: [String] = []
        for match in pageMention.matches(in: html, range: NSRange(html.startIndex..., in: html)) {
            guard let range = Range(match.range, in: html) else { continue }
            let mention = String(html[range])
            if !found.contains(mention) {
                found.append(mention)
            }
        }
        return found
    }

    /// A page standing on its own as an address a frame loads. Percent-encoded rather than base64, so a query after it
    /// reaches the page's `location.search`, and closed by an open comment, since the browser reads that query as the
    /// end of the page too. Only what the address would otherwise cut, drop or end is escaped.
    static func pageDataURL(_ html: String) -> String {
        let escaped = (html + "<!--").unicodeScalars.map { scalar -> String in
            guard "%#?\t\n\r \"'&<>()\\".unicodeScalars.contains(scalar) else { return String(scalar) }
            return "%" + String(format: "%02X", scalar.value)
        }
        return pageURLPrefix + escaped.joined()
    }

    /// The page with each reference it pulled in replaced by the bytes it names; one without bytes stays as it was. A
    /// link to another page keeps its path: no browser opens an inline page from a link, so the copy would only weigh.
    static func withAssets(_ html: String, inline: [String: String]) -> String {
        var page = replacing(attributeReference, in: html) { match, text in
            guard let reference = Range(match.range(at: 3), in: text).map({ String(text[$0]) }),
                let url = inline[reference],
                let name = Range(match.range(at: 1), in: text).map({ text[$0] }),
                let quote = Range(match.range(at: 2), in: text).map({ text[$0] })
            else { return nil }
            if name.lowercased() == "href", url.hasPrefix(pageURLPrefix) {
                return nil
            }
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

    /// A string as `JSON.stringify` writes it, with nothing in it that ends a `<script>` or opens a comment in it.
    private static func inlineJSON(_ value: String) -> String {
        var json = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": json += "\\\""
            case "\\": json += "\\\\"
            case "\n": json += "\\n"
            case "\r": json += "\\r"
            case "\t": json += "\\t"
            case "\u{08}": json += "\\b"
            case "\u{0C}": json += "\\f"
            case "<": json += "\\u003c"
            case _ where scalar.value < 0x20: json += String(format: "\\u%04x", scalar.value)
            default: json.unicodeScalars.append(scalar)
            }
        }
        return json + "\""
    }

    /// The page with `element` first in its head, before any script of its own runs.
    private static func atHeadStart(_ html: String, _ element: String) -> String {
        let range = NSRange(html.startIndex..., in: html)
        let opening = [#"<head(?:\s[^>]*)?>"#, #"<html(?:\s[^>]*)?>"#, #"<!doctype[^>]*>"#].lazy
            .compactMap { try? NSRegularExpression(pattern: $0, options: .caseInsensitive).firstMatch(in: html, range: range) }
            .first
        guard let opening, let end = Range(opening.range, in: html)?.upperBound else { return element + html }
        return html[..<end] + element + html[end...]
    }

    /// The page with the script that frames pages of its folder at the start of its head. `pages` goes by the path of
    /// each page, in the order it was found.
    private static func withFramedPages(_ html: String, from: String, pages: [(path: String, url: String)]) -> String {
        guard !pages.isEmpty else { return html }
        let entries = pages.map { "\(inlineJSON($0.path)):\(inlineJSON($0.url))" }.joined(separator: ",")
        let script = DesignScripts.framedPages
            .replacingOccurrences(of: DesignScripts.pagesToken, with: "{\(entries)}")
            .replacingOccurrences(of: DesignScripts.fromToken, with: inlineJSON(from))
        return atHeadStart(html, "<script data-ruimte-pages>\(script)</script>")
    }

    /// The page with what shows the files its script names while it runs, first in its head.
    private static func withRuntimeAssets(_ html: String, from: String) -> String {
        let script = DesignScripts.runtimeAssets.replacingOccurrences(of: DesignScripts.fromToken, with: inlineJSON(from))
        return atHeadStart(html, "<script data-ruimte-assets>\(script)</script>")
    }

    private static func folderOf(_ path: String) -> String {
        path.lastIndex(of: "/").map { String(path[..<$0]) } ?? ""
    }

    private static func suffixOf(_ reference: String) -> String {
        reference.firstIndex { $0 == "?" || $0 == "#" }.map { String(reference[$0...]) } ?? ""
    }

    /// One page standing on its own: every file of the folder it pulls in rides along as its bytes, up to the bounds
    /// of a visual. A page it frames rides along standing on its own too, once however often it is named, and never a
    /// page it is framed in itself. A file that cannot be read stays a reference that loads nothing, as a broken path
    /// does in a browser.
    @MainActor static func standalonePage(
        _ file: String, folder: String, read: @escaping (String, Int) async throws -> MachineResource
    ) async throws -> Data {
        let page = try await read("\(folder)/\(file)", pageMaxBytes)
        let inlining = Inlining(folder: folder, read: read, total: page.data.count)
        let html = try await inlining.inline(file, text: String(decoding: page.data, as: UTF8.self), chain: [file])
        return Data(html.utf8)
    }

    @MainActor private final class Inlining {
        let folder: String
        let read: (String, Int) async throws -> MachineResource
        var total: Int
        /// The address of each page framed so far, or nil for one that could not ride along.
        var pages: [String: String?] = [:]

        init(folder: String, read: @escaping (String, Int) async throws -> MachineResource, total: Int) {
            self.folder = folder
            self.read = read
            self.total = total
        }

        func inline(_ file: String, text: String, chain: [String]) async throws -> String {
            let from = DesignFiles.folderOf(file)
            var inline: [String: String] = [:]
            for reference in DesignFiles.assetReferences(text, from: from) {
                try Task.checkCancellation()
                guard let path = DesignFiles.assetPath(reference, from: from) else { continue }
                if DesignFiles.isPage(path) {
                    if let url = try await pageURL(path, chain: chain) {
                        inline[reference] = url + DesignFiles.suffixOf(reference)
                    }
                    continue
                }
                guard let asset = try? await read("\(folder)/\(path)", assetMaxBytes) else { continue }
                if total + asset.data.count > pageMaxBytes {
                    break
                }
                total += asset.data.count
                inline[reference] = "data:\(asset.mime);base64,\(asset.data.base64EncodedString())"
            }
            var framed: [(path: String, url: String)] = []
            for mention in DesignFiles.pageMentions(text) {
                try Task.checkCancellation()
                guard let path = DesignFiles.assetPath(mention, from: from),
                    let url = try await pageURL(path, chain: chain)
                else { continue }
                if let at = framed.firstIndex(where: { $0.path == path }) {
                    framed[at].url = url
                } else {
                    framed.append((path, url))
                }
            }
            let page = DesignFiles.withFramedPages(DesignFiles.withAssets(text, inline: inline), from: from, pages: framed)
            // A page without a script names no file while it runs, but one that frames pages answers for them.
            let scripted = text.range(of: #"<script\b"#, options: [.regularExpression, .caseInsensitive]) != nil
            return scripted || !framed.isEmpty ? DesignFiles.withRuntimeAssets(page, from: from) : page
        }

        private func pageURL(_ path: String, chain: [String]) async throws -> String? {
            if chain.contains(path) {
                return nil
            }
            if let known = pages[path] {
                return known
            }
            let url = try await framedPageURL(path, chain: chain + [path])
            pages[path] = .some(url)
            return url
        }

        private func framedPageURL(_ path: String, chain: [String]) async throws -> String? {
            do {
                let page = try await read("\(folder)/\(path)", pageMaxBytes)
                if total + page.data.count > pageMaxBytes {
                    return nil
                }
                total += page.data.count
                return DesignFiles.pageDataURL(
                    try await inline(path, text: String(decoding: page.data, as: UTF8.self), chain: chain))
            } catch {
                try Task.checkCancellation()
                return nil
            }
        }
    }

    /// What the page shown reads for the files its script names while it runs: each once however often it is asked,
    /// by the page or the pages it frames, and up to the bounds of a visual all together. Nil for a file it cannot or
    /// may not read, which the page shows as a broken path.
    @MainActor final class RuntimeAssets {
        private let folder: String
        private let read: (String, Int) async throws -> MachineResource
        private var asked: [String: Task<MachineResource?, Never>] = [:]
        private var total = 0
        private var opened = 0

        init(folder: String, read: @escaping (String, Int) async throws -> MachineResource) {
            self.folder = folder
            self.read = read
        }

        /// The file at `path`, which is only a file inside the folder by the path the folder holds it at, and never a
        /// page, which frames as a page of its own.
        func bytes(_ path: String) async -> MachineResource? {
            guard path.utf16.count <= 1024, DesignFiles.assetPath(path) == path, !DesignFiles.isPage(path) else {
                return nil
            }
            if let known = asked[path] {
                return await known.value
            }
            let opening = opened
            let task = Task { [self] () -> MachineResource? in
                guard let resource = try? await read("\(folder)/\(path)", DesignFiles.assetMaxBytes),
                    opened == opening, total + resource.data.count <= DesignFiles.pageMaxBytes
                else { return nil }
                total += resource.data.count
                return resource
            }
            asked[path] = task
            return await task.value
        }

        /// The page opened again, which may ask for as much as a page that was never opened.
        func reopen() {
            opened += 1
            asked = [:]
            total = 0
        }
    }
}
