import AppKit
import ComputerUseCore
import Phantom
import QuartzCore

/// AX and CGEvent use global points with the origin at the top-left of the primary screen; AppKit uses the bottom-left.
@MainActor
enum Geometry {
    static var primaryHeight: CGFloat {
        NSScreen.screens.first?.frame.height ?? 0
    }

    static func cocoa(fromGlobal point: CGPoint) -> CGPoint {
        CGPoint(x: point.x, y: primaryHeight - point.y)
    }

    static func global(fromCocoa point: CGPoint) -> CGPoint {
        CGPoint(x: point.x, y: primaryHeight - point.y)
    }

    static func screen(containingGlobal point: CGPoint) -> NSScreen? {
        let cocoaPoint = cocoa(fromGlobal: point)
        return NSScreen.screens.first { NSMouseInRect(cocoaPoint, $0.frame, false) } ?? NSScreen.main
    }

    /// A global point in the screen's own space: y down from its top-left corner.
    static func local(_ point: CGPoint, on screen: NSScreen) -> CGPoint {
        CGPoint(x: point.x - screen.frame.minX, y: point.y - (primaryHeight - screen.frame.maxY))
    }
}

/// What an action shows at the cursor.
struct ActionLook {
    var state: PhantomState
    /// What the action is aimed at, for the step line of the menu.
    var target: String?
    /// The text of `type`, the name on the card of `drag`.
    var text: String?
    var direction = ScrollDirection.down
    /// The global frame `look` puts its viewfinder around.
    var frame: CGRect?
}

/// The visible session: the phantom cursor, the session bar, the menu bar item, the hot keys, and noticing the
/// person's own hand on the mouse. It also holds the person's control over the session, which the agent obeys.
@MainActor
final class Overlay {
    /// A session nobody sends a command to for this long ends on its own, unless it waits for the person.
    private static let idleTimeout: Duration = .seconds(120)
    /// Long enough to read why the session ends; `done` needs no words and goes with its own fade.
    private static let endingLinger: Double = 3

    /// Called when the person pauses, takes over or stops, with what an agent command answers from then on.
    var onInterrupt: ((AgentError) -> Void)?
    private(set) var control = SessionControl()
    private let configPath: String
    private var config = OverlayConfig()
    private var window: NSWindow?
    private let stage = CALayer()
    private let cursor = PhantomCursor()
    private var screen: NSScreen?
    /// Screen-local, y down; nil until the cursor first goes somewhere.
    private var cursorPoint: CGPoint?
    private var look = ActionLook(state: .idle)
    private var presenceLabel: String?
    private var step = ""
    private var thinkTurn = -1
    private var takeover = TakeoverDetector()
    /// The key window of the app the agent last acted in, global and y down: where the person's movement takes over.
    private var operatedFrame: CGRect?
    private var operatedPid: pid_t?
    /// The app the agent works in behind the person's work, named on the bar; nil while it works in front.
    private var background: String?
    /// Until when the operated app coming to the front is its own launch and not the person.
    private var activationGrace: TimeInterval = 0
    private var mouseMonitor: Any?
    private var activationObserver: NSObjectProtocol?
    private var tick: Timer?
    private var holdTask: Task<Void, Never>?
    private var idleTask: Task<Void, Never>?
    private var endTask: Task<Void, Never>?
    private lazy var bar = SessionBar { [weak self] button in
        self?.barButton(button)
    }
    private let menu = StatusMenu()
    private lazy var hotkeys = Hotkeys { [weak self] action in
        switch action {
        case .togglePause:
            self?.togglePause()
        case .stop:
            self?.stop()
        }
    }

