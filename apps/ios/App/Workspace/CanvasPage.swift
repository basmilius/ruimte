import RuimtePulsar
import SwiftUI
import UIKit

struct CanvasPage: View {
    let workspace: MobileWorkspace
    let viewID: String
    @State private var selectedID: String?
    @State private var menuID: String?
    @State private var adding = false
    @State private var addingKind = "chat"
    @State private var listed = false
    @State private var fit = 0
    @State private var renameID: String?
    @State private var name = ""
    @State private var linkID: String?
    @State private var groupingID: String?
    @State private var savingLayout = false
    @State private var layoutName = ""
    @State private var removal: NodeRemoval?
    private var canvas: JSONValue { workspace.views.first { $0.stableID == viewID } ?? .object([:]) }
    private var nodes: [JSONValue] { canvas.list("nodes") }
    private var locks: CanvasLocks { workspace.locks(for: viewID) }
    private var status: CanvasStatus {
        let attention = workspace.session.attention
        let snoozes = workspace.session.snoozes
        return CanvasStatus(
            needsYou: nodes.map(\.stableID).filter { attention.needsYou($0) && snoozes.until($0) == nil },
            working: nodes.filter { attention.statuses[$0.stableID] == .running }.count)
    }
    var body: some View {
        Group {
            if listed {
                MobileList {
                    ForEach(nodes, id: \.stableID) { node in
                        Button {
                            selectedID = node.stableID
                        } label: {
                            Label {
                                HStack(spacing: 8) {
                                    Text(node.text("title"))
                                    if let task = workspace.session.tasks.childTask(node.stableID) {
                                        TaskMark(task: task)
                                    }
                                }
                            } icon: {
                                WorkspaceViewIcon(item: node)
                            }
                            .modifier(MobileSidebarLabel(disclosure: true))
                        }
                        .modifier(MobileSidebarRow())
                        .contextMenu { nodeActions(node) }
                    }
                }
            } else if workspace.ready {
                MobileScrollViewport { insets in
                    CanvasViewport(
                        canvas: canvas, statuses: workspace.session.attention.statuses,
                        tasks: workspace.session.tasks.tasks.values.reduce(into: [:]) { marks, task in
                            let child = task.text("childId")
                            if marks[child].map({ $0.number("createdAt") <= task.number("createdAt") }) ?? true {
                                marks[child] = task
                            }
                        },
                        unseen: workspace.session.attention.unseen,
                        needingYou: Set(status.needsYou), camera: workspace.camera(for: viewID), fit: fit,
                        locks: locks, viewportInsets: insets,
                        open: { selectedID = $0 }, menu: { menuID = $0 },
                        cameraChanged: { workspace.setCamera($0, viewID: viewID) }
                    )
                }
                .overlay {
                    if nodes.isEmpty && canvas.list("texts").isEmpty {
                        CanvasStartGrid(
                            workspace: workspace, viewID: viewID,
                            compose: { kind in
                                addingKind = kind
                                adding = true
                            },
                            added: { fit += 1 })
                    }
                }
            } else {
                MobileStyle.canvas.ignoresSafeArea()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            CanvasDock(
                status: status, locks: locks, layouts: CanvasEditing.layoutNames(canvas),
                add: { kind in
                    addingKind = kind
                    adding = true
                },
                fit: {
                    listed = false
                    fit += 1
                },
                openNext: { selectedID = status.next(after: selectedID) },
                setLocks: { workspace.setLocks($0, viewID: viewID) },
                applyLayout: { name in
                    Task { await workspace.updateView(viewID) { CanvasEditing.applyingLayout($0, name: name) } }
                },
                deleteLayout: { name in
                    Task { await workspace.updateView(viewID) { CanvasEditing.deletingLayout($0, name: name) } }
                },
                saveLayout: {
                    layoutName = ""
                    savingLayout = true
                }
            )
            .disabled(!workspace.ready)
        }
        .toolbar {
            ToolbarItem(id: "canvas.actions", placement: .topBarTrailing) {
                Button(
                    listed ? String(localized: "Show canvas") : String(localized: "Show as a list"),
                    lucideIcon: listed ? "layout-grid" : "list"
                ) {
                    listed.toggle()
                }
            }
        }
        .navigationDestination(item: $selectedID) { id in
            if let node = nodes.first(where: { $0.stableID == id }) {
                ProjectItemPage(workspace: workspace, item: node)
            }
        }
        .mobileSheet(isPresented: $adding) { AddProjectItem(workspace: workspace, canvasID: viewID, kind: addingKind) }
        .confirmationDialog(
            nodes.first(where: { $0.stableID == menuID })?.text("title") ?? String(localized: "Node"),
            isPresented: Binding(get: { menuID != nil }, set: { if !$0 { menuID = nil } }),
            titleVisibility: .visible
        ) {
            if let node = nodes.first(where: { $0.stableID == menuID }) { nodeActions(node) }
        }
        .alert("Rename node", isPresented: Binding(get: { renameID != nil }, set: { if !$0 { renameID = nil } })) {
            TextField("Title", text: $name)
            Button("Save") {
                let id = renameID
                renameID = nil
                Task {
                    await workspace.updateView(viewID) { view in
                        view.setting(
                            "nodes",
                            .array(
                                view.list("nodes").map {
                                    $0.stableID == id
                                        ? $0.setting("title", .string(name)).setting("titleSource", .string("user"))
                                        : $0
                                }))
                    }
                }
            }
            Button("Cancel", role: .cancel) { renameID = nil }
        }
        .alert("Save layout", isPresented: $savingLayout) {
            TextField("Name", text: $layoutName)
            Button("Save") {
                let name = layoutName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { return }
                Task { await workspace.updateView(viewID) { CanvasEditing.savingLayout($0, name: name) } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Where every node stands now. A layout with this name is replaced.")
        }
        .mobileSheet(isPresented: Binding(get: { linkID != nil }, set: { if !$0 { linkID = nil } })) {
            if let linkID {
                CanvasLinkSheet(workspace: workspace, viewID: viewID, sourceID: linkID) { self.linkID = nil }
            }
        }
        .mobileSheet(isPresented: Binding(get: { groupingID != nil }, set: { if !$0 { groupingID = nil } })) {
            if let groupingID {
                CanvasGroupSheet(workspace: workspace, viewID: viewID, firstID: groupingID) { self.groupingID = nil }
            }
        }
        .alert(
            "Remove this node from the canvas?",
            isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }),
            presenting: removal
        ) { pending in
            Button(pending.confirmLabel, role: .destructive) {
                removal = nil
                Task {
                    await workspace.updateView(viewID) { canvasWithoutNode($0, id: pending.id) }
                    if workspace.problem == nil { await SessionEnding.end(pending.question, session: workspace.session) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { pending in
            Text(
                pending.question.warning.map {
                    String(
                        localized: "\($0) Its connections are removed too.",
                        comment: "%@ says which chats and terminals end with the node")
                } ?? String(localized: "Its connections are removed too."))
        }
    }
    @ViewBuilder private func nodeActions(_ node: JSONValue) -> some View {
        ForEach(CanvasNodeAction.actions(for: node), id: \.self) { action in
            switch action {
            case .openAsView:
                Button {
                    Task { await promote(node) }
                } label: {
                    Label(String(localized: "Open as view"), lucideIcon: "maximize-2")
                    Text("Keeps its session")
                }
            case .linkAsContext:
                Button(String(localized: "Link as context"), lucideIcon: "link") { linkID = node.stableID }
            case .groupSelection:
                Button(String(localized: "Group selection"), lucideIcon: "layout-grid") { groupingID = node.stableID }
            case .rename:
                Button(String(localized: "Rename"), lucideIcon: "pencil") {
                    name = node.text("title")
                    renameID = node.stableID
                }
            case .snooze:
                let snoozes = workspace.session.snoozes
                SnoozeMenu(until: snoozes.until(node.stableID)) {
                    snoozes.snooze(node.stableID, until: $0)
                } wake: {
                    snoozes.clear(node.stableID)
                }
            case .delete:
                Button(String(localized: "Delete"), lucideIcon: "trash", role: .destructive) {
                    Task {
                        let question = await SessionEnding.question(for: node, client: workspace.client)
                        removal = NodeRemoval(id: node.stableID, question: question)
                    }
                }
            }
        }
    }
    private func promote(_ node: JSONValue) async {
        let view = CanvasEditing.view(for: node)
        await workspace.edit { document in
            var views = document.list("views").map {
                $0.stableID == viewID ? canvasWithoutNode($0, id: node.stableID) : $0
            }
            let index = views.firstIndex { $0.stableID == viewID } ?? (views.count - 1)
            views.insert(view, at: index + 1)
            return document.setting("views", .array(views))
        }
        workspace.select(node.stableID)
    }
}

/// Picks the node that reads this one, and lists the links it already has.
private struct CanvasLinkSheet: View {
    let workspace: MobileWorkspace
    let viewID: String
    let sourceID: String
    let done: () -> Void
    private var canvas: JSONValue { workspace.views.first { $0.stableID == viewID } ?? .object([:]) }
    private var source: JSONValue? { canvas.list("nodes").first { $0.stableID == sourceID } }
    private var targets: [JSONValue] {
        let others = canvas.list("nodes").filter {
            CanvasEditing.canLink(canvas.list("edges"), from: sourceID, to: $0.stableID)
        }
        return others.filter { CanvasEditing.isAgent($0.text("kind")) }
            + others.filter { !CanvasEditing.isAgent($0.text("kind")) }
    }
    private var links: [JSONValue] {
        canvas.list("edges").filter { $0.text("from") == sourceID || $0.text("to") == sourceID }
    }

    var body: some View {
        NavigationStack {
            MobileList {
                Section {
                    ForEach(targets, id: \.stableID) { node in
                        Button {
                            Task {
                                await workspace.updateView(viewID) {
                                    CanvasEditing.linking($0, from: sourceID, to: node.stableID) {
                                        "edge-" + UUID().uuidString
                                    }
                                }
                                if workspace.problem == nil { done() }
                            }
                        } label: {
                            Label {
                                Text(node.text("title")).foregroundStyle(MobileStyle.text)
                            } icon: {
                                WorkspaceViewIcon(item: node)
                            }
                        }
                    }
                } header: {
                    Text("Who reads \(source?.text("title") ?? String(localized: "this node"))")
                } footer: {
                    Text(
                        "An agent reads what a line runs into it from, with ruimte-context. Between two agents the line runs both ways."
                    )
                }
                if !links.isEmpty {
                    Section("Links") {
                        ForEach(links, id: \.stableID) { edge in
                            HStack {
                                Text(edgeName(edge))
                                Spacer()
                                Button(String(localized: "Remove"), lucideIcon: "trash", role: .destructive) {
                                    Task {
                                        await workspace.updateView(viewID) {
                                            $0.setting(
                                                "edges",
                                                .array($0.list("edges").filter { $0.stableID != edge.stableID }))
                                        }
                                    }
                                }
                                .labelStyle(.iconOnly)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Link as context").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done", action: done) } }
        }
    }

    private func edgeName(_ edge: JSONValue) -> String {
        let name: (String) -> String = { id in
            canvas.list("nodes").first { $0.stableID == id }?.text("title") ?? id
        }
        let from = name(edge.text("from"))
        let to = name(edge.text("to"))
        return String(localized: "\(from) to \(to)", comment: "A line between two nodes on a canvas")
    }
}

/// Picks the nodes a new group frames, starting from the one the menu was opened on.
private struct CanvasGroupSheet: View {
    let workspace: MobileWorkspace
    let viewID: String
    let done: () -> Void
    @State private var picked: Set<String>
    private var nodes: [JSONValue] {
        (workspace.views.first { $0.stableID == viewID }?.list("nodes") ?? []).filter { $0.text("kind") != "group" }
    }

    init(workspace: MobileWorkspace, viewID: String, firstID: String, done: @escaping () -> Void) {
        self.workspace = workspace
        self.viewID = viewID
        self.done = done
        _picked = State(initialValue: [firstID])
    }

    var body: some View {
        NavigationStack {
            MobileList {
                Section {
                    ForEach(nodes, id: \.stableID) { node in
                        Button {
                            if picked.contains(node.stableID) {
                                picked.remove(node.stableID)
                            } else {
                                picked.insert(node.stableID)
                            }
                        } label: {
                            HStack {
                                Label {
                                    Text(node.text("title")).foregroundStyle(MobileStyle.text)
                                } icon: {
                                    WorkspaceViewIcon(item: node)
                                }
                                Spacer()
                                if picked.contains(node.stableID) {
                                    Image(lucide: "check").foregroundStyle(MobileStyle.accent)
                                }
                            }
                        }
                        .accessibilityAddTraits(picked.contains(node.stableID) ? .isSelected : [])
                    }
                } footer: {
                    Text("The group is a frame around them, with room for its title.")
                }
            }
            .navigationTitle("Group selection").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: done) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Group") {
                        let ids = nodes.map(\.stableID).filter { picked.contains($0) }
                        Task {
                            await workspace.updateView(viewID) {
                                CanvasEditing.grouping($0, ids: ids, groupID: "group-" + UUID().uuidString) ?? $0
                            }
                            if workspace.problem == nil { done() }
                        }
                    }
                    .disabled(picked.isEmpty)
                }
            }
        }
    }
}

private struct NodeRemoval {
    let id: String
    let question: SessionEnding.Question

    var confirmLabel: String {
        if !question.chats.isEmpty { return String(localized: "Remove and end chat") }
        return question.terminals.isEmpty
            ? String(localized: "Remove node") : String(localized: "Remove and end terminal")
    }
}

func canvasWithoutNode(_ canvas: JSONValue, id: String) -> JSONValue {
    canvas.setting(
        "nodes",
        .array(
            canvas.list("nodes").filter { $0.stableID != id }.map { node in
                node.text("kind") == "group"
                    ? node.setting("memberIds", .array(node.list("memberIds").filter { $0.stringValue != id })) : node
            })
    ).setting("edges", .array(canvas.list("edges").filter { $0.text("from") != id && $0.text("to") != id }))
        .setting("layouts", .array(canvas.list("layouts").map { $0.setting("nodes", $0["nodes"]?.setting(id, nil)) }))
}

private struct CanvasViewport: UIViewRepresentable {
    let canvas: JSONValue
    let statuses: [String: AgentStatus]
    let tasks: [String: JSONValue]
    let unseen: Set<String>
    let needingYou: Set<String>
    let camera: JSONValue?
    let fit: Int
    let locks: CanvasLocks
    let viewportInsets: UIEdgeInsets
    let open: (String) -> Void
    let menu: (String) -> Void
    let cameraChanged: (JSONValue) -> Void
    func makeUIView(context: Context) -> CanvasScrollView { CanvasScrollView() }
    func updateUIView(_ view: CanvasScrollView, context: Context) {
        view.contentInset = viewportInsets
        view.scrollIndicatorInsets = viewportInsets
        view.setAttention(statuses: statuses, unseen: unseen, needingYou: needingYou, tasks: tasks)
        view.open = open
        view.menu = menu
        view.cameraChanged = cameraChanged
        // Only gestures are refused; fitting from the dock moves the camera all the same.
        view.isScrollEnabled = !locks.pan
        view.pinchGestureRecognizer?.isEnabled = !locks.zoom
        view.update(canvas, camera: camera, fit: fit)
    }
}

final class CanvasScrollView: UIScrollView, UIScrollViewDelegate {
    private let surface = CanvasSurface()
    private var content: JSONValue?
    private var fitToken = -1
    private var restored = false
    private var initialCamera: JSONValue?
    private var adjusting = false
    var open: (String) -> Void = { _ in }
    var menu: (String) -> Void = { _ in }
    var cameraChanged: (JSONValue) -> Void = { _ in }
    var visibleNodeCount: Int { surface.accessibilityElements?.count ?? 0 }
    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        contentInsetAdjustmentBehavior = .never
        minimumZoomScale = 0.1
        maximumZoomScale = 4
        alwaysBounceVertical = true
        alwaysBounceHorizontal = true
        backgroundColor = MobileStyle.canvasColor
        addSubview(surface)
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped(_:))))
        addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(held(_:))))
        surface.open = { [weak self] id in self?.open(id) }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func update(_ document: JSONValue, camera: JSONValue?, fit: Int) {
        if content != document {
            let center = worldCenter
            let hadContent = content != nil
            content = document
            adjusting = true
            setZoomScale(1, animated: false)
            surface.configure(document)
            contentSize = surface.bounds.size
            if hadContent { apply(center: center, zoom: previousZoom) }
            adjusting = false
            if !hadContent {
                restored = false
                initialCamera = camera
                setNeedsLayout()
            }
        }
        if fitToken != fit {
            if fitToken >= 0 {
                restored = false
                initialCamera = nil
            }
            fitToken = fit
            setNeedsLayout()
        }
        updateVisible()
    }
    func setAttention(
        statuses: [String: AgentStatus], unseen: Set<String>, needingYou: Set<String>, tasks: [String: JSONValue] = [:]
    ) {
        surface.statuses = statuses
        surface.tasks = tasks
        surface.unseen = unseen
        surface.needingYou = needingYou
        surface.redraw()
    }
    private var previousZoom: CGFloat = 1
    override func layoutSubviews() {
        super.layoutSubviews()
        guard content != nil, bounds.width > 0, bounds.height > 0 else { return }
        if !restored {
            adjusting = true
            if let camera = initialCamera, let center = camera["center"] {
                apply(
                    center: CGPoint(x: center.number("x"), y: center.number("y")),
                    zoom: camera.number("zoom", fallback: 1))
            } else {
                let fitBounds = surface.worldBounds
                let viewport = bounds.inset(by: contentInset)
                let zoom = min(
                    1,
                    min(
                        (viewport.width - 48) / max(1, fitBounds.width),
                        (viewport.height - 48) / max(1, fitBounds.height)))
                apply(center: CGPoint(x: fitBounds.midX, y: fitBounds.midY), zoom: zoom)
            }
            restored = true
            adjusting = false
        }
        updateVisible()
    }
    private var worldCenter: CGPoint {
        CGPoint(
            x: bounds.inset(by: contentInset).midX / zoomScale + surface.origin.x,
            y: bounds.inset(by: contentInset).midY / zoomScale + surface.origin.y)
    }
    private func apply(center: CGPoint, zoom: CGFloat) {
        let center = CGPoint(
            x: max(-10_000_000, min(10_000_000, center.x)), y: max(-10_000_000, min(10_000_000, center.y)))
        setZoomScale(max(minimumZoomScale, min(maximumZoomScale, zoom)), animated: false)
        contentOffset = CGPoint(
            x: (center.x - surface.origin.x) * zoomScale - contentInset.left - bounds.inset(by: contentInset).width / 2,
            y: (center.y - surface.origin.y) * zoomScale - contentInset.top - bounds.inset(by: contentInset).height / 2)
        previousZoom = zoomScale
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { surface }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { changed() }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { changed() }
    private func changed() {
        updateVisible()
        guard restored, !adjusting else { return }
        previousZoom = zoomScale
        let center = worldCenter
        cameraChanged(
            .object(["center": .object(["x": .number(center.x), "y": .number(center.y)]), "zoom": .number(zoomScale)]))
    }
    private func updateVisible() {
        surface.drawingScale = traitCollection.displayScale * zoomScale
        surface.visible = convert(bounds, to: surface)
    }
    @objc private func tapped(_ gesture: UITapGestureRecognizer) {
        if let id = surface.hit(gesture.location(in: surface)) { open(id) }
    }
    @objc private func held(_ gesture: UILongPressGestureRecognizer) {
        if gesture.state == .began, let id = surface.hit(gesture.location(in: surface)) { menu(id) }
    }
}

