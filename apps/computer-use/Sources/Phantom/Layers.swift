import AppKit
import QuartzCore

/// Small builders shared by the cursor and its renders. Every tree here hangs in a geometry-flipped layer, so the
/// numbers of the design go in unchanged, y down.
@MainActor
public enum Layers {
    static func plain(_ frame: CGRect = .zero) -> CALayer {
        let layer = CALayer()
        layer.frame = frame
        return layer
    }

    /// A layer of the cursor's 24 × 24 box that keeps the box's coordinates and scales and turns around `point`.
    static func cursorBox(around point: CGPoint = OverlayStyle.Cursor.hotspot) -> CALayer {
        let box = OverlayStyle.Cursor.box
        let layer = CALayer()
        layer.bounds = CGRect(x: 0, y: 0, width: box, height: box)
        layer.anchorPoint = CGPoint(x: point.x / box, y: point.y / box)
        layer.position = point
        return layer
    }

    static func circle(center: CGPoint, diameter: CGFloat) -> CAShapeLayer {
        let layer = CAShapeLayer()
        layer.bounds = CGRect(x: 0, y: 0, width: diameter, height: diameter)
        layer.position = center
        layer.path = CGPath(ellipseIn: layer.bounds, transform: nil)
        return layer
    }

    /// A CSS drop shadow, cast by everything the layer holds.
    static func shadow(_ layer: CALayer, _ step: ShadowStep) {
        layer.shadowColor = CGColor(gray: 0, alpha: 1)
        layer.shadowOpacity = Float(step.alpha)
        layer.shadowRadius = step.blur / 2
        layer.shadowOffset = CGSize(width: 0, height: step.y)
    }

    /// One line of text, vertically centered on `lineHeight` from `origin`.
    static func text(_ text: String, font: NSFont, color: CGColor, origin: CGPoint, lineHeight: CGFloat) -> CATextLayer {
        let layer = CATextLayer()
        layer.string = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor(cgColor: color) ?? .labelColor])
        let glyphHeight = ceil(font.ascender - font.descender + font.leading)
        let width = ceil(NSAttributedString(string: text, attributes: [.font: font]).size().width)
        layer.frame = CGRect(x: origin.x, y: origin.y + floor((lineHeight - glyphHeight) / 2), width: width, height: glyphHeight)
        layer.truncationMode = .none
        layer.isWrapped = false
        return layer
    }

    /// Sets the scale of a whole tree, so its text and shapes are sharp on the screen it is on.
    public static func setScale(_ layer: CALayer, _ scale: CGFloat) {
        layer.contentsScale = scale
        for sublayer in layer.sublayers ?? [] {
            setScale(sublayer, scale)
        }
        if let mask = layer.mask {
            setScale(mask, scale)
        }
    }

    static func mix(_ from: CGColor, _ to: CGColor, _ t: CGFloat) -> CGColor {
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        let start = from.converted(to: space, intent: .defaultIntent, options: nil)?.components ?? [0, 0, 0, 0]
        let end = to.converted(to: space, intent: .defaultIntent, options: nil)?.components ?? [0, 0, 0, 0]
        let parts = (0..<4).map { start[$0] + (end[$0] - start[$0]) * t }
        return CGColor(colorSpace: space, components: parts) ?? to
    }

    static func withAlpha(_ color: CGColor, _ alpha: CGFloat) -> CGColor {
        color.copy(alpha: color.alpha * alpha) ?? color
    }
}
