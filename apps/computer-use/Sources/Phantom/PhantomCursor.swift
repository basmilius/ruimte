import AppKit
import ComputerUseCore
import QuartzCore

/// Everything a state needs besides the state itself.
public struct PhantomScene {
    public var theme = PhantomTheme.light
    /// Replaces the accent of the theme, from `overlay.json`.
    public var accent: CGColor?
    /// The words of the label: the typed text for `type`, the name on the card for `drag`. Nil shows no label.
    public var label: String?
    public var scrollDirection = ScrollDirection.down
    /// What `look` frames, from the hotspot, y down. Nil puts the viewfinder where the design has it.
    public var viewfinder: CGRect?
    public var dots = DotMotion.wave
    public var working = WorkingStyle.dots
    /// The calm motion of the design: loops a half slower, morphs and moves without overshoot.
    public var calm = false
    /// False leaves out rings, halos and everything else around the form, for the mini cursors.
    public var effects = true
    /// The screen around the hotspot, y down, so the label flips at its edge.
    public var room: CGRect?

    public init() {}

    var loops: Double {
        calm ? OverlayStyle.Motion.calmLoops : 1
    }

    var morph: Timing {
        calm ? OverlayStyle.Motion.calmMorph : OverlayStyle.Motion.morph
    }
}

/// The phantom cursor as a layer tree, in a geometry-flipped superlayer so its numbers are the design's, y down.
/// `layer` has no size: its origin is the hotspot, so its position is the point the cursor points at.
@MainActor
public final class PhantomCursor {
    public let layer = CALayer()
    public private(set) var state: PhantomState?
    private let effects = CALayer()
    private let figure = Layers.cursorBox()
    private let pose = Layers.cursorBox()
    private let beat = Layers.cursorBox()
    private let turn = Layers.cursorBox()
    private let rim = CAShapeLayer()
    private let fill = CAShapeLayer()
    private var glyph: CALayer?
    private var label: CALayer?

    public init() {
        layer.anchorPoint = .zero
        layer.bounds = .zero
        effects.anchorPoint = .zero
        figure.position = .zero
        figure.shadowColor = CGColor(gray: 0, alpha: 1)
        figure.shadowOpacity = Float(OverlayStyle.Cursor.shadow.alpha)
        figure.shadowRadius = OverlayStyle.Cursor.shadow.blur / 2
        figure.shadowOffset = CGSize(width: 0, height: OverlayStyle.Cursor.shadow.y)
        for shape in [rim, fill] {
            shape.frame = CGRect(x: 0, y: 0, width: OverlayStyle.Cursor.box, height: OverlayStyle.Cursor.box)
            shape.lineJoin = .round
            shape.path = PhantomForm.arrow.path.cgPath
            turn.addSublayer(shape)
        }
        rim.fillColor = nil
        beat.addSublayer(turn)
        pose.addSublayer(beat)
        figure.addSublayer(pose)
        layer.addSublayer(effects)
        layer.addSublayer(figure)
    }

    /// Shows a state. `animated` morphs from the state before; without it the state stands as it would after its transitions.
    public func show(_ state: PhantomState, scene: PhantomScene, motion: MotionHost, animated: Bool) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer {
            CATransaction.commit()
        }
        let look = PhantomLook.of(state, working: scene.working)
        let palette = OverlayStyle.palette(scene.theme)
        let color = look.tone == .accent ? (scene.accent ?? palette.accent) : palette.color(look.tone)
        let transition = animated && self.state != nil && motion.moves

