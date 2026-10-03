import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

struct RenderDocumentPage: View {
    let client: any MachineRequesting
    let projectID: String
    let viewID: String
    let kind: String
    /// The diagram's project, for asking an agent to change it; nil where there is no project to start a chat in.
    var agent: DiagramAgentTarget?
    /// Opens the chat a question went to.
    var openChat: (String) -> Void = { _ in }
    @State private var work = RemotePageState()
    @State private var generation = 0
    @State private var connection: (() -> Void)?
    @State private var subscription: (() -> Void)?
    @State private var zoom: SceneZoomRequest?
    @State private var agentModel: DiagramAgentModel?
    @State private var asking = false
    @State private var copied = false
    private var isEmptyDiagram: Bool { kind == "diagram" && work.value?.list("elements").isEmpty == true }
    var body: some View {
        Group {
            if let scene = work.value {
                MobileScrollViewport { insets in
                    NativeScene(scene: scene, zoom: zoom, viewportInsets: insets)
                }
                .overlay {
                    if isEmptyDiagram {
                        if let agentModel {
                            DiagramEmptyState(model: agentModel, sent: openChat)
                        } else {
                            ContentUnavailableView(
                                "Nothing in this diagram yet", lucideIcon: "workflow",
                                description: Text("An agent draws it with ruimte-context view diagram.")
                            )
                            .allowsHitTesting(false)
                            .accessibilityIdentifier("diagram.empty")
                        }
                    }
                }
                .overlay(alignment: .trailing) {
                    if !isEmptyDiagram { zoomControls }
                }
            } else if let problem = work.problem {
                ContentUnavailableView(
                    "Could not load \(kind)", lucideIcon: "triangle-alert", description: Text(problem))
            } else {
                MobileLoadingRow("Loading \(kind)")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if work.value != nil && !isEmptyDiagram {
                bottomBar
            }
        }
        .toolbar {
            ToolbarItem(id: "\(kind).actions", placement: .topBarTrailing) {
                Menu {
                    Button("Reload", lucideIcon: "refresh-cw") { generation += 1 }
                    if work.value != nil {
                        Button("Copy as image", lucideIcon: "copy") { copyImage() }
                    }
                } label: {
                    Image(lucide: "ellipsis")
                }
                .accessibilityLabel("Diagram actions")
            }
        }
        .mobileSheet(isPresented: $asking) {
            if let agentModel {
                DiagramAgentSheet(model: agentModel, sent: openChat).presentationDetents([.medium, .large])
            }
        }
        .sensoryFeedback(.success, trigger: copied)
        .task {
            if agentModel == nil, let agent { agentModel = DiagramAgentModel(target: agent) }
            if subscription == nil {
                subscription = client.subscribe(kind + ".changed") { event in
                    if event.text("projectId") == projectID && event.text("viewId") == viewID { generation += 1 }
                }
                connection = client.observeConnection { if $0 { generation += 1 } }
            }
        }
        .task(id: generation) {
            await work.load {
                try await DocumentSceneLoader.load(
                    client: client, projectID: projectID, viewID: viewID, kind: kind)
            }
        }
        .onDisappear {
            subscription?()
            subscription = nil
            connection?()
            connection = nil
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 8) {
            if let problem = work.problem {
                Text(problem).font(.footnote).padding(.horizontal, 16).padding(.vertical, 8)
                    .glassEffect(.regular, in: .capsule)
            }
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    if agentModel != nil {
                        Button {
                            asking = true
                        } label: {
                            Label("Change with an agent", lucideIcon: "sparkles")
                                .font(.body.weight(.medium))
                                .padding(.horizontal, 18).frame(minHeight: 48)
                                .contentShape(.capsule)
                        }
                        .glassEffect(.regular.interactive(), in: .capsule)
                        Spacer(minLength: 0)
                    }
                    Button {
                        copyImage()
                    } label: {
                        Image(lucide: "copy", size: 18).frame(width: 48, height: 48)
                    }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Copy as image")
                }
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private var zoomControls: some View {
        VStack(spacing: 0) {
            zoomButton("Zoom in", icon: "plus", action: .step(1.5))
            zoomButton("Zoom out", icon: "minus", action: .step(1 / 1.5))
            zoomButton("Fit", icon: "scan", action: .fit)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.trailing, 12)
    }

    private func zoomButton(_ label: String, icon: String, action: SceneZoomRequest.Action) -> some View {
        Button {
            zoom = SceneZoomRequest(action: action)
        } label: {
            Image(lucide: icon, size: 17).frame(width: 44, height: 44).contentShape(.rect)
        }
        .accessibilityLabel(label)
    }

    private func copyImage() {
        guard let scene = work.value else { return }
        let surface = SceneSurface()
        surface.configure(scene)
        UIPasteboard.general.image = surface.image()
        copied.toggle()
    }
}

/// A zoom the controls beside a scene ask for; a new id is a new press.
struct SceneZoomRequest: Equatable {
    enum Action: Equatable {
        case step(CGFloat)
        case fit
    }
    let id = UUID()
    let action: Action
}

private struct NativeScene: UIViewRepresentable {
    let scene: JSONValue
    let zoom: SceneZoomRequest?
    let viewportInsets: UIEdgeInsets
    func makeUIView(context: Context) -> SceneScrollView { SceneScrollView() }
    func updateUIView(_ view: SceneScrollView, context: Context) {
        view.viewportInsets = viewportInsets
        view.setScene(scene)
        if let zoom { view.perform(zoom) }
    }
}

private final class SceneScrollView: UIScrollView, UIScrollViewDelegate {
    var viewportInsets = UIEdgeInsets.zero {
        didSet {
            guard viewportInsets != oldValue else { return }
            scrollIndicatorInsets = viewportInsets
            setNeedsLayout()
        }
    }
    private let surface = SceneSurface()
    private var scene: JSONValue?
    private var needsFit = true
    private var lastZoom: UUID?
    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        contentInsetAdjustmentBehavior = .never
        minimumZoomScale = 0.05
        maximumZoomScale = 6
        backgroundColor = MobileStyle.surfaceColor
        addSubview(surface)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func setScene(_ scene: JSONValue) {
        guard self.scene != scene else { return }
        let previous = zoomScale
        let first = self.scene == nil
        self.scene = scene
        setZoomScale(1, animated: false)
        surface.configure(scene)
        contentSize = surface.bounds.size
        if !first { setZoomScale(previous, animated: false) }
        needsFit = first
        setNeedsLayout()
    }
    func perform(_ request: SceneZoomRequest) {
        guard request.id != lastZoom else { return }
        lastZoom = request.id
        switch request.action {
        case .step(let factor): setZoomScale(zoomScale * factor, animated: true)
        case .fit: setZoomScale(fitScale, animated: true)
        }
    }
    private var fitScale: CGFloat {
        let viewport = bounds.inset(by: viewportInsets)
        return max(
            minimumZoomScale,
            min(1, min(viewport.width / surface.bounds.width, viewport.height / surface.bounds.height)))
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        let viewport = bounds.inset(by: viewportInsets)
        if needsFit && bounds.width > 0 && bounds.height > 0 {
            needsFit = false
            setZoomScale(fitScale, animated: false)
        }
        updateDrawing()
        contentInset = UIEdgeInsets(
            top: viewportInsets.top + max(0, (viewport.height - contentSize.height) / 2),
            left: viewportInsets.left + max(0, (viewport.width - contentSize.width) / 2),
            bottom: viewportInsets.bottom, right: viewportInsets.right)
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { surface }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { updateDrawing() }
    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        updateDrawing()
        setNeedsLayout()
    }
    private func updateDrawing() {
        surface.show(convert(bounds, to: surface), scale: traitCollection.displayScale * zoomScale)
    }
}

class SceneSurface: UIView {
    private var scene: JSONValue = .object([:])
    private var paths: [String: CGPath] = [:]
    private let drawing = SceneDrawing()
    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        addSubview(drawing)
        drawing.paint = { [weak self] context in
            guard let self else { return }
            drawScene(context, from: drawing.frame.origin)
        }
    }
    func show(_ rect: CGRect, scale: CGFloat) {
        drawing.contentScaleFactor = max(0.05, scale)
        let viewport = rect.intersection(bounds)
        drawing.frame = viewport.isNull ? .zero : viewport
        drawing.setNeedsDisplay()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func configure(_ scene: JSONValue) {
        self.scene = scene
        let bounds = scene["bounds"] ?? .object([:])
        frame = CGRect(
            x: 0, y: 0, width: min(10_000_000, max(1, bounds.number("w") + 64)),
            height: min(10_000_000, max(1, bounds.number("h") + 64)))
        let commands = Set(scene.list("elements").flatMap { $0.list("paths").map { $0.text("d") } })
        paths = paths.filter { commands.contains($0.key) }
        for command in commands where paths[command] == nil { paths[command] = try? SVGPathParser.parse(command) }
        accessibilityLabel = scene.list("elements").flatMap { $0.list("text").map { $0.text("text") } }.joined(
            separator: ". ")
        isAccessibilityElement = true
        accessibilityTraits = .image
        drawing.setNeedsDisplay()
    }
    /// The whole scene as a picture on the page's own surface color, at most 4096 pixels a side.
    func image() -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = max(0.05, min(3, 4096 / max(1, max(bounds.width, bounds.height))))
        format.opaque = true
        return UIGraphicsImageRenderer(size: bounds.size, format: format).image { renderer in
            MobileStyle.surfaceColor.resolvedColor(with: traitCollection).setFill()
            renderer.fill(CGRect(origin: .zero, size: bounds.size))
            drawScene(renderer.cgContext, from: .zero)
        }
    }
    /// Draws the scene with `origin` of the surface at the context's top left.
    private func drawScene(_ context: CGContext, from origin: CGPoint) {
        context.translateBy(
            x: 32 - (scene["bounds"]?.number("x") ?? 0) - origin.x,
            y: 32 - (scene["bounds"]?.number("y") ?? 0) - origin.y)

        for element in scene.list("elements") {
            context.saveGState()
            let cx = element.number("centerX")
            let cy = element.number("centerY")
            context.translateBy(x: element.number("x") + cx, y: element.number("y") + cy)
            context.rotate(by: element.number("angle"))
            context.translateBy(x: -cx, y: -cy)
            for item in element.list("paths") {
                guard let path = paths[item.text("d")] else { continue }
                if let fill = item["fill"], fill != .null {
                    context.addPath(path)
                    context.setFillColor(color(fill).cgColor)
                    context.fillPath()
                }
                if let stroke = item["stroke"], stroke != .null {
                    context.addPath(path)
                    context.setStrokeColor(color(stroke).cgColor)
                    context.setLineWidth(item.number("strokeWidth", fallback: 1))
                    context.setLineDash(
                        phase: 0, lengths: item.list("dash").compactMap { $0.numberValue }.map { CGFloat($0) })
                    context.setLineCap(.round)
                    context.setLineJoin(.round)
                    context.strokePath()
                }
            }
            for item in element.list("text") {
                let size = item.number("size", fallback: 16)
                let weight: UIFont.Weight = item["bold"] == .bool(true) ? .bold : .regular
                let font: UIFont
                switch item.text("font") {
                case "mono": font = .monospacedSystemFont(ofSize: size, weight: weight)
                case "hand":
                    font = UIFont(name: "ChalkboardSE-Regular", size: size) ?? .systemFont(ofSize: size, weight: weight)
                default: font = .systemFont(ofSize: size, weight: weight)
                }
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: font, .foregroundColor: color(item["color"] ?? .object([:])),
                ]
                let text = item.text("text") as NSString
                let width = text.size(withAttributes: attrs).width
                let shift = item.text("align") == "center" ? width / 2 : (item.text("align") == "right" ? width : 0)
                text.draw(
                    at: CGPoint(x: item.number("x") - shift, y: item.number("y") - font.ascender), withAttributes: attrs
                )
            }
            context.restoreGState()
        }
    }
    private func color(_ value: JSONValue) -> UIColor {
        let tone: UIColor
        switch value.text("tone") {
        case "muted": tone = .secondaryLabel
        case "accent", "purple": tone = .systemPurple
        case "red": tone = .systemRed
        case "orange": tone = .systemOrange
        case "yellow": tone = .systemYellow
        case "green": tone = .systemGreen
        case "blue": tone = .systemBlue
        case "pink": tone = .systemPink
        default: tone = .label
        }
        switch value.text("palette") {
        case "paper": return tone.withAlphaComponent(traitCollection.userInterfaceStyle == .dark ? 0.22 : 0.12)
        case "edge": return tone.withAlphaComponent(0.45)
        default: return tone
        }
    }
}

