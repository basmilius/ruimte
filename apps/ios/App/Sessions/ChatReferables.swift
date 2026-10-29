import Foundation
import RuimtePulsar

/// A view, node, text or chat of the project a message may point at with `#`, under the name it has now.
struct ChatReferable: Equatable, Identifiable, Sendable {
    enum Group: Equatable, Sendable {
        /// What stands on the canvas the chat is a node of.
        case canvas
        case views
    }

    let id: String
    let name: String
    let kind: String
    /// What tells it apart from another of the same name and kind: the canvas it stands on.
    var detail: String?
    let group: Group
    /// The Lucide mark its row in the sidebar wears, such as the icon a person picked; nil wears its kind's.
    var icon: String?

    var mark: String { icon ?? ChatReferables.icon(kind) }
}

/// Where a chat finds what its `#` offers. Closures, so the picker reads the project as it is when it asks.
struct ChatReferenceSource {
    var items: () -> [ChatReferable] = { [] }
    /// Whether the machine resolves `references` on `chat.send` (`viewReferences` in `endpoint.info`).
    var viewReferences: () -> Bool = { false }
}

/// The views a person picked from, what each id is spelled as, and how `#Name` in a reply is found. Mirrors the
/// desktop's `projectReferables` and the shared composer's matchers, so both clients offer and send the same.
enum ChatReferables {
    static let results = 8

    private static let viewKinds: Set<String> = [
        "canvas", "chat", "terminal", "browser", "device", "drawing", "diagram", "file", "database",
    ]

    /// The nodes and texts of the canvas `chatID` is a node of, then the views in sidebar order, never the chat
    /// itself. Two of one name and kind on the canvas are told apart by the canvas's name.
    static func project(views: [JSONValue], chatID: String) -> [ChatReferable] {
        let canvas = views.first { view in
            view.text("kind") == "canvas" && !unlisted(view) && view.list("nodes").contains { $0.stableID == chatID }
        }
        var onCanvas: [ChatReferable] = []
        if let canvas {
            onCanvas += canvas.list("nodes").compactMap { node in
                node.stableID == chatID ? nil : nodeReferable(node, views: views)
            }
            onCanvas += canvas.list("texts").map { text in
                ChatReferable(id: text.stableID, name: textName(text.text("text")), kind: "text", group: .canvas)
            }
        }
        let taken = Set([chatID] + onCanvas.map(\.id))
        let items = onCanvas + views.compactMap(viewReferable).filter { !taken.contains($0.id) }
        guard let canvas else { return items }
        return items.enumerated().map { index, item in
            let twin = items.enumerated().contains { other, candidate in
                other != index && candidate.kind == item.kind && candidate.name.lowercased() == item.name.lowercased()
            }
            guard item.group == .canvas, twin else { return item }
            var told = item
            told.detail = canvas.text("name")
            return told
        }
    }

    /// What a `#query` offers, the canvas first: never an id in `exclude`, and only chats where the machine takes
    /// no more.
    static func suggestions(
        _ items: [ChatReferable], chatsOnly: Bool, query: String, exclude: [String], limit: Int = results
    ) -> [ChatReferable] {
        let needle = query.lowercased()
        let matches = items.filter { item in
            !item.name.isEmpty && (!chatsOnly || item.kind == "chat") && !exclude.contains(item.id)
                && (needle.isEmpty || item.name.lowercased().contains(needle))
        }
        return Array((matches.filter { $0.group == .canvas } + matches.filter { $0.group == .views }).prefix(limit))
    }

    /// Whether `#` has anything to offer, so a `#fff` with nothing behind it opens no picker.
    static func offers(_ items: [ChatReferable], chatsOnly: Bool) -> Bool {
        items.contains { !chatsOnly || $0.kind == "chat" }
    }

    /// The ids a person pointed at in a thread, with `@` before `#` existed or with `#`. Only a user item counts.
    static func referenced(_ items: [ChatItem]) -> [String] {
        var seen = Set<String>()
        return items.compactMap(\.userItem).flatMap { ($0.chats ?? []) + ($0.references ?? []) }.filter {
            seen.insert($0).inserted
        }
    }

    /// The Lucide mark of a kind, as the desktop's `REFERENCE_ICONS`.
    static func icon(_ kind: String) -> String {
        switch kind {
        case "canvas": "frame"
        case "chat": "message-square"
        case "terminal": "terminal"
        case "note": "sticky-note"
        case "text": "type"
        case "drawing": "pen-tool"
        case "diagram": "workflow"
        case "browser": "globe"
        case "device": "smartphone"
        case "database": "database"
        default: "file-text"
        }
    }

    static func kindName(_ kind: String) -> String {
        switch kind {
        case "canvas": String(localized: "Canvas")
        case "chat": String(localized: "Chat")
        case "terminal": String(localized: "Terminal")
        case "note": String(localized: "Note")
        case "text": String(localized: "Text")
        case "drawing": String(localized: "Drawing")
        case "diagram": String(localized: "Diagram")
        case "browser": String(localized: "Browser")
        case "device": String(localized: "Device")
        case "database": String(localized: "Database")
        default: String(localized: "File")
        }
    }

    static func url(_ id: String) -> URL? {
        var components = URLComponents()
        components.scheme = "ruimte-reference"
        components.host = "open"
        components.queryItems = [URLQueryItem(name: "id", value: id)]
        return components.url
    }

