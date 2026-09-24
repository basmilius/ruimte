import AppKit
import ApplicationServices
import ComputerUseCore

extension Agent {
    /// One element whole, where a state cuts its text: the viewfinder goes around the element.
    func read(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        guard let index = request.element else {
            throw AgentError("read needs --element N")
        }
        try checkStopped()
        let element = try snapshot(for: app).element(index)
        guard let info = ElementInfo.read(element) else {
            throw AgentError("element \(index) is gone; run `cu state` again")
        }
        let window = AX.keyWindow(of: AXUIElementCreateApplication(app.processIdentifier)).flatMap(AX.frame)
        overlay.begin(near: info.frame.map { CGPoint(x: $0.midX, y: $0.midY) })
        overlay.operating(in: window)
        defer {
            overlay.finishAction()
        }
        overlay.show(ActionLook(state: .look, target: targetName(element, app), frame: info.frame ?? window))
        var result: [String: Any] = ["app": Targets.descriptor(app), "element": index, "role": info.roleName]
        let texts: [(String, String?)] = [
            ("title", info.title), ("value", info.value), ("description", info.description),
            ("placeholder", info.placeholder), ("identifier", info.identifier),
        ]
        for (key, text) in texts {
            if let text {
                result[key] = text
            }
        }
        if let frame = info.frame {
            result["frame"] = ["x": Double(frame.minX), "y": Double(frame.minY), "width": Double(frame.width), "height": Double(frame.height)]
        }
        return result
    }

    /// Reads the app again and again until the condition holds or the time is up, looking at its window
    /// throughout, and answers with the state at the end either way.
    func wait(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        let condition = try WaitCondition(request)
        let timeout = min(max(request.timeout ?? WaitCondition.defaultTimeout, 0), WaitCondition.maxTimeout)
        try checkStopped()
        var watched: AXUIElement?
        if case let .value(index, _) = condition {
            watched = try snapshot(for: app).element(index)
        }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        let window = AX.keyWindow(of: appElement).flatMap(AX.frame)
        overlay.begin(near: window.map { CGPoint(x: $0.midX, y: $0.midY) })
        overlay.operating(in: window)
        defer {
            overlay.finishAction()
        }
        overlay.show(ActionLook(state: .look, target: Targets.name(app), frame: window))
        let clock = ContinuousClock()
        let started = clock.now
        let deadline = started + .milliseconds(Int(timeout * 1000))
        var met = false
        while true {
            try checkStopped()
            let value = watched.flatMap { AX.describe(AX.attribute($0, kAXValueAttribute)) }.flatMap(VisibleText.clean)
            if condition.holds(watched == nil ? probe(appElement) : [], value: value) {
                met = true
                break
            }
            if clock.now >= deadline {
                break
            }
            try await Task.sleep(for: .milliseconds(250))
        }
        let waited = clock.now - started
        var result: [String: Any] = [
            "app": Targets.descriptor(app),
            "met": met,
            "condition": condition.summary,
            "waited": (waited / .milliseconds(100)).rounded() / 10,
        ]
        do {
            result["state"] = try await buildState(app, request)
        } catch let error as AgentError {
            result["state"] = ["error": error.message]
        }
        return result
    }
}