private final class CanvasAccessibleNode: UIAccessibilityElement {
    var action: () -> Void = {}
    override func accessibilityActivate() -> Bool {
        action()
        return true
    }
}

private final class CanvasSurface: UIView {
    var origin = CGPoint.zero
    var worldBounds = CGRect(x: 0, y: 0, width: 480, height: 320)
    var drawingScale: CGFloat = 2 {
        didSet { if oldValue != drawingScale { updateDrawing() } }
    }
    var visible = CGRect.zero {
        didSet {
            if oldValue != visible {
                updateDrawing()
                updateAccessibility()
            }
        }
    }
    private let drawing = CanvasDrawing()
    var open: (String) -> Void = { _ in }
    var statuses: [String: AgentStatus] = [:]
    var tasks: [String: JSONValue] = [:]
    var unseen = Set<String>()
    var needingYou = Set<String>()
    private var nodes: [JSONValue] = []
    /// Groups first, so their frames lie under the nodes they hold.
    private var drawOrder: [Int] = []
    private var texts: [JSONValue] = []
    private var edges: [JSONValue] = []
    private var nodeMap: [String: JSONValue] = [:]
    private var grid: [String: [Int]] = [:]
    private let tile: CGFloat = 800
    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        isAccessibilityElement = false
        addSubview(drawing)
        drawing.paint = { [weak self] context in self?.drawScene(context) }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    private func nodeRect(_ node: JSONValue) -> CGRect {
        func bounded(_ value: Double) -> CGFloat { max(-10_000_000, min(10_000_000, value)) }
        return CGRect(
            x: bounded(node.number("x")), y: bounded(node.number("y")),
            width: max(1, bounded(node.number("w", fallback: 320))),
            height: max(1, bounded(node.number("h", fallback: 200))))
    }
    func configure(_ canvas: JSONValue) {
        nodes = canvas.list("nodes")
        drawOrder = nodes.indices.sorted { lhs, rhs in
            let lhsGroup = nodes[lhs].text("kind") == "group"
            let rhsGroup = nodes[rhs].text("kind") == "group"
            return lhsGroup != rhsGroup ? lhsGroup : lhs < rhs
        }
        texts = canvas.list("texts")
        edges = canvas.list("edges")
        nodeMap = Dictionary(nodes.map { ($0.stableID, $0) }, uniquingKeysWith: { _, last in last })
        worldBounds = (nodes + texts).reduce(CGRect.null) { $0.union(nodeRect($1)) }
        if worldBounds.isNull { worldBounds = CGRect(x: 0, y: 0, width: 480, height: 320) }
        let extent = worldBounds.insetBy(dx: -1800, dy: -1800)
        origin = extent.origin
        frame = CGRect(origin: .zero, size: extent.size)
        grid.removeAll()
        for (index, node) in nodes.enumerated() {
            for key in cells(nodeRect(node)) { grid[key, default: []].append(index) }
        }
        updateDrawing()
        updateAccessibility()
    }
    private func cells(_ rect: CGRect) -> [String] {
        guard !rect.isNull, rect.minX.isFinite, rect.minY.isFinite, rect.maxX.isFinite, rect.maxY.isFinite else {
            return []
        }
        guard [rect.minX, rect.maxX, rect.minY, rect.maxY].allSatisfy({ abs($0) <= 1_000_000_000 }) else {
            return ["large"]
        }
        let x0 = Int(floor(rect.minX / tile))
        let x1 = Int(floor(rect.maxX / tile))
        let y0 = Int(floor(rect.minY / tile))
        let y1 = Int(floor(rect.maxY / tile))
        // Very large frames stay out of the index rather than allocating millions of buckets.
        guard x1 - x0 < 64, y1 - y0 < 64 else { return ["large"] }
        return (x0...x1).flatMap { x in (y0...y1).map { "\(x),\($0)" } }
    }
    private func candidates(_ rect: CGRect) -> [Int] {
        let keys = cells(rect)
        if keys == ["large"] { return Array(nodes.indices) }
        return Set((keys + ["large"]).flatMap { grid[$0] ?? [] }).sorted()
    }
    /// The node under a point, front first; a group only answers on its title band, so a tap inside its frame
    /// reaches what it holds or the canvas.
    func hit(_ point: CGPoint) -> String? {
        let world = CGPoint(x: point.x + origin.x, y: point.y + origin.y)
        let order = Dictionary(uniqueKeysWithValues: drawOrder.enumerated().map { ($1, $0) })
        return candidates(CGRect(origin: world, size: CGSize(width: 1, height: 1)))
            .sorted { order[$0, default: 0] > order[$1, default: 0] }
            .first(where: { index in
                let frame = nodeRect(nodes[index])
                guard nodes[index].text("kind") == "group" else { return frame.contains(world) }
                return CGRect(x: frame.minX, y: frame.minY, width: frame.width, height: CanvasEditing.groupHeader)
                    .contains(world)
            }).map { nodes[$0].stableID }
    }
    func redraw() { drawing.setNeedsDisplay() }
    private func updateDrawing() {
        // A canvas-sized backing image grows with distant nodes. Only the viewport gets pixels.
        drawing.contentScaleFactor = max(0.05, drawingScale)
        let viewport = visible.intersection(bounds)
        drawing.frame = viewport.isNull ? .zero : viewport
        drawing.setNeedsDisplay()
    }
    private func drawScene(_ context: CGContext) {
        let viewport = visible.offsetBy(dx: origin.x, dy: origin.y).insetBy(dx: -96, dy: -96)
        context.translateBy(x: -origin.x - drawing.frame.minX, y: -origin.y - drawing.frame.minY)
        let visibleIndices = Set(candidates(viewport))
        for index in drawOrder where visibleIndices.contains(index) && nodes[index].text("kind") == "group" {
            drawGroup(nodes[index], viewport: viewport)
        }
        drawEdges(viewport: viewport)
        for index in drawOrder where visibleIndices.contains(index) && nodes[index].text("kind") != "group" {
            let node = nodes[index]
            let frame = nodeRect(node)
            guard frame.intersects(viewport) else { continue }
            let path = UIBezierPath(roundedRect: frame, cornerRadius: 16)
            if node.text("kind") == "note" {
                CanvasSurface.noteColor(node.text("color")).setFill()
            } else {
                MobileStyle.panelColor.setFill()
            }
            path.fill()
            UIColor.separator.setStroke()
            path.lineWidth = 1
            path.stroke()
            let id = node.stableID
            if needingYou.contains(id) || statuses[id] == .running || unseen.contains(id) {
                let color: UIColor =
                    needingYou.contains(id)
                    ? MobileStyle.statusNeedsYouColor
                    : statuses[id] == .running ? MobileStyle.statusRunningColor : MobileStyle.accentColor
                color.setFill()
                UIBezierPath(ovalIn: CGRect(x: frame.maxX - 28, y: frame.minY + 20, width: 10, height: 10)).fill()
            }
            let title = node.text("title", fallback: NewViewFactory.kindTitle(node.text("kind")))
            drawText(
                title,
                rect: CGRect(
                    x: frame.minX + 20, y: frame.minY + 18, width: frame.width - 40, height: tasks[id] == nil ? 50 : 30),
                font: .preferredFont(forTextStyle: .headline), color: .label)
            if let task = tasks[id] {
                // The line into a task's node says so on the desktop; here the node carries the word itself.
                let status = TaskMark.status(task)
                drawText(
                    String(localized: "Task: \(TaskMark.word(status))", comment: "%@ is the status of the task"),
                    rect: CGRect(x: frame.minX + 20, y: frame.minY + 50, width: frame.width - 40, height: 24),
                    font: .preferredFont(forTextStyle: .caption1), color: AgentWorkLook(taskStatus: status).uiColor)
            }
            let detail =
                node.text("kind") == "note"
                ? node.text("body")
                : NewViewFactory.kindTitle(node.text("kind"))
                    + (node.text("url").isEmpty ? "" : "\n" + node.text("url"))
            drawText(
                detail,
                rect: CGRect(
                    x: frame.minX + 20, y: frame.minY + 74, width: frame.width - 40, height: max(0, frame.height - 94)),
                font: .preferredFont(forTextStyle: .body), color: .secondaryLabel)
        }
        for text in texts {
            let frame = nodeRect(text)
            if frame.intersects(viewport) {
                drawText(
                    text.text("text"), rect: frame, font: .systemFont(ofSize: text.number("fontSize", fallback: 24)),
                    color: .label)
            }
        }
    }
    /// The paper a note takes, by the names the desktop offers; a name this version does not know reads as yellow.
    static func noteColor(_ name: String) -> UIColor {
        let tone: UIColor =
            switch name {
            case "green": .systemGreen
            case "blue": .systemBlue
            case "pink": .systemPink
            case "gray": .systemGray
            default: .systemYellow
            }
        return UIColor { traits in
            MobileStyle.panelColor.resolvedColor(with: traits).blended(
                with: tone.resolvedColor(with: traits), share: traits.userInterfaceStyle == .dark ? 0.3 : 0.22)
        }
    }

