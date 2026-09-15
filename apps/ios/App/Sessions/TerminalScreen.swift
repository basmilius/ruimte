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
    let title: String

    init(client: any MachineRequesting, sessionID: String, title: String) {
        _model = State(initialValue: TerminalModel(client: client, sessionID: sessionID))
        self.title = title
    }

    var body: some View {
        VStack(spacing: 0) {
            if let error = model.error { SessionErrorBanner(message: error) { model.attach() } }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                if let request = model.approvals.first(where: {
                    ($0["expiresAt"]?.numberValue ?? 0) > context.date.timeIntervalSince1970 * 1000
                }) {
                    approvalStrip(request, now: context.date)
                }
            }
            if model.loading { ProgressView("Loading terminal…").padding() }
            HStack {
                Text(model.exited ? "Session exited" : "Following \(model.cols) × \(model.rows)")
                Spacer()
                Text("Desktop size preserved")
            }.font(.caption).foregroundStyle(.secondary).padding(.horizontal).padding(.vertical, 6)
            NativeTerminal(model: model, fontSize: fontSize, theme: theme)
            HStack(spacing: 4) {
                Button("Ctrl+C") { model.write("\u{03}") }.frame(minWidth: 64, minHeight: 44)
                Button("Ctrl+D") { model.write("\u{04}") }.frame(minWidth: 64, minHeight: 44)
                Spacer()
                Button("Clear", systemImage: "eraser") { clearing = true }.frame(minHeight: 44)
                    .keyboardShortcut("k", modifiers: .command)
            }.padding(.horizontal).background(.bar).disabled(!model.connected || model.loading || model.exited)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
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
                    Button("Reload screen", systemImage: "arrow.clockwise") { model.attach() }
                } label: {
                    Image(systemName: "textformat.size")
                }
                .accessibilityLabel("Terminal appearance")
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .confirmationDialog("Clear terminal scrollback?", isPresented: $clearing, titleVisibility: .visible) {
            Button("Clear scrollback", role: .destructive) { Task { await model.clear() } }
        } message: {
            Text("This clears the shared terminal scrollback on every client.")
        }
    }

    private func approvalStrip(_ request: JSONValue, now: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(request["toolName"]?.stringValue ?? "Permission", systemImage: "hand.raised").font(.headline)
                Spacer()
                let seconds = max(0, Int((request["expiresAt"]?.numberValue ?? 0) / 1000 - now.timeIntervalSince1970))
                Text("\(seconds)s").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Text(request["summary"]?.stringValue ?? "").font(.callout).lineLimit(6).textSelection(.enabled)
            ScrollView(.horizontal) {
                HStack {
                    ForEach(Array((request["choices"]?.arrayValue ?? []).enumerated()), id: \.offset) { _, choice in
                        Button(choice["label"]?.stringValue ?? "Answer") {
                            Task { await model.answer(request, choice: choice) }
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        }.padding().background(.regularMaterial).disabled(!model.connected)
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
        func send(source: TerminalView, data: ArraySlice<UInt8>) { model.write(String(decoding: data, as: UTF8.self)) }
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
private final class TerminalContainer: UIScrollView {
    let terminal = RemoteTerminalView(frame: .zero)
    private var cols = 80
    private var rows = 24
    private var chosenFont = 0.0
    private var chosenTheme = ""

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(terminal)
        alwaysBounceHorizontal = true
        isDirectionalLockEnabled = true
        terminal.accessibilityIdentifier = "terminal.screen"
        terminal.changeScrollback(10000)
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
            terminal.nativeBackgroundColor = .systemBackground
            terminal.nativeForegroundColor = .label
            backgroundColor = .systemBackground
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
        let character = ("W" as NSString).size(withAttributes: [.font: terminal.font])
        let width = max(bounds.width, ceil(character.width * CGFloat(cols)) + 2)
        let height = max(bounds.height, ceil(terminal.font.lineHeight * CGFloat(rows)))
        terminal.frame = CGRect(x: 0, y: 0, width: width, height: height)
        terminal.layoutIfNeeded()
        if terminal.getTerminal().cols != cols || terminal.getTerminal().rows != rows {
            terminal.resize(cols: cols, rows: rows)
        }
        contentSize = CGSize(width: width, height: height)
    }
}

@MainActor
private final class RemoteTerminalView: TerminalView {
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
