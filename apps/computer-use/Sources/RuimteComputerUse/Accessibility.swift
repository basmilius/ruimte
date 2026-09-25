import ApplicationServices
import ComputerUseCore
import Foundation

enum AX {
    static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
            return nil
        }
        return value
    }

    static func element(_ element: AXUIElement, _ name: String) -> AXUIElement? {
        guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else {
            return nil
        }
        return (value as! AXUIElement)
    }

    static func children(_ element: AXUIElement) -> [AXUIElement] {
        attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
    }

    static func string(_ element: AXUIElement, _ name: String) -> String? {
        attribute(element, name) as? String
    }

    static func role(_ element: AXUIElement) -> String? {
        string(element, kAXRoleAttribute)
    }

    static func frame(_ element: AXUIElement) -> CGRect? {
        frame(position: attribute(element, kAXPositionAttribute), size: attribute(element, kAXSizeAttribute))
    }

    static func frame(position: CFTypeRef?, size: CFTypeRef?) -> CGRect? {
        guard let position, let size,
              CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else {
            return nil
        }
        var origin = CGPoint.zero
        var extent = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &origin),
              AXValueGetValue(size as! AXValue, .cgSize, &extent) else {
            return nil
        }
        return CGRect(origin: origin, size: extent)
    }

    static func actions(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success else {
            return []
        }
        return names as? [String] ?? []
    }

    static func isSettable(_ element: AXUIElement, _ name: String) -> Bool {
        var settable = DarwinBoolean(false)
        guard AXUIElementIsAttributeSettable(element, name as CFString, &settable) == .success else {
            return false
        }
        return settable.boolValue
    }

    static func pid(_ element: AXUIElement) -> pid_t? {
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success else {
            return nil
        }
        return pid
    }

    /// The window a person would be typing into: focused, then main, then the first standard window.
    static func keyWindow(of application: AXUIElement) -> AXUIElement? {
        if let window = element(application, kAXFocusedWindowAttribute) {
            return window
        }
        if let window = element(application, kAXMainWindowAttribute) {
            return window
        }
        let windows = attribute(application, kAXWindowsAttribute) as? [AXUIElement] ?? []
        return windows.first { string($0, kAXSubroleAttribute) == kAXStandardWindowSubrole } ?? windows.first
    }

    /// Context menus and open pop-up menus hang off the application element, outside every window.
    static func openMenus(of application: AXUIElement) -> [AXUIElement] {
        children(application).filter { role($0) == kAXMenuRole }
    }

    static func ancestors(of element: AXUIElement, limit: Int = 100) -> [AXUIElement] {
        var result: [AXUIElement] = []
        var current = self.element(element, kAXParentAttribute)
        while let node = current, result.count < limit {
            result.append(node)
            current = self.element(node, kAXParentAttribute)
        }
        return result
    }

    /// An element and what sits inside it, in tree order, with their frames, read one round trip per element.
    static func layout(of root: AXUIElement, limit: Int) -> [(element: AXUIElement, laid: Clipping.Laid)] {
        let names = [kAXPositionAttribute, kAXSizeAttribute, kAXChildrenAttribute] as CFArray
        var result: [(element: AXUIElement, laid: Clipping.Laid)] = []
        var pending: [(element: AXUIElement, depth: Int)] = [(root, 0)]
        while let (node, depth) = pending.popLast(), result.count < limit {
            var raw: CFArray?
            let values = AXUIElementCopyMultipleAttributeValues(node, names, AXCopyMultipleAttributeOptions(rawValue: 0), &raw) == .success
                ? raw as? [AnyObject] ?? [] : []
            let value: (Int) -> CFTypeRef? = { index in values.indices.contains(index) ? values[index] : nil }
            result.append((node, Clipping.Laid(depth: depth, frame: frame(position: value(0), size: value(1)))))
            let children = value(2) as? [AXUIElement] ?? []
            pending.append(contentsOf: children.reversed().map { ($0, depth + 1) })
        }
        return result
    }

    /// The window an element sits in, and the sheet in between when there is one.
    static func container(of element: AXUIElement) -> (window: AXUIElement?, sheet: AXUIElement?) {
        var sheet: AXUIElement?
        for node in [element] + ancestors(of: element) {
            let role = role(node)
            if role == kAXSheetRole && sheet == nil {
                sheet = node
            }
            if role == kAXWindowRole {
                return (node, sheet)
            }
        }
        return (nil, sheet)
    }

    static func isSameOrDescendant(_ candidate: AXUIElement, of element: AXUIElement) -> Bool {
        if CFEqual(candidate, element) {
            return true
        }
        return ancestors(of: candidate).contains { CFEqual($0, element) }
    }

    /// Short answer to "what did this land on" for action results.
    static func summary(_ element: AXUIElement?) -> [String: Any] {
        guard let element else {
            return ["role": "unknown"]
        }
        var result: [String: Any] = [:]
        if let info = ElementInfo.read(element) {
            result["role"] = info.roleName
            if let label = info.label {
                result["label"] = TreeWalker.clip(label, limit: 80).text
            }
            if let identifier = info.identifier {
                result["identifier"] = identifier
            }
        }
        let (window, sheet) = container(of: element)
        if let window {
            result["window"] = VisibleText.clean(string(window, kAXTitleAttribute)) ?? ""
        }
        if let sheet {
            result["sheet"] = sheetLabel(sheet)
        }
        return result
    }

    static func sheetLabel(_ sheet: AXUIElement) -> String {
        ElementInfo.read(sheet)?.label ?? ""
    }

    static func describe(_ value: CFTypeRef?) -> String? {
        guard let value else {
            return nil
        }
        if let text = value as? String {
            return text
        }
        if let attributed = value as? NSAttributedString {
            return attributed.string
        }
        if CFGetTypeID(value) == CFBooleanGetTypeID() {
            return (value as? Bool) == true ? "true" : "false"
        }
        if let number = value as? NSNumber {
            return number.stringValue
        }
        return nil
    }
}

