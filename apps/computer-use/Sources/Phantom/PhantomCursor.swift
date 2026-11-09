import AppKit
import ComputerUseCore
import QuartzCore

/// Everything a state needs besides the state itself.
public struct PhantomScene {
    public var scrollDirection = ScrollDirection.down
    public var working = WorkingStyle.dots
    /// False leaves out the ring and the marks, for the mini cursor of the menu bar.
    public var effects = true

    public init() {}
}

/// The phantom cursor as a layer tree, in a geometry-flipped superlayer so its numbers are the design's, y down.
/// `layer` has no size: its origin is the hotspot, so its position is the point the cursor points at.
@MainActor
public final class PhantomCursor {
    public let layer = CALayer()
    public private(set) var state: PhantomState?
    private let rings = Layers.cursorBox()
    /// Carries the figure and its marks, so the drift of dragging takes both.
    private let drift = CALayer()
    private let figure = Layers.cursorBox()
    private let pose = Layers.cursorBox()
    private let beat = Layers.cursorBox()
    private let rim = CAShapeLayer()
    private let fill = CAShapeLayer()
    private let marks = Layers.cursorBox()
    private var glyph: (layer: CALayer, key: String)?
    private var mark: (layer: CALayer, key: String)?

    public init() {
        layer.anchorPoint = .zero
        layer.bounds = .zero
        rings.position = .zero
        drift.anchorPoint = .zero
        drift.bounds = .zero
        figure.position = .zero
        marks.position = .zero
        Layers.shadow(figure, OverlayStyle.Cursor.shadow)
        Layers.shadow(marks, OverlayStyle.Mark.shadow)
        for shape in [rim, fill] {
            shape.frame = CGRect(x: 0, y: 0, width: OverlayStyle.Cursor.box, height: OverlayStyle.Cursor.box)
            shape.lineJoin = .round
            shape.path = PhantomForm.arrow.outline.cgPath
            beat.addSublayer(shape)
        }
        rim.fillColor = nil
        pose.addSublayer(beat)
        figure.addSublayer(pose)
        drift.addSublayer(figure)
        drift.addSublayer(marks)
        layer.addSublayer(rings)
        layer.addSublayer(drift)
    }

    /// Shows a state. `animated` morphs from the state before; without it the state stands as it would after its transitions.
    public func show(_ state: PhantomState, scene: PhantomScene, motion: MotionHost, animated: Bool) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer {
            CATransaction.commit()
        }
        let look = PhantomLook.of(state, working: scene.working)
        let transition = animated && self.state != nil && motion.moves

