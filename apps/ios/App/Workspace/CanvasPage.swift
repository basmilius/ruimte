import RuimtePulsar
import SwiftUI
import UIKit

struct CanvasPage: View {
    let workspace: MobileWorkspace
    let viewID: String
    @State private var selectedID: String?
    @State private var menuID: String?
    @State private var adding = false
    @State private var listed = false
    @State private var fit = 0
    @State private var renameID: String?
    @State private var name = ""
    @State private var linkID: String?
    @State private var deleteID: String?
    private var canvas: JSONValue { workspace.views.first { $0.stableID == viewID } ?? .object([:]) }
    var body: some View {
        Group {
            if listed {
                MobileList {
                    ForEach(canvas.list("nodes"), id: \.stableID) { node in
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
            } else {
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
                        needingYou: Set(
                            canvas.list("nodes").filter { workspace.session.attention.needsYou($0.stableID) }.map(
                                \.stableID)), camera: workspace.camera(for: viewID), fit: fit, viewportInsets: insets,
                        open: { selectedID = $0 }, menu: { menuID = $0 },
                        cameraChanged: { workspace.setCamera($0, viewID: viewID) }
                    )
                }
                .overlay {
                    if canvas.list("nodes").isEmpty && canvas.list("texts").isEmpty {
                        ContentUnavailableView {
                            Label("An open canvas", lucideIcon: "layout-grid", iconSize: 48)
                        } description: {
                            Text("Add a chat, terminal, note or file to get started.")
                        } actions: {
                            Button("Add node") { adding = true }.buttonStyle(.borderedProminent)
                                .foregroundStyle(MobileStyle.onAccent)
                        }
                    }
                }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                Button(listed ? "Show canvas" : "Show list", lucideIcon: listed ? "layout-grid" : "list") {
                    listed.toggle()
                }
                Spacer()
                Button("Fit canvas", lucideIcon: "maximize-2") { fit += 1 }.disabled(listed)
                Spacer()
                Button("Add node", lucideIcon: "plus") { adding = true }
            }
        }
        .navigationDestination(item: $selectedID) { id in
            if let node = canvas.list("nodes").first(where: { $0.stableID == id }) {
                ProjectItemPage(workspace: workspace, item: node)
            }
        }
        .mobileSheet(isPresented: $adding) { AddProjectItem(workspace: workspace, canvasID: viewID) }
        .confirmationDialog(
            "Node", isPresented: Binding(get: { menuID != nil }, set: { if !$0 { menuID = nil } }),
            titleVisibility: .visible
        ) {
            if let node = canvas.list("nodes").first(where: { $0.stableID == menuID }) { nodeActions(node) }
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
        .mobileSheet(isPresented: Binding(get: { linkID != nil }, set: { if !$0 { linkID = nil } })) {
            NavigationStack {
                MobileList {
                    Section("Link to a node") {
                        ForEach(canvas.list("nodes").filter { $0.stableID != linkID }, id: \.stableID) { node in
                            Button(node.text("title")) { Task { await link(to: node.stableID) } }
                        }
                    }
                    Section("Existing connections") {
                        ForEach(
                            canvas.list("edges").filter { $0.text("from") == linkID || $0.text("to") == linkID },
                            id: \.stableID
                        ) { edge in
                            HStack {
                                Text(edgeName(edge))
                                Spacer()
                                Button("Remove", lucideIcon: "trash", role: .destructive) {
                                    Task {
                                        await workspace.updateView(viewID) {
                                            $0.setting(
                                                "edges",
                                                .array($0.list("edges").filter { $0.stableID != edge.stableID }))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }.navigationTitle("Context links").toolbar { Button("Done") { linkID = nil } }
            }
        }
        .confirmationDialog(
            "Remove this node from the canvas?",
            isPresented: Binding(get: { deleteID != nil }, set: { if !$0 { deleteID = nil } }),
            titleVisibility: .visible
        ) {
            Button("Remove node", role: .destructive) {
                guard let id = deleteID else { return }
                deleteID = nil
                Task { await workspace.updateView(viewID) { canvasWithoutNode($0, id: id) } }
            }
        } message: {
            Text("Its connections are removed too. A running session remains available on the machine.")
        }
    }
    @ViewBuilder private func nodeActions(_ node: JSONValue) -> some View {
        Button("Open", lucideIcon: "square-arrow-out-up-right") { selectedID = node.stableID }
        if node.text("kind") != "unknown" {
            Button("Rename", lucideIcon: "pencil") {
                name = node.text("title")
                renameID = node.stableID
            }
        }
        Button("Context links", lucideIcon: "link") { linkID = node.stableID }
        if ["chat", "terminal", "browser"].contains(node.text("kind")) {
            Button("Open as view", lucideIcon: "panel-left") { Task { await promote(node) } }
        }
        Button("Remove", lucideIcon: "trash", role: .destructive) { deleteID = node.stableID }
    }
    private func edgeName(_ edge: JSONValue) -> String {
        let names = [edge.text("from"), edge.text("to")].map { id in
            canvas.list("nodes").first { $0.stableID == id }?.text("title") ?? id
        }
        return names.joined(separator: " → ")
    }
    private func link(to id: String) async {
        guard let source = linkID else { return }
        await workspace.updateView(viewID) { view in
            guard !view.list("edges").contains(where: { $0.text("from") == source && $0.text("to") == id }) else {
                return view
            }
            let edge: JSONValue = .object([
                "id": .string("edge-" + UUID().uuidString), "from": .string(source), "to": .string(id),
            ])
            return view.setting("edges", .array(view.list("edges") + [edge]))
        }
        if workspace.problem == nil { linkID = nil }
    }
    private func promote(_ node: JSONValue) async {
        var view: JSONValue = .object([
            "id": .string(node.stableID), "kind": node["kind"]!, "name": .string(node.text("title")),
        ])
        if node.text("kind") == "browser" {
            view = view.setting("url", node["url"] ?? .string(""))
        } else {
            var metadata: [String: JSONValue] = [:]
            for key in ["cwd", "command", "resume", "provider", "providerFixed", "runtimeMode", "accent"] {
                metadata[key] = node[key]
            }
            view = view.setting("node", .object(metadata))
        }
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
    let statuses: [String: String]
    let tasks: [String: JSONValue]
    let unseen: Set<String>
    let needingYou: Set<String>
    let camera: JSONValue?
    let fit: Int
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
        statuses: [String: String], unseen: Set<String>, needingYou: Set<String>, tasks: [String: JSONValue] = [:]
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
    var statuses: [String: String] = [:]
    var tasks: [String: JSONValue] = [:]
    var unseen = Set<String>()
    var needingYou = Set<String>()
    private var nodes: [JSONValue] = []
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
    func hit(_ point: CGPoint) -> String? {
        let world = CGPoint(x: point.x + origin.x, y: point.y + origin.y)
        return candidates(CGRect(origin: world, size: CGSize(width: 1, height: 1))).reversed().first(where: {
            nodeRect(nodes[$0]).contains(world)
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
        context.setStrokeColor(UIColor.tertiaryLabel.cgColor)
        context.setLineWidth(1.5)
        for edge in edges {
            guard let from = nodeMap[edge.text("from")], let to = nodeMap[edge.text("to")] else { continue }
            let a = nodeRect(from)
            let b = nodeRect(to)
            guard a.union(b).intersects(viewport) else { continue }
            let start = CGPoint(x: a.midX, y: a.midY)
            let end = CGPoint(x: b.midX, y: b.midY)
            context.move(to: start)
            context.addLine(to: end)
            context.strokePath()
        }
        for index in candidates(viewport) {
            let node = nodes[index]
            let frame = nodeRect(node)
            guard frame.intersects(viewport) else { continue }
            let path = UIBezierPath(roundedRect: frame, cornerRadius: 16)
            MobileStyle.panelColor.setFill()
            path.fill()
            UIColor.separator.setStroke()
            path.lineWidth = 1
            path.stroke()
            let id = node.stableID
            if needingYou.contains(id) || statuses[id] == "running" || unseen.contains(id) {
                let color: UIColor =
                    needingYou.contains(id)
                    ? .systemOrange : statuses[id] == "running" ? .systemGreen : MobileStyle.accentColor
                color.setFill()
                UIBezierPath(ovalIn: CGRect(x: frame.maxX - 28, y: frame.minY + 20, width: 10, height: 10)).fill()
            }
            let title = node.text("title", fallback: node.text("kind"))
            drawText(
                title,
                rect: CGRect(
                    x: frame.minX + 20, y: frame.minY + 18, width: frame.width - 40, height: tasks[id] == nil ? 50 : 30),
                font: .preferredFont(forTextStyle: .headline), color: .label)
            if let task = tasks[id] {
                // The line into a task's node says so on the desktop; here the node carries the word itself.
                let status = task.text("status")
                drawText(
                    "Task: " + TaskMark.word(status),
                    rect: CGRect(x: frame.minX + 20, y: frame.minY + 50, width: frame.width - 40, height: 24),
                    font: .preferredFont(forTextStyle: .caption1), color: AgentWorkLook(taskStatus: status).uiColor)
            }
            let detail =
                node.text("kind") == "note"
                ? node.text("body")
                : node.text("kind").capitalized + (node.text("url").isEmpty ? "" : "\n" + node.text("url"))
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
    private func drawText(_ text: String, rect: CGRect, font: UIFont, color: UIColor) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        (text as NSString).draw(
            in: rect, withAttributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
    }
    private func updateAccessibility() {
        let viewport = visible.offsetBy(dx: origin.x, dy: origin.y)
        accessibilityElements = candidates(viewport).compactMap { index -> CanvasAccessibleNode? in
            let node = nodes[index]
            let rect = nodeRect(node)
            guard rect.intersects(viewport) else { return nil }
            let element = CanvasAccessibleNode(accessibilityContainer: self)
            element.accessibilityLabel =
                node.text("title") + ", " + node.text("kind")
                + (tasks[node.stableID].map { ", task " + TaskMark.word($0.text("status")) } ?? "")
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
