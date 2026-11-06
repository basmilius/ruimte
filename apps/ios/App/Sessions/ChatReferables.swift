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
    var group: Group
    /// The Lucide mark its row in the sidebar wears, such as the icon a person picked; nil wears its kind's.
    var icon: String?
    /// Where it stands, outermost first; its chip draws these in front of its name.
    var trail: [ChatReferenceStep] = []
    /// The project heading it is offered under once there is more than one project to offer.
    var section: ChatReferenceSection?

    var mark: String { icon ?? ChatReferables.icon(kind) }
}

/// One place on the way to a reference: the project or the canvas it stands in.
struct ChatReferenceStep: Equatable, Sendable {
    let id: String
    let name: String
    let kind: String
}

struct ChatReferenceSection: Equatable, Sendable {
    let id: String
    let name: String
    var current = false
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
    static let results = 20

    /// The nodes and texts of the canvas `chatID` is a node of, then the views in sidebar order, never the chat
    /// itself. Two of one name and kind on the canvas are told apart by the canvas's name.
    static func project(views: [StoredView], chatID: String) -> [ChatReferable] {
        let canvas = views.first { view in
            view.canvas != nil && !unlisted(view) && view.nodes.contains { $0.id == chatID }
        }?.canvas
        var onCanvas: [ChatReferable] = []
        if let canvas {
            onCanvas += canvas.nodes.compactMap { node in
                node.id == chatID ? nil : nodeReferable(node, views: views)
            }
            onCanvas += canvas.texts.map { text in
                ChatReferable(id: text.id, name: textName(text.text), kind: "text", group: .canvas)
            }
        }
        let taken = Set([chatID] + onCanvas.map(\.id))
        guard let canvas else { return standing(views: views, chatID: chatID, taken: taken) }
        let items = onCanvas + views.compactMap(viewReferable).filter { !taken.contains($0.id) }
        return items.enumerated().map { index, item in
            let twin = items.enumerated().contains { other, candidate in
                other != index && candidate.kind == item.kind && candidate.name.lowercased() == item.name.lowercased()
            }
            guard item.group == .canvas, twin else { return item }
            var told = item
            told.detail = canvas.name
            return told
        }
    }

    /// A chat view stands on no canvas, so it reaches a node through the canvas that node stands on. A node showing
    /// a drawing or a diagram has the id of that view, which is offered once, as a view.
    private static func standing(views: [StoredView], chatID: String, taken: Set<String>) -> [ChatReferable] {
        let viewIDs = Set(views.map(\.id))
        return views.flatMap { view -> [ChatReferable] in
            let own = viewReferable(view).map { [$0] } ?? []
            guard !chatID.isEmpty, view.canvas != nil, !unlisted(view) else { return own }
            let step = ChatReferenceStep(id: view.id, name: view.name, kind: "canvas")
            let nodes = view.nodes.compactMap { node -> ChatReferable? in
                guard var item = nodeReferable(node, views: views), !viewIDs.contains(item.id) else { return nil }
                item.group = .views
                item.trail = [step]
                return item
            }
            return own + nodes
        }.filter { !taken.contains($0.id) }
    }

    /// The other open projects under a heading each, behind the chat's own project. Nothing changes while there is
    /// no other project to tell it apart from.
    static func withReached(
        _ items: [ChatReferable], ownID: String, ownName: String, reached: [JSONValue]
    ) -> [ChatReferable] {
        let others = reached.filter { entry in
            entry["project"]?.text("projectId") != ownID && entry["project"]?["scratch"]?.boolValue != true
        }
        guard !others.isEmpty else { return items }
        let section = ChatReferenceSection(id: ownID, name: ownName, current: true)
        let own = items.map { item -> ChatReferable in
            guard item.group == .views else { return item }
            var placed = item
            placed.section = section
            return placed
        }
        return own + others.flatMap { entry -> [ChatReferable] in
            guard let project = entry["project"] else { return [] }
            let id = project.text("projectId")
            let name = project.text("name")
            let step = ChatReferenceStep(id: id, name: name, kind: "project")
            return entry.list("items").compactMap { item -> ChatReferable? in
                guard isOffered(item.text("kind")) else { return nil }
                let inside = item["canvas"].map {
                    [ChatReferenceStep(id: $0.text("id"), name: $0.text("name"), kind: "canvas")]
                }
                return ChatReferable(
                    id: item.text("id"), name: item.text("name"), kind: item.text("kind"), group: .views,
                    trail: [step] + (inside ?? []), section: ChatReferenceSection(id: id, name: name))
            }
        }
    }

