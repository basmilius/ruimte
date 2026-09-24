import AppKit
import ApplicationServices
import ComputerUseCore
import Phantom

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
        return try screenPoint(snapshot, pixelX: pixelX, pixelY: pixelY)
    }

    func screenPoint(_ snapshot: Snapshot, pixelX: Double, pixelY: Double) throws -> CGPoint {
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
        let behind = request.front != true

        if let index = request.element {
            let element = try snapshot.element(index)
            let point = visibleCenter(of: element, frame: try liveFrame(element, index: index))
            let axAction = right ? kAXShowMenuAction : (count == 1 ? kAXPressAction : nil)
            let pressable = axAction.map { AX.actions(element).contains($0) } ?? false
            // A click on a field is how an agent puts the focus there; behind the person's work focusing it does the same.
            if behind && !pressable && !right && count == 1 && AX.isSettable(element, kAXFocusedAttribute) {
                return try await act(app, request, at: point, as: ActionLook(state: .click, target: targetName(element, app))) {
                    let target = AX.summary(element)
                    self.overlay.press(target: nil)
                    let result = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
                    guard result == .success else {
                        throw AgentError.needsFront("\(Targets.name(app)) did not let element \(index) take the focus (AXError \(result.rawValue)), so clicking it needs the real pointer, and so the app in front")
                    }
                    return ["method": "AXFocused", "element": index, "target": target]
                }
            }
            if behind && !pressable {
                guard let axAction else {
                    throw AgentError.needsFront("A double click needs the real pointer, and so the app in front")
                }
                throw AgentError.needsFront("Element \(index) has no \(axAction) action, so clicking it needs the real pointer, and so the app in front")
            }
            return try await act(app, request, at: point, as: ActionLook(state: .click, target: targetName(element, app))) {
                if let axAction, pressable {
                    // Read before acting: a button that closes its sheet takes its window and label with it.
                    let target = AX.summary(element)
                    self.overlay.press(target: nil)
                    let result = AXUIElementPerformAction(element, axAction as CFString)
                    if result == .success || result == .cannotComplete {
                        var answer: [String: Any] = ["method": axAction, "element": index, "target": target]
                        // A press that opens a modal returns only once the modal closes, so the call times out after it worked.
                        if result == .cannotComplete {
                            answer["note"] = "the app did not answer in time; the action probably opened something modal"
                        } else if right && behind {
                            answer["note"] = "the menu is on screen where the app put it, which may be over the person's work, until you press one of its items or send escape"
                        }
                        return answer
                    }
                    if behind {
                        throw AgentError.needsFront("\(Targets.name(app)) refused \(axAction) on element \(index) (AXError \(result.rawValue)), so it needs a click with the real pointer, and so the app in front")
                    }
                }
                let hit = try await self.prepareMouse(app, at: point, window: snapshot.window, expecting: element, index: index)
                let target = AX.summary(hit)
                self.overlay.press(target: nil)
                try await SyntheticInput.click(at: point, count: count, button: button)
                return ["method": "mouse", "button": buttonName, "element": index, "count": count, "target": target]
            }
        }
        if behind {
            throw AgentError.needsFront("A click by pixel needs the real pointer, and so the app in front")
        }
        let point = try screenPoint(snapshot, request)
        return try await act(app, request, at: point, as: ActionLook(state: .click, target: Targets.name(app))) {
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
        if request.front != true && request.element == nil {
            throw AgentError.needsFront("A scroll by pixel needs the real pointer, and so the app in front; scroll an element instead")
        }

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
        if request.front != true {
            guard let expected, let index else {
                throw AgentError("scroll needs --element N")
            }
            return try await act(app, request, at: point, as: look) {
                var answer = try Self.scrollBehind(expected, direction: direction, pages: pages)
                answer["element"] = index
                answer["target"] = AX.summary(expected)
                return answer
            }
        }
        return try await act(app, request, at: point, as: look) {
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

    /// Presses at the start, moves through a few points to the end and lets go there. Only the start is hit-tested:
    /// the end is wherever the agent drops it, often another element or window.
    func drag(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        let snapshot = try snapshot(for: app)
        if request.front != true {
            throw AgentError.needsFront("A drag needs the real pointer, and so the app in front")
        }
        guard (request.element == nil) != (request.x == nil || request.y == nil) else {
            throw AgentError("drag starts at --from N, or at both --from-x and --from-y, and not both")
        }
        guard (request.toElement == nil) != (request.toX == nil || request.toY == nil) else {
            throw AgentError("drag ends at --to N, or at both --to-x and --to-y, and not both")
        }
        var start: CGPoint
        var grabbed: AXUIElement?
        if let index = request.element {
            let element = try snapshot.element(index)
            start = visibleCenter(of: element, frame: try liveFrame(element, index: index))
            grabbed = element
        } else {
            start = try screenPoint(snapshot, request)
        }
        let end: CGPoint
        if let index = request.toElement {
            let element = try snapshot.element(index)
            end = visibleCenter(of: element, frame: try liveFrame(element, index: index))
        } else if let toX = request.toX, let toY = request.toY {
            end = try screenPoint(snapshot, pixelX: toX, pixelY: toY)
        } else {
            throw AgentError("drag needs where it ends")
        }
        let name = grabbed.map { targetName($0, app) } ?? Targets.name(app)
        let index = request.element
        return try await act(app, request, at: start, as: ActionLook(state: .drag, target: name, text: name)) {
            let hit = try await self.prepareMouse(app, at: start, window: snapshot.window, expecting: grabbed, index: index)
            let target = AX.summary(hit)
            let duration = OverlayStyle.Motion.move.duration
            Task {
                try? await self.overlay.glide(to: end, showing: .drag)
            }
            try await SyntheticInput.drag(from: start, to: end, duration: duration)
            var answer: [String: Any] = ["method": "mouse", "to": ["x": Double(end.x.rounded()), "y": Double(end.y.rounded())], "target": target]
            if let index {
                answer["element"] = index
            }
            if let toElement = request.toElement {
                answer["toElement"] = toElement
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
        if request.front != true {
            let keys = try keyTarget(app)
            return try await act(app, request, at: focusPoint(app), as: look, reportPoint: false) {
                let target = AX.summary(keys.focused ?? keys.window)
                try await self.typeBehind(text, app: app, keys)
                return ["typed": text.count, "method": "keys to the app", "target": target]
            }
        }
        return try await act(app, request, at: focusPoint(app), as: look, reportPoint: false) {
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
        if request.front != true {
            if let edit = combos.first(where: \.editsFocusedText) {
                throw AgentError.needsFront("\(edit.name) edits the focused text through the key window, which an app behind the person's work does not have, so it does nothing there; set-value replaces a text in the background")
            }
            let keys = try keyTarget(app)
            return try await act(app, request, at: focusPoint(app), as: look, reportPoint: false) {
                let target = AX.summary(keys.focused ?? keys.window)
                Self.aimKeys(keys, main: true)
                for combo in combos {
                    try self.checkStopped()
                    try await SyntheticInput.ToProcess.press(combo, to: app.processIdentifier)
                    try await Task.sleep(for: .milliseconds(60))
                }
                return ["pressed": combos.map(\.name), "method": "keys to the app", "target": target]
            }
        }
        return try await act(app, request, at: focusPoint(app), as: look, reportPoint: false) {
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
        let numeric = AX.attribute(element, kAXValueAttribute) is NSNumber
        if numeric {
            guard let number = ValueMatch.number(text) else {
                throw AgentError("element \(index) holds a number; \"\(text)\" is not one")
            }
            newValue = NSNumber(value: number)
        } else {
            newValue = text as CFString
        }
        return try await act(app, request, at: visibleCenter(of: element, frame: frame), as: ActionLook(state: .type, target: targetName(element, app), text: text)) {
            let target = AX.summary(element)
            let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, newValue)
            guard result == .success else {
                throw AgentError("the app refused the value (AXError \(result.rawValue))")
            }
            var answer: [String: Any] = ["element": index, "target": target]
            // Some apps answer success and keep the old value, or take it a moment later.
            var readBack = AX.describe(AX.attribute(element, kAXValueAttribute))
            var reads = 1
            while !ValueMatch.holds(readBack, wanted: text, numeric: numeric) && reads <= 10 {
                try await Task.sleep(for: .milliseconds(100))
                readBack = AX.describe(AX.attribute(element, kAXValueAttribute))
                reads += 1
            }
            if let readBack {
                answer["value"] = readBack
            }
            if !ValueMatch.holds(readBack, wanted: text, numeric: numeric) {
                answer["note"] = "the app said yes, but element \(index) holds \"\(readBack ?? "")\" a second later: the value may not have taken; read the state, or click the field and type"
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
        let behind = request.front != true
        var launched = false
        let app: NSRunningApplication
        if let running = try? Targets.resolve(query) {
            app = running
            if app.isHidden {
                app.unhide()
            }
            if !behind {
                try await Targets.activate(app, window: nil)
            }
        } else {
            guard let url = Targets.applicationURL(for: query) else {
                throw AgentError("no app \"\(query)\" found in /Applications, /System/Applications or ~/Applications; pass its bundle id")
            }
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = !behind
            overlay.expectActivation(for: 10)
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
        var notes: [String] = []
        if let window {
            result["window"] = VisibleText.clean(AX.string(window, kAXTitleAttribute)) ?? ""
        } else {
            notes.append("no window appeared within 5 seconds; the app may show one only after a menu command")
        }
        if behind && launched && Targets.frontmostPid() == app.processIdentifier {
            notes.append("the app came to the front by itself as it started")
        }
        if !notes.isEmpty {
            result["note"] = notes.joined(separator: "; ")
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
        if request.front != true, let shortcut = Menus.shortcut(of: item), (try? KeyCombo.parse(shortcut))?.editsFocusedText == true {
            throw AgentError.needsFront("\"\(path)\" (\(shortcut)) edits the focused text through the key window, which an app behind the person's work does not have, so it does nothing there; set-value replaces a text in the background")
        }
        // Apps refresh AXEnabled of menu items only when a menu opens, so a stale "disabled" is not a reason to refuse.
        let reportedDisabled = !(AX.attribute(item, kAXEnabledAttribute) as? Bool ?? true)
        let point = (topItem.flatMap(AX.frame) ?? AX.frame(item)).map { CGPoint(x: $0.midX, y: $0.midY) }
        return try await act(app, request, at: point, as: ActionLook(state: .click, target: path), reportPoint: false) {
            if request.front == true {
                try await Targets.activate(app, window: nil)
            }
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
            } else if request.front != true {
                answer["note"] = "behind the person's work an item for the window or the text in focus, such as save, export or print, does nothing, since the app has no key window: if the state shows no change, it needs --front"
            }
            return answer
        }
    }

    /// Where keys go behind the person's work: the focused element of the app's window, once that window can take them.
    struct KeyTarget {
        let window: AXUIElement
        /// Nil for an app that takes keys in the window itself.
        let focused: AXUIElement?
    }

    private func keyTarget(_ app: NSRunningApplication) throws -> KeyTarget {
        let name = Targets.name(app)
        guard let window = AX.keyWindow(of: AXUIElementCreateApplication(app.processIdentifier)) else {
            if Targets.hasWindowElsewhere(app.processIdentifier) {
                throw AgentError.needsFront("The window of \(name) is on another Space or minimized, so keys need the app in front")
            }
            throw AgentError("\(name) has no window open to type in")
        }
        if AX.attribute(window, kAXMinimizedAttribute) as? Bool == true {
            throw AgentError.needsFront("The window of \(name) is minimized, so keys need the app in front")
        }
        let focused = focusedElement(app).flatMap { element -> AXUIElement? in
            AX.role(element) == kAXApplicationRole || AX.role(element) == kAXWindowRole ? nil : element
        }
        return KeyTarget(window: window, focused: focused)
    }

    /// Focuses the element in its own window; `main` also makes the window the app's main one, which raises it among
    /// the windows behind the person's work but never activates the app.
    static func aimKeys(_ keys: KeyTarget, main: Bool) {
        if let focused = keys.focused {
            AXUIElementSetAttributeValue(focused, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        }
        if main && AX.attribute(keys.window, kAXMainAttribute) as? Bool != true {
            AXUIElementSetAttributeValue(keys.window, kAXMainAttribute as CFString, kCFBooleanTrue)
        }
    }

    /// One character at a time to the app's process. The first tells whether keys arrive there at all: when a text
    /// element keeps its value, the window is made main and it goes again, and after that the front is the only way.
    private func typeBehind(_ text: String, app: NSRunningApplication, _ keys: KeyTarget) async throws {
        let pid = app.processIdentifier
        let characters = Array(text.replacingOccurrences(of: "\r\n", with: "\n"))
        let valueNow = { keys.focused.flatMap { AX.describe(AX.attribute($0, kAXValueAttribute)) } }
        let before = valueNow()
        Self.aimKeys(keys, main: before == nil)
        var sent = 0
        if let first = characters.first, before != nil {
            for attempt in 0..<2 {
                if attempt == 1 {
                    Self.aimKeys(keys, main: true)
                    try await Task.sleep(for: .milliseconds(100))
                }
                try checkStopped()
                try await SyntheticInput.ToProcess.type(first, to: pid)
                try await Task.sleep(for: .milliseconds(150))
                if valueNow() != before {
                    sent = 1
                    break
                }
            }
            if sent == 0 {
                throw AgentError.needsFront("\(Targets.name(app)) did not take keys in the background")
            }
        }
        for character in characters.dropFirst(sent) {
            try checkStopped()
            try await SyntheticInput.ToProcess.type(character, to: pid)
            try await Task.sleep(for: SyntheticInput.ToProcess.characterGap)
        }
    }

    /// Scrolls through accessibility, since wheel events posted to an app behind the person's work never scroll:
    /// the page actions of the element or what it sits in, or else the value of a scroll area's scroll bar.
    private static func scrollBehind(_ element: AXUIElement, direction: String, pages: Double) throws -> [String: Any] {
        let chain = [element] + AX.ancestors(of: element)
        let pageAction = "AXScroll\(direction.prefix(1).uppercased() + direction.dropFirst())ByPage"
        let times = max(1, Int(pages.rounded()))
        // Some apps list the page actions and refuse them; the scroll bar is tried next.
        if let scrollable = chain.first(where: { AX.actions($0).contains(pageAction) }),
           AXUIElementPerformAction(scrollable, pageAction as CFString) == .success {
            for _ in 1..<times {
                AXUIElementPerformAction(scrollable, pageAction as CFString)
            }
            return ["method": pageAction, "direction": direction, "pages": times]
        }
        let vertical = direction == "up" || direction == "down"
        let barAttribute = vertical ? kAXVerticalScrollBarAttribute : kAXHorizontalScrollBarAttribute
        for area in chain where AX.role(area) == kAXScrollAreaRole {
            guard let bar = AX.element(area, barAttribute), AX.isSettable(bar, kAXValueAttribute),
                  let now = (AX.attribute(bar, kAXValueAttribute) as? NSNumber)?.doubleValue,
                  let visible = AX.frame(area),
                  let content = (AX.attribute(area, kAXContentsAttribute) as? [AXUIElement])?.compactMap(AX.frame).first else {
                continue
            }
            let seen = vertical ? visible.height : visible.width
            let whole = vertical ? content.height : content.width
            guard whole > seen else {
                return ["method": "AXValue of the scroll bar", "direction": direction, "moved": false, "note": "the area shows all it holds; there is nothing to scroll"]
            }
            let sign: Double = direction == "down" || direction == "right" ? 1 : -1
            let target = min(1, max(0, now + sign * Double(seen) * 0.9 * pages / Double(whole - seen)))
            let result = AXUIElementSetAttributeValue(bar, kAXValueAttribute as CFString, NSNumber(value: target))
            guard result == .success else {
                throw AgentError.needsFront("The app refused to move its scroll bar (AXError \(result.rawValue)), so scrolling needs the wheel, and so the app in front")
            }
            return ["method": "AXValue of the scroll bar", "direction": direction, "pages": pages, "moved": target != now]
        }
        throw AgentError.needsFront("Nothing around this element scrolls through accessibility, so scrolling it needs the wheel, and so the app in front")
    }
}
