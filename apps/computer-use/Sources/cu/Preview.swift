import AppKit
import ComputerUseCore
import Phantom
import QuartzCore

/// A window with every state of the cursor live, the cursor travelling between buttons, and the real menu bar item
/// with its menu, for looking at the overlay without a session. Development only.
@MainActor
final class Preview {
    private static var current: Preview?

    private let window: NSWindow
    private let stage = CALayer()
    private var cells: [(cursor: PhantomCursor, state: PhantomState, scene: PhantomScene)] = []
    private let traveller = PhantomCursor()
    private let menu = StatusMenu()
    private let started = Date()

    private static let cell = CGSize(width: 170, height: 120)
    private static let caption: CGFloat = 22
    private static let gap: CGFloat = 12
    private static let margin: CGFloat = 24
    private static let columns = 6
    private static let scene = CGRect(x: 24, y: 0, width: 600, height: 300)
    private static let buttons: [CGRect] = [
        CGRect(x: 70, y: 52, width: 56, height: 22),
        CGRect(x: 430, y: 52, width: 66, height: 22),
        CGRect(x: 250, y: 150, width: 90, height: 26),
        CGRect(x: 90, y: 240, width: 70, height: 24),
        CGRect(x: 400, y: 236, width: 96, height: 28),
    ]
    private static let route = [0, 2, 1, 4, 3]

    static func run() -> Never {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let preview = Preview()
        current = preview
        preview.start()
        app.activate()
        app.run()
        exit(0)
    }

    private var motion: LiveMotion {
        LiveMotion(reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
    }

    private var states: [(PhantomState, ScrollDirection)] {
        PhantomState.allCases.flatMap { state in
            state == .scroll ? [(state, ScrollDirection.down), (state, .up)] : [(state, .down)]
        }
    }

    private init() {
        let rows = CGFloat((PhantomState.allCases.count + 1 + Self.columns - 1) / Self.columns)
        let gridHeight = rows * (Self.cell.height + Self.caption + Self.gap)
        let width = Self.margin * 2 + CGFloat(Self.columns) * Self.cell.width + CGFloat(Self.columns - 1) * Self.gap
        let height = Self.margin * 2 + gridHeight + Self.scene.height + Self.caption
        window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: height), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Phantom cursor preview"
        window.isReleasedWhenClosed = false
        let root = NSView()
        root.wantsLayer = true
        window.contentView = root
        stage.isGeometryFlipped = true
        stage.frame = CGRect(x: 0, y: 0, width: width, height: height)
        stage.backgroundColor = CGColor(red: 0.9, green: 0.91, blue: 0.94, alpha: 1)
        root.layer?.addSublayer(stage)
        buildCells()
        buildScene(top: Self.margin + gridHeight)
        Layers.setScale(stage, window.backingScaleFactor)
        window.center()
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { _ in
            exit(0)
        }
    }

    private func buildCells() {
        for (index, pair) in states.enumerated() {
            let column = index % Self.columns
            let row = index / Self.columns
            let origin = CGPoint(
                x: Self.margin + CGFloat(column) * (Self.cell.width + Self.gap),
                y: Self.margin + CGFloat(row) * (Self.cell.height + Self.caption + Self.gap)
            )
            let ground = CALayer()
            ground.frame = CGRect(origin: origin, size: Self.cell)
            ground.cornerRadius = 12
            ground.backgroundColor = CGColor(red: 0.97, green: 0.97, blue: 0.98, alpha: 1)
            stage.addSublayer(ground)
            let cursor = PhantomCursor()
            cursor.layer.position = CGPoint(x: Self.cell.width / 2 - 14, y: Self.cell.height / 2 - 12)
            ground.addSublayer(cursor.layer)
            var scene = PhantomScene()
            scene.scrollDirection = pair.1
            cells.append((cursor, pair.0, scene))
            let name = pair.0 == .scroll ? "scroll \(pair.1.rawValue)" : pair.0.rawValue
            stage.addSublayer(Self.label(name, at: CGPoint(x: origin.x + 4, y: origin.y + Self.cell.height + 3)))
        }
    }

