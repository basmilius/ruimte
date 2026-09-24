import AppKit
import QuartzCore

/// Where the label goes: down and right of the hotspot, and to the other side of it where the screen ends.
public enum LabelPlacement {
    public struct Result: Equatable, Sendable {
        /// The top-left corner of the label, from the hotspot, y down.
        public var origin: CGPoint
        public var flippedLeft: Bool
        public var flippedUp: Bool
    }

    /// `room` is the screen around the hotspot in the same space: from the hotspot, y down. Without one it never flips.
    public static func place(
        size: CGSize,
        room: CGRect?,
        offset: CGPoint = OverlayStyle.Label.offset,
        margin: CGFloat = OverlayStyle.Label.edgeMargin
    ) -> Result {
        var result = Result(origin: offset, flippedLeft: false, flippedUp: false)
        guard let room else {
            return result
        }
        if offset.x + size.width > room.maxX - margin && -offset.x - size.width >= room.minX + margin {
            result.origin.x = -offset.x - size.width
            result.flippedLeft = true
        }
        if offset.y + size.height > room.maxY - margin && -offset.y - size.height >= room.minY + margin {
            result.origin.y = -offset.y - size.height
            result.flippedUp = true
        }
        return result
    }
}

/// The pill beside the cursor.
@MainActor
enum PhantomLabel {
    struct Built {
        var layer: CALayer
        var size: CGSize
    }

    static func make(kind: PhantomLabelKind, text: String, color: CGColor, palette: PhantomPalette, motion: MotionHost) -> Built {
        let style = OverlayStyle.Label.self
        let border: CGFloat = 1
        let contentX = border + style.padding
        let textX = contentX + style.dot + style.gap
        let lineY = (style.height - style.lineHeight) / 2

        let dot = Layers.circle(center: CGPoint(x: contentX + style.dot / 2, y: style.height / 2), diameter: style.dot)
        dot.fillColor = color
        if kind == .pulsing || kind == .shining {
            motion.play(.keyframes("opacity", duration: OverlayStyle.Motion.pulse, [(0, 1), (0.5, 0.4), (1, 1)], easing: .easeInOut, repeats: true), on: dot)
        }

        if kind == .typed {
            return typed(text: text, color: color, palette: palette, dot: dot, textX: textX, lineY: lineY, motion: motion)
        }

        let font = Layers.font(size: style.fontSize)
        let width = Layers.textWidth(text, font: font)
        let size = CGSize(width: textX + width + style.padding + border, height: style.height)
        let surface = Layers.surface(size: size, radius: style.height / 2, fill: palette.raised, border: palette.border, shadow: palette.floatShadow)
        surface.root.addSublayer(dot)
        if kind == .shining {
            surface.root.addSublayer(shine(text: text, font: font, palette: palette, origin: CGPoint(x: textX, y: lineY), width: width, motion: motion))
        } else {
            surface.root.addSublayer(Layers.text(text, font: font, color: palette.text, origin: CGPoint(x: textX, y: lineY), lineHeight: style.lineHeight))
        }
        return Built(layer: surface.root, size: size)
    }

