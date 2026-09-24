import AppKit
import QuartzCore

/// Small builders shared by the cursor, its label and the session bar. Every tree here hangs in a geometry-flipped
/// layer, so the numbers of the design go in unchanged, y down.
@MainActor
public enum Layers {
    static func plain(_ frame: CGRect = .zero) -> CALayer {
        let layer = CALayer()
        layer.frame = frame
        return layer
    }

    /// A layer of the cursor's 24 × 24 box, turning and scaling around the hotspot.
    static func cursorBox() -> CALayer {
        let box = OverlayStyle.Cursor.box
        let hotspot = OverlayStyle.Cursor.hotspot
        let layer = CALayer()
        layer.bounds = CGRect(x: 0, y: 0, width: box, height: box)
        layer.anchorPoint = CGPoint(x: hotspot.x / box, y: hotspot.y / box)
        layer.position = hotspot
        return layer
    }

    static func circle(center: CGPoint, diameter: CGFloat) -> CAShapeLayer {
        let layer = CAShapeLayer()
        layer.bounds = CGRect(x: 0, y: 0, width: diameter, height: diameter)
        layer.position = center
        layer.path = CGPath(ellipseIn: layer.bounds, transform: nil)
        return layer
    }

    /// A ring with its line inside the box, as a CSS border is.
    static func ring(center: CGPoint, diameter: CGFloat, lineWidth: CGFloat, color: CGColor) -> CAShapeLayer {
        let layer = circle(center: center, diameter: diameter)
        layer.path = CGPath(ellipseIn: layer.bounds.insetBy(dx: lineWidth / 2, dy: lineWidth / 2), transform: nil)
        layer.fillColor = nil
        layer.strokeColor = color
        layer.lineWidth = lineWidth
        return layer
    }

    static func font(size: CGFloat, weight: NSFont.Weight = .regular, monospacedDigits: Bool = false, monospaced: Bool = false) -> NSFont {
        if monospaced {
            return NSFont.monospacedSystemFont(ofSize: size, weight: weight)
        }
        if monospacedDigits {
            return NSFont.monospacedDigitSystemFont(ofSize: size, weight: weight)
        }
        return NSFont.systemFont(ofSize: size, weight: weight)
    }

    static func textWidth(_ text: String, font: NSFont) -> CGFloat {
        ceil(NSAttributedString(string: text, attributes: [.font: font]).size().width)
    }

    /// One line of text, vertically centered on `lineHeight` from `origin`.
    static func text(_ text: String, font: NSFont, color: CGColor, origin: CGPoint, lineHeight: CGFloat, width: CGFloat? = nil) -> CATextLayer {
        let layer = CATextLayer()
        layer.string = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor(cgColor: color) ?? .labelColor])
        let glyphHeight = ceil(font.ascender - font.descender + font.leading)
        layer.frame = CGRect(x: origin.x, y: origin.y + floor((lineHeight - glyphHeight) / 2), width: width ?? textWidth(text, font: font), height: glyphHeight)
        layer.truncationMode = .none
        layer.isWrapped = false
        return layer
    }

    /// A floating surface: the layered shadow of the design, the fill and an alpha border over it.
    /// Each shadow is cast by a copy of the surface under it, so a width that animates takes the shadows along.
    static func surface(size: CGSize, radius: CGFloat, fill: CGColor, border: CGColor, shadow: [ShadowStep]) -> (root: CALayer, resizable: [(layer: CALayer, grow: CGFloat)]) {
        let root = CALayer()
        root.bounds = CGRect(origin: .zero, size: size)
        var resizable: [(layer: CALayer, grow: CGFloat)] = []
        for step in shadow {
            let caster = CALayer()
            caster.bounds = CGRect(x: 0, y: 0, width: size.width + 2 * step.spread, height: size.height + 2 * step.spread)
            caster.anchorPoint = .zero
            caster.position = CGPoint(x: -step.spread, y: -step.spread)
            caster.cornerRadius = max(0, radius + step.spread)
            caster.backgroundColor = fill
            caster.shadowColor = CGColor(gray: 0, alpha: 1)
            caster.shadowOpacity = Float(step.alpha)
            caster.shadowRadius = step.blur / 2
            caster.shadowOffset = CGSize(width: 0, height: step.y)
            root.addSublayer(caster)
            resizable.append((caster, 2 * step.spread))
        }
        let body = CALayer()
        body.bounds = root.bounds
        body.anchorPoint = .zero
        body.position = .zero
        body.cornerRadius = radius
        body.backgroundColor = fill
        body.borderColor = border
        body.borderWidth = 1
        root.addSublayer(body)
        resizable.append((body, 0))
        return (root, resizable)
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

/// The icons of the session bar, in their 24 × 24 box.
enum BarIcon {
    case pause
    case play
    case stop

    var path: CGPath {
        let path = CGMutablePath()
        switch self {
        case .pause:
            path.addRoundedRect(in: CGRect(x: 6, y: 4, width: 4, height: 16), cornerWidth: 1.5, cornerHeight: 1.5)
            path.addRoundedRect(in: CGRect(x: 14, y: 4, width: 4, height: 16), cornerWidth: 1.5, cornerHeight: 1.5)
        case .stop:
            path.addRoundedRect(in: CGRect(x: 5, y: 5, width: 14, height: 14), cornerWidth: 2.5, cornerHeight: 2.5)
        case .play:
            // The design's triangle rounds its corners with unit arcs; these are the corners its sides meet in.
            let top = CGPoint(x: 7, y: 2.66)
            let bottom = CGPoint(x: 7, y: 21.34)
            let tip = CGPoint(x: 21.94, y: 12)
            path.move(to: CGPoint(x: 7, y: 12))
            path.addArc(tangent1End: bottom, tangent2End: tip, radius: 1)
            path.addArc(tangent1End: tip, tangent2End: top, radius: 1)
            path.addArc(tangent1End: top, tangent2End: bottom, radius: 1)
            path.closeSubpath()
        }
        return path
    }
}
