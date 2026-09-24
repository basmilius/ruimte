import AppKit
import ApplicationServices
import ComputerUseCore

extension Agent {
    func snapshot(for app: NSRunningApplication) throws -> Snapshot {
        guard let snapshot = snapshots[app.processIdentifier] else {
            throw AgentError("no state for \(Targets.name(app)) yet; run `cu state \(Targets.name(app))` first")
        }
        return snapshot
    }

    func liveFrame(_ element: AXUIElement, index: Int) throws -> CGRect {
        guard let frame = AX.frame(element), frame.width > 0, frame.height > 0 else {
            throw AgentError("element \(index) is gone or has no frame any more; run `cu state` again")
        }
        return frame
    }

    /// The center of the part of an element its window shows; a half scrolled-away row is clicked where it can be seen.
    func visibleCenter(of element: AXUIElement, frame: CGRect) -> CGPoint {
        var visible = frame
        if let window = AX.container(of: element).window, let windowFrame = AX.frame(window) {
            let clipped = frame.intersection(windowFrame)
            if !clipped.isNull && clipped.width >= 1 && clipped.height >= 1 {
                visible = clipped
            }
        }
        return CGPoint(x: visible.midX, y: visible.midY)
    }

    func screenPoint(_ snapshot: Snapshot, _ request: Request) throws -> CGPoint {
        guard let pixelX = request.x, let pixelY = request.y else {
            throw AgentError("pass --element N, or both --x and --y")
        }
        guard let capture = snapshot.capture else {
            throw AgentError(snapshot.captureProblem ?? "the last state has no screenshot to map --x/--y from")
        }
        guard pixelX >= 0, pixelY >= 0, pixelX < Double(capture.pixelWidth), pixelY < Double(capture.pixelHeight) else {
            throw AgentError("(\(pixelX), \(pixelY)) is outside the screenshot (\(capture.pixelWidth)x\(capture.pixelHeight) px)")
        }
        return capture.screenPoint(pixelX: pixelX, pixelY: pixelY)
    }

