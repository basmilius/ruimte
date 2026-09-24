import ApplicationServices
import ComputerUseCore
import Foundation

@MainActor
enum Menus {
    static let maxItems = 3000

    struct Listing {
        var lines: [String] = []
        var handles: HandleTable
        var truncated = false
    }

    private struct ItemInfo {
        static let attributes: [String] = [
            kAXRoleAttribute, kAXTitleAttribute, kAXEnabledAttribute, kAXChildrenAttribute,
            kAXMenuItemCmdCharAttribute, kAXMenuItemCmdModifiersAttribute, kAXMenuItemMarkCharAttribute,
        ]

        var role = ""
        var title: String?
        var enabled = true
        var children: [AXUIElement] = []
        var shortcut: String?
        var checked = false

        static func read(_ element: AXUIElement) -> ItemInfo? {
            var raw: CFArray?
            guard AXUIElementCopyMultipleAttributeValues(element, attributes as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &raw) == .success,
                  let values = raw as? [AnyObject], values.count == attributes.count else {
                return nil
            }
            let present: [CFTypeRef?] = values.map { value in
                if CFGetTypeID(value) == AXValueGetTypeID() && AXValueGetType(value as! AXValue) == .axError {
                    return nil
                }
                return value
            }
            var info = ItemInfo()
            info.role = present[0] as? String ?? ""
            info.title = VisibleText.clean(present[1] as? String)
            info.enabled = present[2] as? Bool ?? true
            info.children = present[3] as? [AXUIElement] ?? []
            info.shortcut = shortcut(character: present[4] as? String, modifiers: (present[5] as? NSNumber)?.intValue)
            info.checked = VisibleText.clean(present[6] as? String) != nil
            return info
        }

        /// AX modifier bits: 1 shift, 2 option, 4 control, 8 means without command.
        private static func shortcut(character: String?, modifiers: Int?) -> String? {
            guard let character = VisibleText.clean(character),
                  let scalar = character.unicodeScalars.first,
                  !(0xE000...0xF8FF).contains(scalar.value) else {
                return nil
            }
            let bits = modifiers ?? 0
            var parts: [String] = []
            if bits & 4 != 0 {
                parts.append("ctrl")
            }
            if bits & 2 != 0 {
                parts.append("option")
            }
            if bits & 1 != 0 {
                parts.append("shift")
            }
            if bits & 8 == 0 {
                parts.append("cmd")
            }
            parts.append(character.lowercased())
            return parts.joined(separator: "+")
        }

        var submenu: AXUIElement? {
            children.first { AX.role($0) == kAXMenuRole }
        }
    }

    private static func menuBar(of appElement: AXUIElement) throws -> AXUIElement {
        guard let bar = AX.element(appElement, kAXMenuBarAttribute) else {
            throw AgentError("the app has no menu bar that accessibility can see")
        }
        return bar
    }

    static func list(_ appElement: AXUIElement, previous: HandleTable) throws -> Listing {
        var listing = Listing(handles: HandleTable(startingAt: previous.nextIndex))
        for (position, top) in AX.children(try menuBar(of: appElement)).enumerated() {
            guard let info = ItemInfo.read(top), let title = info.title else {
                continue
            }
            let index = listing.handles.register(top, previous: previous)
            // The first menu is the system's: the same in every app, and its recent items list personal files.
            if position == 0 {
                listing.lines.append("[\(index)] \(title) (system menu, items not listed; a path still reaches them)")
                continue
            }
            listing.lines.append("[\(index)] \(title)")
            if let submenu = info.submenu {
                walk(submenu, depth: 1, into: &listing, previous: previous)
            }
        }
        return listing
    }

    private static func walk(_ menu: AXUIElement, depth: Int, into listing: inout Listing, previous: HandleTable) {
        for item in AX.children(menu) {
            if listing.lines.count >= maxItems {
                listing.truncated = true
                return
            }
            guard let info = ItemInfo.read(item), let title = info.title else {
                continue
            }
            let index = listing.handles.register(item, previous: previous)
            var line = String(repeating: "  ", count: depth) + "[\(index)] \(title)"
            if let shortcut = info.shortcut {
                line += " (\(shortcut))"
            }
            if info.checked {
                line += " checked"
            }
            if !info.enabled {
                line += " disabled"
            }
            let submenu = info.submenu
            if submenu != nil {
                line += " >"
            }
            listing.lines.append(line)
            if let submenu {
                walk(submenu, depth: depth + 1, into: &listing, previous: previous)
            }
        }
    }

    static func resolve(_ path: String, in appElement: AXUIElement) throws -> AXUIElement {
        let wanted = MenuPath.steps(path)
        guard !wanted.isEmpty else {
            throw AgentError("an empty menu path; write it like \"File > Save\"")
        }
        var candidates = AX.children(try menuBar(of: appElement))
        var trail: [String] = []
        var found: AXUIElement?
        for (position, part) in wanted.enumerated() {
            let titled: [(AXUIElement, ItemInfo)] = candidates.compactMap { element in
                guard let info = ItemInfo.read(element), info.title != nil else {
                    return nil
                }
                return (element, info)
            }
            guard let match = titled.first(where: { MenuPath.matches($0.1.title ?? "", part) }) else {
                let place = trail.isEmpty ? "in the menu bar" : "under \"\(trail.joined(separator: " > "))\""
                let options = titled.compactMap { $0.1.title }.joined(separator: ", ")
                throw AgentError("no menu item \"\(part)\" \(place); there is: \(options)")
            }
            found = match.0
            trail.append(match.1.title ?? part)
            if position < wanted.count - 1 {
                guard let submenu = match.1.submenu else {
                    throw AgentError("\"\(trail.joined(separator: " > "))\" has no submenu")
                }
                candidates = AX.children(submenu)
            }
        }
        guard let found else {
            throw AgentError("no menu item matches \"\(path)\"")
        }
        return found
    }

    /// The readable path of a menu item and the menu bar item it hangs under.
    static func path(of item: AXUIElement) -> (path: String, topItem: AXUIElement?) {
        var titles: [String] = []
        var top: AXUIElement?
        for node in [item] + AX.ancestors(of: item) {
            let role = AX.role(node)
            if role == kAXMenuItemRole || role == kAXMenuBarItemRole {
                titles.append(VisibleText.clean(AX.string(node, kAXTitleAttribute)) ?? "?")
            }
            if role == kAXMenuBarItemRole {
                top = node
                break
            }
        }
        return (titles.reversed().joined(separator: " > "), top)
    }
}
