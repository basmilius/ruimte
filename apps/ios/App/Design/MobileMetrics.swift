import SwiftUI
import UIKit

/// What kind of device a layout choice is made for.
enum MobileDevice {
    static var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    /// An iPad with the room for a table or columns, which a narrow window of it (Split View) does not have.
    static func isWide(_ sizeClass: UserInterfaceSizeClass?) -> Bool { isPad && sizeClass == .regular }
}

/// The rhythm every page is spaced in: steps of 4, 8, 12, 16 and 24 points.
enum MobileSpacing {
    static let xSmall: CGFloat = 4
    static let small: CGFloat = 8
    static let medium: CGFloat = 12
    static let large: CGFloat = 16
    static let xLarge: CGFloat = 24
    /// The edge of a page to its cards and rows, the same on every page.
    static let margin: CGFloat = 24
    static let cardPadding: CGFloat = 18
}

/// The fixed sizes of the design. A shape is a tile, a card or a capsule; nothing else takes a radius of its own.
enum MobileMetrics {
    /// A code block or a field inside a card.
    static let tileRadius: CGFloat = 10
    static let cardRadius: CGFloat = 20
    static let rowHeight: CGFloat = 56
    /// The width a row's leading glyph stands in, so the titles of a list line up.
    static let statusColumn: CGFloat = 20
    static let statusGlyph: CGFloat = 18
}

/// Puts the middle of a glyph or tile on the middle of the capitals of the first line beside it, for an `HStack`
/// aligned on `.firstTextBaseline` whose text runs to several lines and whose glyph belongs to the first.
private struct FirstLineCenter: ViewModifier {
    let style: UIFont.TextStyle
    @Environment(\.dynamicTypeSize) private var typeSize

    func body(content: Content) -> some View {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(typeSize))
        let capHeight = UIFont.preferredFont(forTextStyle: style, compatibleWith: traits).capHeight
        content.alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + capHeight / 2 }
    }
}

extension View {
    /// `style` is the text style of the line the view sits beside.
    func centeredOnFirstLine(of style: UIFont.TextStyle) -> some View {
        modifier(FirstLineCenter(style: style))
    }
}
