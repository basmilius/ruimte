import RuimtePulsar
import RuimteShared
import SwiftUI
import UIKit

/// The grounds of a block's parts, as the desktop's `--chat-ui-tile`, `--chat-ui-inset` and `--chat-ui-hatch`: a tile
/// on the thread, a card inset in a tile, and the hatch of the band the block stands in.
enum UiTileStyle {
    static let radius: CGFloat = 12
    static let padding: CGFloat = 12
    /// The ink mixed over the ground so lightly that muted text keeps 4.5 to 1 on it.
    static let tile = Color(
        uiColor: MobileStyle.adaptive(
            RuimteColorToken(
                light: MermaidTheme.over(
                    RuimteColors.surface.light, color: RuimteColors.text.light, alpha: 0.045),
                dark: MermaidTheme.over(RuimteColors.surface.dark, color: RuimteColors.text.dark, alpha: 0.03))))
    static let inset = MobileStyle.surface
    static let hatch = MobileStyle.border
}

extension EnvironmentValues {
    /// Inside a Section, which is a tile itself: a tile there takes the inset ground, and one that only frames its
    /// parts goes flat, so every part lines up with the section's title.
    @Entry var uiInSection = false
    /// How far the band of a block reaches past the reply on each side, to the edges of the thread's row.
    @Entry var uiBandBleed: CGFloat = 0
}

private struct UiTileModifier: ViewModifier {
    let flat: Bool
    let padding: EdgeInsets
    @Environment(\.uiInSection) private var inSection

    func body(content: Content) -> some View {
        if inSection && flat {
            content
        } else {
            content.padding(padding)
                .background(
                    inSection ? UiTileStyle.inset : UiTileStyle.tile,
                    in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
        }
    }
}

extension View {
    /// A part on a tile. `flat` is a tile that only frames its parts, which a Section draws without ground or padding.
    func uiTile(flat: Bool = false, horizontal: CGFloat = UiTileStyle.padding, vertical: CGFloat = UiTileStyle.padding)
        -> some View
    {
        modifier(
            UiTileModifier(
                flat: flat,
                padding: EdgeInsets(top: vertical, leading: horizontal, bottom: vertical, trailing: horizontal)))
    }
}

/// The tones of a tag, as `Pill` has them: the color over a ground of itself.
enum UiPillTone {
    case muted, accent, idle, needsYou, error

    init(_ tone: UiTone) {
        switch tone {
        case .neutral: self = .muted
        case .info: self = .accent
        case .success: self = .idle
        case .warning: self = .needsYou
        case .danger: self = .error
        }
    }

    var text: Color {
        switch self {
        case .muted: MobileStyle.muted
        case .accent: MobileStyle.accent
        case .idle: MobileStyle.statusIdle
        case .needsYou: MobileStyle.statusNeedsYou
        case .error: MobileStyle.statusError
        }
    }

    var ground: Color {
        switch self {
        case .muted: MobileStyle.text.opacity(0.07)
        case .accent: MobileStyle.accent.opacity(0.16)
        case .idle: MobileStyle.statusIdle.opacity(0.15)
        case .needsYou: MobileStyle.statusNeedsYou.opacity(0.15)
        case .error: MobileStyle.statusError.opacity(0.15)
        }
    }
}

/// The band a block stands in across the thread, hatched above and below.
struct UiBandEdge: View {
    static let height: CGFloat = 14
    private static let spacing: CGFloat = 7

    var body: some View {
        Canvas { context, size in
            // A line every seven points, measured across the lines, as the desktop's -45° gradient draws them.
            let step = Self.spacing * 2.squareRoot()
            var path = Path()
            var x = -size.height
            while x < size.width {
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
                x += step
            }
            context.stroke(path, with: .color(UiTileStyle.hatch), lineWidth: 1)
        }
        .frame(height: Self.height)
        .overlay(alignment: .top) { Rectangle().fill(MobileStyle.border).frame(height: 1) }
        .overlay(alignment: .bottom) { Rectangle().fill(MobileStyle.border).frame(height: 1) }
        .clipped()
        .accessibilityHidden(true)
    }
}
