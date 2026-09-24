import AppKit
import ApplicationServices
import ComputerUseCore
import Phantom

struct Snapshot {
    let window: AXUIElement
    let handles: HandleTable
    let capture: CaptureResult?
    /// Why there is no capture, phrased for a click by --x/--y.
    let captureProblem: String?

    func element(_ index: Int) throws -> AXUIElement {
        guard let element = handles.byIndex[index] else {
            throw AgentError("the last state has no element \(index); run `cu state` again")
        }
        return element
    }
}

enum ChromiumMode {
    case none
    case manual
    case enhanced
}

private enum Response {
    static func success(_ result: [String: Any]) -> Data {
        encode(["ok": true, "result": result])
    }

    static func failure(_ message: String) -> Data {
        encode(["ok": false, "error": message])
    }

    private static func encode(_ object: [String: Any]) -> Data {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes]) else {
            return Data(#"{"ok":false,"error":"the agent could not encode its answer"}"#.utf8)
        }
        return data
    }
}

@MainActor
final class Agent {
    static let defaultMaxDepth = 60
    static let defaultMaxElements = 500
    static let defaultMaxText = 100
    static let maxScreenshotWidth: CGFloat = 1280
    private static let queuedCommands: Set<String> = ["state", "click", "scroll", "type", "key", "set-value", "open", "menu"]

    let home: Home
    let overlay: Overlay
    var snapshots: [pid_t: Snapshot] = [:]
    var menuTables: [pid_t: HandleTable] = [:]
    private var chromium: [pid_t: ChromiumMode] = [:]
    private var queueTail: Task<Void, Never>?
    private var queued: [UUID: Task<Data, Never>] = [:]