struct SVGPathFailure: Error {}

enum SVGPathParser {
    static func parse(_ source: String) throws -> CGPath {
        guard source.utf8.count <= 4_194_304 else { throw SVGPathFailure() }
        let pattern = "[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:[0-9]*\\.[0-9]+|[0-9]+\\.?[0-9]*)(?:[eE][-+]?[0-9]+)?"
        let regex = try NSRegularExpression(pattern: pattern)
        let range = NSRange(source.startIndex..., in: source)
        let matches = regex.matches(in: source, range: range)
        var covered = 0
        var tokens: [String] = []
        let ns = source as NSString
        for match in matches {
            let gap = ns.substring(with: NSRange(location: covered, length: match.range.location - covered))
            guard gap.allSatisfy({ $0.isWhitespace || $0 == "," }) else { throw SVGPathFailure() }
            tokens.append(ns.substring(with: match.range))
            covered = match.range.location + match.range.length
        }
        guard ns.substring(from: covered).allSatisfy({ $0.isWhitespace || $0 == "," }) else { throw SVGPathFailure() }
        let path = CGMutablePath()
        var index = 0
        var command = ""
        var previous = ""
        var point = CGPoint.zero
        var start = CGPoint.zero
        var cubic = CGPoint.zero
        var quadratic = CGPoint.zero
        func isCommand(_ token: String) -> Bool { token.count == 1 && token.first!.isLetter }
        func number() throws -> Double {
            guard index < tokens.count, let value = Double(tokens[index]), value.isFinite, abs(value) <= 1_000_000_000
            else { throw SVGPathFailure() }
            index += 1
            return value
        }
        func coordinate(_ relative: Bool) throws -> CGPoint {
            let x = try number()
            let y = try number()
            return CGPoint(x: x + (relative ? point.x : 0), y: y + (relative ? point.y : 0))
        }
        while index < tokens.count {
            if isCommand(tokens[index]) {
                command = tokens[index]
                index += 1
            }
            guard !command.isEmpty else { throw SVGPathFailure() }
            let upper = command.uppercased()
            let relative = command != upper
            if path.isEmpty && upper != "M" { throw SVGPathFailure() }
            switch upper {
            case "M":
                point = try coordinate(relative)
                path.move(to: point)
                start = point
                command = relative ? "l" : "L"
            case "L":
                point = try coordinate(relative)
                path.addLine(to: point)
            case "H":
                point.x = try number() + (relative ? point.x : 0)
                path.addLine(to: point)
            case "V":
                point.y = try number() + (relative ? point.y : 0)
                path.addLine(to: point)
            case "C":
                let a = try coordinate(relative)
                let b = try coordinate(relative)
                let end = try coordinate(relative)
                path.addCurve(to: end, control1: a, control2: b)
                point = end
                cubic = b
            case "S":
                let a =
                    ["C", "S"].contains(previous) ? CGPoint(x: 2 * point.x - cubic.x, y: 2 * point.y - cubic.y) : point
                let b = try coordinate(relative)
                let end = try coordinate(relative)
                path.addCurve(to: end, control1: a, control2: b)
                point = end
                cubic = b
            case "Q":
                let control = try coordinate(relative)
                let end = try coordinate(relative)
                path.addQuadCurve(to: end, control: control)
                point = end
                quadratic = control
            case "T":
                let control =
                    ["Q", "T"].contains(previous)
                    ? CGPoint(x: 2 * point.x - quadratic.x, y: 2 * point.y - quadratic.y) : point
                let end = try coordinate(relative)
                path.addQuadCurve(to: end, control: control)
                point = end
                quadratic = control
            case "A":
                let rx = try number()
                let ry = try number()
                let rotation = try number()
                let large = try number()
                let sweep = try number()
                guard [0, 1].contains(large), [0, 1].contains(sweep) else { throw SVGPathFailure() }
                let end = try coordinate(relative)
                arc(
                    path, from: point, to: end, rx: abs(rx), ry: abs(ry), rotation: rotation * .pi / 180,
                    large: large == 1, sweep: sweep == 1)
                point = end
            case "Z":
                path.closeSubpath()
                point = start
                command = ""
            default: throw SVGPathFailure()
            }
            previous = upper
        }
        return path
    }