        applyForm(look, transition: transition, scene: scene, motion: motion)
        applyPaint(look, color: color, palette: palette, transition: transition, motion: motion)
        applyShapeMotion(look, scene: scene, transition: transition, motion: motion)
        applyGlyph(look, scene: scene, transition: transition, motion: motion)
        applyEffects(look, color: color, palette: palette, scene: scene, motion: motion)
        applyLabel(look, color: color, palette: palette, scene: scene, motion: motion)
        self.state = state
    }

    /// Starts the ring and the press of a click again, for a second click in the same state.
    public func replayClick(scene: PhantomScene, motion: MotionHost) {
        guard let state, state == .click || state == .tap else {
            return
        }
        let look = PhantomLook.of(state, working: scene.working)
        let palette = OverlayStyle.palette(scene.theme)
        let color = look.tone == .accent ? (scene.accent ?? palette.accent) : palette.color(look.tone)
        applyShapeMotion(look, scene: scene, transition: false, motion: motion)
        applyEffects(look, color: color, palette: palette, scene: scene, motion: motion)
    }

    private func applyForm(_ look: PhantomLook, transition: Bool, scene: PhantomScene, motion: MotionHost) {
        let target = look.form.path
        for shape in [rim, fill] {
            let current = (shape.presentation()?.path).flatMap(PhantomPath.init(cgPath:)) ?? shape.path.flatMap(PhantomPath.init(cgPath:))
            if transition, let current, current != target {
                let timing = scene.morph
                motion.run(Track(keyPath: "path", duration: timing.duration) { time in
                    PhantomPath.interpolate(current, target, timing.easing.progress(CGFloat(time / timing.duration))).cgPath
                }, on: shape)
            } else {
                shape.removeAnimation(forKey: "path")
                shape.path = target.cgPath
            }
        }
    }

    private func applyPaint(_ look: PhantomLook, color: CGColor, palette: PhantomPalette, transition: Bool, motion: MotionHost) {
        let style = OverlayStyle.Cursor.self
        let white = CGColor(gray: 1, alpha: 1)
        let timing = OverlayStyle.Motion.color
        let colors: [(CAShapeLayer, String, CGColor)] = [
            (rim, "strokeColor", look.ghost ? Layers.withAlpha(white, style.ghostRimOpacity) : white),
            (fill, "fillColor", look.ghost ? Layers.withAlpha(palette.surface, style.ghostFillOpacity) : Layers.withAlpha(color, look.fillOpacity)),
            (fill, "strokeColor", color),
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
        let widths: [(CAShapeLayer, CGFloat)] = [
            (rim, look.ghost ? style.ghostRimWidth : style.rimWidth),
            (fill, look.ghost ? style.ghostStrokeWidth : style.strokeWidth),
        ]
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

    private func applyShapeMotion(_ look: PhantomLook, scene: PhantomScene, transition: Bool, motion: MotionHost) {
        let timing = OverlayStyle.Motion.self
        let currentScale = (pose.presentation()?.value(forKeyPath: "transform.scale") as? NSNumber).map { CGFloat($0.doubleValue) } ?? 1
        if transition && abs(currentScale - look.scale) > 0.001 {
            motion.run(.transition("transform.scale", from: currentScale, to: look.scale, duration: timing.pose.duration, easing: timing.pose.easing), on: pose)
        } else {
            pose.removeAllAnimations()
            pose.transform = CATransform3DMakeScale(look.scale, look.scale, 1)
        }

        for layer in [beat, turn, figure] {
            layer.removeAllAnimations()
        }
        beat.transform = CATransform3DIdentity
        turn.transform = CATransform3DIdentity
        figure.opacity = 1
        let loops = scene.loops
        switch look.motion {
        case .breathe:
            motion.play(.keyframes("transform.scale", duration: timing.breathe * loops, [(0, 1), (0.5, 1.07), (1, 1)], easing: .easeInOut, repeats: true), on: beat)
        case .press:
            let total = timing.pressDown + 2 * timing.pressSpring
            motion.play(.keyframes("transform.scale", duration: total, [
                (0, 1),
                (CGFloat(timing.pressDown / total), timing.pressScale),
                (CGFloat((timing.pressDown + timing.pressSpring) / total), timing.pressOvershoot),
                (1, 1),
            ]), on: beat)
        case .shake:
            let frames: [CGFloat] = [0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.36, 1]
            let shifts: [CGFloat] = [0, -4, 4, -3, 2, 0, 0, 0]
            let angles: [CGFloat] = [0, -8, 6, -4, 2, 0, 0, 0]
            motion.play(.keyframes("transform.translation.x", duration: timing.shake * loops, Array(zip(frames, shifts)), repeats: true), on: beat)
            motion.play(.keyframes("transform.rotation.z", duration: timing.shake * loops, Array(zip(frames, angles.map { $0 * .pi / 180 })), repeats: true), on: turn)
        case .sway:
            let duration = scene.calm ? 2.4 : timing.sway
            motion.play(.keyframes("transform.rotation.z", duration: duration, [(0, -12 * .pi / 180), (0.5, 9 * .pi / 180), (1, -12 * .pi / 180)], easing: .easeInOut, repeats: true), on: turn)
        case nil:
            break
        }
        if look.fades {
            let delay = timing.doneFadeDelay
            let fade = timing.doneFade
            motion.play(Track(keyPath: "opacity", duration: delay + fade.duration) { time in
                NSNumber(value: Double(time < delay ? 1 : 1 - fade.easing.progress(CGFloat((time - delay) / fade.duration))))
            }, on: figure)
        }
    }

    private func applyGlyph(_ look: PhantomLook, scene: PhantomScene, transition: Bool, motion: MotionHost) {
        if let glyph {
            motion.retire(glyph, fade: transition ? OverlayStyle.Motion.glyphIn.duration : 0)
            self.glyph = nil
        }
        guard let kind = look.glyph else {
            return
        }
        let glyph = Layers.plain(CGRect(x: 0, y: 0, width: OverlayStyle.Cursor.box, height: OverlayStyle.Cursor.box))
        let white = CGColor(gray: 1, alpha: 1)
        let loops = scene.loops
        switch kind {
        case .question:
            glyph.addSublayer(Self.questionMark(color: white))
        case .check:
            let pop = Layers.plain(glyph.bounds)
            pop.anchorPoint = CGPoint(x: 12.5 / OverlayStyle.Cursor.box, y: 12.5 / OverlayStyle.Cursor.box)
            pop.position = CGPoint(x: 12.5, y: 12.5)
            let check = CAShapeLayer()
            check.frame = glyph.bounds
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 9.1, y: 12.8))
            path.addLine(to: CGPoint(x: 11.5, y: 15.2))
            path.addLine(to: CGPoint(x: 16.1, y: 10.2))
            check.path = path
            check.fillColor = nil
            check.strokeColor = white
            check.lineWidth = 2
            check.lineCap = .round
            check.lineJoin = .round
            pop.addSublayer(check)
            glyph.addSublayer(pop)
            // A dash of 12 over a check of 10.18 drawn from an offset of 12: the check shows once the offset is under 1.82.
            let length = hypot(2.4, 2.4) + hypot(4.6, 5.0)
            let draw = OverlayStyle.Motion.draw
            motion.run(Track(keyPath: "strokeEnd", duration: draw.duration, delay: OverlayStyle.Motion.drawDelay) { time in
                NSNumber(value: Double(min(1, 12 * draw.easing.progress(CGFloat(time / draw.duration)) / length)))
            }, on: check)
            let popTiming = OverlayStyle.Motion.pop
            motion.play(.keyframes("transform.scale", duration: popTiming.duration, [(0, 0), (0.6, 1.25), (1, 1)], easing: popTiming.easing, delay: OverlayStyle.Motion.glyphInDelay), on: pop)
        case .dots:
            glyph.addSublayer(Self.dots(scene.dots, motion: motion, loops: scene.calm ? 1.4 : 1))
        case .arc:
            let arc = Layers.circle(center: CGPoint(x: 12.5, y: 12.5), diameter: 6.6)
            arc.fillColor = nil
            arc.strokeColor = white
            arc.lineWidth = 1.8
            arc.lineCap = .round
            arc.lineDashPattern = [11, 30]
            glyph.addSublayer(arc)
            motion.play(.keyframes("transform.rotation.z", duration: OverlayStyle.Motion.arc, [(0, 0), (1, 2 * .pi)], easing: .linear, repeats: true), on: arc)
        case .pause:
            for x in [8.6, 11.2] {
                let bar = CAShapeLayer()
                bar.path = CGPath(roundedRect: CGRect(x: x, y: 8.5, width: 1.6, height: 4), cornerWidth: 0.5, cornerHeight: 0.5, transform: nil)
                bar.fillColor = white
                glyph.addSublayer(bar)
            }
        case .pulse:
            let dot = Layers.circle(center: CGPoint(x: 12.5, y: 12.5), diameter: 4)
            dot.fillColor = white
            glyph.addSublayer(dot)
            motion.play(.keyframes("opacity", duration: OverlayStyle.Motion.pulse * loops, [(0, 1), (0.5, 0.4), (1, 1)], easing: .easeInOut, repeats: true), on: dot)
        }
        turn.addSublayer(glyph)
        self.glyph = glyph
        let appear = OverlayStyle.Motion.glyphIn
        if transition {
            motion.run(.transition("opacity", from: 0, to: 1, duration: appear.duration, easing: appear.easing, delay: OverlayStyle.Motion.glyphInDelay), on: glyph)
        }
    }

    private func applyEffects(_ look: PhantomLook, color: CGColor, palette: PhantomPalette, scene: PhantomScene, motion: MotionHost) {
        effects.sublayers?.forEach { $0.removeFromSuperlayer() }
        guard scene.effects, let effect = look.effect else {
            return
        }
        let style = OverlayStyle.Cursor.self
        let timing = OverlayStyle.Motion.self
        let loops = scene.loops
        let center = style.dropCenter
        switch effect {
        case .ring(let size):
            let ring = Layers.ring(center: .zero, diameter: size, lineWidth: 2, color: color)
            ring.opacity = 0
            effects.addSublayer(ring)
            let peak = CGFloat(0.078 / timing.ring)
            motion.play(.keyframes("transform.scale", duration: timing.ring, [(0, 0.3), (1, 1)], easing: .easeOut), on: ring)
            motion.play(.keyframes("opacity", duration: timing.ring, [(0, 0), (peak, 0.9), (1, 0)], easing: .easeOut), on: ring)
        case .halo:
            for index in 0..<2 {
                let halo = Layers.circle(center: center, diameter: style.halo)
                halo.fillColor = color
                halo.opacity = 0
                effects.addSublayer(halo)
                let delay = Double(index) * timing.haloStagger * loops
                motion.play(.keyframes("transform.scale", duration: timing.halo * loops, [(0, 0.5), (1, 1.6)], easing: .easeOut, repeats: true, delay: delay), on: halo)
                motion.play(.keyframes("opacity", duration: timing.halo * loops, [(0, 0.55), (1, 0)], easing: .easeOut, repeats: true, delay: delay), on: halo)
            }
        case .hoverRing:
            let ring = Layers.circle(center: center, diameter: style.hoverRing)
            ring.fillColor = color
            ring.opacity = Float(style.hoverRingOpacity)
            effects.addSublayer(ring)
        case .viewfinder:
            effects.addSublayer(viewfinder(frame: scene.viewfinder ?? style.viewfinder, color: color, motion: motion, loops: loops))
        case .chevrons:
            effects.addSublayer(chevrons(direction: scene.scrollDirection, color: color, motion: motion, loops: loops))
        case .card:
            if let name = scene.label, !name.isEmpty {
                effects.addSublayer(card(name: name, color: color, palette: palette, motion: motion, loops: loops))
            }
        }
    }

    private func applyLabel(_ look: PhantomLook, color: CGColor, palette: PhantomPalette, scene: PhantomScene, motion: MotionHost) {
        label?.removeFromSuperlayer()
        label = nil
        guard let kind = look.label, let text = scene.label, !text.isEmpty else {
            return
        }
        let built = PhantomLabel.make(kind: kind, text: text, color: color, palette: palette, motion: motion)
        let placement = LabelPlacement.place(size: built.size, room: scene.room)
        let pill = built.layer
        // Grows out of the corner nearest the cursor.
        pill.anchorPoint = CGPoint(x: placement.flippedLeft ? 1 : 0, y: placement.flippedUp ? 1 : 0)
        pill.position = CGPoint(x: placement.origin.x + (placement.flippedLeft ? built.size.width : 0), y: placement.origin.y + (placement.flippedUp ? built.size.height : 0))
        layer.addSublayer(pill)
        label = pill
        let appear = OverlayStyle.Motion.label
        motion.play(.transition("opacity", from: 0, to: 1, duration: appear.duration, easing: appear.easing), on: pill)
        motion.play(.transition("transform.scale", from: OverlayStyle.Motion.labelScale, to: 1, duration: appear.duration, easing: appear.easing), on: pill)
    }

    /// The typed text shown so far is part of the label; a longer text builds a new one.
    public var labelFrame: CGRect? {
        label?.frame
    }

    private static func questionMark(color: CGColor) -> CALayer {
        let font = NSFont.systemFont(ofSize: 10, weight: .bold)
        var glyph = CGGlyph()
        var character: UniChar = 0x3F
        CTFontGetGlyphsForCharacters(font, &character, &glyph, 1)
        var advance = CGSize.zero
        CTFontGetAdvancesForGlyphs(font, .horizontal, &glyph, &advance, 1)
        // Glyph outlines are y up; the text sits on the baseline at 16.1 and centers on 12.5.
        var transform = CGAffineTransform(translationX: 12.5 - advance.width / 2, y: 16.1).scaledBy(x: 1, y: -1)
        let shape = CAShapeLayer()
        shape.frame = CGRect(x: 0, y: 0, width: OverlayStyle.Cursor.box, height: OverlayStyle.Cursor.box)
        shape.path = CTFontCreatePathForGlyph(font, glyph, &transform)
        shape.fillColor = color
        return shape
    }

    private static func dots(_ kind: DotMotion, motion: MotionHost, loops: Double) -> CALayer {
        let group = Layers.plain(CGRect(x: 0, y: 0, width: OverlayStyle.Cursor.box, height: OverlayStyle.Cursor.box))
        let make = { (center: CGPoint) -> CAShapeLayer in
            let dot = Layers.circle(center: center, diameter: 2.7)
            dot.fillColor = CGColor(gray: 1, alpha: 1)
            group.addSublayer(dot)
            return dot
        }
        let xs: [CGFloat] = [9.3, 12.5, 15.7]
        switch kind {
        case .orbit:
            let middle = CGPoint(x: 12.5, y: 12.8)
            for (index, degrees) in [0.0, 120.0, 240.0].enumerated() {
                let radians = degrees * .pi / 180
                let dot = make(CGPoint(x: middle.x + cos(radians) * 3, y: middle.y + sin(radians) * 3))
                dot.opacity = Float(1 - Double(index) * 0.25)
            }
            group.anchorPoint = CGPoint(x: middle.x / OverlayStyle.Cursor.box, y: middle.y / OverlayStyle.Cursor.box)
            group.position = middle
            motion.play(.keyframes("transform.rotation.z", duration: 1.4 * loops, [(0, 0), (1, 2 * .pi)], easing: .cubic(0.5, 0.1, 0.5, 0.9), repeats: true), on: group)
        case .gather:
            let easing = Easing.cubic(0.34, 1.56, 0.64, 1)
            let offsets: [CGFloat] = [0, 0.15, 0.45, 0.6, 1]
            let dots = xs.map { make(CGPoint(x: $0, y: 12.8)) }
            motion.play(.keyframes("transform.translation.x", duration: 1.6 * loops, Array(zip(offsets, [0, 0, 3.2, 3.2, 0])), easing: easing, repeats: true), on: dots[0])
            motion.play(.keyframes("transform.scale", duration: 1.6 * loops, Array(zip(offsets, [1, 1, 1.5, 1.5, 1])), easing: easing, repeats: true), on: dots[1])
            motion.play(.keyframes("transform.translation.x", duration: 1.6 * loops, Array(zip(offsets, [0, 0, -3.2, -3.2, 0])), easing: easing, repeats: true), on: dots[2])
        case .wave:
            for (index, x) in xs.enumerated() {
                let dot = make(CGPoint(x: x, y: 12.8))
                let delay = Double(index) * 0.15 * loops
                motion.play(.keyframes("transform.translation.y", duration: 1.1 * loops, [(0, 0), (0.3, -1.6), (0.6, 0), (1, 0)], easing: .easeInOut, repeats: true, delay: delay), on: dot)
                motion.play(.keyframes("opacity", duration: 1.1 * loops, [(0, 0.55), (0.3, 1), (0.6, 0.55), (1, 0.55)], easing: .easeInOut, repeats: true, delay: delay), on: dot)
            }
        case .fade:
            for (index, x) in xs.enumerated() {
                let dot = make(CGPoint(x: x, y: 12.8))
                motion.play(.keyframes("opacity", duration: 1.2 * loops, [(0, 0.3), (0.4, 1), (1, 0.3)], easing: .easeInOut, repeats: true, delay: Double(index) * 0.2 * loops), on: dot)
            }
        case .grow:
            for (index, x) in xs.enumerated() {
                let dot = make(CGPoint(x: x, y: 12.8))
                motion.play(.keyframes("transform.scale", duration: 1.2 * loops, [(0, 0.55), (0.45, 1.25), (1, 0.55)], easing: .easeInOut, repeats: true, delay: Double(index) * 0.18 * loops), on: dot)
            }
        }
        return group
    }

    private func viewfinder(frame: CGRect, color: CGColor, motion: MotionHost, loops: Double) -> CALayer {
        let style = OverlayStyle.Cursor.self
        let finder = Layers.plain(frame)
        let flash = Layers.plain(finder.bounds)
        flash.backgroundColor = CGColor(gray: 1, alpha: 1)
        flash.cornerRadius = 6
        flash.opacity = 0
        finder.addSublayer(flash)
        let corner = style.viewfinderCorner
        let line = style.viewfinderLine
        let inset = line / 2
        let radius: CGFloat = 3 - inset
        let bracket = CGMutablePath()
        bracket.move(to: CGPoint(x: inset, y: corner))
        bracket.addArc(tangent1End: CGPoint(x: inset, y: inset), tangent2End: CGPoint(x: corner, y: inset), radius: radius)
        bracket.addLine(to: CGPoint(x: corner, y: inset))
        let placements: [(CGPoint, CGFloat)] = [
            (CGPoint(x: 0, y: 0), 0),
            (CGPoint(x: frame.width, y: 0), .pi / 2),
            (CGPoint(x: frame.width, y: frame.height), .pi),
            (CGPoint(x: 0, y: frame.height), -.pi / 2),
        ]
        for (origin, angle) in placements {
            let shape = CAShapeLayer()
            var transform = CGAffineTransform(translationX: origin.x, y: origin.y).rotated(by: angle)
            shape.path = bracket.copy(using: &transform)
            shape.fillColor = nil
            shape.strokeColor = color
            shape.lineWidth = line
            finder.addSublayer(shape)
        }
        let duration = OverlayStyle.Motion.view * loops
        motion.play(.keyframes("opacity", duration: duration, [(0, 0), (0.18, 1), (0.8, 1), (1, 0)], easing: .easeOut, repeats: true), on: finder)
        motion.play(.keyframes("transform.scale", duration: duration, [(0, 1.18), (0.18, 1), (1, 1)], easing: .easeOut, repeats: true), on: finder)
        motion.play(.keyframes("opacity", duration: duration, [(0, 0), (0.55, 0), (0.6, 0.5), (0.75, 0), (1, 0)], easing: .linear, repeats: true), on: flash)
        return finder
    }

    private func chevrons(direction: ScrollDirection, color: CGColor, motion: MotionHost, loops: Double) -> CALayer {
        let group = Layers.plain(CGRect(x: 0, y: 24, width: 14, height: 17))
        let angles: [ScrollDirection: CGFloat] = [.down: 0, .up: .pi, .left: .pi / 2, .right: -.pi / 2]
        group.setValue(angles[direction] ?? 0, forKeyPath: "transform.rotation.z")
        for (index, top) in [CGFloat(0), 8].enumerated() {
            let chevron = CAShapeLayer()
            chevron.frame = CGRect(x: 0, y: top, width: 14, height: 9)
            let path = CGMutablePath()
            path.addLines(between: [CGPoint(x: 2, y: 2), CGPoint(x: 7, y: 7), CGPoint(x: 12, y: 2)])
            chevron.path = path
            chevron.fillColor = nil
            chevron.strokeColor = color
            chevron.lineWidth = 2.4
            chevron.lineCap = .round
            chevron.lineJoin = .round
            chevron.opacity = 0
            group.addSublayer(chevron)
            let delay = Double(index) * OverlayStyle.Motion.scrollStagger * loops
            let duration = OverlayStyle.Motion.scroll * loops
            motion.play(.keyframes("transform.translation.y", duration: duration, [(0, -4), (1, 4)], easing: .easeInOut, repeats: true, delay: delay), on: chevron)
            motion.play(.keyframes("opacity", duration: duration, [(0, 0), (0.5, 1), (1, 0)], easing: .easeInOut, repeats: true, delay: delay), on: chevron)
            if !motion.moves {
                chevron.opacity = 1
            }
        }
        return group
    }

    private func card(name: String, color: CGColor, palette: PhantomPalette, motion: MotionHost, loops: Double) -> CALayer {
        let font = Layers.font(size: 14)
        let width = 6 + 18 + 8 + Layers.textWidth(name, font: font) + 10 + 2
        let height: CGFloat = 34
        let surface = Layers.surface(size: CGSize(width: width, height: height), radius: 8, fill: palette.raised, border: palette.border, shadow: palette.floatShadow)
        let card = surface.root
        card.anchorPoint = .zero
        card.position = CGPoint(x: 14, y: 16)
        let icon = Layers.plain(CGRect(x: 7, y: (height - 22) / 2, width: 18, height: 22))
        icon.cornerRadius = 3
        icon.backgroundColor = Layers.withAlpha(color, 0.18)
        card.addSublayer(icon)
        card.addSublayer(Layers.text(name, font: font, color: palette.text, origin: CGPoint(x: 7 + 18 + 8, y: (height - 20) / 2), lineHeight: 20))
        motion.play(.keyframes("transform.rotation.z", duration: OverlayStyle.Motion.drag * loops, [(0, -5 * .pi / 180), (0.5, 3 * .pi / 180), (1, -5 * .pi / 180)], easing: .easeInOut, repeats: true), on: card)
        return card
    }
}
