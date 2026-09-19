import RuimtePulsar
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

    private static func adaptive(_ token: RuimteColorToken) -> UIColor {
        UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? token.dark : token.light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xff) / 255,
                green: CGFloat((hex >> 8) & 0xff) / 255,
                blue: CGFloat(hex & 0xff) / 255, alpha: 1)
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
                .listRowInsets(EdgeInsets(top: 8, leading: 28, bottom: 8, trailing: 28))
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

struct MobileIcon: View {
    let symbol: String
    var color: Color = MobileStyle.accent
    var body: some View {
        Image(lucide: symbol, size: 19)
            .foregroundStyle(color)
            .frame(width: 42, height: 42)
            .background(color.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityHidden(true)
    }
}

struct MobileRow: View {
    let title: String
    let subtitle: String
    let symbol: String
    var color: Color = MobileStyle.accent
    var body: some View {
        HStack(spacing: 10) {
            Image(lucide: symbol, size: 20).foregroundStyle(MobileStyle.muted)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.callout).foregroundStyle(MobileStyle.text).lineLimit(1).truncationMode(.tail)
                if !subtitle.isEmpty {
                    Text(subtitle).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1).truncationMode(
                        .middle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

struct MobileStatus: View {
    let title: String
    var color: Color = .secondary
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