    private func buildScene(top: CGFloat) {
        let frame = Self.scene.offsetBy(dx: 0, dy: top)
        let ground = CALayer()
        ground.frame = frame
        ground.cornerRadius = 14
        ground.backgroundColor = .white
        ground.shadowOpacity = 0.12
        ground.shadowRadius = 6
        ground.shadowOffset = CGSize(width: 0, height: 6)
        stage.addSublayer(ground)
        for button in Self.buttons {
            let shape = CALayer()
            shape.frame = button
            shape.cornerRadius = button.height / 2
            shape.backgroundColor = CGColor(red: 0.94, green: 0.94, blue: 0.95, alpha: 1)
            ground.addSublayer(shape)
        }
        traveller.layer.position = Self.center(Self.route[0])
        ground.addSublayer(traveller.layer)
        let note = "The real menu bar item sits at the top right: working, then waiting, then permission, 6 s each. Click it for the menu."
        stage.addSublayer(Self.label(note, at: CGPoint(x: frame.maxX + 24, y: frame.minY), width: stage.bounds.width - frame.maxX - 48))
    }

    private func start() {
        window.makeKeyAndOrderFront(nil)
        for cell in cells {
            cell.cursor.show(.idle, scene: cell.scene, motion: motion, animated: false)
        }
        traveller.show(.idle, scene: PhantomScene(), motion: motion, animated: false)
        Task {
            await self.cycleStates()
        }
        Task {
            await self.travel()
        }
        menu.onTogglePause = {
            print("pause")
        }
        menu.onTakeOver = {
            print("take over")
        }
        menu.onStop = {
            exit(0)
        }
        let tick = Timer(timeInterval: 1, repeats: true) { _ in
            MainActor.assumeIsolated {
                Preview.current?.refreshMenu()
            }
        }
        RunLoop.main.add(tick, forMode: .common)
        refreshMenu()
    }

    /// Rest, then the state, as the design's cells do.
    private func cycleStates() async {
        while true {
            for cell in cells {
                cell.cursor.show(.idle, scene: cell.scene, motion: motion, animated: true)
            }
            try? await Task.sleep(for: .milliseconds(700))
            for cell in cells {
                cell.cursor.show(cell.state, scene: cell.scene, motion: motion, animated: true)
            }
            try? await Task.sleep(for: .milliseconds(4300))
        }
    }

    private func travel() async {
        var step = 1
        var at = Self.center(Self.route[0])
        while true {
            let target = Self.center(Self.route[step % Self.route.count])
            let start = at
            let distance = hypot(target.x - start.x, target.y - start.y)
            let duration = PhantomTravel.duration(distance: distance)
            traveller.show(.move, scene: PhantomScene(), motion: motion, animated: true)
            motion.run(Track(keyPath: "position", duration: duration) { time in
                NSValue(point: PhantomTravel.point(from: start, to: target, progress: PhantomTravel.easing.progress(CGFloat(time / duration))))
            }, on: traveller.layer)
            try? await Task.sleep(for: .seconds(duration))
            traveller.show(.click, scene: PhantomScene(), motion: motion, animated: true)
            at = target
            try? await Task.sleep(for: .milliseconds(950))
            step += 1
        }
    }

    private func refreshMenu() {
        let seconds = Date().timeIntervalSince(started)
        let states: [PhantomState] = [.think, .waiting, .permission]
        let state = states[Int(seconds / 6) % states.count]
        let config = OverlayConfig()
        menu.show(StatusMenu.Content(
            title: config.menuTitle(background: "Mail"),
            state: state,
            mode: .running,
            time: SessionControl.clock(seconds + 134),
            step: state == .think ? "Reading the inbox" : config.step(for: state, target: nil),
            pauseKey: true,
            stopKey: true
        ), config: config)
    }

    private static func center(_ index: Int) -> CGPoint {
        CGPoint(x: buttons[index].midX, y: buttons[index].midY)
    }

    private static func label(_ text: String, at origin: CGPoint, width: CGFloat? = nil) -> CATextLayer {
        let font = NSFont.systemFont(ofSize: 13)
        let layer = CATextLayer()
        layer.string = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor(white: 0.35, alpha: 1)])
        layer.isWrapped = width != nil
        let size = width.map { CGSize(width: $0, height: 80) } ?? CGSize(width: 200, height: 18)
        layer.frame = CGRect(origin: origin, size: size)
        return layer
    }
}
