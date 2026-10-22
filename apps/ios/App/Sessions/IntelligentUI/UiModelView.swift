import ModelIO
import RuimtePulsar
import RuimteTransport
import SceneKit
import SceneKit.ModelIO
import SwiftUI

/// The formats an agent attaches as a model, told from the bytes as the daemon tells them (`apps/server/src/fs/sniff.ts`),
/// since the name says nothing about them.
enum UiModelFormat: Equatable {
    case gltfBinary
    case usdz
    case stl

    /// ModelIO reads STL and USDZ; glTF has no reader on the system and the app adds none.
    var opens: Bool { self != .gltfBinary }

    /// ModelIO picks its importer by the extension of the file it reads.
    var fileExtension: String {
        switch self {
        case .gltfBinary: "glb"
        case .usdz: "usdz"
        case .stl: "stl"
        }
    }

    private static let headBytes = 4096
    private static let stlHeaderBytes = 84
    private static let stlTriangleBytes = 50

    static func of(_ data: Data) -> Self? {
        let head = [UInt8](data.prefix(headBytes))
        if head.count >= 8, head.starts(with: Array("glTF".utf8)), uint32(head, at: 4) == 2 {
            return .gltfBinary
        }
        if isUsdz(data) {
            return .usdz
        }
        // The size rule goes first, since a binary header may just as well open with `solid`.
        if isBinaryStl(head, size: data.count) || isAsciiStl(head) {
            return .stl
        }
        return nil
    }

    private static func uint32(_ bytes: [UInt8], at offset: Int) -> UInt32 {
        (0..<4).reduce(UInt32(0)) { value, index in value | UInt32(bytes[offset + index]) << (8 * UInt32(index)) }
    }

    /// A USDZ package is a plain zip whose first entry the format requires to be the root layer.
    private static func isUsdz(_ data: Data) -> Bool {
        let header = [UInt8](data.prefix(30))
        guard header.count == 30, header.starts(with: [0x50, 0x4b, 0x03, 0x04]) else { return false }
        let nameLength = Int(header[26]) | Int(header[27]) << 8
        let name = [UInt8](data.dropFirst(30).prefix(nameLength))
        guard nameLength > 0, name.count == nameLength else { return false }
        return String(decoding: name, as: UTF8.self).lowercased().range(of: #"\.usd[ac]?$"#, options: .regularExpression)
            != nil
    }

    private static func isBinaryStl(_ head: [UInt8], size: Int) -> Bool {
        guard head.count >= stlHeaderBytes else { return false }
        let triangles = Int(uint32(head, at: 80))
        return triangles > 0 && size == stlHeaderBytes + stlTriangleBytes * triangles
    }

    /// An ASCII STL opens a solid and says `facet normal` soon after, or closes it at once when it is empty.
    private static func isAsciiStl(_ head: [UInt8]) -> Bool {
        let text = String(head.map { Character(Unicode.Scalar($0)) }).lowercased()
            .drop { $0.isWhitespace }
        guard text.hasPrefix("solid") else { return false }
        let rest = text.dropFirst(5)
        guard rest.first.map(\.isWhitespace) ?? true else { return false }
        return text.range(of: #"\bfacet\s+normal\b"#, options: .regularExpression) != nil
            || text.range(of: #"\bendsolid\b"#, options: .regularExpression) != nil
    }
}

/// A model opened for SceneKit, framed on its bounds. The file ModelIO read goes with it, since a USDZ's textures may
/// still be read from it.
final class UiModelScene: @unchecked Sendable {
    let scene: SCNScene
    let camera: SCNNode
    let home: SCNMatrix4
    private let neutral: SCNMaterial?
    private let file: URL

    private init(scene: SCNScene, camera: SCNNode, neutral: SCNMaterial?, file: URL) {
        self.scene = scene
        self.camera = camera
        self.home = camera.transform
        self.neutral = neutral
        self.file = file
    }

    deinit {
        try? FileManager.default.removeItem(at: file)
    }

    /// The gray an STL is drawn in, lighter on a light ground and darker on a dark one.
    @MainActor func follow(dark: Bool) {
        neutral?.diffuse.contents = UIColor(white: dark ? 0.62 : 0.74, alpha: 1)
    }

    /// Nil when ModelIO cannot read the bytes or they hold nothing to draw.
    static func open(_ data: Data, format: UiModelFormat) -> UiModelScene? {
        guard format.opens else { return nil }
        let folder = FileManager.default.temporaryDirectory.appending(path: "models", directoryHint: .isDirectory)
        let file = folder.appending(path: "\(UUID().uuidString).\(format.fileExtension)")
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: file)
        } catch {
            return nil
        }
        guard let model = build(file, format: format) else {
            try? FileManager.default.removeItem(at: file)
            return nil
        }
        return model
    }

    private static func build(_ file: URL, format: UiModelFormat) -> UiModelScene? {
        var problem: NSError?
        let asset = MDLAsset(
            url: file, vertexDescriptor: nil, bufferAllocator: nil, preserveTopology: false, error: &problem)
        guard problem == nil, asset.count > 0 else { return nil }
        let neutral: SCNMaterial?
        if format == .stl {
            addMissingNormals(asset)
            neutral = SCNMaterial()
            neutral?.lightingModel = .physicallyBased
            neutral?.roughness.contents = 0.55
            neutral?.metalness.contents = 0.0
            neutral?.isDoubleSided = true
        } else {
            asset.loadTextures()
            neutral = nil
        }
        let loaded = SCNScene(mdlAsset: asset)
        let scene = SCNScene()
        let frame = SCNNode()
        let model = SCNNode()
        // An STL is Z-up; turned like the desktop's viewer turns it, so both show the same side on top.
        if format == .stl {
            model.eulerAngles.x = -.pi / 2
        }
        for child in loaded.rootNode.childNodes {
            model.addChildNode(child)
        }
        frame.addChildNode(model)
        scene.rootNode.addChildNode(frame)
        if let neutral {
            model.enumerateHierarchy { node, _ in node.geometry?.materials = [neutral] }
        }
        guard let bounds = bounds(of: model, in: frame) else { return nil }
        let center = (bounds.min + bounds.max) * 0.5
        let radius = simd_length(bounds.max - bounds.min) / 2
        guard radius.isFinite, radius > 0 else { return nil }
        model.position = SCNVector3(-center)

        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 40
        camera.camera?.automaticallyAdjustsZRange = true
        let distance = radius / sin(Float(20 * Double.pi / 180)) * 1.1
        camera.simdPosition = simd_normalize(SIMD3<Float>(0.6, 0.45, 1)) * distance
        camera.simdLook(at: .zero)
        scene.rootNode.addChildNode(camera)
        light(scene)
        return UiModelScene(scene: scene, camera: camera, neutral: neutral, file: file)
    }

    private static func addMissingNormals(_ asset: MDLAsset) {
        for index in 0..<asset.count {
            visit(asset.object(at: index)) { object in
                guard let mesh = object as? MDLMesh,
                    mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributeNormal) == nil
                else { return }
                mesh.addNormals(withAttributeNamed: MDLVertexAttributeNormal, creaseThreshold: 0.5)
            }
        }
    }

