import CoreGraphics
import Foundation
import RuimtePulsar
import RuimteShared

/// Which gestures a canvas refuses on this client. Commands from the dock always work. A phone neither moves nor
/// resizes nodes, but it keeps those two as it read them, since the desktop writes the same local file.
struct CanvasLocks: Equatable {
    var pan = false
    var zoom = false
    var move = false
    var resize = false

    var json: JSONValue {
        .object(["pan": .bool(pan), "zoom": .bool(zoom), "move": .bool(move), "resize": .bool(resize)])
    }
    var any: Bool { pan || zoom || move || resize }
    var all: Bool { pan && zoom && move && resize }

    func locking(everything: Bool) -> CanvasLocks {
        CanvasLocks(pan: everything, zoom: everything, move: everything, resize: everything)
    }
}

extension CanvasLocks {
    /// Absent means nothing locked, which is every file written before a lock outlived a view switch.
    init(_ value: JSONValue?) {
        self.init(
            pan: value?["pan"]?.boolValue ?? false, zoom: value?["zoom"]?.boolValue ?? false,
            move: value?["move"]?.boolValue ?? false, resize: value?["resize"]?.boolValue ?? false)
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
    case openAsView, linkAsContext, groupSelection, rename, color, snooze, delete

    static func actions(for node: JSONValue) -> [CanvasNodeAction] {
        let kind = node.text("kind")
        // A kind this version does not know is kept as it is, so the menu only offers to take it away.
        guard ProjectKinds.editsOnCanvas(kind) else { return [.delete] }
        var actions: [CanvasNodeAction] = []
        if CanvasEditing.opensAsView(kind) { actions.append(.openAsView) }
        actions.append(.linkAsContext)
        if kind != "group" { actions.append(.groupSelection) }
        actions.append(.rename)
        actions.append(.color)
        if CanvasEditing.isAgent(kind) { actions.append(.snooze) }
        actions.append(.delete)
        return actions
    }
}

/// The edits a phone makes to a canvas view, as pure functions over its JSON, so the rules match the desktop's and
/// stay testable: grouping (`groupFrame` in `packages/contracts`), context links (`addEdge` in the client), layouts
/// and the view a node becomes.
enum CanvasEditing {
    static let grid = WireVocabulary.canvasGrid
    static let groupPadding = WireVocabulary.groupPadding
    static let groupHeader = WireVocabulary.groupHeader

    /// A node an agent works in, which reads what runs into it (`isAgentKind` in `packages/contracts`).
    static func isAgent(_ kind: String) -> Bool { kind == "chat" || kind == "terminal" || kind == "design" }

    /// A node folded to its header takes no new line, from or to it; the ones it has stay.
    static func isFolded(_ node: JSONValue) -> Bool { node["collapsed"]?.boolValue == true }
    static func opensAsView(_ kind: String) -> Bool { ProjectKinds.runs(kind) }

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

    /// Whether a group holds exactly the ids it spells out, as `spellsOutMembers` in `packages/contracts` reads it.
    /// 0.29 wrote `memberIds: []` on open groups it read off their frame, so an empty list counts only with
    /// `membersListed`, which 0.29 never writes.
    static func spellsOutMembers(_ group: JSONValue) -> Bool {
        if group["collapsed"]?.boolValue == true { return true }
        guard group["memberIds"] != nil else { return false }
        return !group.list("memberIds").isEmpty || group["membersListed"]?.boolValue == true
    }

    /// The group holding exactly `ids` from now on; an empty list is marked, as `withMemberIds` writes it.
    static func withMemberIds(_ group: JSONValue, _ ids: [String]) -> JSONValue {
        let listed = group.setting("memberIds", .array(ids.map { .string($0) }))
        return ids.isEmpty ? listed.setting("membersListed", .bool(true)) : listed
    }

    /// What a group holds: the ids the file spells out, open or collapsed. A group that spells out none holds
    /// the nodes whose center lies inside its frame, and of two overlapping groups only the larger holds the other.
    static func members(of group: JSONValue, in canvas: JSONValue) -> [JSONValue] {
        let nodes = canvas.list("nodes").filter { $0.stableID != group.stableID }
        if spellsOutMembers(group) {
            let ids = Set(group.list("memberIds").compactMap(\.stringValue))
            return nodes.filter { ids.contains($0.stableID) }
        }
        var frame = rect(group)
        frame.size.height = group.number("expandedHeight", fallback: frame.height)
        let area = frame.width * frame.height
        return nodes.filter { node in
            let box = rect(node)
            if node.text("kind") == "group" && box.width * box.height >= area { return false }
            return frame.contains(CGPoint(x: box.midX, y: box.midY))
        }
    }

    /// What the collapsed groups put out of sight, through the groups inside them.
    static func hiddenIDs(in canvas: JSONValue) -> Set<String> {
        var hidden = Set<String>()
        var pending = canvas.list("nodes").filter { $0.text("kind") == "group" && $0["collapsed"]?.boolValue == true }
        while let group = pending.popLast() {
            for member in members(of: group, in: canvas) where hidden.insert(member.stableID).inserted {
                if member.text("kind") == "group" { pending.append(member) }
            }
        }
        return hidden
    }

