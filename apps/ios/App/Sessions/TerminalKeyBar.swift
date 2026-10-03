import SwiftUI

/// What the keys of the bar under a terminal send, apart from the view so it can be tested.
enum TerminalKeys {
    static let escape = "\u{1b}"
    static let tab = "\t"

    /// The control character a typed key becomes after Ctrl, as a terminal keyboard sends it; nil for a key that has
    /// none, which then goes out as typed.
    static func control(_ text: String) -> String? {
        guard text.unicodeScalars.count == 1, let scalar = text.unicodeScalars.first, scalar.isASCII else {
            return nil
        }
        let value = scalar.value
        switch value {
        case 0x61...0x7a: return String(UnicodeScalar(UInt8(value - 0x60)))
        case 0x40...0x5f: return String(UnicodeScalar(UInt8(value - 0x40)))
        case 0x20: return "\u{0}"
        case 0x3f: return "\u{7f}"
        default: return nil
        }
    }

    /// An arrow key, in the form the program on the other end asked for: application mode (vim, less, a REPL's
    /// history) reads `ESC O`, a plain shell `ESC [`.
    static func arrow(up: Bool, applicationCursor: Bool) -> String {
        "\u{1b}" + (applicationCursor ? "O" : "[") + (up ? "A" : "B")
    }
}

/// A command from the project file that waits above the terminal until a person on this machine approves it.
struct TerminalHeldCommand {
    let command: String
    let enabled: Bool
    let run: () -> Void
}

/// The held command as a prompt of glass above the keys, in place of a bar across the top.
struct TerminalHeldPrompt: View {
    let held: TerminalHeldCommand

    var body: some View {
        HStack(spacing: 12) {
            Image(lucide: "hand", size: 16).foregroundStyle(MobileStyle.statusNeedsYou)
            VStack(alignment: .leading, spacing: 1) {
                Text("From the project file").font(.caption).foregroundStyle(MobileStyle.muted)
                Text(held.command).font(.callout.monospaced()).lineLimit(1).truncationMode(.middle)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                held.run()
            } label: {
                Label("Run", lucideIcon: "play").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.glassProminent)
            .tint(MobileStyle.accent)
            .disabled(!held.enabled)
        }
        .padding(.leading, 16).padding(.trailing, 8).padding(.vertical, 8)
        .glassEffect(.regular, in: .capsule)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Run \(held.command)? It comes from the project file.")
    }
}

/// The keys a phone keyboard lacks, as a capsule of glass under the terminal. Ctrl stays down for the next key.
struct TerminalKeyBar: View {
    let model: TerminalModel
    let keyboardShown: Bool

    var body: some View {
        HStack(spacing: 2) {
            key("esc", label: "Escape") { model.write(TerminalKeys.escape) }
            key("tab", label: "Tab") { model.write(TerminalKeys.tab) }
            Button {
                model.controlArmed.toggle()
            } label: {
                keyFace("ctrl")
                    .background(model.controlArmed ? MobileStyle.accent.opacity(0.28) : .clear, in: .capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Control")
            .accessibilityAddTraits(model.controlArmed ? .isSelected : [])
            key(lucide: "arrow-up", label: "Up") { model.arrow(up: true) }
            key(lucide: "arrow-down", label: "Down") { model.arrow(up: false) }
            key(
                lucide: keyboardShown ? "keyboard-off" : "keyboard",
                label: keyboardShown ? "Hide keyboard" : "Keyboard"
            ) { model.toggleKeyboard?() }
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private func key(_ title: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { keyFace(title) }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
    }

    private func key(lucide icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(lucide: icon, size: 17).frame(minWidth: 44, minHeight: 44).contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func keyFace(_ title: String) -> some View {
        Text(title).font(.system(.subheadline, design: .monospaced).weight(.medium))
            .padding(.horizontal, 6)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
    }
}