struct ElementInfo {
    static let attributes: [String] = [
        kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXValueAttribute,
        kAXDescriptionAttribute, kAXPlaceholderValueAttribute, kAXPositionAttribute, kAXSizeAttribute,
        kAXChildrenAttribute, kAXEnabledAttribute, kAXFocusedAttribute, kAXSelectedAttribute,
        kAXIdentifierAttribute,
    ]

    var role = ""
    var subrole: String?
    var title: String?
    var value: String?
    var valueIsText = false
    var description: String?
    var placeholder: String?
    var frame: CGRect?
    var children: [AXUIElement] = []
    var enabled = true
    var focused = false
    var selected = false
    var identifier: String?

    /// Reads every attribute in one round trip, which keeps a large tree from costing thousands of IPC calls.
    static func read(_ element: AXUIElement) -> ElementInfo? {
        var raw: CFArray?
        let names = attributes as CFArray
        guard AXUIElementCopyMultipleAttributeValues(element, names, AXCopyMultipleAttributeOptions(rawValue: 0), &raw) == .success,
              let values = raw as? [AnyObject], values.count == attributes.count else {
            return nil
        }
        let present: [CFTypeRef?] = values.map { value in
            if CFGetTypeID(value) == AXValueGetTypeID() && AXValueGetType(value as! AXValue) == .axError {
                return nil
            }
            return value
        }
        var info = ElementInfo()
        info.role = present[0] as? String ?? ""
        info.subrole = present[1] as? String
        info.title = VisibleText.clean(present[2] as? String)
        info.valueIsText = present[3] is String || present[3] is NSAttributedString
        info.value = VisibleText.clean(AX.describe(present[3]))
        info.description = VisibleText.clean(present[4] as? String)
        info.placeholder = VisibleText.clean(present[5] as? String)
        info.frame = AX.frame(position: present[6], size: present[7])
        info.children = present[8] as? [AXUIElement] ?? []
        info.enabled = present[9] as? Bool ?? true
        info.focused = present[10] as? Bool ?? false
        info.selected = present[11] as? Bool ?? false
        info.identifier = VisibleText.clean(present[12] as? String).flatMap { $0.hasPrefix("_NS:") ? nil : $0 }
        return info
    }

    var label: String? {
        if let title {
            return title
        }
        if role == kAXStaticTextRole, let value {
            return value
        }
        return description
    }

