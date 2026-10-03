import SwiftUI

/// The one solid action of an onboarding screen: a capsule in the text color, so white on dark and black on light.
struct SolidCapsuleButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @ScaledMetric(relativeTo: .body) private var height = 56

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(MobileStyle.surface)
            .tint(MobileStyle.surface)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(MobileStyle.text, in: .capsule)
            .contentShape(.capsule)
            .opacity(!enabled ? 0.5 : configuration.isPressed ? 0.8 : 1)
    }
}