    /// A group is a frame with its title in a chip on the band at its top.
    private func drawGroup(_ group: JSONValue, viewport: CGRect) {
        let frame = nodeRect(group)
        guard frame.intersects(viewport) else { return }
        let collapsed = group["collapsed"]?.boolValue == true
        let tint = MobileStyle.accentColor
        let path = UIBezierPath(roundedRect: frame, cornerRadius: 18)
        tint.withAlphaComponent(collapsed ? 0.14 : 0.06).setFill()
        path.fill()
        tint.withAlphaComponent(0.45).setStroke()
        path.lineWidth = 1.5
        path.stroke()
        let font = UIFont.preferredFont(forTextStyle: .subheadline).withWeight(.semibold)
        let title = group.text("title", fallback: String(localized: "Group"))
        let width = min(frame.width - 24, (title as NSString).size(withAttributes: [.font: font]).width + 20)
        let chip = CGRect(x: frame.minX + 12, y: frame.minY + 8, width: max(0, width), height: font.lineHeight + 8)
        tint.withAlphaComponent(0.22).setFill()
        UIBezierPath(roundedRect: chip, cornerRadius: chip.height / 2).fill()
        drawText(title, rect: chip.insetBy(dx: 10, dy: 4), font: font, color: tint)
    }

    /// Lines between nodes. One an agent reads along is amber and carries its label in a chip halfway.
    private func drawEdges(viewport: CGRect) {
        for edge in edges {
            guard let from = nodeMap[edge.text("from")], let to = nodeMap[edge.text("to")] else { continue }
            let a = nodeRect(from)
            let b = nodeRect(to)
            guard a.union(b).intersects(viewport) else { continue }
            let context = CanvasEditing.isContext(edge, nodes: nodeMap)
            let color = context ? MobileStyle.statusNeedsYouColor : UIColor.tertiaryLabel
            let start = CGPoint(x: a.midX, y: a.midY)
            let end = CGPoint(x: b.midX, y: b.midY)
            let line = UIBezierPath()
            line.move(to: start)
            line.addLine(to: end)
            line.lineWidth = context ? 2 : 1.5
            color.setStroke()
            line.stroke()
            let label = edge.text("label")
            guard !label.isEmpty else { continue }
            let font = UIFont.preferredFont(forTextStyle: .caption1).withWeight(.semibold)
            let size = (label as NSString).size(withAttributes: [.font: font])
            let chip = CGRect(
                x: (start.x + end.x) / 2 - size.width / 2 - 8, y: (start.y + end.y) / 2 - size.height / 2 - 3,
                width: size.width + 16, height: size.height + 6)
            MobileStyle.canvasColor.setFill()
            let shape = UIBezierPath(roundedRect: chip, cornerRadius: chip.height / 2)
            shape.fill()
            color.setStroke()
            shape.lineWidth = 1
            shape.stroke()
            drawText(label, rect: chip.insetBy(dx: 8, dy: 3), font: font, color: color)
        }
    }