    /// Letter by letter behind a caret, in the width of the monospaced letters, as the design's `steps()` does.
    private static func typed(text: String, color: CGColor, palette: PhantomPalette, dot: CALayer, textX: CGFloat, lineY: CGFloat, motion: MotionHost) -> Built {
        let style = OverlayStyle.Label.self
        let shown = text.count > style.maxTypedCharacters ? "…" + String(text.suffix(style.maxTypedCharacters - 1)) : text
        let letters = max(shown.count, 1)
        let font = Layers.font(size: style.typedFontSize, monospaced: true)
        let letterWidth = NSAttributedString(string: "0", attributes: [.font: font]).size().width
        let fullWidth = ceil(letterWidth * CGFloat(letters))
        // The caret follows the text: a gap of 6 and a margin of -4 in the design.
        let caretGap = style.gap - 4
        let trailing = caretGap + style.caretWidth + style.padding + 1
        let size = CGSize(width: textX + fullWidth + trailing, height: style.height)
        let surface = Layers.surface(size: size, radius: style.height / 2, fill: palette.raised, border: palette.border, shadow: palette.floatShadow)
        surface.root.addSublayer(dot)

        let clip = Layers.plain(CGRect(x: textX, y: lineY, width: fullWidth, height: style.lineHeight))
        clip.masksToBounds = true
        clip.anchorPoint = .zero
        clip.position = CGPoint(x: textX, y: lineY)
        clip.addSublayer(Layers.text(shown, font: font, color: palette.text, origin: .zero, lineHeight: style.lineHeight, width: fullWidth + letterWidth))
        surface.root.addSublayer(clip)

        let caret = Layers.plain(CGRect(x: 0, y: 0, width: style.caretWidth, height: style.caretHeight))
        caret.anchorPoint = .zero
        caret.backgroundColor = color
        caret.position = CGPoint(x: textX + fullWidth + caretGap, y: (style.height - style.caretHeight) / 2)
        surface.root.addSublayer(caret)

        let reveal = OverlayStyle.Motion.typedLetter * Double(letters)
        let revealed = { (fraction: CGFloat) in ceil(letterWidth * CGFloat(letters) * fraction) }
        let steps = Easing.steps(letters)
        let widthAt = { (time: Double) -> CGFloat in
            revealed(steps.progress(CGFloat(time / reveal)))
        }
        motion.play(Track(keyPath: "bounds.size.width", duration: reveal, discrete: true) { NSNumber(value: Double(widthAt($0))) }, on: clip)
        motion.play(Track(keyPath: "position.x", duration: reveal, discrete: true) { NSNumber(value: Double(textX + widthAt($0) + caretGap)) }, on: caret)
        for (layer, grow) in surface.resizable {
            motion.play(Track(keyPath: "bounds.size.width", duration: reveal, discrete: true) { NSNumber(value: Double(textX + widthAt($0) + trailing + grow)) }, on: layer)
        }
        motion.play(Track(keyPath: "opacity", duration: OverlayStyle.Motion.caret, delay: reveal, repeats: true, discrete: true) { NSNumber(value: $0 < OverlayStyle.Motion.caret / 2 ? 1 : 0) }, on: caret)
        return Built(layer: surface.root, size: size)
    }

    /// The words of "working" with a light running through them, muted to text and back.
    private static func shine(text: String, font: NSFont, palette: PhantomPalette, origin: CGPoint, width: CGFloat, motion: MotionHost) -> CALayer {
        let height = OverlayStyle.Label.lineHeight
        let container = Layers.plain(CGRect(x: origin.x, y: origin.y, width: width, height: height))
        let mask = Layers.text(text, font: font, color: CGColor(gray: 0, alpha: 1), origin: .zero, lineHeight: height)
        container.mask = mask
        // The gradient repeats every two widths, as a 200% background does; three periods cover the text while they run by.
        let gradient = CAGradientLayer()
        gradient.startPoint = CGPoint(x: 0, y: 0.5)
        gradient.endPoint = CGPoint(x: 1, y: 0.5)
        var colors: [CGColor] = []
        var locations: [NSNumber] = []
        for period in 0..<3 {
            colors.append(contentsOf: [palette.muted, palette.text, palette.muted])
            locations.append(contentsOf: [0, 0.5, 1].map { NSNumber(value: (Double(period) + $0) / 3) })
        }
        gradient.colors = colors
        gradient.locations = locations
        gradient.bounds = CGRect(x: 0, y: 0, width: width * 6, height: height)
        gradient.anchorPoint = .zero
        gradient.position = CGPoint(x: -4 * width, y: 0)
        container.addSublayer(gradient)
        if motion.moves {
            motion.run(.keyframes("position.x", duration: OverlayStyle.Motion.shine, [(0, -4 * width), (1, 0)], easing: .linear, repeats: true), on: gradient)
        } else {
            gradient.colors = [palette.text, palette.text]
            gradient.locations = [0, 1]
        }
        return container
    }
}
