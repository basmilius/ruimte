import SwiftUI

/// The orbit of the desktop's About and welcome around the app icon: a soft glow and rings that fade out downward.
struct IconOrbit: View {
    /// How far below the top the icon's center sits.
    var center: CGFloat = 62
    var diameters: [CGFloat] = [140, 230, 340]
    var glow: CGFloat = 300

    var body: some View {
        GeometryReader { geometry in
            let point = CGPoint(x: geometry.size.width / 2, y: center)
            ZStack {
                RadialGradient(
                    colors: [MobileStyle.accent.opacity(0.16), .clear], center: .center, startRadius: 0,
                    endRadius: glow / 2
                )
                .frame(width: glow, height: glow)
                .position(point)
                ForEach(diameters, id: \.self) { diameter in
                    Circle()
                        .stroke(MobileStyle.text.opacity(max(0.015, 0.07 - diameter / 10_000)), lineWidth: 1)
                        .frame(width: diameter, height: diameter)
                        .position(point)
                }
            }
            .mask(LinearGradient(colors: [.black, .black, .clear], startPoint: .top, endPoint: .bottom))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