    /// What the menu's step line names: the element's label, or the app.
    func targetName(_ element: AXUIElement, _ app: NSRunningApplication) -> String {
        (AX.summary(element)["label"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? Targets.name(app)
    }

    func focusedElement(_ app: NSRunningApplication) -> AXUIElement? {
        AX.element(AXUIElementCreateApplication(app.processIdentifier), kAXFocusedUIElementAttribute)
    }

    /// Brings the app forward and checks that the point shows what a synthesized event is meant for.
    private func prepareMouse(_ app: NSRunningApplication, at point: CGPoint, window: AXUIElement?, expecting element: AXUIElement?, index: Int?) async throws -> AXUIElement? {
        try await Targets.activate(app, window: window)
        try checkStopped()
        return try Targets.verifyHit(point, pid: app.processIdentifier, expecting: element, index: index)
    }

    func click(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        let buttonName = request.button ?? "left"
        guard buttonName == "left" || buttonName == "right" else {
            throw AgentError("--button is left or right, not \"\(buttonName)\"")
        }
        let right = buttonName == "right"
        let count = right ? 1 : min(max(request.count ?? 1, 1), 3)
        let button: CGMouseButton = right ? .right : .left
        let snapshot = try snapshot(for: app)

        if let index = request.element {
            let element = try snapshot.element(index)
            let point = visibleCenter(of: element, frame: try liveFrame(element, index: index))
            return try await act(app, at: point, as: ActionLook(state: .click, target: targetName(element, app))) {
                let axAction = right ? kAXShowMenuAction : (count == 1 ? kAXPressAction : nil)
                if let axAction, AX.actions(element).contains(axAction) {
                    // Read before acting: a button that closes its sheet takes its window and label with it.
                    let target = AX.summary(element)
                    self.overlay.press(target: nil)
                    let result = AXUIElementPerformAction(element, axAction as CFString)
                    if result == .success || result == .cannotComplete {
                        var answer: [String: Any] = ["method": axAction, "element": index, "target": target]
                        // A press that opens a modal returns only once the modal closes, so the call times out after it worked.
                        if result == .cannotComplete {
                            answer["note"] = "the app did not answer in time; the action probably opened something modal"
                        }
                        return answer
                    }
                }
                let hit = try await self.prepareMouse(app, at: point, window: snapshot.window, expecting: element, index: index)
                let target = AX.summary(hit)
                self.overlay.press(target: nil)
                try await SyntheticInput.click(at: point, count: count, button: button)
                return ["method": "mouse", "button": buttonName, "element": index, "count": count, "target": target]
            }
        }
        let point = try screenPoint(snapshot, request)
        return try await act(app, at: point, as: ActionLook(state: .click, target: Targets.name(app))) {
            let hit = try await self.prepareMouse(app, at: point, window: snapshot.window, expecting: nil, index: nil)
            let target = AX.summary(hit)
            self.overlay.press(target: target["label"] as? String)
            try await SyntheticInput.click(at: point, count: count, button: button)
            return ["method": "mouse", "button": buttonName, "count": count, "target": target]
        }
    }

    func scroll(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        let direction = request.direction ?? ""
        let signs: [String: (x: Double, y: Double)] = ["up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)]
        guard let sign = signs[direction] else {
            throw AgentError("--direction is up, down, left or right")
        }
        let pages = request.pages ?? 1
        guard pages > 0, pages <= 50 else {
            throw AgentError("--pages must be above 0 and at most 50")
        }
        let vertical = sign.y != 0
        let snapshot = try snapshot(for: app)

        var point: CGPoint
        var expected: AXUIElement?
        var pageLength: CGFloat?
        if let index = request.element {
            let element = try snapshot.element(index)
            let frame = try liveFrame(element, index: index)
            point = visibleCenter(of: element, frame: frame)
            expected = element
            pageLength = vertical ? frame.height : frame.width
        } else {
            point = try screenPoint(snapshot, request)
        }
        let index = request.element
        let look = ActionLook(state: .scroll, target: expected.map { targetName($0, app) } ?? Targets.name(app), direction: ScrollDirection(rawValue: direction) ?? .down)
        return try await act(app, at: point, as: look) {
            let hit = try await self.prepareMouse(app, at: point, window: snapshot.window, expecting: expected, index: index)
            let target = AX.summary(hit)
            let length = pageLength ?? Self.scrollAreaLength(around: hit, vertical: vertical) ?? AX.frame(snapshot.window).map { vertical ? $0.height : $0.width } ?? 400
            // Most of a page, so a line of context stays in view as it does with Page Down.
            let distance = Double(length) * 0.9 * pages
            try await SyntheticInput.scroll(at: point, deltaX: sign.x * distance, deltaY: sign.y * distance)
            var answer: [String: Any] = ["method": "wheel", "direction": direction, "pages": pages, "points": distance.rounded(), "target": target]
            if let index {
                answer["element"] = index
            }
            return answer
        }
    }

    private static func scrollAreaLength(around element: AXUIElement?, vertical: Bool) -> CGFloat? {
        guard let element else {
            return nil
        }
        let area = ([element] + AX.ancestors(of: element)).first { AX.role($0) == kAXScrollAreaRole }
        return area.flatMap(AX.frame).map { vertical ? $0.height : $0.width }
    }

    /// The virtual pointer shows where the keys go, the focused element; it is not reported as a point since nothing is clicked there.
    private func focusPoint(_ app: NSRunningApplication) -> CGPoint? {
        guard let focused = focusedElement(app), let frame = AX.frame(focused) else {
            return nil
        }
        return CGPoint(x: frame.midX, y: frame.midY)
    }

    func type(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        guard let text = request.text, !text.isEmpty else {
            throw AgentError("type needs text")
        }
        let window = snapshots[app.processIdentifier]?.window
        let look = ActionLook(state: .type, target: focusedElement(app).map { targetName($0, app) } ?? Targets.name(app), text: text)
        return try await act(app, at: focusPoint(app), as: look, reportPoint: false) {
            try await Targets.activate(app, window: window)
            try self.checkStopped()
            let target = AX.summary(self.focusedElement(app))
            try await SyntheticInput.type(text)
            return ["typed": text.count, "target": target]
        }
    }

    func key(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        let combos = try (request.combos ?? []).map(KeyCombo.parse)
        guard !combos.isEmpty else {
            throw AgentError("key needs at least one combo")
        }
        let window = snapshots[app.processIdentifier]?.window
        let look = ActionLook(state: .type, target: focusedElement(app).map { targetName($0, app) } ?? Targets.name(app), text: combos.map(\.name).joined(separator: " "))
        return try await act(app, at: focusPoint(app), as: look, reportPoint: false) {
            try await Targets.activate(app, window: window)
            let target = AX.summary(self.focusedElement(app))
            for combo in combos {
                try self.checkStopped()
                try await SyntheticInput.press(combo)
                try await Task.sleep(for: .milliseconds(60))
            }
            return ["pressed": combos.map(\.name), "target": target]
        }
    }

    func setValue(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        guard let index = request.element, let text = request.value else {
            throw AgentError("set-value needs --element and a value")
        }
        let element = try snapshot(for: app).element(index)
        let frame = try liveFrame(element, index: index)
        guard AX.isSettable(element, kAXValueAttribute) else {
            let role = AX.role(element) ?? "element"
            throw AgentError("element \(index) (\(role)) does not accept a value; click it and use `cu type` instead")
        }
        let newValue: CFTypeRef
        if AX.attribute(element, kAXValueAttribute) is NSNumber {
            let lowered = text.lowercased()
            if let number = Double(text) {
                newValue = NSNumber(value: number)
            } else if ["true", "yes", "on"].contains(lowered) {
                newValue = NSNumber(value: 1)
            } else if ["false", "no", "off"].contains(lowered) {
                newValue = NSNumber(value: 0)
            } else {
                throw AgentError("element \(index) holds a number; \"\(text)\" is not one")
            }
        } else {
            newValue = text as CFString
        }
        return try await act(app, at: visibleCenter(of: element, frame: frame), as: ActionLook(state: .type, target: targetName(element, app), text: text)) {
            let target = AX.summary(element)
            let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, newValue)
            guard result == .success else {
                throw AgentError("the app refused the value (AXError \(result.rawValue))")
            }
            var answer: [String: Any] = ["element": index, "target": target]
            if let readBack = AX.describe(AX.attribute(element, kAXValueAttribute)) {
                answer["value"] = readBack
            }
            return answer
        }
    }

    /// Activates a running app (showing it when hidden) or launches it, then waits for a window.
    func open(_ request: Request) async throws -> (NSRunningApplication, [String: Any]) {
        try checkStopped()
        guard let query = request.app, !query.isEmpty else {
            throw AgentError("`cu open` needs an app name or bundle id")
        }
        var launched = false
        let app: NSRunningApplication
        if let running = try? Targets.resolve(query) {
            app = running
            if app.isHidden {
                app.unhide()
            }
            try await Targets.activate(app, window: nil)
        } else {
            guard let url = Targets.applicationURL(for: query) else {
                throw AgentError("no app \"\(query)\" found in /Applications, /System/Applications or ~/Applications; pass its bundle id")
            }
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            do {
                app = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
            } catch {
                throw AgentError("could not launch \(url.path): \(error.localizedDescription)")
            }
            launched = true
        }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        var window: AXUIElement?
        for _ in 0..<50 {
            window = AX.keyWindow(of: appElement)
            if window != nil {
                break
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        var result: [String: Any] = ["app": Targets.descriptor(app), "launched": launched]
        if let window {
            result["window"] = VisibleText.clean(AX.string(window, kAXTitleAttribute)) ?? ""
        } else {
            result["note"] = "no window appeared within 5 seconds; the app may show one only after a menu command"
        }
        return (app, result)
    }

    func menu(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        let pid = app.processIdentifier
        let appElement = AXUIElementCreateApplication(pid)
        guard let target = request.path?.trimmingCharacters(in: .whitespaces), !target.isEmpty else {
            let listing = try Menus.list(appElement, previous: menuTables[pid] ?? HandleTable())
            menuTables[pid] = listing.handles
            var result: [String: Any] = ["app": Targets.descriptor(app), "items": listing.handles.count, "menu": listing.lines]
            if listing.truncated {
                result["truncated"] = "stopped at \(Menus.maxItems) items"
            }
            return result
        }

        let item: AXUIElement
        if let index = Int(target) {
            guard let table = menuTables[pid] else {
                throw AgentError("no menu listing for \(Targets.name(app)) yet; run `cu menu \(Targets.name(app))` first, or pass a path like \"File > Save\"")
            }
            guard let found = table.byIndex[index] else {
                throw AgentError("the last menu listing has no item \(index); run `cu menu \(Targets.name(app))` again")
            }
            item = found
        } else {
            item = try Menus.resolve(target, in: appElement)
        }
        let (path, topItem) = Menus.path(of: item)
        // Apps refresh AXEnabled of menu items only when a menu opens, so a stale "disabled" is not a reason to refuse.
        let reportedDisabled = !(AX.attribute(item, kAXEnabledAttribute) as? Bool ?? true)
        let point = (topItem.flatMap(AX.frame) ?? AX.frame(item)).map { CGPoint(x: $0.midX, y: $0.midY) }
        return try await act(app, at: point, as: ActionLook(state: .click, target: path), reportPoint: false) {
            try await Targets.activate(app, window: nil)
            try self.checkStopped()
            let target = AX.summary(item)
            self.overlay.press(target: nil)
            let result = AXUIElementPerformAction(item, kAXPressAction as CFString)
            guard result == .success || result == .cannotComplete else {
                let reason = reportedDisabled ? "; the item is disabled" : ""
                throw AgentError("the app refused to run \"\(path)\" (AXError \(result.rawValue))\(reason)")
            }
            var answer: [String: Any] = ["menu": path, "method": "AXPress", "target": target]
            if result == .cannotComplete {
                answer["note"] = "the app did not answer in time; the item probably opened something modal"
            }
            return answer
        }
    }
}
