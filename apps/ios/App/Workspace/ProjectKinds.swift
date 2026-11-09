import Foundation
import RuimtePulsar

/// What the phone knows of one kind of view or canvas node: its mark, its words and the few rules that hang on the
/// kind. Every list, picker and reference row reads this table, so a kind is added in one place. A kind of
/// `WireVocabulary.nodeKinds` or `viewKinds` without a row fails a test; a kind a newer machine adds is not in the
/// table, and each reader keeps its own fallback for it.
struct ProjectKind: Sendable {
    let kind: String
    /// The Lucide mark when nobody picked one, as the desktop's `ViewGlyph` and `NODE_KIND_ICONS`.
    let icon: String
    private let name: LocalizedStringResource
    /// The mark of a reference chip to a view of this kind, where the desktop's `REFERENCE_ICONS` differs from the
    /// mark of its list row.
    let referenceIcon: String?
    let isDivider: Bool
    /// Its page has nothing to show until the project opened, and for a terminal until its session exists.
    let waitsForSession: Bool
    /// A node of this kind is something that runs, which a canvas lists under it and opens as a view of its own.
    let runs: Bool
    let editsOnCanvas: Bool
    let isReferable: Bool

    init(
        _ kind: String, icon: String, name: LocalizedStringResource, referenceIcon: String? = nil,
        isDivider: Bool = false, waitsForSession: Bool = false, runs: Bool = false, editsOnCanvas: Bool = false,
        isReferable: Bool = false
    ) {
        self.kind = kind
        self.icon = icon
        self.name = name
        self.referenceIcon = referenceIcon
        self.isDivider = isDivider
        self.waitsForSession = waitsForSession
        self.runs = runs
        self.editsOnCanvas = editsOnCanvas
        self.isReferable = isReferable
    }

    var label: String { String(localized: name) }
}

enum ProjectKinds {
    static let all: [ProjectKind] = [
        ProjectKind("canvas", icon: "frame", name: "Canvas", waitsForSession: true, isReferable: true),
        ProjectKind("chat", icon: "message-square", name: "Chat", runs: true, editsOnCanvas: true, isReferable: true),
        ProjectKind(
            "terminal", icon: "terminal", name: "Terminal", waitsForSession: true, runs: true, editsOnCanvas: true,
            isReferable: true),
        ProjectKind("browser", icon: "globe", name: "Browser", runs: true, editsOnCanvas: true, isReferable: true),
        ProjectKind("device", icon: "smartphone", name: "Device", runs: true, editsOnCanvas: true, isReferable: true),
        ProjectKind("separator", icon: "minus", name: "Separator", isDivider: true),
        ProjectKind("subheader", icon: "heading", name: "Subheader", isDivider: true),
        ProjectKind("drawing", icon: "pen-tool", name: "Drawing", editsOnCanvas: true, isReferable: true),
        ProjectKind("diagram", icon: "workflow", name: "Diagram", editsOnCanvas: true, isReferable: true),
        ProjectKind("file", icon: "file-text", name: "File", editsOnCanvas: true, isReferable: true),
        ProjectKind("database", icon: "table", name: "Database", referenceIcon: "database", isReferable: true),
        ProjectKind("note", icon: "sticky-note", name: "Note", editsOnCanvas: true, isReferable: true),
        ProjectKind("group", icon: "layout-grid", name: "Group", waitsForSession: true, editsOnCanvas: true),
        ProjectKind("artifact", icon: "package", name: "Output"),
        ProjectKind("design", icon: "swatch-book", name: "Design", isReferable: true),
        ProjectKind("routine", icon: "calendar-clock", name: "Routine"),
    ]

    static let newView = ["terminal", "canvas", "browser", "file", "drawing", "diagram"]
    static let addView = ["chat", "terminal", "canvas", "browser", "file", "drawing", "diagram", "separator", "subheader"]
    static let addNode = ["chat", "terminal", "browser", "file", "note", "group"]

    private static let byKind = Dictionary(uniqueKeysWithValues: all.map { ($0.kind, $0) })

    static func row(_ kind: String) -> ProjectKind? { byKind[kind] }

    /// The label of a kind; a newer machine's kind reads as its own name.
    static func label(_ kind: String) -> String { row(kind)?.label ?? kind.capitalized }

    static func isDivider(_ kind: String) -> Bool { row(kind)?.isDivider ?? false }
    static func waitsForSession(_ kind: String) -> Bool { row(kind)?.waitsForSession ?? false }
    static func runs(_ kind: String) -> Bool { row(kind)?.runs ?? false }
    static func editsOnCanvas(_ kind: String) -> Bool { row(kind)?.editsOnCanvas ?? false }
    static func isReferable(_ kind: String) -> Bool { row(kind)?.isReferable ?? false }
}
