import RuimtePulsar
import SwiftUI
import UIKit

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

    /// A menu draws its images as templates, so a colored dot has to be an image that keeps its own color. An account
    /// without an accent stays a template and takes the menu's own ink.
    static func menuImage(_ color: String?) -> Image {
        let size = CGSize(width: 10, height: 10)
        let hex = color.flatMap { RuimteColors.nodeAccents[$0] }
        let image = UIGraphicsImageRenderer(size: size).image { context in
            let fill = hex.map { UIColor(RuimteColorToken.color($0)) } ?? .black
            fill.setFill()
            context.cgContext.fillEllipse(in: CGRect(origin: .zero, size: size))
        }
        return Image(uiImage: image.withRenderingMode(hex == nil ? .alwaysTemplate : .alwaysOriginal))
    }
}
