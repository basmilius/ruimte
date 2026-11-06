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

    /// The word the wire uses for this kind of view.
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

    /// The rows that divide the list rather than stand in it.
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

    /// The nodes of a canvas; every other view has none.
    var nodes: [StoredNode] { canvas?.nodes ?? [] }
}

extension JSONValue {
    /// One view of a project document, or nil for a shape the generated types do not read.
    var storedView: StoredView? { try? decoded(as: StoredView.self) }
}

extension [JSONValue] {
    /// The views a screen reads; a view that does not read leaves the others in place.
    var storedViews: [StoredView] { compactMap(\.storedView) }
}
