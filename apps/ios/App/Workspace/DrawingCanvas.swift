import RuimtePulsar
import SwiftUI
import UIKit

struct DrawingViewportRequest: Identifiable {
    enum Action {
        case fitAll, fitSelection
        case scale(Double)
        case step(Double)
    }
    let id = UUID()
    let action: Action
}

struct DrawingCanvas: UIViewRepresentable {
    let model: DrawingEditorModel
    let scene: JSONValue
    let viewportInsets: UIEdgeInsets
    let viewportRequest: DrawingViewportRequest?
    let editText: (JSONValue, Bool) -> Void
    let showStyle: () -> Void
    func makeUIView(context: Context) -> DrawingCanvasScrollView { DrawingCanvasScrollView() }
    func updateUIView(_ view: DrawingCanvasScrollView, context: Context) {
        view.contentInset = viewportInsets
        view.scrollIndicatorInsets = viewportInsets
        view.configure(model: model, scene: scene, request: viewportRequest, editText: editText, showStyle: showStyle)
    }
}

final class DrawingCanvasScrollView: UIScrollView, UIScrollViewDelegate {
    private let surface = DrawingInputSurface()
    private var displayed: JSONValue?
    private var initialBounds: CGRect?
    private var requestID: UUID?
    private weak var model: DrawingEditorModel?
    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        contentInsetAdjustmentBehavior = .never
        minimumZoomScale = 0.1
        maximumZoomScale = 8
        backgroundColor = .systemBackground
        delaysContentTouches = false
        addSubview(surface)
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(editAtTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        addGestureRecognizer(doubleTap)
        accessibilityLabel = "Drawing canvas"
        accessibilityHint =
            "Drag to move the canvas. Choose Select to edit objects, or a drawing tool to create them. Pinch to zoom."
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func configure(
        model: DrawingEditorModel, scene: JSONValue, request: DrawingViewportRequest?,
        editText: @escaping (JSONValue, Bool) -> Void, showStyle: @escaping () -> Void
    ) {
        self.model = model
        surface.model = model
        surface.editText = editText
        surface.showStyle = showStyle
        surface.zoom = zoomScale
        surface.requestViewport = { [weak self] action in self?.apply(action) }
        panGestureRecognizer.minimumNumberOfTouches = model.tool == .pan ? 1 : 2
        panGestureRecognizer.allowedTouchTypes = (model.tool == .pan ? [UITouch.TouchType.direct, .pencil] : [.direct])
            .map { NSNumber(value: $0.rawValue) }
        if displayed != scene {
            let first = displayed == nil
            displayed = scene
            let rect = scene["bounds"] ?? .object([:])
            if first {
                initialBounds = CGRect(
                    x: rect.number("x"), y: rect.number("y"), width: max(100, rect.number("w")),
                    height: max(100, rect.number("h")))
            }
            let scale = zoomScale
            let offset = contentOffset
            setZoomScale(1, animated: false)
            surface.setDocumentScene(scene)
            contentSize = surface.bounds.size
            setZoomScale(scale, animated: false)
            contentOffset = offset
            setNeedsLayout()
        }
        surface.refreshSelection()
        if let request, request.id != requestID {
            requestID = request.id
            apply(request.action)
        }
    }
    private func apply(_ action: DrawingViewportRequest.Action) {
        guard let model else { return }
        switch action {
        case .fitAll: if let bounds = DrawingGeometry.bounds(model.elements) { fit(bounds) }
        case .fitSelection: if let bounds = DrawingGeometry.bounds(model.selected) { fit(bounds) }
        case .scale(let scale): zoom(to: scale)
        case .step(let delta): zoom(to: zoomScale + delta)
        }
    }
    private func zoom(to scale: Double) {
        let visible = bounds.inset(by: contentInset)
        let center = convert(CGPoint(x: visible.midX, y: visible.midY), to: surface)
        let scale = min(maximumZoomScale, max(minimumZoomScale, scale))
        zoom(
            to: CGRect(
                x: center.x - visible.width / scale / 2, y: center.y - visible.height / scale / 2,
                width: visible.width / scale, height: visible.height / scale), animated: true)
    }
    private func fit(_ rect: CGRect, animated: Bool = true) {
        let viewport = bounds.inset(by: contentInset)
        guard viewport.width > 0, viewport.height > 0 else { return }
        let scale = min(
            4,
            max(
                minimumZoomScale,
                min((viewport.width - 64) / max(100, rect.width), (viewport.height - 64) / max(100, rect.height))))
        let target = CGPoint(x: rect.midX - surface.documentOrigin.x + 32, y: rect.midY - surface.documentOrigin.y + 32)
        setZoomScale(scale, animated: animated)
        setContentOffset(
            CGPoint(
                x: target.x * scale - contentInset.left - viewport.width / 2,
                y: target.y * scale - contentInset.top - viewport.height / 2), animated: animated)
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        if let initialBounds, bounds.width > 0, bounds.height > 0 {
            self.initialBounds = nil
            fit(initialBounds, animated: false)
        }
        updateDrawing()
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { surface }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { updateDrawing() }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { updateDrawing() }
    private func updateDrawing() {
        surface.zoom = zoomScale
        surface.show(convert(bounds, to: surface), scale: traitCollection.displayScale * zoomScale)
        surface.refreshSelection()
        let viewport = bounds.inset(by: contentInset)
        model?.viewportCenter = surface.documentPoint(convert(CGPoint(x: viewport.midX, y: viewport.midY), to: surface))
    }
    @objc private func editAtTap(_ gesture: UITapGestureRecognizer) {
        surface.edit(at: surface.documentPoint(gesture.location(in: surface)))
    }
}

private final class DrawingInputSurface: SceneSurface, UIPencilInteractionDelegate {
    weak var model: DrawingEditorModel?
    var editText: ((JSONValue, Bool) -> Void)?
    var showStyle: (() -> Void)?
    var requestViewport: ((DrawingViewportRequest.Action) -> Void)?
    var zoom: CGFloat = 1
    private(set) var documentOrigin = CGPoint(x: -50_000, y: -50_000)
    private var virtualBounds: JSONValue = .object([
        "x": .number(-50_000), "y": .number(-50_000), "w": .number(100_000), "h": .number(100_000),
    ])
    private var documentScene: JSONValue?
    private var activeTouch: UITouch?
    private var gesture: Gesture?
    private var start = CGPoint.zero
    private var original: [JSONValue] = []
    private var working: [JSONValue] = []
    private var samples: [DrawingSample] = []
    private var pendingShape: JSONValue?
    private var selectionAtStart: Set<String> = []
    private var renderTask: Task<Void, Never>?
    private var renderRevision = 0
    private var previousTool = DrawingTool.pen
    private let inkLayer = CAShapeLayer()
    private let selectionLayer = CAShapeLayer()
    private let handleLayer = CAShapeLayer()
    private let hoverLayer = CAShapeLayer()
    private enum Gesture {
        case pen, erase
        case shape(DrawingTool, String)
        case move, marquee
        case resize(Int, CGRect)
        case rotate(CGPoint, Double)
        case endpoint(String, Int)
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        isAccessibilityElement = false
        for overlay in [inkLayer, selectionLayer, handleLayer, hoverLayer] { layer.addSublayer(overlay) }
        inkLayer.lineCap = .round
        inkLayer.lineJoin = .round
        selectionLayer.fillColor = nil
        handleLayer.fillColor = UIColor.systemBackground.cgColor
        hoverLayer.fillColor = nil
        let hover = UIHoverGestureRecognizer(target: self, action: #selector(hovered(_:)))
        addGestureRecognizer(hover)
        addInteraction(UIPencilInteraction(delegate: self))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var canBecomeFirstResponder: Bool { true }
    func setDocumentScene(_ scene: JSONValue) {
        if documentScene == nil, let bounds = scene["bounds"] {
            documentOrigin = CGPoint(
                x: min(-50_000, bounds.number("x") - 5000), y: min(-50_000, bounds.number("y") - 5000))
            virtualBounds = .object([
                "x": .number(documentOrigin.x), "y": .number(documentOrigin.y),
                "w": .number(max(100_000, bounds.number("x") + bounds.number("w") - documentOrigin.x + 50_000)),
                "h": .number(max(100_000, bounds.number("y") + bounds.number("h") - documentOrigin.y + 50_000)),
            ])
        }
        documentScene = scene
        guard activeTouch == nil else { return }
        super.configure(scene.setting("bounds", virtualBounds))
        inkLayer.path = nil
        refreshSelection()
    }
    func documentPoint(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x + documentOrigin.x - 32, y: point.y + documentOrigin.y - 32)
    }
    private func surfacePoint(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x - documentOrigin.x + 32, y: point.y - documentOrigin.y + 32)
    }
    private var visibleElements: [JSONValue] { activeTouch == nil ? (model?.elements ?? []) : working }
    private var selectedElements: [JSONValue] {
        visibleElements.filter { model?.selection.contains($0.stableID) == true && $0["locked"] != .bool(true) }
    }
    private func hit(_ point: CGPoint) -> JSONValue? {
        visibleElements.reversed().first { DrawingGeometry.hit($0, point: point, tolerance: max(6, 8 / zoom)) }
    }
    private func handlePoints(_ rect: CGRect) -> [CGPoint] {
        [
            CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.midX, y: rect.minY),
            CGPoint(x: rect.maxX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.midY),
            CGPoint(x: rect.maxX, y: rect.maxY), CGPoint(x: rect.midX, y: rect.maxY),
            CGPoint(x: rect.minX, y: rect.maxY), CGPoint(x: rect.minX, y: rect.midY),
        ]
    }
    private func endpoints(_ element: JSONValue) -> [CGPoint] {
        let center = CGPoint(
            x: element.number("x") + element.number("w") / 2, y: element.number("y") + element.number("h") / 2)
        return element.list("points").compactMap { value in
            guard let row = value.arrayValue, row.count >= 2 else { return nil }
            return DrawingGeometry.rotate(
                CGPoint(
                    x: element.number("x") + (row[0].numberValue ?? 0),
                    y: element.number("y") + (row[1].numberValue ?? 0)), around: center, angle: element.number("angle"))
        }
    }
    func refreshSelection(marquee: CGRect? = nil) {
        let path = CGMutablePath()
        let handles = CGMutablePath()
        let color = UIColor.label.resolvedColor(with: traitCollection).cgColor
        selectionLayer.strokeColor = color
        handleLayer.strokeColor = color
        handleLayer.fillColor = UIColor.systemBackground.resolvedColor(with: traitCollection).cgColor
        selectionLayer.lineWidth = 1 / zoom
        handleLayer.lineWidth = 1 / zoom
        selectionLayer.lineDashPattern = [4 / zoom, 3 / zoom].map { NSNumber(value: Double($0)) }
        if let marquee {
            path.addRect(CGRect(origin: surfacePoint(marquee.origin), size: marquee.size))
        } else if model?.tool == .select, let rect = DrawingGeometry.bounds(selectedElements) {
            path.addRect(CGRect(origin: surfacePoint(rect.origin), size: rect.size))
            var points = handlePoints(rect)
            if selectedElements.count == 1, let element = selectedElements.first {
                if element.text("kind") == "line" {
                    let ends = endpoints(element)
                    points = [ends.first, ends.last].compactMap { $0 }
                } else {
                    let rotate = CGPoint(x: rect.midX, y: rect.minY - 28 / zoom)
                    path.move(to: surfacePoint(CGPoint(x: rect.midX, y: rect.minY)))
                    path.addLine(to: surfacePoint(rotate))
                    points.append(rotate)
                }
            }
            for point in points {
                let point = surfacePoint(point)
                handles.addEllipse(
                    in: CGRect(x: point.x - 5 / zoom, y: point.y - 5 / zoom, width: 10 / zoom, height: 10 / zoom))
            }
        }
        selectionLayer.path = path
        handleLayer.path = handles
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let model else { return }
        becomeFirstResponder()
        guard model.tool != .pan else { return }
        if activeTouch?.type == .pencil, !touches.contains(where: { $0.type == .pencil }) { return }
        if let pencil = touches.first(where: { $0.type == .pencil }) {
            cancelGesture()
            activeTouch = pencil
        } else if activeTouch == nil, event?.allTouches?.count == 1 {
            activeTouch = touches.first
        } else if activeTouch?.type != .pencil {
            cancelGesture()
            return
        }
        guard let touch = activeTouch else { return }
        start = documentPoint(touch.location(in: self))
        original = model.elements
        working = original
        selectionAtStart = model.selection
        samples = []
        pendingShape = nil
        switch model.tool {
        case .pan: break
        case .pen: gesture = .pen
        case .eraser: gesture = .erase
        case .select:
            beginSelection(
                at: start, additive: model.additiveSelection || event?.modifierFlags.contains(.shift) == true)
        default: gesture = .shape(model.tool, UUID().uuidString)
        }
        update(touch, event: event)
    }
    private func beginSelection(at point: CGPoint, additive: Bool) {
        guard let model else { return }
        let selected = selectedElements
        if !additive, let rect = DrawingGeometry.bounds(selected) {
            let reach = 16 / zoom
            if selected.count == 1, let element = selected.first, element.text("kind") == "line" {
                let points = endpoints(element)
                for index in [0, max(0, points.count - 1)] where points.indices.contains(index) {
                    if hypot(point.x - points[index].x, point.y - points[index].y) <= reach {
                        gesture = .endpoint(element.stableID, index)
                        return
                    }
                }
            } else {
                if selected.count == 1 {
                    let rotate = CGPoint(x: rect.midX, y: rect.minY - 28 / zoom)
                    if hypot(point.x - rotate.x, point.y - rotate.y) <= reach {
                        let center = CGPoint(x: rect.midX, y: rect.midY)
                        gesture = .rotate(center, atan2(point.y - center.y, point.x - center.x))
                        return
                    }
                }
                for (index, corner) in handlePoints(rect).enumerated() {
                    if hypot(point.x - corner.x, point.y - corner.y) <= reach {
                        gesture = .resize(index, rect)
                        return
                    }
                }
            }
        }
        if let item = hit(point) {
            if additive {
                var ids = model.selection
                if ids.contains(item.stableID) { ids.remove(item.stableID) } else { ids.insert(item.stableID) }
                model.select(ids)
            } else if !model.selection.contains(item.stableID) {
                model.select([item.stableID])
            }
            selectionAtStart = model.selection
            gesture = .move
        } else {
            if !additive {
                model.select([])
                selectionAtStart = []
            }
            gesture = .marquee
        }
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let activeTouch, touches.contains(activeTouch) else { return }
        update(activeTouch, event: event)
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let activeTouch, touches.contains(activeTouch), let model else { return }
        update(activeTouch, event: event)
        let finished = gesture
        let after = working
        let before = original
        let shape = pendingShape
        self.activeTouch = nil
        gesture = nil
        renderTask?.cancel()
        renderRevision += 1
        switch finished {
        case .pen:
            if let stroke = DrawingStroke.element(
                samples: samples, color: model.style.stroke, width: model.style.strokeWidth)
            {
                model.append(model.style.apply(to: stroke))
                model.selection = []
            }
        case .shape:
            if let shape {
                let shape = DrawingGeometry.defaultShape(shape)
                if shape.text("kind") == "text" {
                    editText?(shape, true)
                } else {
                    model.append(shape)
                    if shape.text("kind") == "note" { editText?(shape, false) }
                }
            }
        case .erase, .move, .resize, .rotate, .endpoint:
            if !model.commitGesture(before: before, after: after), let documentScene { setDocumentScene(documentScene) }
        default: break
        }
        samples = []
        pendingShape = nil
        switch finished {
        case .pen, .shape: break
        default: if after == before { if let documentScene { setDocumentScene(documentScene) } }
        }
        refreshSelection()
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { cancelGesture() }
    private func cancelGesture() {
        activeTouch = nil
        gesture = nil
        samples = []
        pendingShape = nil
        renderTask?.cancel()
        renderRevision += 1
        inkLayer.path = nil
        if let documentScene { setDocumentScene(documentScene) }
        refreshSelection()
    }
    private func update(_ touch: UITouch, event: UIEvent?) {
        guard let model, let gesture else { return }
        let point = documentPoint(touch.location(in: self))
        let constrained = model.constrain || event?.modifierFlags.contains(.shift) == true
        switch gesture {
        case .pen:
            for touch in event?.coalescedTouches(for: touch) ?? [touch] {
                let pressure =
                    touch.type == .pencil && touch.maximumPossibleForce > 0
                    ? touch.force / touch.maximumPossibleForce : 0.5
                samples.append(DrawingSample(point: documentPoint(touch.location(in: self)), pressure: pressure))
            }
            showInk()
        case .erase:
            for touch in event?.coalescedTouches(for: touch) ?? [touch] {
                let point = documentPoint(touch.location(in: self))
                if let item = hit(point) { working.removeAll { $0.stableID == item.stableID } }
            }
            preview(working)
        case .shape(let tool, let id):
            pendingShape = DrawingGeometry.create(
                tool: tool, from: start, to: point, style: model.style, id: id, constrained: constrained)
            preview(original + (pendingShape.map { [$0] } ?? []))
        case .move:
            var delta = CGPoint(x: point.x - start.x, y: point.y - start.y)
            if constrained { if abs(delta.x) > abs(delta.y) { delta.y = 0 } else { delta.x = 0 } }
            working = original.map {
                selectionAtStart.contains($0.stableID) && $0["locked"] != .bool(true)
                    ? DrawingGeometry.moved($0, by: delta) : $0
            }
            preview(working)
        case .marquee:
            let rect = DrawingGeometry.bounds([start, point])
            model.selection = selectionAtStart.union(
                original.filter { $0["locked"] != .bool(true) && DrawingGeometry.box($0).intersects(rect) }.map(
                    \.stableID))
            refreshSelection(marquee: rect)
        case .resize(let handle, let source):
            var left = source.minX
            var top = source.minY
            var right = source.maxX
            var bottom = source.maxY
            if [0, 6, 7].contains(handle) { left = min(point.x, right - 1) }
            if [0, 1, 2].contains(handle) { top = min(point.y, bottom - 1) }
            if [2, 3, 4].contains(handle) { right = max(point.x, left + 1) }
            if [4, 5, 6].contains(handle) { bottom = max(point.y, top + 1) }
            if constrained, source.width > 0, source.height > 0 {
                let ratio = source.width / source.height
                if (right - left) / (bottom - top) > ratio {
                    if [0, 1, 2].contains(handle) {
                        top = bottom - (right - left) / ratio
                    } else {
                        bottom = top + (right - left) / ratio
                    }
                } else if [0, 6, 7].contains(handle) {
                    left = right - (bottom - top) * ratio
                } else {
                    right = left + (bottom - top) * ratio
                }
            }
            let target = CGRect(x: left, y: top, width: right - left, height: bottom - top)
            working = original.map {
                selectionAtStart.contains($0.stableID) && $0["locked"] != .bool(true)
                    ? DrawingGeometry.scaled($0, from: source, to: target) : $0
            }
            preview(working)
        case .rotate(let center, let angle):
            var delta = atan2(point.y - center.y, point.x - center.x) - angle
            if constrained { delta = (delta / (.pi / 12)).rounded() * (.pi / 12) }
            working = original.map {
                selectionAtStart.contains($0.stableID) && $0["locked"] != .bool(true)
                    ? $0.setting("angle", .number($0.number("angle") + delta)) : $0
            }
            preview(working)
        case .endpoint(let id, let index):
            working = original.map { element in
                guard element.stableID == id else { return element }
                var points = endpoints(element)
                guard points.indices.contains(index) else { return element }
                points[index] = point
                let bounds = DrawingGeometry.bounds(points)
                return element.setting("x", .number(bounds.minX)).setting("y", .number(bounds.minY)).setting(
                    "w", .number(bounds.width)
                ).setting("h", .number(bounds.height)).setting("angle", .number(0)).setting(
                    "points", .array(points.map { .array([.number($0.x - bounds.minX), .number($0.y - bounds.minY)]) }))
            }
            preview(working)
        }
        if case .marquee = gesture {} else { refreshSelection() }
    }
    private func preview(_ elements: [JSONValue]) {
        renderTask?.cancel()
        renderRevision += 1
        let revision = renderRevision
        renderTask = Task {
            do {
                let scene = try await LocalDocumentRenderer.shared.render(
                    kind: "drawing",
                    document: .object(["version": .number(1), "rev": .number(0), "elements": .array(elements)]))
                guard !Task.isCancelled, revision == renderRevision else { return }
                super.configure(scene.setting("bounds", virtualBounds))
                if let scroll = superview as? UIScrollView {
                    show(scroll.convert(scroll.bounds, to: self), scale: traitCollection.displayScale * zoom)
                }
            } catch {}
        }
    }
    private func showInk() {
        guard let model else { return }
        let path = CGMutablePath()
        for (index, sample) in samples.enumerated() {
            let point = surfacePoint(sample.point)
            let radius = CGFloat(model.style.strokeWidth) * (0.5 + sample.pressure)
            path.addEllipse(in: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
            if index > 0 {
                let segment = CGMutablePath()
                segment.move(to: surfacePoint(samples[index - 1].point))
                segment.addLine(to: point)
                path.addPath(
                    segment.copy(strokingWithWidth: radius * 2, lineCap: .round, lineJoin: .round, miterLimit: 1))
            }
        }
        inkLayer.fillColor = DrawingPalette.color(model.style.stroke).resolvedColor(with: traitCollection).cgColor
        inkLayer.path = path
    }
    func edit(at point: CGPoint) {
        guard let item = hit(point), ["text", "note"].contains(item.text("kind")) else { return }
        cancelGesture()
        resignFirstResponder()
        editText?(item, false)
    }
    @objc private func hovered(_ gesture: UIHoverGestureRecognizer) {
        guard gesture.state != .ended, gesture.state != .cancelled, activeTouch == nil, let model, model.tool != .pan
        else {
            hoverLayer.path = nil
            return
        }
        let point = gesture.location(in: self)
        let radius = (model.tool == .eraser ? 12 : CGFloat(model.style.strokeWidth + 3)) / zoom
        let path = CGMutablePath()
        if model.tool == .pen || model.tool == .eraser {
            path.addEllipse(in: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
        } else {
            path.move(to: CGPoint(x: point.x - 8 / zoom, y: point.y))
            path.addLine(to: CGPoint(x: point.x + 8 / zoom, y: point.y))
            path.move(to: CGPoint(x: point.x, y: point.y - 8 / zoom))
            path.addLine(to: CGPoint(x: point.x, y: point.y + 8 / zoom))
        }
        hoverLayer.path = path
        hoverLayer.strokeColor = DrawingPalette.color(model.style.stroke).resolvedColor(with: traitCollection).cgColor
        hoverLayer.lineWidth = 1 / zoom
        hoverLayer.opacity = Float(1 - gesture.zOffset * 0.5)
    }
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        pencilAction(UIPencilInteraction.preferredTapAction)
    }
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        if squeeze.phase == .ended { pencilAction(UIPencilInteraction.preferredSqueezeAction) }
    }
    private func pencilAction(_ action: UIPencilPreferredAction) {
        guard let model else { return }
        cancelGesture()
        switch action {
        case .switchEraser:
            if model.tool == .eraser {
                model.tool = previousTool
            } else {
                previousTool = model.tool
                model.tool = .eraser
            }
        case .switchPrevious:
            let current = model.tool
            model.tool = previousTool
            previousTool = current
        case .showColorPalette, .showContextualPalette: showStyle?()
        default: break
        }
    }
    override var keyCommands: [UIKeyCommand]? {
        var result = DrawingTool.allCases.map {
            UIKeyCommand(title: $0.rawValue, action: #selector(key(_:)), input: $0.shortcut, modifierFlags: [])
        }
        for (input, modifiers, title) in [
            ("z", UIKeyModifierFlags.command, "Undo"), ("z", [.command, .shift], "Redo"), ("a", .command, "Select all"),
            ("d", .command, "Duplicate"), ("c", .command, "Copy"), ("x", .command, "Cut"), ("v", .command, "Paste"),
            ("]", .command, "Bring to front"), ("[", .command, "Send to back"), ("l", [.command, .shift], "Lock"),
            ("0", .command, "Actual size"), ("1", .command, "Fit drawing"), ("2", .command, "Fit selection"),
            ("q", [], "Keep tool"), (UIKeyCommand.inputEscape, [], "Deselect"), ("\u{8}", [], "Delete"),
            ("+", [], "Zoom in"), ("-", [], "Zoom out"),
        ] {
            result.append(
                UIKeyCommand(title: title, action: #selector(key(_:)), input: input, modifierFlags: modifiers))
        }
        for input in [
            UIKeyCommand.inputLeftArrow, UIKeyCommand.inputRightArrow, UIKeyCommand.inputUpArrow,
            UIKeyCommand.inputDownArrow,
        ] {
            result.append(
                UIKeyCommand(title: "Move selection", action: #selector(key(_:)), input: input, modifierFlags: []))
            result.append(
                UIKeyCommand(
                    title: "Move selection farther", action: #selector(key(_:)), input: input, modifierFlags: .shift))
        }
        return result
    }
    @objc private func key(_ command: UIKeyCommand) {
        guard let model, let input = command.input else { return }
        let shift = command.modifierFlags.contains(.shift)
        if command.modifierFlags.contains(.command) {
            switch input {
            case "z": if shift { model.redo() } else { model.undo() }
            case "a":
                model.tool = .select
                model.select(Set(model.elements.filter { $0["locked"] != .bool(true) }.map(\.stableID)))
            case "d": model.duplicate()
            case "c": model.copySelection()
            case "x": model.copySelection(cut: true)
            case "v": model.paste()
            case "]": model.reorder(front: true)
            case "[": model.reorder(front: false)
            case "l": model.lockSelection()
            case "0": requestViewport?(.scale(1))
            case "1": requestViewport?(.fitAll)
            case "2": requestViewport?(.fitSelection)
            default: break
            }
        } else if let tool = DrawingTool.allCases.first(where: { $0.shortcut == input }) {
            model.tool = tool
        } else if input == "q" {
            model.toolLocked.toggle()
        } else if input == UIKeyCommand.inputEscape {
            cancelGesture()
            model.selection = []
            model.tool = .pan
        } else if input == "\u{8}" {
            model.deleteSelected()
        } else if input == "+" {
            requestViewport?(.step(0.1))
        } else if input == "-" {
            requestViewport?(.step(-0.1))
        } else {
            let step: CGFloat = shift ? 24 : 1
            switch input {
            case UIKeyCommand.inputLeftArrow: model.moveSelection(CGPoint(x: -step, y: 0))
            case UIKeyCommand.inputRightArrow: model.moveSelection(CGPoint(x: step, y: 0))
            case UIKeyCommand.inputUpArrow: model.moveSelection(CGPoint(x: 0, y: -step))
            case UIKeyCommand.inputDownArrow: model.moveSelection(CGPoint(x: 0, y: step))
            default: break
            }
        }
        refreshSelection()
    }
}
