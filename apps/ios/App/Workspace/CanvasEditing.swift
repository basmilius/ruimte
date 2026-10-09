import CoreGraphics
import Foundation
import RuimtePulsar

/// Which gestures a canvas refuses on this client. Commands from the dock always work. A phone neither moves nor
/// resizes nodes, but it keeps those two as it read them, since the desktop writes the same local file.
struct CanvasLocks: Equatable {
    var pan = false
    var zoom = false
    var move = false
    var resize = false

    init(pan: Bool = false, zoom: Bool = false, move: Bool = false, resize: Bool = false) {
        self.pan = pan
        self.zoom = zoom
        self.move = move
        self.resize = resize
    }

    /// Absent means nothing locked, which is every file written before a lock outlived a view switch.
    init(_ value: JSONValue?) {
        pan = value?["pan"]?.boolValue ?? false
        zoom = value?["zoom"]?.boolValue ?? false
        move = value?["move"]?.boolValue ?? false
        resize = value?["resize"]?.boolValue ?? false
    }

    var json: JSONValue {
        .object(["pan": .bool(pan), "zoom": .bool(zoom), "move": .bool(move), "resize": .bool(resize)])
    }
    var any: Bool { pan || zoom || move || resize }
    var all: Bool { pan && zoom && move && resize }

    func locking(everything: Bool) -> CanvasLocks {
        CanvasLocks(pan: everything, zoom: everything, move: everything, resize: everything)
    }
}

/// What the dock of a canvas counts: the nodes waiting on a person, in canvas order so a tap walks through them, and
/// how many agents work.
struct CanvasStatus: Equatable {
    var needsYou: [String] = []
    var working = 0

    var isEmpty: Bool { needsYou.isEmpty && working == 0 }

    /// The node a tap on the count opens: the one after the node opened last, so repeated taps visit them all.
    func next(after id: String?) -> String? {
        guard !needsYou.isEmpty else { return nil }
        guard let id, let index = needsYou.firstIndex(of: id) else { return needsYou.first }
        return needsYou[(index + 1) % needsYou.count]
    }
}

/// What a long press on a node offers, in the order of the design's node menu.
enum CanvasNodeAction: Equatable {
    case openAsView, linkAsContext, groupSelection, rename, snooze, delete

    static func actions(for node: JSONValue) -> [CanvasNodeAction] {
        let kind = node.text("kind")
        // A kind this version does not know is kept as it is, so the menu only offers to take it away.
        guard CanvasEditing.knownKinds.contains(kind) else { return [.delete] }
        var actions: [CanvasNodeAction] = []
        if CanvasEditing.opensAsView(kind) { actions.append(.openAsView) }
        actions.append(.linkAsContext)
        if kind != "group" { actions.append(.groupSelection) }
        actions.append(.rename)
        if CanvasEditing.isAgent(kind) { actions.append(.snooze) }
        actions.append(.delete)
        return actions
    }
}

/// The edits a phone makes to a canvas view, as pure functions over its JSON, so the rules match the desktop's and
/// stay testable: grouping (`groupFrame` in `packages/contracts`), context links (`addEdge` in the client), layouts
/// and the view a node becomes.
enum CanvasEditing {
    static let grid = 8.0
    static let groupPadding = 32.0
    static let groupHeader = 40.0
    static let knownKinds: Set<String> = [
        "terminal", "chat", "browser", "device", "group", "note", "drawing", "diagram", "file",
    ]

    static func isAgent(_ kind: String) -> Bool { kind == "chat" || kind == "terminal" }
    static func opensAsView(_ kind: String) -> Bool { ["chat", "terminal", "browser", "device"].contains(kind) }

    /// `Math.round` of the desktop, which rounds a half up where Swift rounds it away from zero.
    static func snap(_ value: Double) -> Double { (value / grid + 0.5).rounded(.down) * grid }

    static func rect(_ node: JSONValue) -> CGRect {
        CGRect(
            x: node.number("x"), y: node.number("y"), width: node.number("w", fallback: 320),
            height: node.number("h", fallback: 200))
    }

    // MARK: Groups

    /// The frame a group takes around what it holds: room on every side and the title band above it, on the grid.
    static func groupFrame(_ members: [JSONValue]) -> CGRect? {
        guard !members.isEmpty else { return nil }
        let bounds = members.map(rect).reduce(CGRect.null) { $0.union($1) }
        return CGRect(
            x: snap(bounds.minX - groupPadding), y: snap(bounds.minY - groupPadding - groupHeader),
            width: snap(bounds.width + groupPadding * 2), height: snap(bounds.height + groupPadding * 2 + groupHeader))
    }

    /// What a group holds: open, the nodes whose center lies inside its frame; collapsed, the ids the file spells out.
    static func members(of group: JSONValue, in canvas: JSONValue) -> [JSONValue] {
        let nodes = canvas.list("nodes").filter { $0.stableID != group.stableID }
        if group["collapsed"]?.boolValue == true {
            let ids = Set(group.list("memberIds").compactMap(\.stringValue))
            return nodes.filter { ids.contains($0.stableID) }
        }
        var frame = rect(group)
        frame.size.height = group.number("expandedHeight", fallback: frame.height)
        return nodes.filter { node in
            let box = rect(node)
            return frame.contains(CGPoint(x: box.midX, y: box.midY))
        }
    }