        applyForm(look, transition: transition, motion: motion)
        applyPaint(look, transition: transition, motion: motion)
        applyPose(look, transition: transition, motion: motion)
        applyBeat(look, motion: motion)
        applyGlyph(look, transition: transition, motion: motion)
        applyRing(look, scene: scene, motion: motion)
        applyMark(look, scene: scene, transition: transition, motion: motion)
        self.state = state
    }

    /// Starts the ring and the press of a click again, for a second click in the same state.
    public func replayClick(scene: PhantomScene, motion: MotionHost) {
        guard let state, state == .click || state == .tap else {
            return
        }
        let look = PhantomLook.of(state, working: scene.working)
        applyBeat(look, motion: motion)
        applyRing(look, scene: scene, motion: motion)
    }

    private func applyForm(_ look: PhantomLook, transition: Bool, motion: MotionHost) {
        let target = look.form.outline
        let current = (fill.presentation()?.path).flatMap(PhantomOutline.init(cgPath:)) ?? fill.path.flatMap(PhantomOutline.init(cgPath:))
        for shape in [rim, fill] {
            if transition, let current, current != target {
                let timing = OverlayStyle.Motion.morph
                motion.run(Track(keyPath: "path", duration: timing.duration) { time in
                    PhantomOutline.interpolate(current, target, timing.easing.progress(CGFloat(time / timing.duration))).cgPath
                }, on: shape)
            } else {
                shape.removeAnimation(forKey: "path")
                shape.path = target.cgPath
            }
        }
    }

    private func applyPaint(_ look: PhantomLook, transition: Bool, motion: MotionHost) {
        let ink = OverlayStyle.Ink.self
        let timing = OverlayStyle.Motion.color
        let colors: [(CAShapeLayer, String, CGColor)] = [
            (rim, "strokeColor", look.ghost ? ink.ghostRim : ink.white),
            (fill, "fillColor", look.ghost ? ink.ghostFill : Layers.withAlpha(ink.fill, look.fillOpacity)),
            (fill, "strokeColor", look.ghost ? ink.ghostStroke : ink.fill),
        ]
        for (shape, keyPath, target) in colors {
            let current = shape.presentation()?.value(forKeyPath: keyPath) ?? shape.value(forKeyPath: keyPath)
            if transition, let current, CFGetTypeID(current as CFTypeRef) == CGColor.typeID {
                let start = current as! CGColor
                motion.run(Track(keyPath: keyPath, duration: timing.duration) { time in
                    Layers.mix(start, target, timing.easing.progress(CGFloat(time / timing.duration)))
                }, on: shape)
            } else {
                shape.removeAnimation(forKey: keyPath)
                shape.setValue(target, forKeyPath: keyPath)
            }
        }
        let widths: [(CAShapeLayer, CGFloat)] = [(rim, look.rimWidth), (fill, OverlayStyle.Cursor.strokeWidth)]
        for (shape, target) in widths {
            let current = shape.presentation()?.lineWidth ?? shape.lineWidth
            if transition && abs(current - target) > 0.001 {
                motion.run(.transition("lineWidth", from: current, to: target, duration: timing.duration, easing: timing.easing), on: shape)
            } else {
                shape.removeAnimation(forKey: "lineWidth")
                shape.lineWidth = target
            }
        }
    }

    private func applyPose(_ look: PhantomLook, transition: Bool, motion: MotionHost) {
        let timing = OverlayStyle.Motion.pose
        let current = (pose.presentation()?.value(forKeyPath: "transform.scale") as? NSNumber).map { CGFloat($0.doubleValue) } ?? 1
        if transition && abs(current - look.scale) > 0.001 {
            motion.run(.transition("transform.scale", from: current, to: look.scale, duration: timing.duration, easing: timing.easing), on: pose)
        } else {
            pose.removeAllAnimations()
            pose.transform = CATransform3DMakeScale(look.scale, look.scale, 1)
        }
    }

    private func applyBeat(_ look: PhantomLook, motion: MotionHost) {
        let timing = OverlayStyle.Motion.self
        for layer in [beat, drift] {
            layer.removeAllAnimations()
            layer.transform = CATransform3DIdentity
        }
        beat.opacity = 1
        switch look.beat {
        case .press:
            motion.play(.keyframes("transform.scale", duration: timing.press, [(0, 1), (0.35, timing.pressScale), (1, 1)], easing: timing.smooth), on: beat)
        case .nudge:
            motion.play(.keyframes("transform.translation.x", duration: timing.nudge, [(0, 0), (0.25, -1.2), (0.55, 1.2), (0.8, -0.5), (1, 0)], easing: .easeOut), on: beat)
        case .typing:
            let step = timing.typingStep
            motion.play(.keyframes("transform.translation.x", duration: timing.typing, [(0, 0), (0.2, step), (0.4, 2 * step), (0.6, 3 * step), (0.85, 3 * step), (1, 0)], easing: .steps(1), repeats: true), on: beat)
        case .fade:
            motion.play(.keyframes("opacity", duration: timing.doneFade, [(0, 1), (0.7, 1), (1, 0)]), on: beat)
        case nil:
            break
        }
        guard look.drift else {
            return
        }
        // `alternate`: out on the curve, and back on the same curve run backwards.
        let leg = timing.drift
        let reach = timing.driftReach
        for (keyPath, distance) in [("transform.translation.x", reach.x), ("transform.translation.y", reach.y)] {
            motion.play(Track(keyPath: keyPath, duration: 2 * leg, repeats: true) { time in
                let along = time < leg ? time / leg : (2 * leg - time) / leg
                return NSNumber(value: Double(distance * timing.smooth.progress(CGFloat(along))))
            }, on: drift)
        }
    }

    private func applyGlyph(_ look: PhantomLook, transition: Bool, motion: MotionHost) {
        let key = look.glyph.map { "\($0)-\(look.tone?.rawValue ?? "white")" }
        if transition, let glyph, glyph.key == key {
            return
        }
        if let glyph {
            let fade = OverlayStyle.Motion.glyphIn
            let from = CGFloat(glyph.layer.presentation()?.opacity ?? glyph.layer.opacity)
            motion.retire(glyph.layer, tracks: transition ? [.transition("opacity", from: from, to: 0, duration: fade.duration, easing: fade.easing)] : [])
            self.glyph = nil
        }
        guard let kind = look.glyph, let key else {
            return
        }
        let glyph = Layers.plain(CGRect(x: 0, y: 0, width: OverlayStyle.Cursor.box, height: OverlayStyle.Cursor.box))
        let timing = OverlayStyle.Motion.self
        switch kind {
        case .handLines:
            let lines = CAShapeLayer()
            lines.frame = glyph.bounds
            lines.path = PhantomGeometry.handLines
            lines.fillColor = nil
            lines.strokeColor = Layers.withAlpha(OverlayStyle.Ink.white, OverlayStyle.Cursor.handLineOpacity)
            lines.lineWidth = OverlayStyle.Cursor.handLine
            lines.lineCap = .round
            glyph.addSublayer(lines)
        }
        beat.addSublayer(glyph)
        self.glyph = (glyph, key)
        if transition {
            let appear = timing.glyphIn
            motion.run(.transition("opacity", from: 0, to: 1, duration: appear.duration, easing: appear.easing, delay: timing.glyphInDelay), on: glyph)
        }
    }

    private func applyRing(_ look: PhantomLook, scene: PhantomScene, motion: MotionHost) {
        rings.sublayers?.forEach { $0.removeFromSuperlayer() }
        guard scene.effects, let radius = look.ring else {
            return
        }
        let timing = OverlayStyle.Motion.self
        let ring = Layers.circle(center: OverlayStyle.Cursor.hotspot, diameter: 2 * radius)
        ring.fillColor = nil
        ring.strokeColor = OverlayStyle.Ink.white
        ring.lineWidth = OverlayStyle.Cursor.ringLine
        ring.opacity = 0
        Layers.shadow(ring, OverlayStyle.Mark.shadow)
        rings.addSublayer(ring)
        motion.play(.keyframes("transform.scale", duration: timing.ring, [(0, timing.ringScale), (1, 1)], easing: timing.smooth), on: ring)
        motion.play(.keyframes("opacity", duration: timing.ring, [(0, 0), (0.18, 0.9), (1, 0)], easing: timing.smooth), on: ring)
    }

    private func applyMark(_ look: PhantomLook, scene: PhantomScene, transition: Bool, motion: MotionHost) {
        let kind = scene.effects ? look.mark : nil
        let key = kind.map { "\($0)-\(scene.scrollDirection.rawValue)" }
        if transition, let mark, mark.key == key {
            return
        }
        if let mark {
            let timing = OverlayStyle.Motion.markOut
            let layer = mark.layer
            let scale = (layer.presentation()?.value(forKeyPath: "transform.scale") as? NSNumber).map { CGFloat($0.doubleValue) } ?? 1
            let opacity = CGFloat(layer.presentation()?.opacity ?? layer.opacity)
            motion.retire(layer, tracks: transition ? [
                .transition("transform.scale", from: scale, to: OverlayStyle.Motion.markOutScale, duration: timing.duration, easing: timing.easing),
                .transition("opacity", from: opacity, to: 0, duration: timing.duration, easing: timing.easing),
            ] : [])
            self.mark = nil
        }
        guard let kind, let key else {
            return
        }
        let timing = OverlayStyle.Motion.self
        let layer: CALayer
        switch kind {
        case .look:
            layer = Self.lookMark()
            motion.play(.transition("transform.scale", from: timing.focusInScale, to: 1, duration: timing.focusIn, easing: timing.smooth), on: layer)
            motion.play(.transition("opacity", from: 0, to: 1, duration: timing.focusIn, easing: timing.smooth), on: layer)
        case .scroll:
            layer = Self.scrollMark(scene.scrollDirection, motion: motion)
        case .disc(let sign):
            layer = Self.discMark(sign, motion: motion)
        }
        if kind != .look {
            motion.play(.transition("transform.scale", from: timing.markInScale, to: 1, duration: timing.markIn, easing: timing.smooth), on: layer)
            motion.play(.transition("opacity", from: 0, to: 1, duration: timing.markIn, easing: timing.smooth), on: layer)
        }
        marks.addSublayer(layer)
        mark = (layer, key)
    }

    /// Four corners, each an arm, a rounded bend and an arm; they focus around their own middle.
    private static func lookMark() -> CALayer {
        let style = OverlayStyle.Mark.self
        let frame = style.place(style.lookFrame, radius: style.lookRadius)
        let layer = Layers.cursorBox(around: CGPoint(x: frame.midX, y: frame.midY))
        let arm = style.lookArm
        let bend = style.lookBend
        let path = CGMutablePath()
        let (left, top, right, bottom) = (frame.minX, frame.minY, frame.maxX, frame.maxY)
        path.move(to: CGPoint(x: left, y: top + arm))
        path.addLine(to: CGPoint(x: left, y: top + bend))
        path.addQuadCurve(to: CGPoint(x: left + bend, y: top), control: CGPoint(x: left, y: top))
        path.addLine(to: CGPoint(x: left + arm, y: top))
        path.move(to: CGPoint(x: right - arm, y: top))
        path.addLine(to: CGPoint(x: right - bend, y: top))
        path.addQuadCurve(to: CGPoint(x: right, y: top + bend), control: CGPoint(x: right, y: top))
        path.addLine(to: CGPoint(x: right, y: top + arm))
        path.move(to: CGPoint(x: right, y: bottom - arm))
        path.addLine(to: CGPoint(x: right, y: bottom - bend))
        path.addQuadCurve(to: CGPoint(x: right - bend, y: bottom), control: CGPoint(x: right, y: bottom))
        path.addLine(to: CGPoint(x: right - arm, y: bottom))
        path.move(to: CGPoint(x: left + arm, y: bottom))
        path.addLine(to: CGPoint(x: left + bend, y: bottom))
        path.addQuadCurve(to: CGPoint(x: left, y: bottom - bend), control: CGPoint(x: left, y: bottom))
        path.addLine(to: CGPoint(x: left, y: bottom - arm))
        let corners = CAShapeLayer()
        corners.frame = layer.bounds
        corners.path = path
        corners.fillColor = nil
        corners.strokeColor = OverlayStyle.Ink.white
        corners.lineWidth = style.lookLine
        corners.lineCap = .round
        corners.lineJoin = .round
        layer.addSublayer(corners)
        return layer
    }

    /// The wheel stands for up and down and lies down for left and right; its dot runs out, lands, fades and rests.
    private static func scrollMark(_ direction: ScrollDirection, motion: MotionHost) -> CALayer {
        let style = OverlayStyle.Mark.self
        let size = direction.isVertical ? style.wheel : CGSize(width: style.wheel.height, height: style.wheel.width)
        let radius = min(size.width, size.height) / 2
        let frame = style.place(size, radius: radius)
        let layer = Layers.cursorBox(around: style.notch)
        let wheel = CAShapeLayer()
        wheel.frame = layer.bounds
        wheel.path = CGPath(roundedRect: frame, cornerWidth: radius, cornerHeight: radius, transform: nil)
        wheel.fillColor = OverlayStyle.Ink.white
        layer.addSublayer(wheel)
        let travel = style.wheelTravel * CGFloat(direction.sign)
        let start = direction.isVertical
            ? CGPoint(x: frame.midX, y: frame.midY - travel / 2)
            : CGPoint(x: frame.midX - travel / 2, y: frame.midY)
        let dot = Layers.circle(center: start, diameter: 2 * style.wheelDot)
        dot.fillColor = Layers.withAlpha(OverlayStyle.Ink.fill, style.wheelDotOpacity)
        layer.addSublayer(dot)
        let timing = OverlayStyle.Motion.self
        let keyPath = direction.isVertical ? "transform.translation.y" : "transform.translation.x"
        motion.play(.keyframes(keyPath, duration: timing.wheel, [(0, 0, timing.smooth), (0.6, travel, .linear), (1, travel, .linear)], repeats: true), on: dot)
        motion.play(.keyframes("opacity", duration: timing.wheel, [(0, 0, timing.smooth), (0.14, 1, .ease), (0.6, 1, .cubic(0.42, 0, 1, 1)), (0.74, 0, .linear), (1, 0, .linear)], repeats: true), on: dot)
        return layer
    }

    /// A disc as the alert of the design, with the sign of its state in it.
    private static func discMark(_ sign: PhantomDisc, motion: MotionHost) -> CALayer {
        let style = OverlayStyle.Mark.self
        let timing = OverlayStyle.Motion.self
        let radius = style.discRadius
        let frame = style.place(CGSize(width: 2 * radius, height: 2 * radius), radius: radius)
        let center = CGPoint(x: frame.midX, y: frame.midY)
        let layer = Layers.cursorBox(around: style.notch)
        let disc = Layers.circle(center: center, diameter: 2 * radius)
        let white = OverlayStyle.Ink.white
        let ink = OverlayStyle.Ink.fill
        layer.addSublayer(disc)
        let shape = CAShapeLayer()
        shape.frame = layer.bounds
        shape.fillColor = white
        layer.addSublayer(shape)
        switch sign {
        case .dots:
            disc.fillColor = white
            for (index, offset) in [-2.6, 0, 2.6].enumerated() {
                let dot = Layers.circle(center: CGPoint(x: center.x + offset, y: center.y), diameter: 1.9)
                dot.fillColor = ink
                layer.addSublayer(dot)
                let delay = Double(index) * timing.waveStagger
                motion.play(.keyframes("transform.translation.y", duration: timing.wave, [(0, 0), (0.3, -1), (0.6, 0), (1, 0)], easing: .easeInOut, repeats: true, delay: delay), on: dot)
                motion.play(.keyframes("opacity", duration: timing.wave, [(0, 0.55), (0.3, 1), (0.6, 0.55), (1, 0.55)], easing: .easeInOut, repeats: true, delay: delay), on: dot)
            }
        case .arc:
            disc.fillColor = white
            let arc = Layers.circle(center: center, diameter: 6)
            arc.fillColor = nil
            arc.strokeColor = ink
            arc.lineWidth = 1.5
            arc.lineCap = .round
            arc.lineDashPattern = [10, 30]
            layer.addSublayer(arc)
            motion.play(.keyframes("transform.rotation.z", duration: timing.arc, [(0, 0), (1, 2 * .pi)], easing: .linear, repeats: true), on: arc)
        case .waiting:
            disc.fillColor = OverlayStyle.color(.needs)
            let dot = Layers.circle(center: center, diameter: 4)
            dot.fillColor = white
            layer.addSublayer(dot)
            motion.play(.keyframes("opacity", duration: timing.pulse, [(0, 1), (0.5, 0.35), (1, 1)], easing: .easeInOut, repeats: true), on: dot)
        case .permission:
            disc.fillColor = OverlayStyle.color(.needs)
            shape.path = questionMark(center: center)
        case .alert:
            disc.fillColor = OverlayStyle.color(.error)
            let path = CGMutablePath()
            path.addRoundedRect(in: CGRect(x: center.x - 0.75, y: center.y - 3.5, width: 1.5, height: 4.5), cornerWidth: 0.75, cornerHeight: 0.75)
            path.addEllipse(in: CGRect(x: center.x - 0.9, y: center.y + 2.6 - 0.9, width: 1.8, height: 1.8))
            shape.path = path
        case .paused:
            disc.fillColor = OverlayStyle.color(.paused)
            let path = CGMutablePath()
            for x in [center.x - 2.1, center.x + 0.5] {
                path.addRoundedRect(in: CGRect(x: x, y: center.y - 2.25, width: 1.6, height: 4.5), cornerWidth: 0.5, cornerHeight: 0.5)
            }
            shape.path = path
        case .done:
            disc.fillColor = OverlayStyle.color(.done)
            let check = CAShapeLayer()
            check.frame = layer.bounds
            let path = CGMutablePath()
            path.move(to: CGPoint(x: center.x - 2.7, y: center.y + 0.25))
            path.addLine(to: CGPoint(x: center.x - 0.8, y: center.y + 2.15))
            path.addLine(to: CGPoint(x: center.x + 2.9, y: center.y - 1.85))
            check.path = path
            check.fillColor = nil
            check.strokeColor = white
            check.lineWidth = 1.6
            check.lineCap = .round
            check.lineJoin = .round
            layer.addSublayer(check)
            let draw = timing.draw
            motion.run(.transition("strokeEnd", from: 0, to: 1, duration: draw.duration, easing: draw.easing, delay: timing.drawDelay), on: check)
        }
        return layer
    }

    /// A bold question mark centered in the disc; glyph outlines are y up.
    private static func questionMark(center: CGPoint) -> CGPath? {
        let font = NSFont.systemFont(ofSize: 9, weight: .bold)
        var glyph = CGGlyph()
        var character: UniChar = 0x3F
        CTFontGetGlyphsForCharacters(font, &character, &glyph, 1)
        var advance = CGSize.zero
        CTFontGetAdvancesForGlyphs(font, .horizontal, &glyph, &advance, 1)
        var transform = CGAffineTransform(translationX: center.x - advance.width / 2, y: center.y + 3.25).scaledBy(x: 1, y: -1)
        return CTFontCreatePathForGlyph(font, glyph, &transform)
    }
}