    /// A text on a canvas is no view or node kind of the project, so the table does not hold it.
    private static func isOffered(_ kind: String) -> Bool { kind == "text" || ProjectKinds.isReferable(kind) }

    /// What a `#query` offers, the canvas first: never an id in `exclude`, and only chats where the machine takes
    /// no more. The limit holds per project, or a large first project would keep every other one out.
    static func suggestions(
        _ items: [ChatReferable], chatsOnly: Bool, query: String, exclude: [String], limit: Int = results
    ) -> [ChatReferable] {
        let needle = query.lowercased()
        // A name on the way counts as well, so typing a project or a canvas finds what stands in it.
        let found = items.filter { item in
            !item.name.isEmpty && (!chatsOnly || item.kind == "chat") && !exclude.contains(item.id)
                && (needle.isEmpty
                    || ([item.name] + item.trail.map(\.name)).contains { $0.lowercased().contains(needle) })
        }
        // A node never stands in the list without its canvas above it, even a canvas that does not match or is picked.
        let foundIDs = Set(found.map(\.id))
        let canvases = Set(found.flatMap { $0.trail.filter { $0.kind == "canvas" }.map(\.id) })
        let matches = items.filter { foundIDs.contains($0.id) || canvases.contains($0.id) }
        var taken: [String: Int] = [:]
        return (matches.filter { $0.group == .canvas } + matches.filter { $0.group == .views }).filter { item in
            let section = item.section?.id ?? ""
            taken[section, default: 0] += 1
            return taken[section, default: 0] <= limit
        }
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
        case "project": "folder"
        case "text": "type"
        default: ProjectKinds.row(kind).map { $0.referenceIcon ?? $0.icon } ?? "file-text"
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
    static func destination(_ id: String, views: [StoredView]) -> (viewID: String, nodeID: String)? {
        if views.contains(where: { $0.id == id }) { return (id, id) }
        for case .canvas(let view) in views {
            if view.nodes.contains(where: { $0.id == id }) { return (view.id, id) }
            if view.texts.contains(where: { $0.id == id }) { return (view.id, view.id) }
        }
        // A drawing or diagram node stands for its view, which a sidebar may not list but the project holds.
        for view in views {
            if let node = view.nodes.first(where: { $0.viewId == id }) {
                return (view.id, node.id)
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
    private static func nodeReferable(_ node: StoredNode, views: [StoredView]) -> ChatReferable? {
        if node.machine != nil { return nil }
        let kind = node.kind.rawValue
        let title = node.title
        let icon = WorkspaceViewIcon.name(for: node)
        switch node.kind {
        case .chat, .terminal, .note, .browser, .design:
            return ChatReferable(id: node.id, name: title, kind: kind, group: .canvas, icon: icon)
        case .drawing, .diagram:
            guard let viewID = node.viewId, !viewID.isEmpty else { return nil }
            // The node stands for its view, so it wears the view's mark.
            let view = views.first { $0.id == viewID }
            return ChatReferable(
                id: viewID, name: title, kind: kind, group: .canvas,
                icon: view.map { WorkspaceViewIcon.name(for: $0) } ?? icon)
        case .file:
            return (node.path ?? "").isEmpty
                ? nil : ChatReferable(id: node.id, name: title, kind: kind, group: .canvas, icon: icon)
        case .device:
            guard node.device != nil else { return nil }
            return ChatReferable(id: node.id, name: title, kind: kind, group: .canvas, icon: icon)
        default:
            return nil
        }
    }

    private static func viewReferable(_ view: StoredView) -> ChatReferable? {
        guard ProjectKinds.isReferable(view.kind), !unlisted(view) else { return nil }
        return ChatReferable(
            id: view.id, name: view.name, kind: view.kind, group: .views, icon: WorkspaceViewIcon.name(for: view))
    }

    /// A chat nobody wrote in yet or an extension draws, or a view that is shown nowhere (an inline chat, another
    /// machine's canvas): `isUnlistedView` in `packages/contracts`.
    private static func unlisted(_ view: StoredView) -> Bool {
        switch view {
        case .chat(let chat): chat.empty == true || chat.hidden == true || chat.drawnBy != nil
        case .canvas(let canvas): canvas.hidden == true
        default: false
        }
    }

    /// A text's first line is its name, as the daemon names it to an agent.
    private static func textName(_ text: String) -> String {
        let line = (text.components(separatedBy: "\n").first ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return String(line.utf16.prefix(60)) ?? String(line.prefix(60))
    }
}
