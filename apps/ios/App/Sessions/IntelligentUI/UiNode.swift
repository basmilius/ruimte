import Foundation
import RuimtePulsar

/// One evaluated node of a block, as the interpreter hands it over: props are already evaluated and validated, a
/// binding carries only its current value, and the renderer never sees an expression.
struct UiNode: Identifiable, Equatable {
    let id: String
    let sourceID: String
    let type: String
    let props: [String: JSONValue]
    let bindings: [String: JSONValue]
    let children: [UiNode]
    let complete: Bool
    let fallback: String
    /// The interpreter's code for a node it could not evaluate, which then draws its fallback.
    let error: String?

    init?(_ value: JSONValue) {
        guard let id = value["id"]?.stringValue, let type = value["type"]?.stringValue else { return nil }
        self.id = id
        sourceID = value["sourceId"]?.stringValue ?? id
        self.type = type
        props = value["props"]?.objectValue ?? [:]
        bindings = value["bindings"]?.objectValue ?? [:]
        children = (value["children"]?.arrayValue ?? []).compactMap(UiNode.init)
        complete = value["complete"]?.boolValue == true
        fallback = value["fallback"]?.stringValue ?? ""
        error = value["error"]?.stringValue
    }

    static func list(_ values: [JSONValue]) -> [UiNode] { values.compactMap(UiNode.init) }

    var isText: Bool { type == "$text" }
    var text: String { props["text"]?.stringValue ?? "" }

    func string(_ key: String) -> String? { props[key]?.stringValue }
    func number(_ key: String) -> Double? { props[key]?.numberValue.flatMap { $0.isFinite ? $0 : nil } }
    func bool(_ key: String) -> Bool? { props[key]?.boolValue }
    var tone: UiTone? { string("tone").flatMap(UiTone.init(rawValue:)) }

    /// The current value of an input's binding, or nil for a node that is not bound.
    var boundValue: JSONValue? { bindings["value"]?["value"] }

    /// Every `$text` below this node joined as written, such as the code of a CodeBlock.
    var nodeText: String { children.map { $0.isText ? $0.text : $0.nodeText }.joined() }

    /// The same text on one line, for a name a control or VoiceOver needs as a string.
    var label: String {
        nodeText.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// The valid children of one kind, which a parent reads as metadata: the columns of a table, the tabs of a strip.
    func children(of type: String) -> [UiNode] { children.filter { $0.type == type && $0.error == nil } }

    var isBlankText: Bool { isText && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

enum UiTone: String {
    case neutral, info, success, warning, danger

    /// Every tone has an icon of its own, so color is never the only thing that tells two apart.
    var icon: String {
        switch self {
        case .neutral: "message-circle"
        case .info: "info"
        case .success: "circle-check"
        case .warning: "triangle-alert"
        case .danger: "octagon-alert"
        }
    }
}

/// What the interpreter knows about the components of this version, so a newer one reads as unknown.
enum UiCatalog {
    static let version = 1
    static let components: Set<String> = [
        "Summary", "Callout", "Tag", "Progress", "Steps", "Step", "Stats", "Stat", "EntityList", "Entry", "Table",
        "Column", "Chart", "Tabs", "Tab", "Sections", "Section", "CodeBlock", "Image", "Sources", "Source", "File",
        "Diff", "Commit", "Node", "Checklist", "Item", "Switch", "Slider", "Segmented", "Option", "Show", "Each",
        "Choices", "Choice",
    ]
    static let links: Set<String> = ["File", "Diff", "Commit", "Node"]
    /// Parents whose text is read as written: code, a short tag and the labels of controls, whose accessible name
    /// and sent text are that same string.
    static let literalParents: Set<String> = [
        "CodeBlock", "Tag", "Choice", "Item", "Switch", "Slider", "Segmented", "Option", "Column",
    ]

    /// Which `$text` nodes of a block the agent wrote out; the value of an expression is data and stays as it is.
    static func writtenTexts(_ nodes: [JSONValue]) -> Set<String> {
        var written: Set<String> = []
        func visit(_ nodes: [JSONValue]) {
            for node in nodes {
                if node["type"]?.stringValue == "$text", node["expressions"]?["text"] == nil,
                    let id = node["id"]?.stringValue
                {
                    written.insert(id)
                }
                visit(node["children"]?.arrayValue ?? [])
            }
        }
        visit(nodes)
        return written
    }

    /// The Summary that heads a block is its first node; a Summary further down is a subheading.
    static func head(_ nodes: [UiNode]) -> UiNode? {
        guard let first = nodes.first, first.type == "Summary", first.error == nil else { return nil }
        return first
    }

    /// Inline Markdown in a Summary, without the marks, for the name VoiceOver gives the block.
    static func plainLabel(_ text: String) -> String {
        text.replacingOccurrences(of: #"\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"\*\*|`"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// Whether a node flows inside a paragraph rather than standing as a row of its own.
    static func isInline(_ node: UiNode) -> Bool {
        if node.isText { return true }
        return node.error == nil && (node.type == "Tag" || (links.contains(node.type) && node.children.isEmpty))
    }
}

/// Why a part of a block is drawn as its Markdown.
enum UiFallbackProblem: Equatable {
    case unknown(String)
    case failed

    static func of(_ node: UiNode, catalogVersion: Int?) -> Self? {
        if node.isText { return nil }
        if catalogVersion != UiCatalog.version || node.error == "unknown_catalog" { return .unknown(node.type) }
        if node.error == "unknown_component" || !UiCatalog.components.contains(node.type) { return .unknown(node.type) }
        return node.error == nil ? nil : .failed
    }
}

/// Why a whole block is drawn as its text, or nil when its nodes are drawn.
enum UiBlockText: Equatable {
    case unreadable
    case tooLarge
    case diagnostic(String)

    static func of(block: JSONValue, evaluated: [UiNode], diagnostics: [JSONValue], error: String?) -> Self? {
        if block["catalogVersion"]?.numberValue != Double(UiCatalog.version) { return .unreadable }
        let written = block["nodes"]?.arrayValue ?? []
        let compiled = block["diagnostics"]?.arrayValue ?? []
        if written.isEmpty, let first = compiled.first {
            return first["code"]?.stringValue == "over_budget"
                ? .tooLarge : .diagnostic(first["message"]?.stringValue ?? "")
        }
        if diagnostics.contains(where: { $0["code"] == .string("budget_exceeded") }) { return .tooLarge }
        if evaluated.isEmpty, !written.isEmpty, error != nil { return .unreadable }
        return nil
    }
}

/// Something the compiler or the interpreter repaired, such as a prop it dropped; never an error to a person.
struct UiBlockFix: Equatable {
    let code: String
    let message: String

    static func list(_ values: [JSONValue]) -> [Self] {
        values.compactMap { value in
            guard let code = value["code"]?.stringValue else { return nil }
            return Self(code: code, message: value["message"]?.stringValue ?? "")
        }
    }
}
