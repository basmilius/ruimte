import SwiftUI
import UIKit

enum MobileStyle {
    static let accentColor = UIColor { $0.userInterfaceStyle == .dark ? .white : .black }
    static let accent = Color(uiColor: accentColor)
    static let onAccent = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? .black : .white })
    // Keep these paired with the semantic gray tokens in apps/client/src/styles.css.
    static let canvasColor = adaptive(light: 0xf4f4f5, dark: 0x0d0d10)
    static let surfaceColor = adaptive(light: 0xffffff, dark: 0x131316)
    static let panelColor = adaptive(light: 0xffffff, dark: 0x18181c)
    static let textColor = adaptive(light: 0x18181b, dark: 0xececf1)
    static let mutedColor = adaptive(light: 0x6f6f78, dark: 0x9a9aa6)
    static let canvas = Color(uiColor: canvasColor)
    static let surface = Color(uiColor: surfaceColor)
    static let panel = Color(uiColor: panelColor)
    static let inset = Color(uiColor: adaptive(light: 0xececef, dark: 0x08080a))
    static let hover = Color(uiColor: adaptive(light: 0xf3f3f5, dark: 0x202024))
    static let active = Color(uiColor: adaptive(light: 0xdcdce2, dark: 0x28282e))
    static let pressed = Color(uiColor: adaptive(light: 0xededf1, dark: 0x202024))
    static let border = Color(uiColor: adaptive(light: 0xe2e2e6, dark: 0x1f1f24))
    static let text = Color(uiColor: textColor)
    static let muted = Color(uiColor: mutedColor)
    static let faint = Color(uiColor: adaptive(light: 0xa1a1aa, dark: 0x5f5f6b))
    static let positive = Color(uiColor: adaptive(light: 0x15803d, dark: 0x4ade80))
    static let statusError = Color(uiColor: adaptive(light: 0xdc2626, dark: 0xef4444))
    static let statusNeedsYou = Color(uiColor: adaptive(light: 0xd97706, dark: 0xfbbf24))

    private static func adaptive(light: UInt32, dark: UInt32) -> UIColor {
        UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
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