    /// A group around these nodes, added in front of them; nil when none of them can be held.
    static func grouping(_ canvas: JSONValue, ids: [String], groupID: String) -> JSONValue? {
        let wanted = Set(ids)
        let members = canvas.list("nodes").filter { wanted.contains($0.stableID) && $0.text("kind") != "group" }
        guard let frame = groupFrame(members) else { return nil }
        let group: JSONValue = .object([
            "id": .string(groupID), "kind": .string("group"), "title": .string("Group"),
            "x": .number(frame.minX), "y": .number(frame.minY), "w": .number(frame.width), "h": .number(frame.height),
        ])
        return canvas.setting("nodes", .array(canvas.list("nodes") + [group]))
    }

    // MARK: Context links

    /// Whether a line may run from one node to another: never to itself and never twice the same way.
    static func canLink(_ edges: [JSONValue], from: String, to: String) -> Bool {
        from != to && !edges.contains { $0.text("from") == from && $0.text("to") == to }
    }

    /// Lets `target` read `source`. A line into an agent is labeled context; between two agents it runs both ways,
    /// as the desktop and the daemon's `link new` draw it, since each end reads only what runs into it.
    static func linking(_ canvas: JSONValue, from source: String, to target: String, newID: () -> String) -> JSONValue {
        let nodes = Dictionary(
            canvas.list("nodes").map { ($0.stableID, $0) }, uniquingKeysWith: { first, _ in first })
        guard let from = nodes[source], let to = nodes[target] else { return canvas }
        var pairs = [(from, to)]
        if isAgent(from.text("kind")) && isAgent(to.text("kind")) { pairs.append((to, from)) }
        var edges = canvas.list("edges")
        for (start, end) in pairs where canLink(edges, from: start.stableID, to: end.stableID) {
            var edge: [String: JSONValue] = [
                "id": .string(newID()), "from": .string(start.stableID), "to": .string(end.stableID),
            ]
            if isAgent(end.text("kind")) { edge["label"] = .string("context") }
            edges.append(.object(edge))
        }
        return canvas.setting("edges", .array(edges))
    }

    /// A line an agent reads along: one into an agent, or one that says so in its role.
    static func isContext(_ edge: JSONValue, nodes: [String: JSONValue]) -> Bool {
        edge.text("role") == "context" || isAgent(nodes[edge.text("to")]?.text("kind") ?? "")
    }

    // MARK: Layouts

    static func layoutNames(_ canvas: JSONValue) -> [String] { canvas.list("layouts").map { $0.text("name") } }

    /// Where every node and text stands now, under a name; a layout of the same name gives way to it.
    static func savingLayout(_ canvas: JSONValue, name: String) -> JSONValue {
        var nodes: [String: JSONValue] = [:]
        for node in canvas.list("nodes") {
            let box = rect(node)
            nodes[node.stableID] = .object([
                "x": .number(box.minX), "y": .number(box.minY), "w": .number(max(1, box.width)),
                "h": .number(max(1, box.height)),
            ])
        }
        var texts: [String: JSONValue] = [:]
        for text in canvas.list("texts") {
            texts[text.stableID] = .object(["x": .number(text.number("x")), "y": .number(text.number("y"))])
        }
        let layout: JSONValue = .object(["name": .string(name), "nodes": .object(nodes), "texts": .object(texts)])
        return canvas.setting(
            "layouts", .array(canvas.list("layouts").filter { $0.text("name") != name } + [layout]))
    }

    /// Puts every node and text the layout saw back where it was; what it never saw stays, nothing comes or goes.
    static func applyingLayout(_ canvas: JSONValue, name: String) -> JSONValue {
        guard let layout = canvas.list("layouts").first(where: { $0.text("name") == name }) else { return canvas }
        let placed = { (items: [JSONValue], places: JSONValue?, keys: [String]) -> [JSONValue] in
            items.map { item in
                guard let place = places?[item.stableID] else { return item }
                return keys.reduce(item) { result, key in place[key].map { result.setting(key, $0) } ?? result }
            }
        }
        return canvas.setting("nodes", .array(placed(canvas.list("nodes"), layout["nodes"], ["x", "y", "w", "h"])))
            .setting("texts", .array(placed(canvas.list("texts"), layout["texts"], ["x", "y"])))
    }

    static func deletingLayout(_ canvas: JSONValue, name: String) -> JSONValue {
        canvas.setting("layouts", .array(canvas.list("layouts").filter { $0.text("name") != name }))
    }

    // MARK: Open as view

    /// The view a node becomes when it leaves the canvas. Its id stays the node's, which is the session's, so nothing
    /// restarts.
    static func view(for node: JSONValue) -> JSONValue {
        var view: JSONValue = .object([
            "id": .string(node.stableID), "kind": node["kind"] ?? .string("unknown"),
            "name": .string(node.text("title", fallback: node.text("kind").capitalized)),
        ])
        switch node.text("kind") {
        case "browser":
            view = view.setting("url", node["url"] ?? .string(""))
                .setting("browserOwner", node["browserOwner"])
        case "device": view = view.setting("device", node["device"])
        default:
            var metadata: [String: JSONValue] = [:]
            for key in ["cwd", "command", "resume", "provider", "account", "providerFixed", "runtimeMode", "accent"] {
                metadata[key] = node[key]
            }
            view = view.setting("node", .object(metadata))
        }
        return view
    }
}
