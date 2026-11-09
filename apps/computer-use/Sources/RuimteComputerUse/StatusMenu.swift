import AppKit
import ComputerUseCore
import Phantom

/// The menu bar item while a session runs: a mini mark and the time, amber while the agent waits for the person.
@MainActor
final class StatusMenu: NSObject, NSMenuDelegate {
    struct Content: Equatable {
        /// The first line of the menu, which names the app while the agent works in the background.
        var title: String
        var state: PhantomState
        var mode: SessionMode
        var time: String
        var step: String
        /// The session's keys that are registered; a key another app holds is not offered as the shortcut.
        var keys: Set<Hotkeys.Action>
    }

    var onTogglePause: (() -> Void)?
    var onTakeOver: (() -> Void)?
    var onStop: (() -> Void)?
    private var item: NSStatusItem?
    private var content: Content?
    private var markState: PhantomState?
    private var config = OverlayConfig()

    func show(_ content: Content, config: OverlayConfig) {
        self.config = config
        if item == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
            let menu = NSMenu()
            menu.delegate = self
            menu.autoenablesItems = false
            item.menu = menu
            item.button?.imagePosition = .imageLeading
            self.item = item
        }
        update(content)
    }

    func update(_ content: Content) {
        guard let button = item?.button, content != self.content else {
            return
        }
        self.content = content
        let shown = PhantomLook.markState(content.state)
        if shown != markState {
            let scale = button.window?.backingScaleFactor ?? 2
            if let image = PhantomSnapshot.mark(shown, scale: scale) {
                button.image = NSImage(cgImage: image, size: OverlayStyle.MenuBar.mark)
            }
            markState = shown
        }
        var attributes: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)]
        if content.state.waitsOnPerson {
            attributes[.foregroundColor] = NSColor(cgColor: OverlayStyle.color(.needs))
        }
        button.attributedTitle = NSAttributedString(string: content.time, attributes: attributes)
    }

    func hide() {
        if let item {
            NSStatusBar.system.removeStatusItem(item)
        }
        item = nil
        content = nil
        markState = nil
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        guard let content else {
            return
        }
        let title = NSMenuItem(title: content.title, action: nil, keyEquivalent: "")
        title.attributedTitle = NSAttributedString(string: content.title, attributes: [.font: NSFont.systemFont(ofSize: NSFont.menuFont(ofSize: 0).pointSize, weight: .medium)])
        title.isEnabled = false
        menu.addItem(title)
        let step = NSMenuItem(title: content.step, action: nil, keyEquivalent: "")
        step.attributedTitle = NSAttributedString(string: content.step, attributes: [
            .font: NSFont.menuFont(ofSize: NSFont.smallSystemFontSize),
            .foregroundColor: NSColor.secondaryLabelColor,
        ])
        step.isEnabled = false
        menu.addItem(step)
        menu.addItem(.separator())

        let pause = NSMenuItem(title: content.mode == .running ? config.pause : config.resume, action: #selector(togglePause), keyEquivalent: content.keys.contains(.togglePause) ? " " : "")
        pause.keyEquivalentModifierMask = .option
        pause.target = self
        menu.addItem(pause)
        let takeOver = NSMenuItem(title: config.takeOver, action: #selector(takeOver), keyEquivalent: "")
        takeOver.target = self
        takeOver.isEnabled = content.mode != .takenOver
        menu.addItem(takeOver)
        menu.addItem(.separator())

        let stop = NSMenuItem(title: config.stop, action: #selector(stop), keyEquivalent: content.keys.contains(.stop) ? "\u{1b}" : "")
        stop.keyEquivalentModifierMask = .option
        stop.attributedTitle = NSAttributedString(string: config.stop, attributes: [
            .foregroundColor: NSColor(cgColor: OverlayStyle.color(.error)) ?? .systemRed,
            .font: NSFont.menuFont(ofSize: 0),
        ])
        stop.target = self
        menu.addItem(stop)
    }

    @objc private func togglePause() {
        onTogglePause?()
    }

    @objc private func takeOver() {
        onTakeOver?()
    }

    @objc private func stop() {
        onStop?()
    }
}
