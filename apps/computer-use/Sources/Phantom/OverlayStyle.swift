import AppKit
import QuartzCore

/// The look of the overlay: tokens per theme, sizes, durations and easings, named as the design names them.
/// The forms are in `PhantomForms.swift` and which state wears what in `PhantomLook.swift`; the words come from
/// `OverlayConfig`, which the daemon writes.
public enum OverlayStyle {
    /// The overlay draws outside the web view, so it holds the design's literal colors instead of reading tokens.
    public static func palette(_ theme: PhantomTheme) -> PhantomPalette {
        switch theme {
        case .light:
            return PhantomPalette(
                surface: .hex(0xFFFFFF), raised: .hex(0xFFFFFF), sunken: .hex(0xECECEF), hover: .hex(0xF3F3F5),
                border: .hex(0x000000, alpha: 0.11), text: .hex(0x18181B), muted: .hex(0x6F6F78), faint: .hex(0xA1A1AA),
                accent: .hex(0x155DFC), needs: .hex(0xD97706), error: .hex(0xDC2626), done: .hex(0x16A34A),
                canvas: .hex(0xEEEEF1), canvasDot: .hex(0xCFCFD6), wall: .hex(0xE4E4E9),
                floatShadow: [
                    ShadowStep(y: 1, blur: 2, spread: -1, alpha: 0.08),
                    ShadowStep(y: 3, blur: 6, spread: -2, alpha: 0.07),
                    ShadowStep(y: 8, blur: 16, spread: -8, alpha: 0.1),
                    ShadowStep(y: 16, blur: 28, spread: -14, alpha: 0.1),
                ]
            )
        case .dark:
            return PhantomPalette(
                surface: .hex(0x131316), raised: .hex(0x18181C), sunken: .hex(0x08080A), hover: .hex(0x202024),
                border: .hex(0xFFFFFF, alpha: 0.07), text: .hex(0xECECF1), muted: .hex(0x9A9AA6), faint: .hex(0x5F5F6B),
                accent: .hex(0x155DFC), needs: .hex(0xFBBF24), error: .hex(0xEF4444), done: .hex(0x4ADE80),
                canvas: .hex(0x0D0D10), canvasDot: .hex(0x202024), wall: .hex(0x1A1A1F),
                floatShadow: [
                    ShadowStep(y: 1, blur: 2, spread: -1, alpha: 0.3),
                    ShadowStep(y: 2, blur: 4, spread: 0, alpha: 0.24),
                    ShadowStep(y: 4, blur: 8, spread: 0, alpha: 0.18),
                    ShadowStep(y: 6, blur: 12, spread: 0, alpha: 0.1),
                ]
            )
        }
    }

    public enum Cursor {
        public static let box: CGFloat = 24
        public static let hotspot = CGPoint(x: 4, y: 3.5)
        /// The middle of the drop, from the hotspot: where the halo and the hover ring sit.
        public static let dropCenter = CGPoint(x: 8.5, y: 9)
        public static let rimWidth: CGFloat = 7
        public static let strokeWidth: CGFloat = 2
        public static let ghostRimWidth: CGFloat = 5
        public static let ghostRimOpacity: CGFloat = 0.7
        public static let ghostStrokeWidth: CGFloat = 1.5
        public static let ghostFillOpacity: CGFloat = 0.55
        public static let tapFillOpacity: CGFloat = 0.5
        public static let hoverScale: CGFloat = 1.12
        public static let takeoverScale: CGFloat = 0.86
        /// `drop-shadow(0 1px 1.5px rgb(0 0 0 / .3))`; a CSS blur is twice the radius Core Animation takes.
        public static let shadow = ShadowStep(y: 1, blur: 1.5, spread: 0, alpha: 0.3)
        public static let clickRing: CGFloat = 36
        public static let tapRing: CGFloat = 56
        public static let halo: CGFloat = 44
        public static let hoverRing: CGFloat = 38
        public static let hoverRingOpacity: CGFloat = 0.14
        /// Where the viewfinder of `look` sits when the helper has no captured frame to put it around.
        public static let viewfinder = CGRect(x: 22, y: 50, width: 150, height: 96)
        public static let viewfinderCorner: CGFloat = 16
        public static let viewfinderLine: CGFloat = 2.5
    }

    public enum Label {
        public static let height: CGFloat = 26
        public static let padding: CGFloat = 9
        public static let gap: CGFloat = 6
        public static let dot: CGFloat = 8
        /// `text-xs` of the client.
        public static let fontSize: CGFloat = 14
        public static let lineHeight: CGFloat = 20
        public static let typedFontSize: CGFloat = 13
        public static let caretWidth: CGFloat = 1.5
        public static let caretHeight: CGFloat = 15
        /// From the hotspot to the top-left corner of the label.
        public static let offset = CGPoint(x: 18, y: 20)
        /// Kept free between the label and the edge of the screen before it flips.
        public static let edgeMargin: CGFloat = 8
        /// A long text keeps its end in view.
        public static let maxTypedCharacters = 32
    }

