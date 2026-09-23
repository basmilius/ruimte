import SwiftUI

/// How a usage widget looks: plain for the widget over every provider, and leaning on the provider's own design in a
/// provider's widget.
enum UsageTheme {
    case plain
    case claude
    case codex

    /// Anthropic's Claude orange and the warm grounds it sits on in Claude's own apps.
    static let terracotta = Color(red: 0xd9 / 255, green: 0x77 / 255, blue: 0x57 / 255)
    static let paper = Color(red: 0xf4 / 255, green: 0xf3 / 255, blue: 0xee / 255)
    static let charcoal = Color(red: 0x26 / 255, green: 0x26 / 255, blue: 0x24 / 255)

    init(provider: String?) {
        switch provider {
        case "claude": self = .claude
        case "codex": self = .codex
        default: self = .plain
        }
    }

    var fontDesign: Font.Design {
        switch self {
        case .plain: .default
        case .claude: .serif
        case .codex: .monospaced
        }
    }

    /// Codex draws its meters in blocks, the way a terminal would.
    var segmented: Bool { self == .codex }

    var mark: Color { self == .claude ? Self.terracotta : .primary }

    func tint(_ used: Double) -> Color {
        if used >= 0.9 { return .red }
        return self == .claude ? Self.terracotta : .primary
    }
}

extension EnvironmentValues {
    @Entry var usageTheme: UsageTheme = .plain
}
