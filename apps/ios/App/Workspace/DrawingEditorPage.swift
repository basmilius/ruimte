import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

struct DrawingEditorPage: View {
    @State private var model: DrawingEditorModel
    @State private var tool = DrawingTool.pen
    @State private var color = "ink"
    @State private var width = 2
    @State private var discard = false

    init(client: any MachineRequesting, machineID: String, projectID: String, viewID: String) {
        _model = State(
            initialValue: DrawingEditorModel(client: client, machineID: machineID, projectID: projectID, viewID: viewID)
        )
    }

    var body: some View {
        Group {
            if let scene = model.scene {
                MobileScrollViewport { insets in
                    DrawingCanvas(
                        scene: scene, elements: model.elements, tool: tool, color: color, width: width,
                        viewportInsets: insets,
                        append: model.append, erase: model.erase
                    )
                }
            } else if let problem = model.problem {
                ContentUnavailableView("Could not open drawing", systemImage: "pencil.tip", description: Text(problem))
            } else {
                ProgressView("Loading drawing").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                if let problem = model.problem {
                    HStack {
                        Text(problem).font(.caption)
                        Button("Retry") { Task { await model.reload() } }
                        if model.dirty { Button("Discard", role: .destructive) { discard = true } }
                    }.padding(12).background(.regularMaterial, in: .rect(cornerRadius: 16))
                }
                HStack(spacing: 4) {
                    ForEach(DrawingTool.allCases) { option in
                        Button {
                            tool = option
                        } label: {
                            Image(systemName: option.symbol).frame(width: 44, height: 44)
                                .foregroundStyle(tool == option ? Color.primary : Color.secondary)
                        }.accessibilityLabel(option.rawValue).accessibilityAddTraits(tool == option ? .isSelected : [])
                    }
                    Divider().frame(height: 24)
                    Menu {
                        Picker("Color", selection: $color) {
                            ForEach(
                                ["ink", "muted", "red", "orange", "yellow", "green", "blue", "purple", "pink"],
                                id: \.self
                            ) {
                                Text($0.capitalized).tag($0)
                            }
                        }
                        Picker("Stroke width", selection: $width) {
                            Text("Fine").tag(1)
                            Text("Medium").tag(2)
                            Text("Bold").tag(4)
                        }
                    } label: {
                        Image(systemName: "circle.fill").foregroundStyle(
                            Color(uiColor: DrawingInputSurface.color(color))
                        )
                        .frame(width: 44, height: 44)
                    }.accessibilityLabel("Pen color and width")
                    Button("Undo", systemImage: "arrow.uturn.backward") { model.undo() }
                        .labelStyle(.iconOnly).frame(width: 44, height: 44).disabled(model.history.isEmpty)
                    if model.saving { ProgressView().controlSize(.mini).accessibilityLabel("Saving drawing") }
                }
                .padding(10).glassEffect(.regular.interactive(), in: .capsule)
            }.padding(12)
        }
        .confirmationDialog("Discard unsaved changes on this device?", isPresented: $discard, titleVisibility: .visible)
        {
            Button("Discard local changes", role: .destructive) { model.discardDraft() }
        }
        .task { await model.start() }
        .onDisappear { model.stop() }
    }
}

enum DrawingTool: String, CaseIterable, Identifiable {
    case pen = "Pen"
    case eraser = "Eraser"
    case pan = "Move canvas"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .pen: "pencil.tip"
        case .eraser: "eraser"
        case .pan: "hand.draw"
        }
    }
}

private struct DrawingCanvas: UIViewRepresentable {
    let scene: JSONValue
    let elements: [JSONValue]
    let tool: DrawingTool
    let color: String
    let width: Int
    let viewportInsets: UIEdgeInsets
    let append: (JSONValue) -> Void
    let erase: (String) -> Void
    func makeUIView(context: Context) -> DrawingCanvasScrollView { DrawingCanvasScrollView() }
    func updateUIView(_ view: DrawingCanvasScrollView, context: Context) {
        view.contentInset = viewportInsets
        view.scrollIndicatorInsets = viewportInsets
        view.configure(
            scene: scene, elements: elements, tool: tool, color: color, width: width, append: append, erase: erase)
    }
}