    static func id(from url: URL) -> String? {
        guard url.scheme == "ruimte-reference" else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "id" }?.value
    }

    /// The view and node a chip opens: a view as itself, a node on its canvas, and a text as the canvas it is on.
    static func destination(_ id: String, views: [JSONValue]) -> (viewID: String, nodeID: String)? {
        if views.contains(where: { $0.stableID == id }) { return (id, id) }
        for view in views where view.text("kind") == "canvas" {
            if view.list("nodes").contains(where: { $0.stableID == id }) { return (view.stableID, id) }
            if view.list("texts").contains(where: { $0.stableID == id }) { return (view.stableID, view.stableID) }
        }
        // A drawing or diagram node stands for its view, which a sidebar may not list but the project holds.
        for view in views {
            if let node = view.list("nodes").first(where: { $0.text("viewId") == id }) {
                return (view.stableID, node.stableID)
            }
        }
        return nil
    }

    /// Where a text nobody typed through the picker, such as a reply, spells `#Name` for one of `items` by exactly its
    /// name. The longest name wins; a name more than one carries stays text, unless one of those is in `referenced`.
    static func namedRanges(
        in text: String, items: [ChatReferable], referenced: [String], excluded: [NSRange] = []
    ) -> [ChatDraftToken] {
        var byName: [String: [String]] = [:]
        var names: [String] = []
        for item in items where !item.name.isEmpty {
            if byName[item.name] == nil { names.append(item.name) }
            byName[item.name, default: []].append(item.id)
        }
        names.sort { ($0 as NSString).length > ($1 as NSString).length }
        let preferred = Set(referenced)
        let source = text as NSString
        var found: [ChatDraftToken] = []
        var index = source.range(of: "#").location
        while index != NSNotFound {
            let from = index
            var name: String?
            if from == 0 || opens(source.character(at: from - 1)) {
                name = names.first { candidate in
                    let length = (candidate as NSString).length
                    guard from + 1 + length <= source.length else { return false }
                    return source.substring(with: NSRange(location: from + 1, length: length)) == candidate
                        && ChatDraftSyntax.endsToken(at: from + 1 + length, in: source)
                }
            }
            let to = from + 1 + (name.map { ($0 as NSString).length } ?? 0)
            let ids = name.flatMap { byName[$0] } ?? []
            let id = ids.first { preferred.contains($0) } ?? (ids.count == 1 ? ids.first : nil)
            let range = NSRange(location: from, length: to - from)
            if let id, !excluded.contains(where: { NSIntersectionRange($0, range).length > 0 }) {
                found.append(ChatDraftToken(range: range, value: id, kind: "#"))
            }
            index =
                to < source.length
                ? source.range(of: "#", range: NSRange(location: to, length: source.length - to)).location : NSNotFound
        }
        return found
    }

    /// What a `#` may follow in a text nobody typed through the picker: a space, or an opening bracket or quote.
    private static func opens(_ unit: unichar) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return CharacterSet.whitespacesAndNewlines.contains(scalar)
            || "([{\"'\u{201C}\u{2018}".unicodeScalars.contains(scalar)
    }

    /// A node as a `#` reaches it, or nil for one no verb reaches: a group, a node with nothing to read, one on another
    /// machine. A node showing a drawing or a diagram stands for that view.
    private static func nodeReferable(_ node: JSONValue, views: [JSONValue]) -> ChatReferable? {
        if let machine = node["machine"], machine != .null { return nil }
        let kind = node.text("kind")
        let title = node.text("title")
        let icon = WorkspaceViewIcon.name(for: node)
        switch kind {
        case "chat", "terminal", "note", "browser":
            return ChatReferable(id: node.stableID, name: title, kind: kind, group: .canvas, icon: icon)
        case "drawing", "diagram":
            let viewID = node.text("viewId")
            guard !viewID.isEmpty else { return nil }
            // The node stands for its view, so it wears the view's mark.
            let view = views.first { $0.stableID == viewID }
            return ChatReferable(
                id: viewID, name: title, kind: kind, group: .canvas, icon: view.map(WorkspaceViewIcon.name) ?? icon)
        case "file":
            return node.text("path").isEmpty
                ? nil : ChatReferable(id: node.stableID, name: title, kind: kind, group: .canvas, icon: icon)
        case "device":
            guard let device = node["device"], device != .null else { return nil }
            return ChatReferable(id: node.stableID, name: title, kind: kind, group: .canvas, icon: icon)
        default:
            return nil
        }
    }

    private static func viewReferable(_ view: JSONValue) -> ChatReferable? {
        let kind = view.text("kind")
        guard viewKinds.contains(kind), !unlisted(view) else { return nil }
        return ChatReferable(
            id: view.stableID, name: view.text("name"), kind: kind, group: .views,
            icon: WorkspaceViewIcon.name(for: view))
    }

    /// A chat nobody wrote in yet, or a view that is shown nowhere (an inline chat, another machine's canvas).
    private static func unlisted(_ view: JSONValue) -> Bool {
        let kind = view.text("kind")
        let empty = kind == "chat" && view["empty"]?.boolValue == true
        let hidden = (kind == "chat" || kind == "canvas") && view["hidden"]?.boolValue == true
        return empty || hidden
    }

    /// A text's first line is its name, as the daemon names it to an agent.
    private static func textName(_ text: String) -> String {
        let line = (text.components(separatedBy: "\n").first ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return String(line.utf16.prefix(60)) ?? String(line.prefix(60))
    }
}