    public enum Bar {
        public static let height: CGFloat = 36
        public static let cornerRadius: CGFloat = 10
        public static let leadingPadding: CGFloat = 10
        public static let trailingPadding: CGFloat = 4
        public static let gap: CGFloat = 8
        public static let fontSize: CGFloat = 14
        public static let timeMinWidth: CGFloat = 38
        public static let button: CGFloat = 28
        public static let buttonRadius: CGFloat = 8
        public static let buttonGap: CGFloat = 2
        public static let icon: CGFloat = 14
        public static let mark: CGFloat = 14
        public static let markScale: CGFloat = 0.5
        /// Where the hotspot of the mini cursor sits inside the mark.
        public static let markHotspot = CGPoint(x: 2, y: 1)
        /// Below the menu bar.
        public static let topMargin: CGFloat = 12
    }

    public enum MenuBar {
        public static let mark = CGSize(width: 18, height: 16)
        public static let markScale: CGFloat = 0.55
        public static let markHotspot = CGPoint(x: 3, y: 2)
    }

    public enum Motion {
        public static let morph = Timing(duration: 0.46, easing: .cubic(0.34, 1.56, 0.64, 1))
        // No overshoot, unlike the design: a pointer that springs past its target reads as a slip, not a hand.
        public static let move = Timing(duration: 0.7, easing: .cubic(0.4, 0, 0.2, 1))
        /// The scale of hover and take over.
        public static let pose = Timing(duration: 0.22, easing: .cubic(0.34, 1.56, 0.64, 1))
        public static let color = Timing(duration: 0.2, easing: .ease)
        public static let glyphIn = Timing(duration: 0.18, easing: .ease)
        public static let glyphInDelay: Double = 0.2
        public static let label = Timing(duration: 0.12, easing: .easeOut)
        public static let labelScale: CGFloat = 0.96
        /// Press to 0.8, spring back past 1 to 1.08, settle.
        public static let pressDown: Double = 0.08
        public static let pressSpring: Double = 0.13
        public static let pressScale: CGFloat = 0.8
        public static let pressOvershoot: CGFloat = 1.08
        public static let ring: Double = 0.55
        public static let pop = Timing(duration: 0.36, easing: .ease)
        public static let draw = Timing(duration: 0.32, easing: .easeOut)
        public static let drawDelay: Double = 0.26
        public static let doneFadeDelay: Double = 1.2
        public static let doneFade = Timing(duration: 0.3, easing: .ease)
        public static let breathe: Double = 2.4
        public static let shake: Double = 1.8
        public static let halo: Double = 1.8
        public static let haloStagger: Double = 0.9
        public static let pulse: Double = 1.4
        public static let scroll: Double = 0.9
        public static let scrollStagger: Double = 0.15
        public static let view: Double = 2.2
        public static let drag: Double = 1.6
        public static let sway: Double = 1.6
        public static let arc: Double = 0.9
        public static let shine: Double = 1.6
        public static let caret: Double = 1
        /// Per letter of the label of `type`; the design takes 70 percent of 2.4 s for 19 letters.
        public static let typedLetter: Double = 0.088
        /// How long an action state stays after its action before the cursor rests again.
        public static let actionHold: Double = 1.2
        /// Calm motion stretches every loop by this much.
        public static let calmLoops: Double = 1.5
        public static let calmMorph = Timing(duration: 0.32, easing: .cubic(0.2, 0, 0, 1))
        public static let calmMove = Timing(duration: 0.52, easing: .cubic(0.2, 0, 0, 1))
    }
}

public enum PhantomTheme: String, CaseIterable, Sendable {
    case light
    case dark

    @MainActor
    public static func current(_ appearance: NSAppearance) -> PhantomTheme {
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .dark : .light
    }
}

/// The state colors of the design: accent for work, needs you, error, done and muted for the person's turn.
public enum PhantomTone: String, Sendable {
    case accent
    case needs
    case error
    case done
    case muted
}

public struct PhantomPalette {
    public var surface: CGColor
    public var raised: CGColor
    public var sunken: CGColor
    public var hover: CGColor
    public var border: CGColor
    public var text: CGColor
    public var muted: CGColor
    public var faint: CGColor
    public var accent: CGColor
    public var needs: CGColor
    public var error: CGColor
    public var done: CGColor
    /// The ground of the renders, not of the overlay.
    public var canvas: CGColor
    public var canvasDot: CGColor
    public var wall: CGColor
    public var floatShadow: [ShadowStep]

    public func color(_ tone: PhantomTone) -> CGColor {
        switch tone {
        case .accent:
            return accent
        case .needs:
            return needs
        case .error:
            return error
        case .done:
            return done
        case .muted:
            return muted
        }
    }
}

/// One layer of a CSS box shadow.
public struct ShadowStep: Sendable {
    public var y: CGFloat
    public var blur: CGFloat
    public var spread: CGFloat
    public var alpha: CGFloat
}

public struct Timing: Sendable {
    public var duration: Double
    public var easing: Easing
}

extension CGColor {
    static func hex(_ value: UInt32, alpha: CGFloat = 1) -> CGColor {
        CGColor(
            srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: alpha
        )
    }
}