    private static func arc(
        _ path: CGMutablePath, from a: CGPoint, to b: CGPoint, rx originalRX: Double, ry originalRY: Double,
        rotation: Double, large: Bool, sweep: Bool
    ) {
        guard a != b else { return }
        guard originalRX >= 0.00000001, originalRY >= 0.00000001 else {
            path.addLine(to: b)
            return
        }
        let cosPhi = cos(rotation)
        let sinPhi = sin(rotation)
        let dx = (a.x - b.x) / 2
        let dy = (a.y - b.y) / 2
        let x = cosPhi * dx + sinPhi * dy
        let y = -sinPhi * dx + cosPhi * dy
        var rx = originalRX
        var ry = originalRY
        let scale = x * x / (rx * rx) + y * y / (ry * ry)
        if scale > 1 {
            rx *= sqrt(scale)
            ry *= sqrt(scale)
        }
        let denominator = rx * rx * y * y + ry * ry * x * x
        guard denominator.isFinite, denominator > .leastNormalMagnitude else {
            path.addLine(to: b)
            return
        }
        let factor =
            (large == sweep ? -1.0 : 1.0)
            * sqrt(max(0, (rx * rx * ry * ry - denominator) / max(denominator, .leastNonzeroMagnitude)))
        let cxPrime = factor * rx * y / ry
        let cyPrime = -factor * ry * x / rx
        let cx = cosPhi * cxPrime - sinPhi * cyPrime + (a.x + b.x) / 2
        let cy = sinPhi * cxPrime + cosPhi * cyPrime + (a.y + b.y) / 2
        let theta = atan2((y - cyPrime) / ry, (x - cxPrime) / rx)
        var delta = atan2((-y - cyPrime) / ry, (-x - cxPrime) / rx) - theta
        if sweep && delta < 0 { delta += 2 * .pi }
        if !sweep && delta > 0 { delta -= 2 * .pi }
        guard [cx, cy, theta, delta].allSatisfy(\.isFinite) else {
            path.addLine(to: b)
            return
        }
        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / Double(segments)
        func position(_ angle: Double) -> CGPoint {
            CGPoint(
                x: cx + rx * cosPhi * cos(angle) - ry * sinPhi * sin(angle),
                y: cy + rx * sinPhi * cos(angle) + ry * cosPhi * sin(angle))
        }
        func derivative(_ angle: Double) -> CGPoint {
            CGPoint(
                x: -rx * cosPhi * sin(angle) - ry * sinPhi * cos(angle),
                y: -rx * sinPhi * sin(angle) + ry * cosPhi * cos(angle))
        }
        for segment in 0..<segments {
            let t0 = theta + Double(segment) * step
            let t1 = t0 + step
            let k = 4 / 3 * tan(step / 4)
            let p0 = position(t0)
            let p1 = position(t1)
            let d0 = derivative(t0)
            let d1 = derivative(t1)
            path.addCurve(
                to: segment == segments - 1 ? b : p1, control1: CGPoint(x: p0.x + k * d0.x, y: p0.y + k * d0.y),
                control2: CGPoint(x: p1.x - k * d1.x, y: p1.y - k * d1.y))
        }
    }
}

private final class SceneDrawing: UIView {
    var paint: (CGContext) -> Void = { _ in }
    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override func draw(_ rect: CGRect) { if let context = UIGraphicsGetCurrentContext() { paint(context) } }
}
