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

    static func sessionItem(_ chat: Chat) -> JSONValue {
        .object(["id": .string(chat.id), "kind": .string("chat"), "node": chat.node])
    }
}

/// Making a design and reading its pages, after `apps/client/src/design`.
enum DesignFiles {
    static let folders = [".ruimte/private/designs", ".ruimte/designs"]
    static let pageMaxBytes = DesignLimits.pageMaxBytes
    static let assetMaxBytes = 10 * 1024 * 1024

    /// The pages of a design, the HTML files right in its folder, the most recently changed first; a tie keeps the
    /// order of their names.
    static func pages(_ entries: [FsEntry]) -> [FsEntry] {
        entries
            .filter { $0.kind == .file && isPage($0.name) }
            .sorted { one, other in
                one.mtime == other.mtime
                    ? one.name.localizedStandardCompare(other.name) == .orderedAscending : one.mtime > other.mtime
            }
    }

    /// What the pages list shows. Only a missing folder is a design without pages; any other failed read keeps what
    /// the list had and says so, so a dropped connection never reads as an empty design.
    struct Listing: Equatable {
        var pages: [FsEntry]?
        var found = false
        var problem: String?

        func after(_ outcome: Result<[FsEntry], Error>) -> Listing {
            switch outcome {
            case .success(let entries):
                return Listing(pages: DesignFiles.pages(entries), found: true, problem: nil)
            case .failure(let error) where error.machineCode == .notFound:
                return Listing(pages: [], found: false, problem: nil)
            case .failure(let error):
                return Listing(pages: pages, found: found, problem: error.localizedDescription)
            }
        }
    }