    private static func visit(_ object: MDLObject, _ body: (MDLObject) -> Void) {
        body(object)
        for child in object.children.objects {
            visit(child, body)
        }
    }

    /// The corners of every geometry in the frame's space, so the turn of an STL counts.
    private static func bounds(of model: SCNNode, in frame: SCNNode) -> (min: SIMD3<Float>, max: SIMD3<Float>)? {
        var low = SIMD3<Float>(repeating: .infinity)
        var high = SIMD3<Float>(repeating: -.infinity)
        model.enumerateHierarchy { node, _ in
            guard let geometry = node.geometry else { return }
            let (lower, upper) = geometry.boundingBox
            for corner in 0..<8 {
                let point = SCNVector3(
                    corner & 1 == 0 ? lower.x : upper.x, corner & 2 == 0 ? lower.y : upper.y,
                    corner & 4 == 0 ? lower.z : upper.z)
                let placed = SIMD3<Float>(node.convertPosition(point, to: frame))
                low = simd_min(low, placed)
                high = simd_max(high, placed)
            }
        }
        return low.x <= high.x ? (low, high) : nil
    }

    /// Light that stays put while the camera turns: a soft environment for physically based materials, a key and a fill.
    private static func light(_ scene: SCNScene) {
        scene.lightingEnvironment.contents = UIColor(white: 0.55, alpha: 1)
        scene.lightingEnvironment.intensity = 1
        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        ambient.light?.intensity = 250
        scene.rootNode.addChildNode(ambient)
        for (direction, intensity) in [(SIMD3<Float>(-0.5, -1, -0.6), 900.0), (SIMD3<Float>(0.7, -0.3, 0.8), 400.0)] {
            let node = SCNNode()
            node.light = SCNLight()
            node.light?.type = .directional
            node.light?.intensity = CGFloat(intensity)
            node.simdLook(at: direction, up: SIMD3<Float>(0, 1, 0), localFront: SIMD3<Float>(0, 0, -1))
            scene.rootNode.addChildNode(node)
        }
    }
}

enum UiModelPhase {
    case waiting
    case ready(UiModelScene)
    /// A format the app does not draw, like glTF, with what went wrong when something did.
    case row(problem: String?)

