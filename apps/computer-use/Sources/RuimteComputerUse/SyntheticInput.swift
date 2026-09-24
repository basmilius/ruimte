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
}
