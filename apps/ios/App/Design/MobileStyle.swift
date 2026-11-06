import RuimtePulsar
import RuimteShared
import SwiftUI
import UIKit

/// The values are `RuimteColors` in `RuimtePulsar`, which the Live Activity widget reads from its own target; this
/// only gives each one the UIKit and SwiftUI shape the app draws with.
enum MobileStyle {
    static let accentColor = adaptive(RuimteColors.accent)
    static let accent = Color(uiColor: accentColor)
    static let onAccent = Color(uiColor: adaptive(RuimteColors.onAccent))
    static let canvasColor = adaptive(RuimteColors.canvas)
    static let surfaceColor = adaptive(RuimteColors.surface)
    static let panelColor = adaptive(RuimteColors.panel)
    static let textColor = adaptive(RuimteColors.text)
    static let mutedColor = adaptive(RuimteColors.muted)
    static let canvas = Color(uiColor: canvasColor)
    static let surface = Color(uiColor: surfaceColor)
    static let panel = Color(uiColor: panelColor)
    static let inset = Color(uiColor: adaptive(RuimteColors.inset))
    static let hover = Color(uiColor: adaptive(RuimteColors.hover))
    static let active = Color(uiColor: adaptive(RuimteColors.active))
    static let pressed = Color(uiColor: adaptive(RuimteColors.pressed))
    static let border = Color(uiColor: adaptive(RuimteColors.border))
    static let text = Color(uiColor: textColor)
    static let muted = Color(uiColor: mutedColor)
    static let faintColor = adaptive(RuimteColors.faint)
    static let faint = Color(uiColor: faintColor)
    static let positive = Color(uiColor: adaptive(RuimteColors.positive))
    static let statusRunningColor = adaptive(RuimteColors.statusRunning)
    static let statusErrorColor = adaptive(RuimteColors.statusError)
    static let statusNeedsYouColor = adaptive(RuimteColors.statusNeedsYou)
    static let statusIdleColor = adaptive(RuimteColors.statusIdle)
    static let statusRunning = Color(uiColor: statusRunningColor)
    static let statusError = Color(uiColor: statusErrorColor)
    static let statusNeedsYou = Color(uiColor: statusNeedsYouColor)
    static let statusIdle = Color(uiColor: statusIdleColor)
    /// The hairline a card is edged with. An alpha over whatever lies behind, so not an opaque token in `RuimteColors`.
    static let hairline = Color(uiColor: translucent(dark: 0.06, light: 0.08))
    /// The one quiet ground: a quiet capsule, an icon button, a chip. Translucent, so it reads the same on a surface, a
    /// panel or a card, where the opaque `hover` would vanish on a panel of the same gray.
    static let fill = Color(uiColor: translucent(dark: 0.08, light: 0.05))
    /// The ground of a code line inside a card.
    static let subtleFill = Color(uiColor: translucent(dark: 0.05, light: 0.035))
    /// The grounds of a swipe action. The system draws a swipe's label white, so these keep the light value in both
    /// appearances, where the lighter dark values would leave that label below 3 to 1.
    static let swipeAction = RuimteColorToken.color(RuimteColors.statusRunning.light)
    static let swipeQuiet = RuimteColorToken.color(RuimteColors.muted.light)
    static let swipeDestructive = RuimteColorToken.color(RuimteColors.statusError.light)
    static let skill = Color(uiColor: adaptive(RuimteColors.skill))
    static let chartClaude = Color(uiColor: adaptive(RuimteColors.chartClaude))
    static let chartCodex = Color(uiColor: adaptive(RuimteColors.chartCodex))
    static let chartContextTools = Color(uiColor: adaptive(RuimteColors.chartContextTools))
    static let chartContextFiles = Color(uiColor: adaptive(RuimteColors.chartContextFiles))
    static let chartContextConversation = Color(uiColor: adaptive(RuimteColors.chartContextConversation))
    static let chart2 = Color(uiColor: adaptive(RuimteColors.chart2))
    static let chart3 = Color(uiColor: adaptive(RuimteColors.chart3))
    static let chart4 = Color(uiColor: adaptive(RuimteColors.chart4))
    static let chart5 = Color(uiColor: adaptive(RuimteColors.chart5))
    static let chart6 = Color(uiColor: adaptive(RuimteColors.chart6))

    /// The paper a note is drawn on, from its accent or the paper it had before.
    static func notePaperColor(accent: String, color: String) -> UIColor {
        adaptive(RuimteColors.notePaperToken(accent: accent, color: color))
    }

    /// Nil for no accent, so the caller keeps its own color.
    static func nodeAccentColor(_ id: String) -> UIColor? {
        RuimteColors.nodeAccents[id].map { adaptive(RuimteColorToken(light: $0, dark: $0)) }
    }

    static func adaptive(_ token: RuimteColorToken) -> UIColor {
        UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? token.dark : token.light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xff) / 255,
                green: CGFloat((hex >> 8) & 0xff) / 255,
                blue: CGFloat(hex & 0xff) / 255, alpha: 1)
        }
    }

    /// White over a dark ground and black over a light one, each at its own alpha.
    private static func translucent(dark: CGFloat, light: CGFloat) -> UIColor {
        UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: dark) : UIColor(white: 0, alpha: light)
        }
    }
}

struct MobilePageSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(MobileStyle.surface.ignoresSafeArea(.container))
            .containerBackground(MobileStyle.surface, for: .navigation)
    }
}

struct MobileList<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        List {
            content
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listSectionSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 8, leading: 32, bottom: 8, trailing: 32))
        }
        .modifier(MobileSidebarList())
        .buttonStyle(MobileListActionStyle())
        .font(.callout)
        .foregroundStyle(MobileStyle.text)
    }
}

struct MobileForm<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        Form {
            content.listRowBackground(MobileStyle.panel)
        }
        .scrollContentBackground(.hidden)
        .background(MobileStyle.canvas)
        .foregroundStyle(MobileStyle.text)
    }
}

struct MobileStatus: View {
    let title: String
    var color: Color = MobileStyle.muted
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(title).font(.caption.weight(.medium))
        }
        .foregroundStyle(MobileStyle.muted)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
    }
}