    @MainActor static func load(attachment: String, chat: ChatContentContext) async -> Self {
        let resource: JSONValue = .object([
            "kind": .string("attachment"), "chatId": .string(chat.chatID), "attachmentId": .string(attachment),
        ])
        guard let bytes = try? await chat.client.readResource(resource, maxBytes: WireConstants.chatModelMaxBytes)
        else { return .row(problem: String(localized: "Model unavailable")) }
        guard let format = UiModelFormat.of(bytes.data) else {
            return .row(problem: String(localized: "Could not open the model"))
        }
        guard format.opens else { return .row(problem: nil) }
        let data = bytes.data
        let scene = await Task.detached(priority: .userInitiated) { UiModelScene.open(data, format: format) }.value
        return scene.map { .ready($0) } ?? .row(problem: String(localized: "Could not open the model"))
    }
}

/// A 3D model of the chat, read through the chat's resources only once the block comes on screen. The scene goes when
/// the block leaves it, so a thread of models holds only those in view.
struct UiModelView: View {
    let node: UiNode
    @Environment(\.chatContent) private var chat
    @Environment(\.colorScheme) private var colorScheme
    @State private var phase: UiModelPhase = .waiting
    @State private var resets = 0

    static let height: CGFloat = 320

    var body: some View {
        let caption = node.label
        let alt = node.string("alt")
        let attachment = node.string("attachment")
        let label = alt ?? (caption.isEmpty ? String(localized: "3D model") : caption)
        VStack(alignment: .leading, spacing: 6) {
            switch phase {
            case .ready(let model):
                UiSceneView(model: model, label: label, dark: colorScheme == .dark, resets: resets)
                    .frame(maxWidth: .infinity).frame(height: Self.height)
                    .background(MobileStyle.hover)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
                    .overlay(alignment: .topTrailing) {
                        Button {
                            resets += 1
                        } label: {
                            Image(lucide: "rotate-ccw", size: 14).foregroundStyle(MobileStyle.muted)
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(String(localized: "Reset camera"))
                    }
            case .waiting:
                UiModelRow(name: alt ?? attachment ?? label, loading: true, problem: nil)
            case .row(let problem):
                UiModelRow(name: alt ?? attachment ?? label, loading: false, problem: problem)
            }
            if !caption.isEmpty {
                Text(caption).font(.footnote).foregroundStyle(MobileStyle.muted).padding(.horizontal, 8)
            }
        }
        .padding(.horizontal, 8)
        .task(id: attachment) {
            if case .row = phase { return }
            guard let attachment, let chat else {
                phase = .row(problem: String(localized: "Model unavailable"))
                return
            }
            let loaded = await UiModelPhase.load(attachment: attachment, chat: chat)
            if !Task.isCancelled { phase = loaded }
        }
        .onDisappear {
            if case .ready = phase { phase = .waiting }
        }
    }
}

/// The calm row for a model the app does not draw: what it is, its name and, under it, why when something failed.
private struct UiModelRow: View {
    let name: String
    let loading: Bool
    let problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(lucide: "box", size: 14).foregroundStyle(MobileStyle.muted)
                Text(verbatim: name).foregroundStyle(MobileStyle.text).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                if loading {
                    Spinner(size: 12).foregroundStyle(MobileStyle.faint)
                } else {
                    Text("3D model").foregroundStyle(MobileStyle.faint)
                }
            }
            .font(.footnote)
            .padding(.horizontal, 12).frame(minHeight: 44)
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(MobileStyle.border) }
            if let problem {
                Text(problem).font(.caption).foregroundStyle(MobileStyle.faint)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct UiSceneView: UIViewRepresentable {
    let model: UiModelScene
    let label: String
    let dark: Bool
    let resets: Int

    final class Coordinator {
        var resets = 0
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero)
        view.backgroundColor = .clear
        view.antialiasingMode = .multisampling4X
        view.allowsCameraControl = true
        view.defaultCameraController.interactionMode = .orbitTurntable
        view.scene = model.scene
        view.pointOfView = model.camera
        view.defaultCameraController.target = SCNVector3Zero
        view.isAccessibilityElement = true
        view.accessibilityTraits = .image
        view.accessibilityLabel = label
        context.coordinator.resets = resets
        model.follow(dark: dark)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        if view.scene !== model.scene {
            view.scene = model.scene
            view.pointOfView = model.camera
        }
        if context.coordinator.resets != resets {
            context.coordinator.resets = resets
            model.camera.transform = model.home
            view.pointOfView = model.camera
            view.defaultCameraController.target = SCNVector3Zero
        }
        view.accessibilityLabel = label
        model.follow(dark: dark)
    }

    static func dismantleUIView(_ view: SCNView, coordinator: Coordinator) {
        view.scene = nil
        view.pointOfView = nil
    }
}