    /// The smallest open group in sight whose frame holds `point`, as a drop on the desktop picks it (`groupUnder`).
    static func groupUnder(_ point: CGPoint, in canvas: JSONValue, excluding excluded: Set<String>) -> JSONValue? {
        canvas.list("nodes")
            .filter { node in
                node.text("kind") == "group" && node["collapsed"]?.boolValue != true
                    && !excluded.contains(node.stableID) && rect(node).contains(point)
            }
            .min { rect($0).width * rect($0).height < rect($1).width * rect($1).height }
    }

    /// A group around these nodes, added in front of them; nil when none of them can be held. As on the desktop
    /// (`groupSelection`), the grouped nodes leave a group that spells them out, and the new group joins the
    /// smallest open group it stands in.
    static func grouping(_ canvas: JSONValue, ids: [String], groupID: String) -> JSONValue? {
        let wanted = Set(ids)
        let members = canvas.list("nodes").filter { wanted.contains($0.stableID) && $0.text("kind") != "group" }
        guard let frame = groupFrame(members) else { return nil }
        let memberIDs = members.map(\.stableID)
        // It holds exactly what was grouped, so nothing else that stands under the frame joins it.
        let group: JSONValue = .object([
            "id": .string(groupID), "kind": .string("group"), "title": .string("Group"),
            "x": .number(frame.minX), "y": .number(frame.minY), "w": .number(frame.width), "h": .number(frame.height),
            "memberIds": .array(memberIDs.map { .string($0) }),
        ])
        let around = groupUnder(CGPoint(x: frame.midX, y: frame.midY), in: canvas, excluding: hiddenIDs(in: canvas))
        // A group that reads its frame holds the new group by position already.
        let nodes = canvas.list("nodes").map { node -> JSONValue in
            guard node.text("kind") == "group", spellsOutMembers(node) else { return node }
            let held = node.list("memberIds").compactMap(\.stringValue)
            let kept = held.filter { !memberIDs.contains($0) }
            let joined = node.stableID == around?.stableID ? kept + [groupID] : kept
            return joined == held ? node : withMemberIds(node, joined)
        }
        return canvas.setting("nodes", .array(nodes + [group]))
    }

    // MARK: Context links

    /// Whether a line may run from one node to another: never to itself and never twice the same way.
    static func canLink(_ edges: [JSONValue], from: String, to: String) -> Bool {
        from != to && !edges.contains { $0.text("from") == from && $0.text("to") == to }
    }

    /// Gives a node one of the accents, or none. A note takes its paper from the accent and loses its old `color`,
    /// as `nodeColorPatch` in `packages/contracts` writes it.
    static func coloring(_ canvas: JSONValue, id: String, accent: String?) -> JSONValue {
        let value: JSONValue? = accent.flatMap { RuimteColors.nodeAccents[$0] == nil ? nil : .string($0) }
        return canvas.setting(
            "nodes",
            .array(
                canvas.list("nodes").map { node in
                    guard node.stableID == id, ProjectKinds.editsOnCanvas(node.text("kind")) else { return node }
                    let colored = node.setting("accent", value)
                    return node.text("kind") == "note" ? colored.setting("color", nil) : colored
                }))
    }

    /// Lets `target` read `source`. A line into an agent is labeled context; between two agents it runs both ways,
    /// as the desktop and the daemon's `link new` draw it, since each end reads only what runs into it.
    static func linking(_ canvas: JSONValue, from source: String, to target: String, newID: () -> String) -> JSONValue {
        let nodes = Dictionary(
            canvas.list("nodes").map { ($0.stableID, $0) }, uniquingKeysWith: { first, _ in first })
        guard let from = nodes[source], let to = nodes[target], !isFolded(from), !isFolded(to) else { return canvas }
        var edges = canvas.list("edges")
        // A line that already runs this way draws nothing, not even the way back that is missing.
        guard canLink(edges, from: source, to: target) else { return canvas }
        var pairs = [(from, to)]
        if isAgent(from.text("kind")) && isAgent(to.text("kind")) { pairs.append((to, from)) }
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
    static func isContext(_ edge: StoredCanvasViewEdgesItem, nodes: [String: StoredNode]) -> Bool {
        edge.role == "context" || isAgent(nodes[edge.to]?.kind.rawValue ?? "")
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
        // ProjectNodeSchema fields are placed explicitly; newer fields travel as extras, as in withNodeAsView.
        let known: Set<String> = [
            "id", "kind", "title", "titleSource", "x", "y", "w", "h", "accent", "cwd", "command", "resume",
            "provider", "account", "providerFixed", "runtimeMode", "url", "browserOwner", "device", "collapsed",
            "memberIds", "expandedHeight", "worktree", "issue", "body", "color", "viewId", "path", "raw", "machine",
        ]
        let carried = (node.objectValue ?? [:]).filter { !known.contains($0.key) }
        var view: JSONValue = .object([
            "id": .string(node.stableID), "kind": node["kind"] ?? .string("unknown"),
            "name": .string(node.text("title", fallback: node.text("kind").capitalized)),
        ])
        let kind = node.text("kind")
        if kind == "browser" || kind == "device" {
            for (key, value) in carried where view[key] == nil { view = view.setting(key, value) }
        }
        switch kind {
        case "browser":
            view = view.setting("url", node["url"] ?? .string(""))
                .setting("browserOwner", node["browserOwner"])
        case "device":
            view = view.setting("device", node["device"])
        default:
            var metadata = carried
            for key in [
                "cwd", "command", "resume", "provider", "account", "providerFixed", "runtimeMode", "accent", "issue",
            ] {
                metadata[key] = node[key]
            }
            view = view.setting("node", .object(metadata))
        }
        return view
    }
}
