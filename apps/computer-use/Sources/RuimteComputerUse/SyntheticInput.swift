import ComputerUseCore
import CoreGraphics
import Foundation

@MainActor
enum SyntheticInput {
    /// Stamped on every event this agent posts, so its own clicks are not taken for the person taking over.
    static let marker: Int64 = 0x5275_696D_7465
    /// How long after its own input a mouse event may still be the system's echo of it, such as the warp back.
    private static let echo: TimeInterval = 0.35
    private static var lastPost: TimeInterval = 0

    static var postedRecently: Bool {
        ProcessInfo.processInfo.systemUptime - lastPost < echo
    }

    private static func post(_ event: CGEvent?) {
        guard let event else {
            return
        }
        lastPost = ProcessInfo.processInfo.systemUptime
        event.setIntegerValueField(.eventSourceUserData, value: marker)
        event.post(tap: .cghidEventTap)
    }

    private static var source: CGEventSource? {
        CGEventSource(stateID: .hidSystemState)
    }

    static func currentPointer() -> CGPoint {
        CGEvent(source: nil)?.location ?? .zero
    }

    /// Moves the real pointer, clicks, and puts the pointer back where the person left it.
    static func click(at point: CGPoint, count: Int, button: CGMouseButton = .left) async throws {
        try Task.checkCancellation()
        let source = self.source
        let previous = currentPointer()
        let (downType, upType): (CGEventType, CGEventType) = button == .right ? (.rightMouseDown, .rightMouseUp) : (.leftMouseDown, .leftMouseUp)
        let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: button)
        move?.flags = []
        post(move)
        try? await Task.sleep(for: .milliseconds(40))
        for click in 1...count {
            let down = CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: point, mouseButton: button)
            let up = CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: point, mouseButton: button)
            for event in [down, up] {
                event?.flags = []
                event?.setIntegerValueField(.mouseEventClickState, value: Int64(click))
            }
            post(down)
            try? await Task.sleep(for: .milliseconds(30))
            post(up)
            if click < count {
                try? await Task.sleep(for: .milliseconds(60))
            }
        }
        try? await Task.sleep(for: .milliseconds(80))
        restorePointer(previous)
    }

    /// Presses at `start`, drags through a few points over `duration` seconds and lets go at `end`. The button
    /// always comes up again, also when the person interrupts halfway, or it would stay down for them.
    static func drag(from start: CGPoint, to end: CGPoint, duration: Double, steps: Int = 12) async throws {
        try Task.checkCancellation()
        let source = self.source
        let previous = currentPointer()
        let event = { (type: CGEventType, point: CGPoint) in
            let made = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)
            made?.flags = []
            made?.setIntegerValueField(.mouseEventClickState, value: 1)
            return made
        }
        post(event(.mouseMoved, start))
        try? await Task.sleep(for: .milliseconds(40))
        post(event(.leftMouseDown, start))
        // Many apps start a drag only once the press has lasted a moment.
        try? await Task.sleep(for: .milliseconds(120))
        var reached = start
        for point in DragPath.points(from: start, to: end, steps: steps) where !Task.isCancelled {
            post(event(.leftMouseDragged, point))
            reached = point
            try? await Task.sleep(for: .milliseconds(Int(duration * 1000) / max(1, steps)))
        }
        post(event(.leftMouseUp, reached))
        try? await Task.sleep(for: .milliseconds(80))
        restorePointer(previous)
        try Task.checkCancellation()
    }

    /// Scroll wheel events go to the window under the pointer, so the pointer visits the point for the duration.
    /// A positive `deltaY` reveals content further down, a positive `deltaX` content further right.
    static func scroll(at point: CGPoint, deltaX: Double, deltaY: Double) async throws {
        try Task.checkCancellation()
        let source = self.source
        let previous = currentPointer()
        let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
        move?.flags = []
        post(move)
        try? await Task.sleep(for: .milliseconds(40))
        let steps = max(1, Int((max(abs(deltaX), abs(deltaY)) / 40).rounded(.up)))
        var sentX = 0
        var sentY = 0
        for step in 1...steps {
            let targetX = Int((deltaX * Double(step) / Double(steps)).rounded())
            let targetY = Int((deltaY * Double(step) / Double(steps)).rounded())
            let event = CGEvent(
                scrollWheelEvent2Source: source,
                units: .pixel,
                wheelCount: 2,
                wheel1: Int32(-(targetY - sentY)),
                wheel2: Int32(-(targetX - sentX)),
                wheel3: 0
            )
            event?.location = point
            event?.flags = []
            post(event)
            sentX = targetX
            sentY = targetY
            try? await Task.sleep(for: .milliseconds(12))
        }
        try? await Task.sleep(for: .milliseconds(80))
        restorePointer(previous)
    }

    private static func restorePointer(_ point: CGPoint) {
        lastPost = ProcessInfo.processInfo.systemUptime
        CGWarpMouseCursorPosition(point)
        CGAssociateMouseAndMouseCursorPosition(1)
    }

    static func press(_ combo: KeyCombo) async throws {
        let source = self.source
        let down = CGEvent(keyboardEventSource: source, virtualKey: combo.keyCode, keyDown: true)
        let up = CGEvent(keyboardEventSource: source, virtualKey: combo.keyCode, keyDown: false)
        down?.flags = combo.flags
        up?.flags = combo.flags
        post(down)
        try? await Task.sleep(for: .milliseconds(25))
        post(up)
    }

    /// One character per event: some apps read only the first character of a longer unicode string.
    static func type(_ text: String) async throws {
        let source = self.source
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        for character in normalized {
            try Task.checkCancellation()
            if character == "\n" || character == "\r" {
                try await press(KeyCombo(keyCode: 36, flags: [], name: "return"))
            } else if character == "\t" {
                try await press(KeyCombo(keyCode: 48, flags: [], name: "tab"))
            } else {
                let units = Array(String(character).utf16)
                let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
                let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
                for event in [down, up] {
                    event?.flags = []
                    event?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                }
                post(down)
                post(up)
            }
            try await Task.sleep(for: .milliseconds(12))
        }
    }

    /// Keys for an app behind the person's work: posted to its process alone, so they never pass the system's event
    /// stream or the focus. Wheel events posted this way do not scroll, measured on macOS 27.
    @MainActor
    enum ToProcess {
        /// The app drops characters that come faster, since it reads them as it gets to them.
        static let characterGap: Duration = .milliseconds(40)

        private static func post(_ event: CGEvent?, to pid: pid_t) {
            guard let event else {
                return
            }
            event.setIntegerValueField(.eventSourceUserData, value: marker)
            event.postToPid(pid)
        }

        static func press(_ combo: KeyCombo, to pid: pid_t) async throws {
            let down = CGEvent(keyboardEventSource: source, virtualKey: combo.keyCode, keyDown: true)
            let up = CGEvent(keyboardEventSource: source, virtualKey: combo.keyCode, keyDown: false)
            down?.flags = combo.flags
            up?.flags = combo.flags
            post(down, to: pid)
            try? await Task.sleep(for: .milliseconds(25))
            post(up, to: pid)
        }

        static func type(_ character: Character, to pid: pid_t) async throws {
            if character == "\n" || character == "\r" {
                try await press(KeyCombo(keyCode: 36, flags: [], name: "return"), to: pid)
                return
            }
            if character == "\t" {
                try await press(KeyCombo(keyCode: 48, flags: [], name: "tab"), to: pid)
                return
            }
            let units = Array(String(character).utf16)
            let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
            let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
            for event in [down, up] {
                event?.flags = []
                event?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            }
            post(down, to: pid)
            post(up, to: pid)
        }
    }
}
