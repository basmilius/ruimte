import Foundation
import RuimtePulsar
import RuimteShared
import SwiftUI

/// A color a program asked for: one of the sixteen of the palette by number, or one of its own.
enum ChatAnsiColor: Equatable {
    case palette(Int)
    case rgb(UInt8, UInt8, UInt8)
}

struct ChatAnsiStyle: Equatable {
    var foreground: ChatAnsiColor?
    var background: ChatAnsiColor?
    var bold = false
    var dim = false
    var italic = false
    var underline = false
    var strike = false
    var inverse = false
}

struct ChatAnsiToken: Equatable {
    let content: String
    let style: ChatAnsiStyle
}

/// The terminal colors in a call's output, read as `chat/logic/ansi.ts` in the desktop's chat reads them.
enum ChatAnsi {
    // Non-color controls are consumed too, so cursor commands and OSC links never become visible text.
    private static let escapes = try! NSRegularExpression(
        pattern:
            #"(?:\x1b\[|\x9b)([0-?]*[ -/]*)([@-~]|\z)|(?:\x1b\]|\x9d)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c|\z)|\x1b[PX^_][^\x1b\x9c]*(?:\x1b\\|\x9c|\z)|\x1b[ -/]*[@-~]|\x1b\z|[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f-\x9f]"#
    )
    private static let levels: [UInt8] = [0, 95, 135, 175, 215, 255]

    /// The palette of `@adecore/terminal`, black to white and then the bright eight.
    static let palette: [RuimteColorToken] = [
        RuimteColorToken(light: 0x3f3f46, dark: 0x2a2a31),
        RuimteColorToken(light: 0xb91c1c, dark: 0xf87171),
        RuimteColorToken(light: 0x15803d, dark: 0x4ade80),
        RuimteColorToken(light: 0xa16207, dark: 0xfbbf24),
        RuimteColorToken(light: 0x1d4ed8, dark: 0x60a5fa),
        RuimteColorToken(light: 0xa21caf, dark: 0xc084fc),
        RuimteColorToken(light: 0x0e7490, dark: 0x67e8f9),
        RuimteColorToken(light: 0xa1a1aa, dark: 0xd6d6de),
        RuimteColorToken(light: 0x71717a, dark: 0x6b6b76),
        RuimteColorToken(light: 0xdc2626, dark: 0xfca5a5),
        RuimteColorToken(light: 0x16a34a, dark: 0x86efac),
        RuimteColorToken(light: 0xca8a04, dark: 0xfde68a),
        RuimteColorToken(light: 0x2563eb, dark: 0x93c5fd),
        RuimteColorToken(light: 0xc026d3, dark: 0xd8b4fe),
        RuimteColorToken(light: 0x0891b2, dark: 0xa5f3fc),
        RuimteColorToken(light: 0xe4e4e7, dark: 0xf4f4f5),
    ]

    static func strip(_ text: String) -> String {
        escapes.stringByReplacingMatches(
            in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
    }

    /// The text as styled runs. `tailLines` keeps only the last lines, with the colors set before them; `limit`
    /// cuts what is left after that many visible characters, which `omitted` counts.
    static func parse(_ text: String, limit: Int? = nil, tailLines: Int? = nil) -> (
        tokens: [ChatAnsiToken], omitted: Int
    ) {
        let tokens = styledTokens(text)
        let plain = Array(tokens.map(\.content).joined().unicodeScalars)
        var start = 0
        var end = plain.count
        if let tailLines {
            if end > 0, plain[end - 1] == "\n" {
                end -= 1
            }
            var newlines = 0
            var index = end
            while index > 0 {
                index -= 1
                if plain[index] == "\n" {
                    newlines += 1
                    if newlines == tailLines {
                        start = index + 1
                        break
                    }
                }
            }
        }
        let omitted = limit.map { max(0, end - start - $0) } ?? 0
        end -= omitted
        var offset = 0
        var clipped: [ChatAnsiToken] = []
        for token in tokens {
            let scalars = Array(token.content.unicodeScalars)
            let from = max(0, start - offset)
            let to = min(scalars.count, end - offset)
            offset += scalars.count
            if to > from {
                var content = String.UnicodeScalarView()
                content.append(contentsOf: scalars[from..<to])
                clipped.append(ChatAnsiToken(content: String(content), style: token.style))
            }
        }
        return (clipped, omitted)
    }

    /// The runs as text to draw. `base` is the color of text that asked for none, and the ground an inverse run
    /// without a background takes its color from.
    static func attributed(_ tokens: [ChatAnsiToken], dark: Bool, base: Color, ground: Color) -> AttributedString {
        var result = AttributedString()
        for token in tokens {
            var run = AttributedString(token.content)
            let style = token.style
            let foreground = (style.inverse ? style.background : style.foreground).map { color($0, dark: dark) }
            let background = (style.inverse ? style.foreground : style.background).map { color($0, dark: dark) }
            let shownForeground = style.inverse ? (foreground ?? ground) : foreground
            if style.dim {
                run.foregroundColor = (shownForeground ?? base).opacity(0.65)
            } else if let shownForeground {
                run.foregroundColor = shownForeground
            }
            if style.inverse {
                run.backgroundColor = background ?? base
            } else if let background {
                run.backgroundColor = background
            }
            var intent: InlinePresentationIntent = []
            if style.bold {
                intent.insert(.stronglyEmphasized)
            }
            if style.italic {
                intent.insert(.emphasized)
            }
            if !intent.isEmpty {
                run.inlinePresentationIntent = intent
            }
            if style.underline {
                run.underlineStyle = .single
            }
            if style.strike {
                run.strikethroughStyle = .single
            }
            result.append(run)
        }
        return result
    }

    static func color(_ color: ChatAnsiColor, dark: Bool) -> Color {
        switch color {
        case .palette(let index):
            let token = palette[index]
            return RuimteColorToken.color(dark ? token.dark : token.light)
        case .rgb(let red, let green, let blue):
            return Color(.sRGB, red: Double(red) / 255, green: Double(green) / 255, blue: Double(blue) / 255)
        }
    }

    private static func styledTokens(_ text: String) -> [ChatAnsiToken] {
        let source = text as NSString
        var tokens: [ChatAnsiToken] = []
        var style = ChatAnsiStyle()
        var position = 0
        for match in escapes.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            if match.range.location > position {
                tokens.append(
                    ChatAnsiToken(
                        content: source.substring(
                            with: NSRange(location: position, length: match.range.location - position)),
                        style: style))
            }
            let final = match.range(at: 2)
            if final.location != NSNotFound, source.substring(with: final) == "m" {
                style = rendition(style, parameters: source.substring(with: match.range(at: 1)))
            }
            position = match.range.location + match.range.length
        }
        if position < source.length {
            tokens.append(ChatAnsiToken(content: source.substring(from: position), style: style))
        }
        return tokens
    }

