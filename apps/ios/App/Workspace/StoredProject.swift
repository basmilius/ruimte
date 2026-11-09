import Foundation
import RuimtePulsar

/*
 * The project document is merged and saved as JSON, so a kind or a key this app has no word for survives a save. These
 * are the views of it that the screens read: the generated types over the same JSON, never a copy that gets written
 * back.
 */

extension StoredView: Identifiable {
    public var id: String {
        switch self {
        case .canvas(let view): view.id
        case .chat(let view): view.id
        case .terminal(let view): view.id
        case .browser(let view): view.id
        case .device(let view): view.id
        case .drawing(let view): view.id
        case .diagram(let view): view.id
        case .file(let view): view.id
        case .database(let view): view.id
        case .separator(let view): view.id
        case .subheader(let view): view.id
        case .artifact(let view): view.id
        case .design(let view): view.id
        case .unknown(let view): view.id
        }
    }

    var name: String {
        switch self {
        case .canvas(let view): view.name
        case .chat(let view): view.name
        case .terminal(let view): view.name
        case .browser(let view): view.name
        case .device(let view): view.name
        case .drawing(let view): view.name
        case .diagram(let view): view.name
        case .file(let view): view.name
        case .database(let view): view.name
        case .separator(let view): view.name ?? ""
        case .subheader(let view): view.name
        case .artifact(let view): view.name
        case .design(let view): view.name
        case .unknown(let view): view.name
        }
    }

    var kind: String {
        switch self {
        case .canvas: "canvas"
        case .chat: "chat"
        case .terminal: "terminal"
        case .browser: "browser"
        case .device: "device"
        case .drawing: "drawing"
        case .diagram: "diagram"
        case .file: "file"
        case .database: "database"
        case .separator: "separator"
        case .subheader: "subheader"
        case .artifact: "artifact"
        case .design: "design"
        case .unknown: "unknown"
        }
    }

    /// The mark a person chose; a separator and a subheader have none.
    var icon: MachineIcon? {
        switch self {
        case .canvas(let view): view.icon
        case .chat(let view): view.icon
        case .terminal(let view): view.icon
        case .browser(let view): view.icon
        case .device(let view): view.icon
        case .drawing(let view): view.icon
        case .diagram(let view): view.icon
        case .file(let view): view.icon
        case .database(let view): view.icon
        case .artifact(let view): view.icon
        case .design(let view): view.icon
        case .separator, .subheader, .unknown: nil
        }
    }

    var isDivider: Bool {
        switch self {
        case .separator, .subheader: true
        default: false
        }
    }

    var canvas: StoredCanvasView? {
        if case .canvas(let view) = self { return view }
        return nil
    }

    var deviceReference: StoredDeviceViewDevice? {
        if case .device(let view) = self { return view.device }
        return nil
    }

    var nodes: [StoredNode] { canvas?.nodes ?? [] }
}

extension JSONValue {
    var storedView: StoredView? { try? decoded(as: StoredView.self) }
}

extension [JSONValue] {
    /// The views a screen reads; a view that does not read leaves the others in place.
    var storedViews: [StoredView] { compactMap(\.storedView) }
}

/// A view of a project, or a node on one of its canvases, as the lists and pages read it. Reading only: an edit goes
/// through the JSON document, so a kind or a key this app has no word for survives a save.
struct ProjectItem: Identifiable, Hashable {
    struct ArtifactReference: Hashable {
        let id: String
        let version: String?
    }

    let id: String
    let kind: String
    let isView: Bool
    let name: String
    let icon: String?
    let provider: String?
    let url: String?
    let path: String?
    let body: String?
    /// The drawing or diagram a node stands for, when it is not the node itself.
    let viewId: String?
    let browserOwner: String?
    let artifact: ArtifactReference?
    let hidden: Bool
    let drawnBy: String?
    let empty: Bool
    let nodes: [ProjectItem]

    init(_ view: StoredView) {
        id = view.id
        kind = view.kind
        isView = true
        name = view.name
        icon = view.icon.flatMap { $0.kind == "lucide" ? $0.value : nil }
        nodes = view.nodes.map(ProjectItem.init)
        viewId = nil
        body = nil
        switch view {
        case .chat(let view):
            provider = view.node.provider
            artifact = view.node.artifact.map { ArtifactReference(id: $0.id, version: $0.version) }
            url = nil
            path = nil
            browserOwner = nil
            hidden = view.hidden == true
            drawnBy = view.drawnBy
            empty = view.empty == true
        case .terminal(let view):
            provider = view.node.provider
            artifact = view.node.artifact.map { ArtifactReference(id: $0.id, version: $0.version) }
            url = nil
            path = nil
            browserOwner = nil
            hidden = false
            drawnBy = nil
            empty = false
        case .artifact(let view):
            provider = view.node.provider
            artifact = view.node.artifact.map { ArtifactReference(id: $0.id, version: $0.version) }
            url = nil
            path = nil
            browserOwner = nil
            hidden = false
            drawnBy = nil
            empty = false
        case .design(let view):
            provider = view.node.provider
            artifact = view.node.artifact.map { ArtifactReference(id: $0.id, version: $0.version) }
            url = nil
            path = view.path
            browserOwner = nil
            hidden = false
            drawnBy = nil
            empty = false
        case .browser(let view):
            provider = nil
            artifact = nil
            url = view.url
            path = nil
            browserOwner = view.browserOwner
            hidden = false
            drawnBy = nil
            empty = false
        case .file(let view):
            provider = nil
            artifact = nil
            url = nil
            path = view.path
            browserOwner = nil
            hidden = false
            drawnBy = nil
            empty = false
        case .canvas(let view):
            provider = nil
            artifact = nil
            url = nil
            path = nil
            browserOwner = nil
            hidden = view.hidden == true
            drawnBy = nil
            empty = false
        default:
            provider = nil
            artifact = nil
            url = nil
            path = nil
            browserOwner = nil
            hidden = false
            drawnBy = nil
            empty = false
        }
    }

    init(_ node: StoredNode) {
        id = node.id
        kind = node.kind.rawValue
        isView = false
        name = node.title
        icon = nil
        provider = node.provider
        url = node.url
        path = node.path
        body = node.body
        viewId = node.viewId
        browserOwner = node.browserOwner
        artifact = node.artifact.map { ArtifactReference(id: $0.id, version: $0.version) }
        hidden = false
        drawnBy = nil
        empty = false
        nodes = []
    }

    /// A view as the machine's sidebar lists it, which is all a page knows of it before the project opens.
    init(_ view: ProjectSidebarView) {
        id = view.id
        kind = view.kind.rawValue
        isView = true
        name = view.name
        icon = view.icon?.value
        provider = view.provider
        url = nil
        path = view.path
        body = nil
        viewId = nil
        browserOwner = nil
        artifact = nil
        hidden = false
        drawnBy = nil
        empty = false
        nodes = view.nodes.map(ProjectItem.init)
    }

    init(_ node: ProjectSidebarNode) {
        id = node.id
        kind = node.kind.rawValue
        isView = false
        name = node.title
        icon = nil
        provider = node.provider
        url = nil
        path = nil
        body = nil
        viewId = nil
        browserOwner = nil
        artifact = nil
        hidden = false
        drawnBy = nil
        empty = false
        nodes = []
    }

    var isDivider: Bool { ProjectKinds.isDivider(kind) }

    var title: String { name.isEmpty ? ProjectKinds.label(kind) : name }
}

extension JSONValue {
    var projectItem: ProjectItem? { storedView.map(ProjectItem.init) }
}