private final class DrawingCanvasScrollView: UIScrollView, UIScrollViewDelegate {
    private let surface = DrawingInputSurface()
    private var displayed: JSONValue?
    private var initialBounds: CGRect?
    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        contentInsetAdjustmentBehavior = .never
        minimumZoomScale = 0.1
        maximumZoomScale = 8
        backgroundColor = .systemBackground
        delaysContentTouches = false
        addSubview(surface)
        panGestureRecognizer.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        accessibilityLabel = "Drawing canvas"
        accessibilityHint = "Draw with one finger or Apple Pencil. Move with two fingers and pinch to zoom."
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func configure(
        scene: JSONValue, elements: [JSONValue], tool: DrawingTool, color: String, width: Int,
        append: @escaping (JSONValue) -> Void, erase: @escaping (String) -> Void
    ) {
        surface.tool = tool
        surface.ink = color
        surface.strokeWidth = width
        surface.append = append
        surface.erase = erase
        surface.elements = elements
        panGestureRecognizer.minimumNumberOfTouches = tool == .pan ? 1 : 2
        guard displayed != scene else { return }
        let first = displayed == nil
        displayed = scene
        let bounds = scene["bounds"] ?? .object([:])
        if first {
            initialBounds = CGRect(
                x: bounds.number("x"), y: bounds.number("y"), width: max(100, bounds.number("w")),
                height: max(100, bounds.number("h")))
        }
        // A stable document origin keeps existing ink still as newly drawn strokes change its bounds.
        let origin = CGPoint(x: -50_000, y: -50_000)
        surface.documentOrigin = origin
        let viewportScene = scene.setting(
            "bounds",
            .object(["x": .number(origin.x), "y": .number(origin.y), "w": .number(100_000), "h": .number(100_000)]))
        let scale = zoomScale
        let offset = contentOffset
        setZoomScale(1, animated: false)
        surface.configure(viewportScene)
        contentSize = surface.bounds.size
        setZoomScale(scale, animated: false)
        contentOffset = offset
        setNeedsLayout()
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        if let initialBounds, bounds.width > 0, bounds.height > 0 {
            self.initialBounds = nil
            let viewport = bounds.inset(by: contentInset)
            let scale = min(
                1, min((viewport.width - 48) / initialBounds.width, (viewport.height - 48) / initialBounds.height))
            setZoomScale(max(minimumZoomScale, scale), animated: false)
            contentOffset = CGPoint(
                x: (initialBounds.minX - surface.documentOrigin.x + 32) * zoomScale - contentInset.left - 24,
                y: (initialBounds.minY - surface.documentOrigin.y + 32) * zoomScale - contentInset.top - 24)
        }
        updateDrawing()
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { surface }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { updateDrawing() }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { updateDrawing() }
    private func updateDrawing() {
        surface.show(convert(bounds, to: surface), scale: traitCollection.displayScale * zoomScale)
    }
}

private final class DrawingInputSurface: SceneSurface {
    var tool = DrawingTool.pen
    var ink = "ink"
    var strokeWidth = 2
    var documentOrigin = CGPoint.zero
    var elements: [JSONValue] = []
    var append: ((JSONValue) -> Void)?
    var erase: ((String) -> Void)?
    private var activeTouch: UITouch?
    private var samples: [DrawingSample] = []
    private let preview = CAShapeLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        isAccessibilityElement = false
        preview.fillColor = Self.color(ink).cgColor
        preview.lineCap = .round
        preview.lineJoin = .round
        layer.addSublayer(preview)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard tool != .pan else { return }
        if let pencil = touches.first(where: { $0.type == .pencil }) {
            activeTouch = pencil
            samples = []
        } else if activeTouch == nil, event?.allTouches?.count == 1 {
            activeTouch = touches.first
        } else if activeTouch?.type != .pencil {
            cancelStroke()
            return
        }
        if let activeTouch { sample(activeTouch, event: event) }
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let activeTouch, touches.contains(activeTouch) else { return }
        sample(activeTouch, event: event)
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let activeTouch, touches.contains(activeTouch) else { return }
        sample(activeTouch, event: event)
        if tool == .pen, let element = DrawingStroke.element(samples: samples, color: ink, width: strokeWidth) {
            append?(element)
        }
        self.activeTouch = nil
        samples = []
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { cancelStroke() }
    private func cancelStroke() {
        activeTouch = nil
        samples = []
        preview.path = nil
    }
    private func sample(_ touch: UITouch, event: UIEvent?) {
        for touch in event?.coalescedTouches(for: touch) ?? [touch] {
            let location = touch.location(in: self)
            let point = CGPoint(x: location.x + documentOrigin.x - 32, y: location.y + documentOrigin.y - 32)
            if tool == .eraser {
                if let element = elements.reversed().first(where: { Self.hits($0, point: point) }) {
                    erase?(element.stableID)
                    elements.removeAll { $0.stableID == element.stableID && $0["locked"] != .bool(true) }
                }
            } else {
                let pressure =
                    touch.type == .pencil && touch.maximumPossibleForce > 0
                    ? touch.force / touch.maximumPossibleForce : 0.5
                samples.append(DrawingSample(point: point, pressure: pressure))
            }
        }
        let path = CGMutablePath()
        for (index, sample) in samples.enumerated() {
            let point = CGPoint(x: sample.point.x - documentOrigin.x + 32, y: sample.point.y - documentOrigin.y + 32)
            let radius = CGFloat(strokeWidth) * (0.5 + sample.pressure)
            path.addEllipse(in: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
            if index > 0 {
                let previous = samples[index - 1].point
                let segment = CGMutablePath()
                segment.move(to: CGPoint(x: previous.x - documentOrigin.x + 32, y: previous.y - documentOrigin.y + 32))
                segment.addLine(to: point)
                path.addPath(
                    segment.copy(strokingWithWidth: radius * 2, lineCap: .round, lineJoin: .round, miterLimit: 1))
            }
        }
        preview.fillColor = Self.color(ink).cgColor
        preview.path = path
    }
    override func configure(_ scene: JSONValue) {
        super.configure(scene)
        if activeTouch == nil { preview.path = nil }
    }

    static func hits(_ element: JSONValue, point: CGPoint) -> Bool {
        guard element["locked"] != .bool(true) else { return false }
        let center = CGPoint(
            x: element.number("x") + element.number("w") / 2, y: element.number("y") + element.number("h") / 2)
        let angle = -element.number("angle")
        let dx = point.x - center.x
        let dy = point.y - center.y
        let local = CGPoint(
            x: dx * cos(angle) - dy * sin(angle) + element.number("w") / 2,
            y: dx * sin(angle) + dy * cos(angle) + element.number("h") / 2)
        let tolerance = max(8, element.number("strokeWidth") * 3)
        if ["freehand", "line"].contains(element.text("kind")) {
            let points = element.list("points").compactMap { value -> CGPoint? in
                guard let items = value.arrayValue, items.count >= 2, let x = items[0].numberValue,
                    let y = items[1].numberValue
                else { return nil }
                return CGPoint(x: x, y: y)
            }
            if points.count == 1 { return hypot(local.x - points[0].x, local.y - points[0].y) < tolerance }
            return zip(points, points.dropFirst()).contains { start, end in
                let dx = end.x - start.x
                let dy = end.y - start.y
                let length = dx * dx + dy * dy
                let position =
                    length == 0 ? 0 : max(0, min(1, ((local.x - start.x) * dx + (local.y - start.y) * dy) / length))
                return hypot(local.x - start.x - position * dx, local.y - start.y - position * dy) < tolerance
            }
        }
        return CGRect(x: 0, y: 0, width: element.number("w"), height: element.number("h")).insetBy(
            dx: -tolerance, dy: -tolerance
        ).contains(local)
    }
    static func color(_ name: String) -> UIColor {
        switch name {
        case "muted": .secondaryLabel
        case "red": .systemRed
        case "orange": .systemOrange
        case "yellow": .systemYellow
        case "green": .systemGreen
        case "blue": .systemBlue
        case "purple", "accent": .systemPurple
        case "pink": .systemPink
        default: .label
        }
    }
}
