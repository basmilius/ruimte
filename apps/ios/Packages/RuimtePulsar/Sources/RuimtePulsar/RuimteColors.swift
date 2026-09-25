import SwiftUI

/// One color of the interface: the value for a light ground and the one for a dark ground, as the matching token in
/// `apps/client/src/styles.css` has them.
public struct RuimteColorToken: Sendable, Equatable {
    public let light: UInt32
    public let dark: UInt32

    public init(light: UInt32, dark: UInt32) {
        self.light = light
        self.dark = dark
    }

    /// The dark value whatever the system is set to, for a surface that is dark either way: a Live Activity draws on
    /// its own tint and never follows the appearance around it.
    public var onDark: Color { Self.color(dark) }

    public static func color(_ hex: UInt32) -> Color {
        Color(
            .sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255)
    }
}

/// The color tokens of the interface. The app and the Live Activity widget are separate targets that share only this
/// package, so the table lives here and neither keeps a copy of it.
public enum RuimteColors {
    public static let accent = RuimteColorToken(light: 0x000000, dark: 0xffffff)
    public static let onAccent = RuimteColorToken(light: 0xffffff, dark: 0x000000)
    public static let canvas = RuimteColorToken(light: 0xf4f4f5, dark: 0x0d0d10)
    public static let surface = RuimteColorToken(light: 0xffffff, dark: 0x131316)
    public static let panel = RuimteColorToken(light: 0xffffff, dark: 0x18181c)
    public static let inset = RuimteColorToken(light: 0xececef, dark: 0x08080a)
    public static let hover = RuimteColorToken(light: 0xf3f3f5, dark: 0x202024)
    public static let active = RuimteColorToken(light: 0xdcdce2, dark: 0x28282e)
    public static let pressed = RuimteColorToken(light: 0xededf1, dark: 0x202024)
    public static let border = RuimteColorToken(light: 0xe2e2e6, dark: 0x1f1f24)
    public static let text = RuimteColorToken(light: 0x18181b, dark: 0xececf1)
    public static let muted = RuimteColorToken(light: 0x6f6f78, dark: 0x9a9aa6)
    public static let faint = RuimteColorToken(light: 0xa1a1aa, dark: 0x5f5f6b)
    public static let positive = RuimteColorToken(light: 0x15803d, dark: 0x4ade80)
    public static let statusRunning = RuimteColorToken(light: 0x2563eb, dark: 0x60a5fa)
    public static let statusError = RuimteColorToken(light: 0xdc2626, dark: 0xef4444)
    public static let statusNeedsYou = RuimteColorToken(light: 0xd97706, dark: 0xfbbf24)
    public static let statusIdle = RuimteColorToken(light: 0x16a34a, dark: 0x4ade80)
    /// The ground a Live Activity puts under its own card, which the system never lightens.
    public static let activityTint = RuimteColorToken(light: 0x1b1b21, dark: 0x1b1b21)

    /// The node accents by id, as `apps/client/src/canvas/accents.ts` paints them; an account wears one of these.
    public static let nodeAccents: [String: UInt32] = [
        "red": 0xe7000b, "orange": 0xf54900, "amber": 0xe17100, "yellow": 0xd08700, "lime": 0x5ea500,
        "green": 0x00a63e, "emerald": 0x009966, "teal": 0x009689, "cyan": 0x0092b8, "sky": 0x0084d1,
        "blue": 0x155dfc, "indigo": 0x4f39f6, "violet": 0x7f22fe, "purple": 0x9810fa, "fuchsia": 0xc800de,
        "pink": 0xe60076, "rose": 0xec003f,
    ]

    /// Nil for an id that is no accent, which the caller paints with the app's accent.
    public static func nodeAccent(_ id: String?) -> Color? {
        id.flatMap { nodeAccents[$0] }.map(RuimteColorToken.color)
    }
}
