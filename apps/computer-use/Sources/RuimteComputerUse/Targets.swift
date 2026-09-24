import AppKit
import ApplicationServices
import ComputerUseCore

@MainActor
enum Targets {
    static func regularApps() -> [NSRunningApplication] {
        NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && !$0.isTerminated }
    }

    /// Some apps put a left-to-right mark in their name, which would keep a plain name from matching.
    static func name(_ app: NSRunningApplication) -> String {
        VisibleText.clean(app.localizedName) ?? ""
    }

    static func list() -> [String: Any] {
        let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let apps = regularApps()
            .sorted { name($0).localizedCaseInsensitiveCompare(name($1)) == .orderedAscending }
            .map { app -> [String: Any] in
                var entry: [String: Any] = [
                    "name": name(app),
                    "pid": Int(app.processIdentifier),
                    "frontmost": app.processIdentifier == frontmost,
                ]
                if let bundleIdentifier = app.bundleIdentifier {
                    entry["bundleId"] = bundleIdentifier
                }
                if let bundleName = app.bundleURL?.deletingPathExtension().lastPathComponent {
                    entry["bundleName"] = bundleName
                }
                if app.isHidden {
                    entry["hidden"] = true
                }
                return entry
            }
        return ["apps": apps]
    }

    static func resolve(_ query: String?) throws -> NSRunningApplication {
        guard let query = query?.trimmingCharacters(in: .whitespaces), !query.isEmpty else {
            throw AgentError("no app given; pass a name, bundle id or pid from `cu apps`")
        }
        let apps = regularApps()
        if let pid = Int32(query), let match = apps.first(where: { $0.processIdentifier == pid }) {
            return match
        }
        let wanted = query.lowercased()
        if let match = apps.first(where: { $0.bundleIdentifier?.lowercased() == wanted }) {
            return match
        }
        let bareName = wanted.hasSuffix(".app") ? String(wanted.dropLast(4)) : wanted
        // The bundle's file name stays English when the menu bar name is localized ("Rekenmachine" is Calculator.app).
        let byName = apps.filter { app in
            name(app).lowercased() == bareName || app.bundleURL?.deletingPathExtension().lastPathComponent.lowercased() == bareName
        }
        if byName.count > 1 {
            let pids = byName.map { String($0.processIdentifier) }.joined(separator: ", ")
            throw AgentError("more than one running app is called \"\(query)\" (pids \(pids)); pass a pid instead")
        }
        if let match = byName.first {
            return match
        }
        throw AgentError("no running app matches \"\(query)\"; run `cu apps` to list them, or start it with `cu open`")
    }

    static func descriptor(_ app: NSRunningApplication) -> [String: Any] {
        var entry: [String: Any] = ["name": name(app), "pid": Int(app.processIdentifier)]
        if let bundleIdentifier = app.bundleIdentifier {
            entry["bundleId"] = bundleIdentifier
        }
        return entry
    }

    static func frontmostPid() -> pid_t? {
        if let focused = AX.element(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute), let pid = AX.pid(focused) {
            return pid
        }
        return NSWorkspace.shared.frontmostApplication?.processIdentifier
    }

    /// Brings the app forward so synthesized keys and clicks land in it, and refuses to go on if something else stays in front.
    static func activate(_ app: NSRunningApplication, window: AXUIElement?) async throws {
        let pid = app.processIdentifier
        if let window, AX.attribute(window, kAXMinimizedAttribute) as? Bool == true {
            AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
        }
        if frontmostPid() == pid {
            return
        }
        // A background agent is not allowed to take the focus under cooperative activation, so AX asks the app itself.
        app.activate()
        let element = AXUIElementCreateApplication(pid)
        AXUIElementSetAttributeValue(element, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        if let window {
            AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        }
        for _ in 0..<30 {
            try await Task.sleep(for: .milliseconds(50))
            if frontmostPid() == pid {
                try await Task.sleep(for: .milliseconds(80))
                return
            }
        }
        let other = NSWorkspace.shared.frontmostApplication.map(name) ?? "another app"
        throw AgentError("could not bring \(name(app)) to the front (\(other) stays in front); refusing to send input")
    }

    /// Whether the app has a normal window that the window server knows and does not show: on another Space or minimized.
    static func hasWindowElsewhere(_ pid: pid_t) -> Bool {
        let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        return list.contains { entry in
            guard (entry[kCGWindowOwnerPID as String] as? Int) == Int(pid),
                  (entry[kCGWindowLayer as String] as? Int) == 0,
                  (entry[kCGWindowIsOnscreen as String] as? Bool) != true,
                  let bounds = entry[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: bounds) else {
                return false
            }
            return frame.width > 50 && frame.height > 50
        }
    }

    /// Hit-tests the point a synthesized event is about to land on. Refuses another app's window and,
    /// for an element from a state, anything that is not that element: after a new window opens, the
    /// stored frame points at whatever is there now.
    static func verifyHit(_ point: CGPoint, pid: pid_t, expecting element: AXUIElement?, index: Int?) throws -> AXUIElement? {
        var found: AXUIElement?
        let result = AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &found)
        let place = "(\(Int(point.x)), \(Int(point.y)))"
        guard result == .success, let hit = found else {
            if let index, element != nil {
                throw AgentError("could not check what is at \(place) for element \(index) (AXError \(result.rawValue)); run `cu state` again")
            }
            return nil
        }
        if let owner = AX.pid(hit), owner != pid {
            let name = NSRunningApplication(processIdentifier: owner).map(name) ?? "pid \(owner)"
            throw AgentError("the point \(place) is covered by \(name); refusing to click there")
        }
        if let element, let index, !AX.isSameOrDescendant(hit, of: element), !isInnerAncestor(hit, of: element) {
            throw AgentError("element \(index) is no longer at \(place); the point now hits \(describe(hit)). Run `cu state` again")
        }
        return hit
    }

    /// Some rows and cells do not hit-test themselves and answer with their table; the window itself does not count.
    private static func isInnerAncestor(_ candidate: AXUIElement, of element: AXUIElement) -> Bool {
        let role = AX.role(candidate)
        if role == kAXWindowRole || role == kAXSheetRole || role == kAXApplicationRole {
            return false
        }
        return AX.ancestors(of: element).contains { CFEqual($0, candidate) }
    }

    static func describe(_ element: AXUIElement) -> String {
        let summary = AX.summary(element)
        var text = summary["role"] as? String ?? "an element"
        if let label = summary["label"] as? String {
            text += " \"\(label)\""
        }
        if let window = summary["window"] as? String {
            text += " in window \"\(window)\""
        }
        return text
    }

    private static let applicationFolders = [
        "/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities",
        NSHomeDirectory() + "/Applications",
    ]

    /// Finds an app that is not running by bundle id, or in the usual folders by the file name of its bundle,
    /// else by the name it shows (`CFBundleDisplayName`): the same order the daemon looks in.
    static func applicationURL(for query: String) -> URL? {
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: query) {
            return url
        }
        let wanted = query.lowercased().hasSuffix(".app") ? String(query.lowercased().dropLast(4)) : query.lowercased()
        let manager = FileManager.default
        let bundles = applicationFolders.flatMap { folder in
            ((try? manager.contentsOfDirectory(atPath: folder)) ?? [])
                .filter { $0.lowercased().hasSuffix(".app") }
                .map { URL(fileURLWithPath: folder).appendingPathComponent($0) }
        }
        if let match = bundles.first(where: { $0.deletingPathExtension().lastPathComponent.lowercased() == wanted }) {
            return match
        }
        return bundles.first { url in
            (Bundle(url: url)?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)?.lowercased() == wanted
        }
    }
}
