import Foundation
import RuimtePulsar

enum ChatVisualAppearance: String {
    case light, dark
}

/// The app's tokens under the names a visual's page is drawn with, for one appearance.
struct ChatVisualTheme: Equatable {
    struct Variable: Equatable {
        let name: String
        let value: String
    }

    static let light = ChatVisualTheme(.light)
    static let dark = ChatVisualTheme(.dark)

    let appearance: ChatVisualAppearance
    /// In the order of `ChatVisualContract.themeVariables`. A variable without a token here keeps the page's default
    /// for the appearance.
    let variables: [Variable]

    init(appearance: ChatVisualAppearance, variables: [Variable]) {
        self.appearance = appearance
        self.variables = variables
    }

    /// The names follow common component themes, where `--accent` is a quiet ground and `--primary` the color that
    /// stands out, so the app's accent is the primary, the ring and the first series of a chart.
    init(_ appearance: ChatVisualAppearance) {
        let pick = { (token: RuimteColorToken) in Self.hex(appearance == .dark ? token.dark : token.light) }
        let text = pick(RuimteColors.text)
        let quiet = pick(RuimteColors.hover)
        let raised = pick(RuimteColors.panel)
        let accent = pick(RuimteColors.accent)
        let onAccent = pick(RuimteColors.onAccent)
        let values: [String: String] = [
            "--background": pick(RuimteColors.surface),
            "--foreground": text,
            "--muted": quiet,
            "--muted-foreground": pick(RuimteColors.muted),
            "--card": raised,
            "--card-foreground": text,
            "--popover": raised,
            "--popover-foreground": text,
            "--secondary": quiet,
            "--secondary-foreground": text,
            "--border": pick(RuimteColors.border),
            "--ring": accent,
            "--primary": accent,
            "--primary-foreground": onAccent,
            "--accent": quiet,
            "--accent-foreground": text,
            "--destructive": pick(RuimteColors.statusError),
            "--destructive-foreground": onAccent,
            "--warning": pick(RuimteColors.statusNeedsYou),
            "--success": pick(RuimteColors.positive),
            "--info": pick(RuimteColors.statusRunning),
            "--code-background": raised,
            "--code-foreground": text,
            "--chart-1": accent,
            "--chart-2": pick(Self.series[0]),
            "--chart-3": pick(Self.series[1]),
            "--chart-4": pick(Self.series[2]),
            "--chart-5": pick(Self.series[3]),
            "--chart-6": pick(Self.series[4]),
            "--radius": "12px",
            "--font-sans": "-apple-system, system-ui, sans-serif",
            "--font-mono": "ui-monospace, Menlo, monospace",
        ]
        self.init(
            appearance: appearance,
            variables: ChatVisualContract.themeVariables.compactMap { name in
                values[name].map { Variable(name: name, value: $0) }
            })
    }

    /// The series of a chart after the accent, as `--chart-2` to `--chart-6` in `@adecore/agents-react/theme.css`:
    /// orange, aqua, yellow, magenta and green, checked for color vision deficiency on both grounds.
    private static let series: [RuimteColorToken] = [
        RuimteColorToken(light: 0xeb6834, dark: 0xd95926),
        RuimteColorToken(light: 0x1baf7a, dark: 0x199e70),
        RuimteColorToken(light: 0xeda100, dark: 0xc98500),
        RuimteColorToken(light: 0xe87ba4, dark: 0xd55181),
        RuimteColorToken(light: 0x008300, dark: 0x008300),
    ]

    private static func hex(_ value: UInt32) -> String { String(format: "#%06x", value) }

    /// `visualThemeFragment` of the contracts: the theme the page applies before its first paint and then takes off
    /// its address.
    var fragment: String {
        let json = #"{"appearance":\#(Self.json(appearance.rawValue)),"variables":\#(variablesJSON)}"#
        return "#\(ChatVisualContract.fragmentKey)="
            + (json.addingPercentEncoding(withAllowedCharacters: Self.unescaped) ?? "")
    }

    /// `visualHostContextMessage` of the contracts, which the page applies without loading again.
    var hostContextMessage: String {
        let method = Self.json(ChatVisualContract.hostContextChanged)
        let params = #"{"theme":\#(Self.json(appearance.rawValue)),"styles":{"variables":\#(variablesJSON)}}"#
        return #"{"jsonrpc":"2.0","method":\#(method),"params":\#(params)}"#
    }

    private var variablesJSON: String {
        "{" + variables.map { "\(Self.json($0.name)):\(Self.json($0.value))" }.joined(separator: ",") + "}"
    }

    /// What `encodeURIComponent` leaves as it is.
    private static let unescaped = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    /// A string as `JSON.stringify` writes it, so the fragment reads the same as the desktop's.
    private static func json(_ value: String) -> String {
        var output = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": output += "\\\""
            case "\\": output += "\\\\"
            case "\n": output += "\\n"
            case "\r": output += "\\r"
            case "\t": output += "\\t"
            case "\u{08}": output += "\\b"
            case "\u{0C}": output += "\\f"
            default:
                if scalar.value < 0x20 {
                    output += String(format: "\\u%04x", scalar.value)
                } else {
                    output.unicodeScalars.append(scalar)
                }
            }
        }
        return output + "\""
    }
}
