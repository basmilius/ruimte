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
    /// One color per agent CLI and per part of a chat's context, as `@adecore/agents-react/theme.css` has them.
    public static let chartClaude = RuimteColorToken(light: 0xff9500, dark: 0xff9f0a)
    public static let chartCodex = RuimteColorToken(light: 0x30b0c7, dark: 0x40c8e0)
    public static let chartContextTools = RuimteColorToken(light: 0x4d7ce6, dark: 0x8aa7f5)
    public static let chartContextFiles = RuimteColorToken(light: 0x9a63e0, dark: 0xb98af3)
    public static let chartContextConversation = RuimteColorToken(light: 0x2f9e5a, dark: 0x6dd08b)
    /// A skill a person picked, as `--skill` in `@adecore/agents-react/theme.css`.
    public static let skill = RuimteColorToken(light: 0x9333ea, dark: 0xc084fc)
    /// The series of a chart after the first, which is the accent, as `--chart-2` to `--chart-6` order them.
    public static let chart2 = RuimteColorToken(light: 0xeb6834, dark: 0xd95926)
    public static let chart3 = RuimteColorToken(light: 0x1baf7a, dark: 0x199e70)
    public static let chart4 = RuimteColorToken(light: 0xeda100, dark: 0xc98500)
    public static let chart5 = RuimteColorToken(light: 0xe87ba4, dark: 0xd55181)
    public static let chart6 = RuimteColorToken(light: 0x008300, dark: 0x008300)
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

extension RuimteColors {
    /// The accents in the order the desktop lists them, `NODE_ACCENT_NAMES` in `packages/contracts`.
    public static let nodeAccentNames = [
        "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo",
        "violet", "purple", "fuchsia", "pink", "rose",
    ]

    /// The paper of a note in each color, as `apps/client/src/styles.css` paints it (`--paper-*`). Neutral is only for
    /// a note that was gray before Color covered notes.
    public static let notePapers: [String: RuimteColorToken] = [
        "red": RuimteColorToken(light: 0xffe3dd, dark: 0x482520),
        "orange": RuimteColorToken(light: 0xffe3d9, dark: 0x47261c),
        "amber": RuimteColorToken(light: 0xffe6d3, dark: 0x452814),
        "yellow": RuimteColorToken(light: 0xfff3bf, dark: 0x3b3416),
        "lime": RuimteColorToken(light: 0xe2f3d7, dark: 0x253619),
        "green": RuimteColorToken(light: 0xdcf5e3, dark: 0x173a25),
        "emerald": RuimteColorToken(light: 0xd5f6e3, dark: 0x123927),
        "teal": RuimteColorToken(light: 0xcef6f0, dark: 0x023933),
        "cyan": RuimteColorToken(light: 0xcff3ff, dark: 0x073645),
        "sky": RuimteColorToken(light: 0xd6f0ff, dark: 0x16334a),
        "blue": RuimteColorToken(light: 0xdbe9ff, dark: 0x182f4b),
        "indigo": RuimteColorToken(light: 0xe5ebff, dark: 0x292d4b),
        "violet": RuimteColorToken(light: 0xede8ff, dark: 0x312b49),
        "purple": RuimteColorToken(light: 0xf1e6ff, dark: 0x352947),
        "fuchsia": RuimteColorToken(light: 0xfbe4fd, dark: 0x3d2740),
        "pink": RuimteColorToken(light: 0xfde2ea, dark: 0x43212c),
        "rose": RuimteColorToken(light: 0xffe2e1, dark: 0x482425),
        "neutral": RuimteColorToken(light: 0xececef, dark: 0x26262d),
    ]

    /// The papers a note had in `color` before Color covered notes; four are accents by the same name.
    private static let legacyNotePapers = [
        "yellow": "yellow", "green": "green", "blue": "blue", "pink": "pink", "gray": "neutral",
    ]

    /// The paper a note shows, nil for the default, by the rule of `notePaperOf` in `packages/contracts`: an old paper
    /// wins over an accent, so a project looks as it did, and a name this version does not know counts for nothing.
    public static func notePaper(accent: String?, color: String?) -> String? {
        if let color, let paper = legacyNotePapers[color] { return paper }
        if let accent, nodeAccents[accent] != nil { return accent }
        return nil
    }

    /// A note without a color keeps the yellow sheet every note had before it could take one.
    public static func notePaperToken(accent: String?, color: String?) -> RuimteColorToken {
        notePapers[notePaper(accent: accent, color: color) ?? "yellow"] ?? notePapers["yellow"]!
    }
}