    init(configPath: String) {
        self.configPath = configPath
        stage.isGeometryFlipped = true
        stage.addSublayer(cursor.layer)
        cursor.layer.isHidden = true
        menu.onTogglePause = { [weak self] in
            self?.togglePause()
        }
        menu.onTakeOver = { [weak self] in
            self?.takeOver()
        }
        menu.onStop = { [weak self] in
            self?.stop()
        }
        DistributedNotificationCenter.default().addObserver(forName: Notification.Name("AppleInterfaceThemeChangedNotification"), object: nil, queue: .main) { [weak self] _ in
            // The appearance of the app follows a moment after the notification.
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(150))
                self?.render(animated: false)
            }
        }
    }

    private var now: TimeInterval {
        ProcessInfo.processInfo.systemUptime
    }

    private var theme: PhantomTheme {
        PhantomTheme.current(NSApp.effectiveAppearance)
    }

    private var reduceMotion: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }

    private var accent: CGColor? {
        config.accentComponents.map { CGColor(srgbRed: $0.red, green: $0.green, blue: $0.blue, alpha: 1) }
    }


    /// Why an agent command may not run now; nil when it may.
    var refusal: AgentError? {
        control.refusal
    }

    /// A new `state` is how an agent picks up again after the person stopped it, or the daemon, which took the stop over.
    func clearStop() {
        control.clearStop()
    }

    /// Starts the session, or keeps it going, on the screen of the point. In the background, `app` names the app
    /// the agent works in, and the cursor stays away: it would be drawn over other apps.
    func begin(near globalPoint: CGPoint?, background app: String?) {
        background = app
        if app != nil {
            cursor.layer.isHidden = true
            cursorPoint = nil
        }
        endTask?.cancel()
        holdTask?.cancel()
        takeover.reset()
        config = OverlayConfig.load(from: configPath)
        let anchor = globalPoint ?? cursorGlobalPoint ?? SyntheticInput.currentPointer()
        guard let target = Geometry.screen(containingGlobal: anchor) else {
            return
        }
        if window == nil {
            window = makeWindow()
        }
        if screen != target {
            place(on: target)
        }
        window?.alphaValue = 1
        window?.orderFrontRegardless()
        if !control.isActive {
            control.begin(at: now)
            hotkeys.register()
            installMouseMonitor()
            installActivationObserver()
            tick = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.refreshChrome()
                }
            }
        }
        armIdleTimeout()
        refreshChrome()
    }

    /// The window the agent acts in now, which the person's movement has to be in to take over.
    func operating(in frame: CGRect?, pid: pid_t) {
        operatedFrame = frame
        operatedPid = pid
    }

    /// The app is about to come up by the agent's own doing, which is not the person bringing it forward.
    func expectActivation(for duration: TimeInterval) {
        activationGrace = now + duration
    }

    /// Moves the cursor to the target, showing `state` on the way; the real pointer stays put.
    func glide(to globalPoint: CGPoint, showing state: PhantomState = .move) async throws {
        guard let screen, background == nil else {
            return
        }
        let target = Geometry.local(globalPoint, on: screen)
        let pointer = Geometry.local(SyntheticInput.currentPointer(), on: screen)
        let bounds = CGRect(origin: .zero, size: screen.frame.size)
        let wasHidden = cursor.layer.isHidden
        let start = (cursor.layer.presentation()?.position).flatMap { wasHidden ? nil : $0 }
            ?? cursorPoint
            ?? (bounds.contains(pointer) ? pointer : CGPoint(x: target.x + 120, y: target.y + 90))
        cursorPoint = target
        show(ActionLook(state: state, target: look.target, text: look.text))
        let timing = OverlayStyle.Motion.move
        let motion = LiveMotion(reduceMotion: reduceMotion)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        cursor.layer.isHidden = false
        cursor.layer.position = start
        motion.run(Track(keyPath: "position", duration: timing.duration) { time in
            let progress = timing.easing.progress(CGFloat(time / timing.duration))
            return NSValue(point: CGPoint(x: start.x + (target.x - start.x) * progress, y: start.y + (target.y - start.y) * progress))
        }, on: cursor.layer)
        CATransaction.commit()
        if motion.moves && hypot(target.x - start.x, target.y - start.y) > 1 {
            try await Task.sleep(for: .milliseconds(Int(timing.duration * 1000)))
        }
    }

    /// Shows an action at the cursor.
    func show(_ action: ActionLook) {
        holdTask?.cancel()
        look = action
        presenceLabel = nil
        control.show(action.state)
        step = config.step(for: action.state, target: action.target)
        render(animated: true)
    }

    /// The moment of a click: the press and the ring, again for each click.
    func press(target: String?) {
        if control.agentState == .click {
            cursor.replayClick(scene: scene(for: .click), motion: LiveMotion(reduceMotion: reduceMotion))
        } else {
            show(ActionLook(state: .click, target: target ?? look.target))
        }
    }

    /// The action is over: after a moment the cursor rests again.
    func finishAction() {
        armIdleTimeout()
        holdTask?.cancel()
        var hold = OverlayStyle.Motion.actionHold
        if look.state == .type, let text = look.text {
            hold += OverlayStyle.Motion.typedLetter * Double(min(text.count, OverlayStyle.Label.maxTypedCharacters))
        }
        holdTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(Int(hold * 1000)))
            guard !Task.isCancelled, let self, self.control.isActive, self.control.agentState.isAction else {
                return
            }
            self.control.show(.idle)
            self.look = ActionLook(state: .idle)
            self.step = self.config.step(for: .idle, target: nil)
            self.render(animated: true)
        }
    }

    /// What the agent is when it is not acting: set by the daemon, which knows.
    func presence(_ name: String?, label: String?, step stepText: String?, ends: Bool) throws -> [String: Any] {
        guard let request = PresenceRequest(name) else {
            throw AgentError("presence takes one of \(PresenceRequest.names.joined(separator: ", "))")
        }
        guard case let .show(state) = request else {
            // In any mode: with the agent gone there is nothing left for the person to hold or resume.
            if control.isActive {
                endSession()
            }
            return ["session": false, "shown": NSNull()]
        }
        let settles = state == .done || ends
        if control.stopped && !settles {
            throw AgentError.stopped
        }
        if !control.isActive {
            guard !settles else {
                return ["session": false, "shown": NSNull()]
            }
            begin(near: nil, background: background)
        }
        config = OverlayConfig.load(from: configPath)
        holdTask?.cancel()
        armIdleTimeout()
        if state == .think && control.agentState != .think {
            thinkTurn += 1
        }
        look = ActionLook(state: state)
        presenceLabel = label.flatMap { $0.isEmpty ? nil : $0 }
        control.show(state)
        step = stepText.flatMap { $0.isEmpty ? nil : $0 } ?? config.step(for: state, target: nil)
        render(animated: true)
        if settles {
            endTask?.cancel()
            let linger = state == .done ? OverlayStyle.Motion.doneFadeDelay + OverlayStyle.Motion.doneFade.duration : Self.endingLinger
            endTask = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(Int(linger * 1000)))
                guard !Task.isCancelled, let self, self.control.agentState == state else {
                    return
                }
                self.endSession()
            }
        }
        return ["session": true, "shown": control.shownState.rawValue, "mode": control.mode.rawValue]
    }


    func togglePause() {
        guard control.isActive else {
            return
        }
        let wasRunning = control.mode == .running
        control.togglePause(at: now)
        if wasRunning {
            onInterrupt?(.paused)
        } else {
            armIdleTimeout()
        }
        render(animated: true)
    }

    func takeOver() {
        guard control.isActive, control.mode != .takenOver else {
            return
        }
        control.takeOver(at: now)
        onInterrupt?(.takenOver)
        render(animated: true)
    }

    func stop() {
        guard control.isActive else {
            return
        }
        control.stop(at: now)
        onInterrupt?(.stopped)
        endSession()
    }

    /// What the session bar's buttons do, for a person who presses them in Ruimte instead.
    func press(_ action: SessionAction) -> [String: Any] {
        if action.applies(to: control) {
            switch action {
            case .pause, .resume:
                togglePause()
            case .stop:
                stop()
            }
        }
        return ["session": control.summary]
    }

    private func barButton(_ button: SessionBarLayer.Button) {
        switch button {
        case .pause:
            togglePause()
        case .stop:
            stop()
        }
    }

    /// Only the person's own input: the helper's events carry the marker, and the grace after them covers what
    /// the system derives from them.
    private func installMouseMonitor() {
        guard mouseMonitor == nil else {
            return
        }
        let kinds: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDown, .rightMouseDown, .otherMouseDown, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
        mouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: kinds) { [weak self] event in
            let synthetic = event.cgEvent?.getIntegerValueField(.eventSourceUserData) == SyntheticInput.marker
            let isPress = [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(event.type)
            let distance = hypot(event.deltaX, event.deltaY)
            let time = event.timestamp
            MainActor.assumeIsolated {
                self?.personMoved(synthetic: synthetic, press: isPress, distance: distance, at: time)
            }
        }
    }

    private func personMoved(synthetic: Bool, press: Bool, distance: CGFloat, at time: TimeInterval) {
        guard !synthetic, !SyntheticInput.postedRecently, control.acceptsTakeover else {
            return
        }
        let pointer = Geometry.global(fromCocoa: NSEvent.mouseLocation)
        let inside = operatedFrame?.contains(pointer) ?? false
        if background != nil {
            // Behind the person's work their hand is expected: only a click that lands in the app's own window takes over.
            if press, inside, let operatedPid, WindowStack.owner(at: pointer, in: WindowCapture.onScreenStack(), ignoring: getpid()) == operatedPid {
                takeOver()
            }
            return
        }
        if takeover.note(press: press, distance: distance, inside: inside, at: time) {
            takeOver()
        }
    }


    /// Bringing the app the agent works in to the front takes over, in the background; in front the agent brought it there.
    private func installActivationObserver() {
        guard activationObserver == nil else {
            return
        }
        activationObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] notification in
            let pid = (notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.processIdentifier
            MainActor.assumeIsolated {
                guard let self, let pid, self.background != nil, pid == self.operatedPid, self.now > self.activationGrace, self.control.acceptsTakeover else {
                    return
                }
                self.takeOver()
            }
        }
    }

    private var cursorGlobalPoint: CGPoint? {
        guard let cursorPoint, let screen else {
            return nil
        }
        return CGPoint(x: cursorPoint.x + screen.frame.minX, y: cursorPoint.y + (Geometry.primaryHeight - screen.frame.maxY))
    }

    private func labelText(for state: PhantomState) -> String? {
        switch state {
        case .type, .drag:
            return look.text
        case .think, .waiting, .permission, .error, .done:
            return presenceLabel
        default:
            return nil
        }
    }

    private func scene(for state: PhantomState) -> PhantomScene {
        var scene = PhantomScene()
        scene.theme = theme
        scene.accent = accent
        scene.label = labelText(for: state)
        scene.scrollDirection = look.direction
        scene.dots = DotMotion.rotating(max(thinkTurn, 0))
        if let screen, let point = cursorPoint {
            scene.room = CGRect(origin: CGPoint(x: -point.x, y: -point.y), size: screen.frame.size)
            if let frame = look.frame {
                let origin = Geometry.local(frame.origin, on: screen)
                scene.viewfinder = CGRect(x: origin.x - point.x, y: origin.y - point.y, width: frame.width, height: frame.height)
            }
        }
        return scene
    }

    private func render(animated: Bool) {
        guard control.isActive else {
            return
        }
        let state = control.shownState
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        cursor.show(state, scene: scene(for: state), motion: LiveMotion(reduceMotion: reduceMotion), animated: animated && !cursor.layer.isHidden)
        CATransaction.commit()
        refreshChrome()
    }

    private func refreshChrome() {
        guard control.isActive, let screen else {
            return
        }
        let shown = control.shownState
        let time = SessionControl.clock(control.elapsed(at: now))
        let held = control.mode != .running
        bar.show(on: screen, SessionBarLayer.Content(title: config.title(background: background), state: shown, held: held, time: time, theme: theme), accent: accent, reduceMotion: reduceMotion)
        let stepLine = held ? config.step(for: shown, target: nil) : step
        menu.show(StatusMenu.Content(title: config.menuTitle(background: background), state: shown, mode: control.mode, time: time, step: stepLine, keys: hotkeys.registered), config: config, accent: accent)
    }

    private func armIdleTimeout() {
        idleTask?.cancel()
        idleTask = Task { [weak self] in
            try? await Task.sleep(for: Self.idleTimeout)
            guard !Task.isCancelled, let self, self.control.isActive, self.control.mode == .running, !self.control.agentState.waitsOnPerson else {
                return
            }
            self.endSession()
        }
    }

    private func endSession() {
        if control.isActive {
            control.end(at: now)
        }
        for task in [holdTask, idleTask, endTask] {
            task?.cancel()
        }
        tick?.invalidate()
        tick = nil
        hotkeys.unregister()
        if let mouseMonitor {
            NSEvent.removeMonitor(mouseMonitor)
        }
        mouseMonitor = nil
        if let activationObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(activationObserver)
        }
        activationObserver = nil
        background = nil
        operatedPid = nil
        bar.hide()
        menu.hide()
        look = ActionLook(state: .idle)
        presenceLabel = nil
        cursorPoint = nil
        guard let window else {
            return
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.15
            window.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated {
                guard let self, !self.control.isActive else {
                    return
                }
                self.window?.orderOut(nil)
                self.cursor.layer.isHidden = true
            }
        })
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.isReleasedWhenClosed = false
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.assistiveTechHighWindow)))
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.sharingType = .none
        let root = NSView()
        root.wantsLayer = true
        window.contentView = root
        root.layer?.addSublayer(stage)
        return window
    }

    private func place(on screen: NSScreen) {
        guard let window else {
            return
        }
        self.screen = screen
        cursorPoint = nil
        cursor.layer.isHidden = true
        window.setFrame(screen.frame, display: false)
        window.contentView?.frame = CGRect(origin: .zero, size: screen.frame.size)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        stage.frame = CGRect(origin: .zero, size: screen.frame.size)
        CATransaction.commit()
        Layers.setScale(stage, screen.backingScaleFactor)
    }
}