    init(home: Home) {
        self.home = home
        overlay = Overlay(configPath: home.overlayConfigPath)
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 1.5)
        overlay.onInterrupt = { [weak self] _ in
            guard let self else {
                return
            }
            for task in self.queued.values {
                task.cancel()
            }
        }
    }

    func handle(_ data: Data) async -> Data {
        if let refusal = authenticate(data) {
            return Response.failure(refusal)
        }
        let request: Request
        do {
            request = try JSONDecoder().decode(Request.self, from: data)
        } catch {
            return Response.failure("malformed request: \(error)")
        }
        switch request.command {
        case "doctor":
            return await respond { Permissions.doctor(prompt: request.prompt ?? true) }
        case "apps":
            return await respond { Targets.list() }
        case "quit":
            Task {
                try? await Task.sleep(for: .milliseconds(150))
                NSApp.terminate(nil)
            }
            return Response.success(["stopped": true])
        case "presence":
            return await respond { try self.overlay.presence(request.state, label: request.label, step: request.step) }
        case let command where Self.queuedCommands.contains(command):
            return await enqueue {
                await self.respond { try await self.perform(request) }
            }
        default:
            return Response.failure("unknown command \"\(request.command)\"")
        }
    }

    /// Security boundary: this app holds Accessibility and Screen Recording, so a caller has to prove it is the
    /// Ruimte of this home the same way a local process proves it to the daemon.
    private func authenticate(_ data: Data) -> String? {
        guard let secret = LocalSecret.read(at: home.secretPath) else {
            return "refused: there is no local secret at \(home.secretPath) yet; the daemon writes it on its first start"
        }
        guard let credential = try? JSONDecoder().decode(Credential.self, from: data),
              let presented = credential.secret,
              LocalSecret.matches(presented, secret) else {
            return "refused: the request does not carry the local secret of \(home.path)"
        }
        return nil
    }

    private func respond(_ body: () async throws -> [String: Any]) async -> Data {
        do {
            return Response.success(try await body())
        } catch is CancellationError {
            return Response.failure((overlay.refusal ?? AgentError.stopped).message)
        } catch let error as AgentError {
            return Response.failure(error.message)
        } catch {
            return Response.failure("\(error)")
        }
    }

    /// Runs commands one at a time: two clients interleaving clicks and keys would race for the focus.
    private func enqueue(_ work: @escaping @MainActor () async -> Data) async -> Data {
        let previous = queueTail
        let id = UUID()
        let task = Task { @MainActor in
            await previous?.value
            return await work()
        }
        queued[id] = task
        queueTail = Task { _ = await task.value }
        let result = await task.value
        queued[id] = nil
        return result
    }

    private func perform(_ request: Request) async throws -> [String: Any] {
        try Permissions.requireAccessibility()
        let app: NSRunningApplication
        var result: [String: Any]
        if request.command == "open" {
            (app, result) = try await open(request)
        } else {
            app = try Targets.resolve(request.app)
            switch request.command {
            case "state":
                overlay.clearStop()
                try checkStopped()
                return try await look(app, request)
            case "click":
                result = try await click(app, request)
            case "scroll":
                result = try await scroll(app, request)
            case "type":
                result = try await type(app, request)
            case "key":
                result = try await key(app, request)
            case "set-value":
                result = try await setValue(app, request)
            case "menu":
                result = try await menu(app, request)
            default:
                throw AgentError("unknown command \"\(request.command)\"")
            }
        }
        if request.withState == true {
            result["settled"] = await settle(app)
            do {
                result["state"] = try await buildState(app, request)
            } catch let error as AgentError {
                result["state"] = ["error": error.message]
            }
        }
        return result
    }

    func buildState(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        let pid = app.processIdentifier
        let appElement = AXUIElementCreateApplication(pid)
        var mode = await prepareChromium(app, appElement)
        guard let keyWindow = AX.keyWindow(of: appElement) else {
            throw AgentError("\(Targets.name(app)) has no window that accessibility can see (no window open, or it is minimized)")
        }
        // A sheet is its own AX element and its own window on screen; the tree and the picture start at its parent.
        let root = AX.container(of: keyWindow).window ?? keyWindow
        let rootFrame = AX.frame(root) ?? .zero
        let previous = snapshots[pid]?.handles ?? HandleTable()

        var walker = walkTree(appElement, root: root, keyWindow: keyWindow, request: request, previous: previous)
        if mode == .manual && walker.handles.count < 5 {
            // Some Chromium builds only fill their tree for AXEnhancedUserInterface, which is kept away from native apps.
            AXUIElementSetAttributeValue(appElement, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
            chromium[pid] = .enhanced
            mode = .enhanced
            try await Task.sleep(for: .milliseconds(600))
            walker = walkTree(appElement, root: root, keyWindow: keyWindow, request: request, previous: previous)
        }

        var notes: [String] = []
        var screenshot: [String: Any] = [:]
        var capture: CaptureResult?
        var captureProblem: String?
        if request.screenshot == false {
            screenshot["error"] = "skipped (--no-screenshot)"
            captureProblem = "the last state was taken with --no-screenshot, so there is no screenshot to map --x/--y from; run `cu state \(Targets.name(app))` without it"
        } else if !CGPreflightScreenCaptureAccess() {
            screenshot["error"] = "Screen Recording is not granted to \(Permissions.appName); run `cu doctor`"
            captureProblem = "the last state has no screenshot because Screen Recording is not granted; run `cu doctor`"
        } else {
            do {
                capture = try await WindowCapture.capture(
                    pid: pid,
                    windowFrame: rootFrame,
                    label: app.bundleIdentifier ?? "pid-\(pid)",
                    maxWidth: Self.maxScreenshotWidth,
                    directory: URL(fileURLWithPath: home.screenshotDirectory, isDirectory: true)
                )
                screenshot = capture?.json ?? [:]
            } catch {
                let message = (error as? AgentError)?.message ?? "capture failed: \(error.localizedDescription)"
                screenshot["error"] = message
                captureProblem = "the last state has no screenshot (\(message))"
            }
        }
        snapshots[pid] = Snapshot(window: root, handles: walker.handles, capture: capture, captureProblem: captureProblem)

        var window: [String: Any] = [
            "title": VisibleText.clean(AX.string(root, kAXTitleAttribute)) ?? "",
            "frame": [
                "x": Double(rootFrame.minX), "y": Double(rootFrame.minY),
                "width": Double(rootFrame.width), "height": Double(rootFrame.height),
            ],
        ]
        if AX.role(keyWindow) == kAXSheetRole {
            window["sheet"] = AX.sheetLabel(keyWindow)
        }
        var result: [String: Any] = [
            "app": Targets.descriptor(app),
            "window": window,
            "screenshot": screenshot,
            "elements": walker.handles.count,
            "tree": walker.lines,
        ]
        if let truncation = walker.truncation {
            result["truncated"] = truncation
        }
        if app.isHidden {
            result["hidden"] = true
            notes.append("the app is hidden: its windows are off screen, cannot be captured, and AppKit reports them with subrole Dialog; `cu open \(Targets.name(app))` shows it")
        }
        switch mode {
        case .manual:
            notes.append("Chromium accessibility switched on with AXManualAccessibility")
        case .enhanced:
            notes.append("Chromium accessibility switched on with AXEnhancedUserInterface")
        case .none:
            break
        }
        if !notes.isEmpty {
            result["note"] = notes.joined(separator: "; ")
        }
        return result
    }

    private func walkTree(_ appElement: AXUIElement, root: AXUIElement, keyWindow: AXUIElement, request: Request, previous: HandleTable) -> TreeWalker {
        var walker = TreeWalker(
            maxDepth: max(1, request.maxDepth ?? Self.defaultMaxDepth),
            maxElements: max(1, request.maxElements ?? Self.defaultMaxElements),
            maxText: max(10, request.maxText ?? Self.defaultMaxText),
            previous: previous
        )
        let rootFrame = AX.frame(root) ?? .infinite
        walker.walk(root, visible: rootFrame)
        if !CFEqual(root, keyWindow) && walker.handles.index(of: keyWindow) == nil {
            walker.walk(keyWindow, visible: AX.frame(keyWindow) ?? .infinite)
        }
        for menu in AX.openMenus(of: appElement) {
            walker.walk(menu, visible: .infinite)
        }
        return walker
    }

    /// Waits until the tree stops changing: the same text three polls in a row, or a timeout.
    func settle(_ app: NSRunningApplication, timeout: Duration = .seconds(3)) async -> Bool {
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        let clock = ContinuousClock()
        let deadline = clock.now + timeout
        var last: [String]?
        var repeats = 0
        try? await Task.sleep(for: .milliseconds(120))
        while clock.now < deadline {
            let lines = signature(appElement)
            if lines == last {
                repeats += 1
                if repeats >= 2 {
                    return true
                }
            } else {
                repeats = 0
                last = lines
            }
            try? await Task.sleep(for: .milliseconds(120))
        }
        return false
    }

    private func signature(_ appElement: AXUIElement) -> [String] {
        guard let keyWindow = AX.keyWindow(of: appElement) else {
            return []
        }
        let root = AX.container(of: keyWindow).window ?? keyWindow
        var request = Request(command: "state")
        request.maxElements = 400
        return walkTree(appElement, root: root, keyWindow: keyWindow, request: request, previous: HandleTable()).lines
    }

    /// Chromium and Electron build their accessibility tree only once an assistive app asks for it.
    private func prepareChromium(_ app: NSRunningApplication, _ appElement: AXUIElement) async -> ChromiumMode {
        let pid = app.processIdentifier
        if let known = chromium[pid] {
            return known
        }
        guard Self.looksChromiumBased(app.bundleURL) else {
            chromium[pid] = ChromiumMode.none
            return .none
        }
        AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        chromium[pid] = .manual
        try? await Task.sleep(for: .milliseconds(400))
        return .manual
    }

    /// Every Chromium-based bundle ships renderer helper apps, either beside its frameworks or inside one of them.
    private static func looksChromiumBased(_ bundleURL: URL?) -> Bool {
        guard let frameworks = bundleURL?.appendingPathComponent("Contents/Frameworks", isDirectory: true) else {
            return false
        }
        let manager = FileManager.default
        let entries = (try? manager.contentsOfDirectory(atPath: frameworks.path)) ?? []
        let isRenderer = { (name: String) in name.hasSuffix("Helper (Renderer).app") }
        if entries.contains(where: { isRenderer($0) || $0.hasPrefix("Electron Framework") || $0.contains("Chromium") }) {
            return true
        }
        for framework in entries where framework.hasSuffix(".framework") {
            let helpers = frameworks.appendingPathComponent("\(framework)/Versions/Current/Helpers").path
            if ((try? manager.contentsOfDirectory(atPath: helpers)) ?? []).contains(where: isRenderer) {
                return true
            }
        }
        return false
    }

    func checkStopped() throws {
        if let refusal = overlay.refusal {
            throw refusal
        }
        if Task.isCancelled {
            throw overlay.refusal ?? AgentError.stopped
        }
    }

    /// A `state` shows as looking: the viewfinder goes around the window the agent captures.
    private func look(_ app: NSRunningApplication, _ request: Request) async throws -> [String: Any] {
        let frame = AX.keyWindow(of: AXUIElementCreateApplication(app.processIdentifier)).flatMap(AX.frame)
        overlay.begin(near: frame.map { CGPoint(x: $0.midX, y: $0.midY) })
        defer {
            overlay.finishAction()
        }
        overlay.show(ActionLook(state: .look, target: Targets.name(app), frame: frame))
        return try await buildState(app, request)
    }

    /// Wraps one action in the overlay: the cursor glides to the target first and shows the action there.
    func act(_ app: NSRunningApplication, at point: CGPoint?, as action: ActionLook, reportPoint: Bool = true, _ body: () async throws -> [String: Any]) async throws -> [String: Any] {
        try checkStopped()
        overlay.begin(near: point)
        defer {
            overlay.finishAction()
        }
        if let point {
            try await overlay.glide(to: point)
        }
        try checkStopped()
        var shown = action
        // A click points first and presses at the moment the event goes out.
        if action.state == .click {
            shown.state = .hover
        }
        overlay.show(shown)
        var result = try await body()
        if let point, reportPoint {
            result["point"] = ["x": Double(point.x.rounded()), "y": Double(point.y.rounded())]
        }
        result["app"] = Targets.descriptor(app)
        return result
    }
}