    var roleName: String {
        var name = role.hasPrefix("AX") ? String(role.dropFirst(2)) : role
        if let subrole, subrole != "AXUnknown" {
            name += ":" + (subrole.hasPrefix("AX") ? String(subrole.dropFirst(2)) : subrole)
        }
        return name.isEmpty ? "Unknown" : name
    }
}

/// Keeps an element's index for as long as it is the same AX element, so indices survive a `state` that adds lines above them.
struct HandleTable {
    private var buckets: [CFHashCode: [(element: AXUIElement, index: Int)]] = [:]
    private(set) var byIndex: [Int: AXUIElement] = [:]
    private(set) var nextIndex: Int

    init(startingAt nextIndex: Int = 0) {
        self.nextIndex = nextIndex
    }

    var count: Int {
        byIndex.count
    }

    func index(of element: AXUIElement) -> Int? {
        buckets[CFHash(element)]?.first { CFEqual($0.element, element) }?.index
    }

    /// Keeps what an older table knew and this one did not reach, for a state that read only part of the window.
    mutating func keep(_ older: HandleTable) {
        for (index, element) in older.byIndex where byIndex[index] == nil && self.index(of: element) == nil {
            buckets[CFHash(element), default: []].append((element, index))
            byIndex[index] = element
        }
        nextIndex = max(nextIndex, older.nextIndex)
    }

    /// Indices only grow, so an index from an older state never points at a different element.
    mutating func register(_ element: AXUIElement, previous: HandleTable) -> Int {
        if let existing = index(of: element) {
            return existing
        }
        let index: Int
        if let old = previous.index(of: element), byIndex[old] == nil {
            index = old
        } else {
            index = nextIndex
            nextIndex += 1
        }
        buckets[CFHash(element), default: []].append((element, index))
        byIndex[index] = element
        return index
    }
}

struct TreeWalker {
    /// Roles worth a line even without any text.
    static let landmarkRoles: Set<String> = [
        "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXComboBox",
        "AXTextField", "AXTextArea", "AXSlider", "AXIncrementor", "AXLink", "AXMenuItem", "AXMenu",
        "AXDisclosureTriangle", "AXColorWell", "AXDateField", "AXTimeField", "AXWebArea", "AXWindow",
        "AXSheet", "AXTabGroup", "AXTable", "AXOutline", "AXList", "AXBrowser", "AXPopover", "AXScrollArea",
    ]
    /// AXColumn repeats the cells its table already lists under rows; scroll bars only add noise.
    static let skippedRoles: Set<String> = ["AXColumn", "AXScrollBar", "AXGrowArea", "AXMatte"]

    let maxDepth: Int
    let maxElements: Int
    let maxText: Int
    let maxVisits: Int
    let previous: HandleTable

    private(set) var lines: [String] = []
    /// The whole text of each line, in the same order.
    private(set) var elements: [ElementText] = []
    private(set) var handles: HandleTable
    private var visibleRect = CGRect.infinite
    private var visits = 0
    private var offscreenLines = 0
    private var offscreenLeftOut = 0
    private var depthCutoffs = 0
    private var hitElementLimit = false
    private var hitVisitLimit = false

    init(maxDepth: Int, maxElements: Int, maxText: Int, previous: HandleTable, maxVisits: Int = 8000) {
        self.maxDepth = maxDepth
        self.maxElements = maxElements
        self.maxText = maxText
        self.maxVisits = maxVisits
        self.previous = previous
        self.handles = HandleTable(startingAt: previous.nextIndex)
    }

    var truncation: String? {
        var reasons: [String] = []
        if hitElementLimit {
            reasons.append("stopped at \(maxElements) elements (raise with --max-elements)")
        }
        if hitVisitLimit {
            reasons.append("stopped after visiting \(maxVisits) accessibility nodes")
        }
        if offscreenLeftOut > 0 {
            reasons.append("\(offscreenLeftOut) elements out of view left out after \(Clipping.offscreenLines(of: maxElements)) (raise with --max-elements, or find them with --find)")
        }
        if depthCutoffs > 0 {
            reasons.append("\(depthCutoffs) branches deeper than \(maxDepth) levels left out (raise with --max-depth)")
        }
        return reasons.isEmpty ? nil : reasons.joined(separator: "; ")
    }

