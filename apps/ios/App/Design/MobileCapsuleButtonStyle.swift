import SwiftUI

/// The button of the design, a capsule in two weights and three sizes. Prominent is the one action a card or page leads
/// with (Allow, a chosen answer): the text color with the ground on it. Quiet is the quiet ground for the rest. Small
/// sits inside a row (Resume, Reconnect, Install); large spans the bottom of a page (Check again, Start Voice). A
/// destructive role turns the label, or the ground of a prominent one, to the error color. Disabled dims the whole
/// capsule rather than graying its label, so the label keeps its contrast on the ground in both appearances.
struct MobileCapsuleButtonStyle: ButtonStyle {
    enum Size {
        case small
        case regular
        case large
    }

    var prominent = false
    var size = Size.regular
    @Environment(\.isEnabled) private var enabled
    @ScaledMetric(relativeTo: .footnote) private var smallHeight = 30
    @ScaledMetric(relativeTo: .subheadline) private var regularHeight = 36
    @ScaledMetric(relativeTo: .body) private var largeHeight = 56

    func makeBody(configuration: Configuration) -> some View {
        let destructive = configuration.role == .destructive
        let label = label(destructive: destructive)
        configuration.label
            .labelStyle(MobileButtonLabelStyle())
            .font(font)
            .lineLimit(1)
            .foregroundStyle(label)
            .tint(label)
            .padding(.horizontal, horizontalPadding)
            .frame(maxWidth: size == .large ? .infinity : nil, minHeight: height)
            .background(ground(destructive: destructive), in: .capsule)
            .contentShape(.capsule)
            .opacity(!enabled ? 0.5 : configuration.isPressed ? 0.75 : 1)
    }

    private func label(destructive: Bool) -> Color {
        if prominent {
            return MobileStyle.surface
        }
        return destructive ? MobileStyle.statusError : MobileStyle.text
    }

    private func ground(destructive: Bool) -> Color {
        if prominent {
            return destructive ? MobileStyle.statusError : MobileStyle.text
        }
        return MobileStyle.fill
    }

    private var height: CGFloat {
        switch size {
        case .small: smallHeight
        case .regular: regularHeight
        case .large: largeHeight
        }
    }

    private var font: Font {
        switch size {
        case .small: .footnote.weight(prominent ? .semibold : .medium)
        case .regular: .subheadline.weight(prominent ? .semibold : .medium)
        case .large: .body.weight(.semibold)
        }
    }

    private var horizontalPadding: CGFloat {
        switch size {
        case .small: MobileSpacing.medium
        case .regular: prominent ? 20 : MobileSpacing.large
        case .large: MobileSpacing.xLarge
        }
    }
}

extension ButtonStyle where Self == MobileCapsuleButtonStyle {
    static var mobileCapsule: MobileCapsuleButtonStyle { MobileCapsuleButtonStyle() }
    static var mobileCapsuleProminent: MobileCapsuleButtonStyle { MobileCapsuleButtonStyle(prominent: true) }
    static var mobileCapsuleSmall: MobileCapsuleButtonStyle { MobileCapsuleButtonStyle(size: .small) }
    static var mobileCapsuleSmallProminent: MobileCapsuleButtonStyle {
        MobileCapsuleButtonStyle(prominent: true, size: .small)
    }
    static var mobileCapsuleLarge: MobileCapsuleButtonStyle { MobileCapsuleButtonStyle(prominent: true, size: .large) }
}

/// A button that is only a glyph, inside content: a 32 pt circle on the quiet ground in a 44 pt hit area. The label is
/// the bare icon; a destructive role draws it in the error color.
struct MobileIconButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @ScaledMetric(relativeTo: .body) private var size = 32
    @ScaledMetric(relativeTo: .body) private var hitSize = 44

    func makeBody(configuration: Configuration) -> some View {
        let color = configuration.role == .destructive ? MobileStyle.statusError : MobileStyle.text
        configuration.label
            .foregroundStyle(color)
            .tint(color)
            .frame(width: size, height: size)
            .background(MobileStyle.fill, in: .circle)
            .frame(width: hitSize, height: hitSize)
            .contentShape(.rect)
            .opacity(!enabled ? 0.5 : configuration.isPressed ? 0.6 : 1)
    }
}

extension ButtonStyle where Self == MobileIconButtonStyle {
    static var mobileIcon: MobileIconButtonStyle { MobileIconButtonStyle() }
}

/// A button that floats over content, in glass. The label sizes itself unless `padded`, which gives it the capsule's
/// font and the 48 pt height of a floating bar. Prominent tints the glass in the text color and draws the label in the ground,
/// in the error color for a destructive role. It is set through the button style and not on the label inside a
/// `Menu`, so the system takes the glass as the menu's source and grows the menu out of it. Disabled dims the whole
/// button, as the capsule does, instead of the system's light gray on a tinted glass.
struct MobileGlassButtonStyle<GlassShape: Shape>: ButtonStyle {
    let shape: GlassShape
    var prominent = false
    var padded = false
    @Environment(\.isEnabled) private var enabled
    @ScaledMetric(relativeTo: .subheadline) private var height = 48

    func makeBody(configuration: Configuration) -> some View {
        let destructive = configuration.role == .destructive
        let label =
            prominent ? MobileStyle.surface : destructive ? MobileStyle.statusError : MobileStyle.text
        let glass: Glass =
            prominent ? .regular.tint(destructive ? MobileStyle.statusError : MobileStyle.text) : .regular
        configuration.label
            .labelStyle(MobileButtonLabelStyle())
            .modifier(MobileGlassPadding(active: padded, height: height))
            .foregroundStyle(label)
            .tint(label)
            .contentShape(shape)
            .glassEffect(glass.interactive(), in: shape)
            .opacity(!enabled ? 0.5 : configuration.isPressed ? 0.8 : 1)
    }
}

/// The icon close to its text, where the system's label leaves a gap meant for a list row. An icon-only label stays
/// as the caller styled it.
private struct MobileButtonLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon
            configuration.title
        }
    }
}

private struct MobileGlassPadding: ViewModifier {
    let active: Bool
    let height: CGFloat

    func body(content: Content) -> some View {
        if active {
            content
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, MobileSpacing.large)
                .frame(minHeight: height)
        } else {
            content
        }
    }
}

extension ButtonStyle where Self == MobileGlassButtonStyle<Capsule> {
    static var mobileGlass: MobileGlassButtonStyle<Capsule> {
        MobileGlassButtonStyle(shape: Capsule(), padded: true)
    }
    static var mobileGlassProminent: MobileGlassButtonStyle<Capsule> {
        MobileGlassButtonStyle(shape: Capsule(), prominent: true, padded: true)
    }
}