    private func drawText(_ text: String, rect: CGRect, font: UIFont, color: UIColor) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        (text as NSString).draw(
            in: rect, withAttributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
    }
    private func updateAccessibility() {
        let viewport = visible.offsetBy(dx: origin.x, dy: origin.y)
        accessibilityElements = drawOrder.filter(Set(candidates(viewport)).contains).compactMap {
            index -> CanvasAccessibleNode? in

            let node = nodes[index]
            let rect = nodeRect(node)
            guard rect.intersects(viewport) else { return nil }
            let element = CanvasAccessibleNode(accessibilityContainer: self)
            let title = node.text("title")
            let kind = NewViewFactory.kindTitle(node.text("kind"))
            if let task = tasks[node.stableID] {
                let word = TaskMark.word(TaskMark.status(task))
                element.accessibilityLabel = String(
                    localized: "\(title), \(kind), task \(word)",
                    comment: "A node on a canvas: its title, its kind and the status of its task")
            } else {
                element.accessibilityLabel = "\(title), \(kind)"
            }
            element.accessibilityTraits = .button
            element.accessibilityFrameInContainerSpace = rect.offsetBy(dx: -origin.x, dy: -origin.y)
            element.action = { [weak self] in self?.open(node.stableID) }
            return element
        }
    }
}

private final class CanvasDrawing: UIView {
    var paint: (CGContext) -> Void = { _ in }
    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func draw(_ rect: CGRect) { if let context = UIGraphicsGetCurrentContext() { paint(context) } }
}

extension UIFont {
    fileprivate func withWeight(_ weight: UIFont.Weight) -> UIFont { .systemFont(ofSize: pointSize, weight: weight) }
}

extension UIColor {
    /// This color with `share` of another mixed in, both resolved already.
    fileprivate func blended(with other: UIColor, share: CGFloat) -> UIColor {
        var (red, green, blue, alpha) = (CGFloat(0), CGFloat(0), CGFloat(0), CGFloat(0))
        var (otherRed, otherGreen, otherBlue, otherAlpha) = (CGFloat(0), CGFloat(0), CGFloat(0), CGFloat(0))
        getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        other.getRed(&otherRed, green: &otherGreen, blue: &otherBlue, alpha: &otherAlpha)
        let mix = { (base: CGFloat, added: CGFloat) in base + (added - base) * share }
        return UIColor(
            red: mix(red, otherRed), green: mix(green, otherGreen), blue: mix(blue, otherBlue), alpha: alpha)
    }
}