    static func pageName(_ file: String) -> String {
        file.replacingOccurrences(of: #"\.html?$"#, with: "", options: [.regularExpression, .caseInsensitive])
    }

    /// Whether a change the machine reports touches the folder. A parent counts only while the folder is not there
    /// yet, since that is how the chat making it shows.
    static func changeReaches(_ changed: String, folder: String, found: Bool) -> Bool {
        changed == folder || changed.hasPrefix(folder + "/") || (!found && folder.hasPrefix(changed + "/"))
    }

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

    static func view(agent: String, name: String, path: String) -> JSONValue {
        .object([
            "id": .string("design-" + UUID().uuidString), "kind": .string("design"), "name": .string(name),
            "node": .object(["provider": .string(agent), "providerFixed": .bool(true)]), "path": .string(path),
        ])
    }

    static func chat(agent: (kind: String, name: String), count: Int) -> JSONValue {
        .object([
            "id": .string("chat-" + UUID().uuidString), "name": .string("\(agent.name) \(count + 1)"),
            "node": .object(["provider": .string(agent.kind), "providerFixed": .bool(true)]),
        ])
    }

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
    private static let pageURLPrefix = "data:text/html;charset=utf-8,"

    /// The file a relative reference of a page names, relative to the design folder, or nil when it leaves the folder
    /// or loads on its own. `from` is the folder of the page that makes the reference, inside the design folder.
    ///
    /// The rule of `assetPathOf` on the desktop, the same on every machine the path reaches: a backslash separates
    /// like a slash (a Windows machine reads `..\x` as a parent), and a drive, a UNC prefix, a NUL, or a separator or
    /// `..` that only a percent escape spells out are refused after one decoding. A segment of nothing but dots and
    /// spaces is refused too, which Windows reads as another name. Symlinks are out of scope: a page can read only
    /// what the client may read anyway, so this keeps a page in its folder and is no sandbox against the person who
    /// opened it.
    static func assetPath(_ reference: String, from: String = "") -> String? {
        let cut = reference.firstIndex { $0 == "?" || $0 == "#" } ?? reference.endIndex
        let path = String(reference[..<cut])
        let range = NSRange(reference.startIndex..., in: reference)
        guard !path.isEmpty, loadsAsItIs.firstMatch(in: reference, range: range) == nil else { return nil }
        let decoded = (path.removingPercentEncoding ?? path).unicodeScalars
        guard let first = decoded.first, !decoded.contains("\0"), first != "/", first != "\\" else { return nil }
        if first.isASCII, first.properties.isAlphabetic, decoded.dropFirst().first == ":" {
            return nil
        }
        var parts = from.split(separator: "/").map(String.init)
        // Split by scalar, as the page's script splits by UTF-16 unit: a separator before a combining mark is one
        // `Character`, which a split by `Character` would not see.
        for scalars in decoded.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "\\" }) {
            let part = String(String.UnicodeScalarView(scalars))
            if part.isEmpty || part == "." {
                continue
            }
            if part == ".." {
                guard !parts.isEmpty else { return nil }
                parts.removeLast()
                continue
            }
            if scalars.allSatisfy({ $0 == "." || $0 == " " }) {
                return nil
            }
            parts.append(part)
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
    /// Found by walking each run of name characters once, back from its end; a pattern that retries from every
    /// character of a long run takes time in the square of its length.
    static func pageMentions(_ html: String) -> [String] {
        let bytes = Array(html.utf8)
        var found: [String] = []
        var seen: Set<String> = []
        var at = 0
        while at < bytes.count {
            guard isNameByte(bytes[at]) else {
                at += 1
                continue
            }
            var end = at + 1
            while end < bytes.count, isNameByte(bytes[end]) {
                end += 1
            }
            if let page = pageNamed(in: bytes, start: at, end: end), seen.insert(page).inserted {
                found.append(page)
            }
            at = end
        }
        return found
    }

    private static func isWordByte(_ byte: UInt8) -> Bool {
        (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte == 95
    }

    private static func isNameByte(_ byte: UInt8) -> Bool {
        isWordByte(byte) || byte == 37 || byte == 46 || byte == 47 || byte == 45
    }

    private static func spells(_ bytes: [UInt8], at: Int, _ letters: StaticString) -> Bool {
        let wanted = UnsafeBufferPointer(start: letters.utf8Start, count: letters.utf8CodeUnitCount)
        return wanted.indices.allSatisfy { bytes[at + $0] | 0x20 == wanted[$0] }
    }

    /// Whether a name may end at `end`: what follows goes on neither as a word, a dash, nor a dot and a word.
    private static func endsName(_ bytes: [UInt8], at end: Int) -> Bool {
        guard end < bytes.count else { return true }
        let next = bytes[end]
        if isWordByte(next) || next == 45 {
            return false
        }
        return !(next == 46 && end + 1 < bytes.count && isWordByte(bytes[end + 1]))
    }

    /// The page a run of name characters, `bytes[start..<end]`, names: the run up to its last `.htm` or `.html` that
    /// ends on its own, after at least one character. No other can follow it in the run, since that one would have
    /// been the last.
    private static func pageNamed(in bytes: [UInt8], start: Int, end: Int) -> String? {
        for at in stride(from: end, through: start + 5, by: -1) {
            let dot =
                bytes[at - 5] == 46 && spells(bytes, at: at - 4, "html")
                ? at - 5 : bytes[at - 4] == 46 && spells(bytes, at: at - 3, "htm") ? at - 4 : -1
            if dot > start, endsName(bytes, at: at) {
                return String(decoding: bytes[start..<at], as: UTF8.self)
            }
        }
        return nil
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

    /// How many bytes a page being built may still grow by: what it weighs counts every place a file or page stands in
    /// it, however often.
    final class Room {
        var left: Int

        init(left: Int) {
            self.left = left
        }

        func take(_ bytes: Int) -> Bool {
            guard bytes <= left else { return false }
            left -= bytes
            return true
        }
    }

    /// The page with each reference it pulled in replaced by the bytes it names; one without bytes stays as it was. A
    /// link to another page keeps its path: no browser opens an inline page from a link, so the copy would only weigh.
    /// A file named in many places is in every one of them, so each place takes what it adds from `room`, and one that
    /// does not fit stays the path it was.
    static func withAssets(_ html: String, inline: [String: String], room: Room? = nil) -> String {
        func grows(_ reference: String, _ url: String) -> Bool {
            guard let room else { return true }
            return room.take(max(0, url.utf8.count - reference.utf8.count))
        }
        var page = replacing(attributeReference, in: html) { match, text in
            guard let reference = Range(match.range(at: 3), in: text).map({ String(text[$0]) }),
                let url = inline[reference],
                let name = Range(match.range(at: 1), in: text).map({ text[$0] }),
                let quote = Range(match.range(at: 2), in: text).map({ text[$0] })
            else { return nil }
            if name.lowercased() == "href", url.hasPrefix(pageURLPrefix) {
                return nil
            }
            return grows(reference, url) ? "\(name)=\(quote)\(url)\(quote)" : nil
        }
        page = replacing(cssReference, in: page) { match, text in
            guard let reference = Range(match.range(at: 2), in: text).map({ String(text[$0]) }),
                let url = inline[reference],
                let quote = Range(match.range(at: 1), in: text).map({ text[$0] })
            else { return nil }
            return grows(reference, url) ? "url(\(quote)\(url)\(quote))" : nil
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

    /// The script that frames pages of its folder, as it stands in a page; `pagesJSON` is the pages it frames by their
    /// path.
    private static func framedPagesElement(_ pagesJSON: String, from: String) -> String {
        let script = DesignScripts.framedPages
            .replacingOccurrences(of: DesignScripts.pagesToken, with: pagesJSON)
            .replacingOccurrences(of: DesignScripts.fromToken, with: inlineJSON(from))
        return "<script data-ruimte-pages>\(script)</script>"
    }

    /// The page with the script that frames pages of its folder at the start of its head. `pages` goes by the path of
    /// each page, in the order it was found.
    private static func withFramedPages(_ html: String, from: String, pages: [(path: String, url: String)]) -> String {
        guard !pages.isEmpty else { return html }
        let entries = pages.map { "\(inlineJSON($0.path)):\(inlineJSON($0.url))" }.joined(separator: ",")
        return atHeadStart(html, framedPagesElement("{\(entries)}", from: from))
    }

    private static func runtimeAssetsElement(from: String) -> String {
        let script = DesignScripts.runtimeAssets.replacingOccurrences(of: DesignScripts.fromToken, with: inlineJSON(from))
        return "<script data-ruimte-assets>\(script)</script>"
    }

    private static func withRuntimeAssets(_ html: String, from: String) -> String {
        atHeadStart(html, runtimeAssetsElement(from: from))
    }

    /// What the scripts a page may carry weigh, which a page keeps room for whether it ends up with them or not.
    private static func scriptsWeight(from: String) -> Int {
        framedPagesElement("{}", from: from).utf8.count + runtimeAssetsWeight(from: from)
    }

    /// What the script that shows the files a page's script names weighs, which a page with a script cannot do without.
    private static func runtimeAssetsWeight(from: String) -> Int {
        runtimeAssetsElement(from: from).utf8.count
    }

    private static func framedEntryWeight(_ path: String, _ url: String) -> Int {
        inlineJSON(path).utf8.count + inlineJSON(url).utf8.count + 2
    }

    private static func folderOf(_ path: String) -> String {
        path.lastIndex(of: "/").map { String(path[..<$0]) } ?? ""
    }

    private static func suffixOf(_ reference: String) -> String {
        reference.firstIndex { $0 == "?" || $0 == "#" }.map { String(reference[$0...]) } ?? ""
    }

    /// One page standing on its own: every file of the folder it pulls in rides along as its bytes, up to the bounds
    /// of a visual. A page it frames rides along standing on its own too, read once however often it is named, and
    /// never a page it is framed in itself. A file that cannot be read stays a reference that loads nothing, as a
    /// broken path does in a browser.
    ///
    /// The bounds hold for what is built, not for what is read: a file or page named in many places is in every one of
    /// them, a framed page is in its parent as the address that holds it, and one that does not fit stays the path it
    /// was. Reading stops at the same bounds, so a folder is not read past them either. A page that does not fit beside
    /// the script that shows its files is refused with an error, a framed one by staying the path it was.
    ///
    /// It runs off the main actor: scanning and rewriting a page of megabytes takes long enough to stall the screen.
    @concurrent static func standalonePage(
        _ file: String, folder: String, read: @escaping @Sendable (String, Int) async throws -> MachineResource
    ) async throws -> Data {
        let page = try await read("\(folder)/\(file)", pageMaxBytes)
        let inlining = Inlining(folder: folder, read: read, total: page.data.count)
        let html = try await inlining.inline(file, text: String(decoding: page.data, as: UTF8.self), chain: [file])
        return Data(html.utf8)
    }

    /// One page standing on its own. A machine that answers `design.page` builds it next to the files, so the page
    /// travels once instead of every file it names; an older one hands out the files and the page is built here.
    @MainActor static func page(
        _ file: String, folder: String, design: String, project: String, client: any MachineRequesting,
        read: @escaping @Sendable (String, Int) async throws -> MachineResource
    ) async throws -> Data {
        guard !project.isEmpty, (client as? MachineFeatures)?.answers(.designPage) == true else {
            return try await standalonePage(file, folder: folder, read: read)
        }
        return try await builtPage(file, design: design, project: project, client: client)
    }

    @MainActor private static func builtPage(
        _ file: String, design: String, project: String, client: any MachineRequesting
    ) async throws -> Data {
        // With the bootstrap of a visual, which sets the theme a page draws in; the app has none of its own to add.
        let built = try await client.request(
            .designPage,
            payload: .object([
                "projectId": .string(project), "designId": .string(design), "file": .string(file),
                "bootstrap": .bool(true),
            ]))
        let name = built.text("name")
        switch built.text("kind") {
        case "missing":
            throw MachineClientError.invalid(String(localized: "\(name) is not in the design."))
        case "too-large":
            throw MachineClientError.invalid(String(localized: "This page is too large to show."))
        case "not-text":
            throw MachineClientError.invalid(String(localized: "\(name) is not a text file."))
        default:
            break
        }
        // The machine lets go of the page once every byte went out, so a read that starts over would find nothing.
        let page = try await client.readResource(
            .object(["kind": .string("designPage"), "pageId": .string(built.text("pageId"))]),
            maxBytes: DesignLimits.pageSentMaxBytes, restarts: 0)
        // Decoded as the page built here is, so a byte that is no UTF-8 shows the same on both paths.
        return Data(String(decoding: page.data, as: UTF8.self).utf8)
    }

    private final class Inlining {
        let folder: String
        let read: @Sendable (String, Int) async throws -> MachineResource
        var total: Int
        /// The address of each page framed so far, or nil for one that could not ride along.
        var pages: [String: String?] = [:]

        init(folder: String, read: @escaping @Sendable (String, Int) async throws -> MachineResource, total: Int) {
            self.folder = folder
            self.read = read
            self.total = total
        }

        func inline(_ file: String, text: String, chain: [String]) async throws -> String {
            let from = DesignFiles.folderOf(file)
            var inline: [String: String] = [:]
            let scripted = text.range(of: #"<script\b"#, options: [.regularExpression, .caseInsensitive]) != nil
            // The script that shows the files of a page is not optional, so a page it cannot fit beside is not built at all.
            if text.utf8.count + (scripted ? DesignFiles.runtimeAssetsWeight(from: from) : 0) > pageMaxBytes {
                throw MachineClientError.invalid(String(localized: "This page is too large to show."))
            }
            let room = Room(left: DesignFiles.pageMaxBytes - text.utf8.count - DesignFiles.scriptsWeight(from: from))
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
            let withBytes = DesignFiles.withAssets(text, inline: inline, room: room)
            let fitting = framed.filter { room.take(DesignFiles.framedEntryWeight($0.path, $0.url)) }
            let page = DesignFiles.withFramedPages(withBytes, from: from, pages: fitting)
            // A page without a script names no file while it runs, but one that frames pages answers for them.
            return scripted || !fitting.isEmpty ? DesignFiles.withRuntimeAssets(page, from: from) : page
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