    /// Walks one root; `visible` is what counts as on screen for the `offscreen` mark.
    mutating func walk(_ root: AXUIElement, visible: CGRect) {
        visibleRect = visible
        walk(root, depth: 0, indent: 0, parentLabel: nil)
    }

    private mutating func walk(_ element: AXUIElement, depth: Int, indent: Int, parentLabel: String?) {
        guard !hitElementLimit, !hitVisitLimit else {
            return
        }
        if lines.count >= maxElements {
            hitElementLimit = true
            return
        }
        if visits >= maxVisits {
            hitVisitLimit = true
            return
        }
        visits += 1
        guard let info = ElementInfo.read(element), !Self.skippedRoles.contains(info.role) else {
            return
        }
        let repeatsParent = info.role == kAXStaticTextRole && info.label != nil && info.label == parentLabel
        let separator = info.role == kAXMenuItemRole && info.label == nil
        var meaningful = !repeatsParent && !separator
            && (Self.landmarkRoles.contains(info.role) || info.label != nil || (info.valueIsText && info.value != nil))
        // An open menu hangs outside its window, so nothing in it is offscreen.
        let outerVisible = visibleRect
        if info.role == kAXMenuRole {
            visibleRect = .infinite
        }
        defer {
            visibleRect = outerVisible
        }
        if meaningful, info.role != kAXWindowRole, let frame = info.frame, Clipping.isOffscreen(frame, within: visibleRect) {
            if offscreenLines >= Clipping.offscreenLines(of: maxElements) {
                offscreenLeftOut += 1
                meaningful = false
            } else {
                offscreenLines += 1
            }
        }

        var childIndent = indent
        var childParentLabel = parentLabel
        if meaningful {
            let index = handles.register(element, previous: previous)
            lines.append(String(repeating: "  ", count: indent) + line(for: info, index: index))
            elements.append(ElementText(index: index, depth: indent, texts: [info.title, info.value, info.description, info.identifier].compactMap { $0 }))
            childIndent += 1
            childParentLabel = info.label
        }
        guard depth < maxDepth else {
            if !info.children.isEmpty {
                depthCutoffs += 1
            }
            return
        }
        for child in info.children {
            walk(child, depth: depth + 1, indent: childIndent, parentLabel: childParentLabel)
            if hitElementLimit || hitVisitLimit {
                return
            }
        }
    }

    private func line(for info: ElementInfo, index: Int) -> String {
        var parts = ["[\(index)]", info.roleName]
        let label = info.label
        if let label {
            parts.append(quote(label))
        }
        if let value = info.value, value != label {
            parts.append("value=" + quote(value))
        }
        if let description = info.description, description != label {
            parts.append("desc=" + quote(description))
        }
        if let placeholder = info.placeholder, info.value == nil {
            parts.append("placeholder=" + quote(placeholder))
        }
        if let identifier = info.identifier {
            parts.append("id=" + quote(identifier))
        }
        if let frame = info.frame {
            parts.append("(\(Self.whole(frame.minX)),\(Self.whole(frame.minY)) \(Self.whole(frame.width))x\(Self.whole(frame.height)))")
            if info.role != kAXWindowRole && Clipping.isOffscreen(frame, within: visibleRect) {
                parts.append("offscreen")
            }
        }
        if info.focused {
            parts.append("focused")
        }
        if info.selected {
            parts.append("selected")
        }
        if !info.enabled {
            parts.append("disabled")
        }
        return parts.joined(separator: " ")
    }

    private static func whole(_ value: CGFloat) -> Int {
        value.isFinite ? Int(value.rounded()) : 0
    }

    static func clip(_ text: String, limit: Int) -> (text: String, fullLength: Int?) {
        guard text.count > limit else {
            return (text, nil)
        }
        return (String(text.prefix(limit)) + "…", text.count)
    }

    /// Quotes a string on one line; a cut-off string says so and how long it really is.
    private func quote(_ text: String) -> String {
        let (clipped, fullLength) = Self.clip(text, limit: maxText)
        let escaped = clipped
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r\n", with: "\\n")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\n")
            .replacingOccurrences(of: "\t", with: "\\t")
        guard let fullLength else {
            return "\"" + escaped + "\""
        }
        return "\"" + escaped + "\"(cut: \(fullLength) chars)"
    }
}
