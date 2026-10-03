import RuimtePulsar
import RuimteTransport
@preconcurrency import SwiftTerm
import SwiftUI
import UIKit

struct TerminalScreen: View {
    @State private var model: TerminalModel
    @AppStorage("ruimte.ios.terminalFontSize") private var fontSize = 14.0
    @AppStorage("ruimte.ios.appearance") private var theme = "system"
    @State private var clearing = false
    @State private var keyboardShown = false
    let title: String
    /// False while the session is still being made, so the page stands with its bar before the screen attaches.
    let isPrepared: Bool
    let held: TerminalHeldCommand?

    init(
        client: any MachineRequesting, sessionID: String, title: String, isPrepared: Bool = true,
        held: TerminalHeldCommand? = nil
    ) {
        _model = State(initialValue: TerminalModel(client: client, sessionID: sessionID))
        self.title = title
        self.isPrepared = isPrepared
        self.held = held
    }

    private var usable: Bool { model.connected && !model.loading && !model.exited }

    var body: some View {
        VStack(spacing: 0) {
            if let error = model.error { SessionErrorBanner(message: error) { model.attach() } }
            NativeTerminal(model: model, fontSize: fontSize, theme: theme)
                .padding(.horizontal, 12).padding(.top, 12)
                .background(MobileStyle.surface)
                .overlay {
                    if model.loading { MobileLoadingRow("Loading terminal…") }
                }
                .overlay(alignment: .top) {
                    if isPrepared && (model.exited || !model.connected) {
                        MobileStatus(
                            title: model.exited ? "Exited" : "Reconnecting",
                            color: model.exited ? .secondary : .orange
                        )
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .glassEffect(.regular, in: .capsule)
                        .padding(.top, 8)
                    }
                }
        }
        .background(MobileStyle.surface)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            GlassEffectContainer(spacing: 8) {
                VStack(spacing: 8) {
                    if let held {
                        TerminalHeldPrompt(held: held)
                    }
                    TerminalKeyBar(model: model, keyboardShown: keyboardShown)
                        .disabled(!usable)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(id: "terminal.actions", placement: .topBarTrailing) {
                Menu {
                    Section("Font size") {
                        ForEach([10.0, 12, 13, 14, 16, 18, 20], id: \.self) { size in
                            Button("\(Int(size)) pt") { fontSize = size }
                        }
                    }
                    Picker("Theme", selection: $theme) {
                        Text("System").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }
                    Section("Following the machine's \(model.cols) × \(model.rows)") {
                        Button("Reload screen", lucideIcon: "refresh-cw") { model.attach() }
                        Button("Clear scrollback", lucideIcon: "eraser") { clearing = true }
                            .keyboardShortcut("k", modifiers: .command)
                            .disabled(!usable)
                    }
                } label: {
                    Image(lucide: "ellipsis")
                }
                .accessibilityLabel("Terminal actions")
            }
        }
        .onAppear { if isPrepared { model.start() } }
        .onChange(of: isPrepared) { _, prepared in if prepared { model.start() } }
        .onDisappear { model.stop() }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            keyboardShown = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardShown = false
        }
        .confirmationDialog("Clear terminal scrollback?", isPresented: $clearing, titleVisibility: .visible) {
            Button("Clear scrollback", role: .destructive) { Task { await model.clear() } }
        } message: {
            Text("This clears the shared terminal scrollback on every client.")
        }
    }
}

private struct NativeTerminal: UIViewRepresentable {
    let model: TerminalModel
    let fontSize: Double
    let theme: String

    func makeUIView(context: Context) -> TerminalContainer {
        let container = TerminalContainer()
        container.terminal.terminalDelegate = context.coordinator
        bind(container)
        return container
    }

    private func bind(_ container: TerminalContainer) {
        container.terminal.onClear = { Task { await model.clear() } }
        model.render = { [weak container] text, reset in
            guard let terminal = container?.terminal else { return }
            if reset { terminal.getTerminal().resetToInitialState() }
            terminal.feed(text: text)
        }
        model.resizeDisplay = { [weak container] cols, rows in container?.setDimensions(cols: cols, rows: rows) }
        model.applicationCursor = { [weak container] in container?.terminal.getTerminal().applicationCursor ?? false }
        model.toggleKeyboard = { [weak container] in container?.toggleKeyboard() }
        model.flushOutput()
    }

    func updateUIView(_ container: TerminalContainer, context: Context) {
        context.coordinator.model = model
        bind(container)
        container.configure(fontSize: fontSize, theme: theme)
        container.setDimensions(cols: model.cols, rows: model.rows)
        container.terminal.isUserInteractionEnabled = model.connected && !model.loading && !model.exited
    }

    static func dismantleUIView(_ container: TerminalContainer, coordinator: Coordinator) {
        container.terminal.updateUiClosed()
        container.terminal.terminalDelegate = nil
        container.terminal.onClear = nil
    }

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    @MainActor final class Coordinator: NSObject, @preconcurrency TerminalViewDelegate {
        var model: TerminalModel
        init(model: TerminalModel) { self.model = model }
        func send(source: TerminalView, data: ArraySlice<UInt8>) { model.type(String(decoding: data, as: UTF8.self)) }
        func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
            // Following the remote PTY must never resize another client's shell.
        }
        func setTerminalTitle(source: TerminalView, title: String) {}
        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
        func scrolled(source: TerminalView, position: Double) {}
        func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
            guard let url = URL(string: link), ["https", "http"].contains(url.scheme?.lowercased() ?? "") else {
                return
            }
            UIApplication.shared.open(url)
        }
        func bell(source: TerminalView) { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
        func clipboardCopy(source: TerminalView, content: Data) {}
        func clipboardRead(source: TerminalView) -> Data? { nil }
        func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
        func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
    }
}

