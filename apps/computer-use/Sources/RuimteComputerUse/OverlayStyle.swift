import AppKit
import ComputerUseCore
import QuartzCore

/// What the overlay looks like, kept apart from how it moves so a designed cursor and pill can be dropped in.
/// A cursor asset goes in `Resources/cursor.pdf` or `Resources/cursor.png`; `scripts/build.ts` copies it into the app.
/// The words of the pill and the accent come from `OverlayConfig`, which the daemon writes.
@MainActor
enum OverlayStyle {
    static let pill = PillStyle()
    static let cursor = CursorStyle()
}

struct PillStyle {
    var font = NSFont.systemFont(ofSize: 13, weight: .medium)
    var textColor = NSColor.white
    var background = NSColor(calibratedWhite: 0.08, alpha: 0.88)
    var borderColor = NSColor(calibratedWhite: 1, alpha: 0.18)
    var borderWidth: CGFloat = 1
    var height: CGFloat = 30
    var horizontalPadding: CGFloat = 16
    /// nil rounds the ends fully.
    var cornerRadius: CGFloat?
    /// Distance below the menu bar.
    var topMargin: CGFloat = 10
}

struct CursorStyle {
    /// Looked up in the app's Resources, PDF before PNG. Without one the built-in arrow is drawn.
    var assetName = "cursor"
    /// The point of the asset that lands on the target, from its top-left corner, in points.
    var hotspot = CGPoint(x: 0, y: 0)
    /// nil draws the asset at its own size.
    var size: CGSize?
    /// Fill of the built-in arrow and color of the click ring, unless the overlay config names another.
    var accent = NSColor(srgbRed: 0.35, green: 0.40, blue: 1.0, alpha: 1)
}

final class PillView: NSView {
    init(style: PillStyle, text: String) {
        let label = NSTextField(labelWithString: text)
        label.font = style.font
        label.textColor = style.textColor
        label.sizeToFit()
        let width = ceil(label.frame.width) + style.horizontalPadding * 2
        super.init(frame: CGRect(x: 0, y: 0, width: width, height: style.height))
        wantsLayer = true
        layer?.backgroundColor = style.background.cgColor
        layer?.cornerRadius = style.cornerRadius ?? style.height / 2
        layer?.borderWidth = style.borderWidth
        layer?.borderColor = style.borderColor.cgColor
        label.frame.origin = CGPoint(x: style.horizontalPadding, y: floor((style.height - label.frame.height) / 2))
        addSubview(label)
    }

    required init?(coder: NSCoder) {
        nil
    }
}

@MainActor
enum CursorArtwork {
    /// A layer whose position is the hotspot, so moving it to a point puts the tip on that point.
    static func makeLayer(style: CursorStyle, accent: NSColor) -> CALayer {
        if let image = asset(named: style.assetName) {
            let size = style.size ?? image.size
            let layer = CALayer()
            layer.bounds = CGRect(origin: .zero, size: size)
            layer.contents = image.layerContents(forContentsScale: NSScreen.main?.backingScaleFactor ?? 2)
            layer.contentsGravity = .resizeAspect
            // AppKit layers count y from the bottom, the hotspot from the top.
            layer.anchorPoint = CGPoint(x: style.hotspot.x / max(size.width, 1), y: 1 - style.hotspot.y / max(size.height, 1))
            return layer
        }
        let arrow = CAShapeLayer()
        arrow.path = arrowPath()
        arrow.fillColor = accent.cgColor
        arrow.strokeColor = NSColor.white.cgColor
        arrow.lineWidth = 1.5
        arrow.lineJoin = .round
        arrow.shadowColor = NSColor.black.cgColor
        arrow.shadowOpacity = 0.35
        arrow.shadowRadius = 3
        arrow.shadowOffset = CGSize(width: 0, height: -1)
        return arrow
    }

    private static func asset(named name: String) -> NSImage? {
        for fileExtension in ["pdf", "png"] {
            if let url = Bundle.main.url(forResource: name, withExtension: fileExtension), let image = NSImage(contentsOf: url) {
                return image
            }
        }
        return nil
    }

    /// An arrow with its tip at the layer origin, drawn downward in AppKit's y-up space.
    private static func arrowPath() -> CGPath {
        let outline: [CGPoint] = [
            CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 17), CGPoint(x: 4.3, y: 13.2), CGPoint(x: 6.9, y: 19.3),
            CGPoint(x: 9.6, y: 18.2), CGPoint(x: 7.1, y: 12.3), CGPoint(x: 12.5, y: 12.3),
        ]
        let path = CGMutablePath()
        path.addLines(between: outline.map { CGPoint(x: $0.x * 1.3, y: -$0.y * 1.3) })
        path.closeSubpath()
        return path
    }
}