    private static func paletteColor(_ index: Int?) -> ChatAnsiColor? {
        guard let index, (0...255).contains(index) else {
            return nil
        }
        if index < 16 {
            return .palette(index)
        }
        if index < 232 {
            let cube = index - 16
            return .rgb(levels[cube / 36], levels[(cube / 6) % 6], levels[cube % 6])
        }
        let gray = UInt8(8 + (index - 232) * 10)
        return .rgb(gray, gray, gray)
    }

    private static func rgb(_ channels: [Substring]) -> ChatAnsiColor? {
        let values = channels.compactMap { UInt8($0) }
        guard channels.count == 3, values.count == 3 else {
            return nil
        }
        return .rgb(values[0], values[1], values[2])
    }

    private static func extendedColor(_ parameters: [Substring]) -> ChatAnsiColor? {
        guard let mode = parameters.first else {
            return nil
        }
        if mode == "5", parameters.count == 2, !parameters[1].isEmpty {
            return paletteColor(Int(parameters[1]))
        }
        if mode == "2" {
            // Colon-form RGB may carry an empty color-space parameter before its three channels.
            return rgb(Array(parameters.count == 5 ? parameters.dropFirst(2) : parameters.dropFirst()))
        }
        return nil
    }

    private static func rendition(_ current: ChatAnsiStyle, parameters: String) -> ChatAnsiStyle {
        guard parameters.allSatisfy({ $0.isASCII && ($0.isNumber || $0 == ";" || $0 == ":") }) else {
            return current
        }
        var style = current
        let values = parameters.split(separator: ";", omittingEmptySubsequences: false)
        var i = 0
        while i < values.count {
            let parts = values[i].split(separator: ":", omittingEmptySubsequences: false)
            // An empty parameter is a zero, as `Number('')` reads it.
            let code = parts[0].isEmpty ? 0 : Int(parts[0]) ?? -1
            if code == 38 || code == 48 {
                let color: ChatAnsiColor?
                if parts.count > 1 {
                    color = extendedColor(Array(parts.dropFirst()))
                } else {
                    let next = i + 1 < values.count ? values[i + 1] : nil
                    let count = next == "2" ? 4 : next == "5" ? 2 : 1
                    color = extendedColor(Array(values[min(i + 1, values.count)..<min(i + 1 + count, values.count)]))
                    i += count
                }
                if let color {
                    if code == 38 {
                        style.foreground = color
                    } else {
                        style.background = color
                    }
                }
            } else if (30...37).contains(code) {
                style.foreground = paletteColor(code - 30)
            } else if (40...47).contains(code) {
                style.background = paletteColor(code - 40)
            } else if (90...97).contains(code) {
                style.foreground = paletteColor(code - 90 + 8)
            } else if (100...107).contains(code) {
                style.background = paletteColor(code - 100 + 8)
            } else {
                switch code {
                case 0: style = ChatAnsiStyle()
                case 1: style.bold = true
                case 2: style.dim = true
                case 3: style.italic = true
                case 4: style.underline = parts.count < 2 || parts[1] != "0"
                case 7: style.inverse = true
                case 9: style.strike = true
                case 22:
                    style.bold = false
                    style.dim = false
                case 23: style.italic = false
                case 24: style.underline = false
                case 27: style.inverse = false
                case 29: style.strike = false
                case 39: style.foreground = nil
                case 49: style.background = nil
                default: break
                }
            }
            i += 1
        }
        return style
    }
}
