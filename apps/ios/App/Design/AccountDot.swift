import RuimtePulsar
import RuimteShared
import SwiftUI

/// The dot an account of a CLI wears, in its node accent. An account without one takes the app's accent.
struct AccountDot: View {
    let color: String?
    var size: CGFloat = 8

    var body: some View {
        Circle()
            .fill(RuimteColors.nodeAccent(color) ?? MobileStyle.accent)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