@MainActor
final class TerminalContainer: UIScrollView {
    let terminal = RemoteTerminalView(frame: .zero)
    private var cols = 80
    private var rows = 24
    private var chosenFont = 0.0
    private var chosenTheme = ""
    private let focusTap = UITapGestureRecognizer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(terminal)
        alwaysBounceHorizontal = true
        isDirectionalLockEnabled = true
        terminal.accessibilityIdentifier = "terminal.screen"
        terminal.changeScrollback(10000)
        focusTap.addTarget(self, action: #selector(focusTerminal))
        addGestureRecognizer(focusTap)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    func configure(fontSize: Double, theme: String) {
        if chosenFont != fontSize {
            chosenFont = fontSize
            terminal.font = .monospacedSystemFont(ofSize: fontSize, weight: .regular)
            setNeedsLayout()
        }
        if chosenTheme != theme {
            chosenTheme = theme
            overrideUserInterfaceStyle = theme == "dark" ? .dark : theme == "light" ? .light : .unspecified
            terminal.nativeBackgroundColor = MobileStyle.surfaceColor
            terminal.nativeForegroundColor = MobileStyle.textColor
            backgroundColor = MobileStyle.surfaceColor
        }
    }

    func setDimensions(cols: Int, rows: Int) {
        guard self.cols != cols || self.rows != rows else { return }
        self.cols = cols
        self.rows = rows
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let emulator = terminal.getTerminal()
        if emulator.cols != cols || emulator.rows != rows {
            // The view's own `resize` soft-resets as well, which drops the cursor, modes and scroll region a program
            // on the remote set.
            emulator.resize(cols: cols, rows: rows)
            terminal.sizeChanged(source: emulator)
        }
        // SwiftTerm sizes its grid from the frame on its own, so the frame is the remote grid and nothing else. Half a
        // cell over it keeps its division by the cell size from rounding a row or column away.
        let grid = terminal.getOptimalFrameSize().size
        let size = CGSize(
            width: grid.width + grid.width / CGFloat(2 * cols), height: grid.height + grid.height / CGFloat(2 * rows))
        if terminal.frame.size != size {
            terminal.frame = CGRect(origin: .zero, size: size)
        }
        contentSize = size
    }

    override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
        if recognizer === focusTap { return !terminal.frame.contains(recognizer.location(in: self)) }
        return super.gestureRecognizerShouldBegin(recognizer)
    }

    func toggleKeyboard() {
        if terminal.isFirstResponder {
            _ = terminal.resignFirstResponder()
        } else if terminal.isUserInteractionEnabled {
            _ = terminal.becomeFirstResponder()
        }
    }

    /// A grid smaller than the screen leaves room beside it, where a tap still brings up the keyboard.
    @objc private func focusTerminal() {
        guard terminal.isUserInteractionEnabled else { return }
        terminal.becomeFirstResponder()
    }
}

@MainActor
final class RemoteTerminalView: TerminalView {
    var onClear: (() -> Void)?
    override var keyCommands: [UIKeyCommand]? {
        (super.keyCommands ?? []) + [
            UIKeyCommand(input: UIKeyCommand.inputLeftArrow, modifierFlags: .command, action: #selector(lineStart)),
            UIKeyCommand(input: UIKeyCommand.inputRightArrow, modifierFlags: .command, action: #selector(lineEnd)),
            UIKeyCommand(input: UIKeyCommand.inputLeftArrow, modifierFlags: .alternate, action: #selector(wordBack)),
            UIKeyCommand(
                input: UIKeyCommand.inputRightArrow, modifierFlags: .alternate, action: #selector(wordForward)),
            UIKeyCommand(input: "\u{08}", modifierFlags: .command, action: #selector(eraseLine)),
            UIKeyCommand(input: "k", modifierFlags: .command, action: #selector(clearScrollback)),
        ]
    }
    @objc private func lineStart() { send(txt: "\u{1b}[H") }
    @objc private func lineEnd() { send(txt: "\u{1b}[F") }
    @objc private func wordBack() { send(txt: "\u{1b}b") }
    @objc private func wordForward() { send(txt: "\u{1b}f") }
    @objc private func eraseLine() { send(txt: "\u{15}") }
    @objc private func clearScrollback() { onClear?() }

    override func paste(_ sender: Any?) {
        guard let text = UIPasteboard.general.string else { return }
        guard text.count > 4000 else {
            super.paste(sender)
            return
        }
        var responder: UIResponder? = self
        while responder != nil, !(responder is UIViewController) { responder = responder?.next }
        guard let controller = responder as? UIViewController else { return }
        let alert = UIAlertController(
            title: "Paste \(text.count) characters?", message: "The text will be sent to the running terminal.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(
            UIAlertAction(title: "Paste", style: .default) { [weak self] _ in
                guard let self else { return }
                let bracketed = getTerminal().bracketedPasteMode
                if bracketed { send(txt: "\u{1b}[200~") }
                send(txt: text)
                if bracketed { send(txt: "\u{1b}[201~") }
            })
        controller.present(alert, animated: true)
    }
}
