import SwiftUI
import UIKit

enum MobileStyle {
    static let accent = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.40, green: 0.64, blue: 1, alpha: 1)
                : UIColor(red: 0.082, green: 0.365, blue: 0.988, alpha: 1)
        })
    static let canvas = Color(uiColor: .systemGroupedBackground)
    static let surface = Color(uiColor: .secondarySystemGroupedBackground)
    static let panel = Color(uiColor: .secondarySystemBackground)
    static let inset = Color(uiColor: .tertiarySystemFill)
    static let border = Color(uiColor: .separator).opacity(0.35)
}

struct MobileIcon: View {
    let symbol: String
    var color: Color = MobileStyle.accent
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 19, weight: .medium))
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
        HStack(spacing: 13) {
            MobileIcon(symbol: symbol, color: color)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body.weight(.semibold)).foregroundStyle(.primary).lineLimit(2)
                if !subtitle.isEmpty {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 7)
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
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
    }
}
