import AppKit
import QuartzCore

/// The look of the overlay (8a and 9a of the design): colors, sizes, durations and easings, named as the design
/// names them. The forms are in `PhantomForms.swift` and which state wears what in `PhantomLook.swift`.
public enum OverlayStyle {
    /// One look on every ground, as the system's own pointer: graphite with a white rim, color only in the signs.
    public enum Ink {
        public static var fill: CGColor {
            .hex(0x1D1D1F)
        }

        public static var white: CGColor {
            CGColor(gray: 1, alpha: 1)
        }

        public static var ghostFill: CGColor {
            CGColor(gray: 1, alpha: 0.55)
        }

        public static var ghostStroke: CGColor {
            .hex(0x1D1D1F, alpha: 0.55)
        }

        public static var ghostRim: CGColor {
            CGColor(gray: 1, alpha: 0.7)
        }
    }

    public static func color(_ tone: PhantomTone) -> CGColor {
        switch tone {
        case .needs:
            return .hex(0xF59E0B)
        case .error:
            return .hex(0xE5484D)
        case .done:
            return .hex(0x30A46C)
        case .paused:
            return .hex(0x8E8E93)
        case .working:
            return .hex(0x155DFC)
        }
    }

    public enum Cursor {
        public static let box: CGFloat = 24
        public static let hotspot = CGPoint(x: 4, y: 3.5)
        /// 3 points outside the outline.
        public static let rimWidth: CGFloat = 6
        public static let handRimWidth: CGFloat = 4
        public static let beamRimWidth: CGFloat = 3.2
        public static let strokeWidth: CGFloat = 1
        public static let ghostRimScale: CGFloat = 0.7
        public static let tapFillOpacity: CGFloat = 0.45
        public static let hoverScale: CGFloat = 1.08
        public static let takeoverScale: CGFloat = 0.86
        /// `drop-shadow(0 .5px .8px rgb(0 0 0 / .35))`; a CSS blur is twice the radius Core Animation takes.
        public static let shadow = ShadowStep(y: 0.5, blur: 0.8, alpha: 0.35)
        /// Radii of the white ring around the hotspot.
        public static let clickRing: CGFloat = 13
        public static let tapRing: CGFloat = 19
        public static let ringLine: CGFloat = 1.6
        public static let handLine: CGFloat = 0.75
        public static let handLineOpacity: CGFloat = 0.85
    }

    /// The white signs beside the arrow, placed from its notch along the line from the tip through it.
    public enum Mark {
        public static let notch = CGPoint(x: 13.5, y: 13.5)
        /// From the notch to the nearest edge of a sign.
        public static let clearance: CGFloat = 6.5
        public static let shadow = ShadowStep(y: 0.7, blur: 1.3, alpha: 0.32)
        public static let lookFrame = CGSize(width: 20, height: 14)
        public static let lookRadius: CGFloat = 3
        public static let lookArm: CGFloat = 4.4
        public static let lookBend: CGFloat = 2.2
        public static let lookLine: CGFloat = 1.8
        public static let wheel = CGSize(width: 8, height: 13)
        public static let wheelDot: CGFloat = 1.25
        public static let wheelDotOpacity: CGFloat = 0.8
        public static let wheelTravel: CGFloat = 5.6
        /// A little larger than the design's 6, by Bas's choice (2026-11-09).
        public static let discRadius: CGFloat = 7

        static var tail: CGPoint {
            let hotspot = Cursor.hotspot
            let length = hypot(notch.x - hotspot.x, notch.y - hotspot.y)
            return CGPoint(x: (notch.x - hotspot.x) / length, y: (notch.y - hotspot.y) / length)
        }

        /// The frame of a sign whose corner circle has `radius`: its center sits on the tail, so the sign's nearest
        /// point is `clearance` from the notch.
        public static func place(_ size: CGSize, radius: CGFloat) -> CGRect {
            let reach = clearance + radius
            return CGRect(x: notch.x + tail.x * reach - radius, y: notch.y + tail.y * reach - radius, width: size.width, height: size.height)
        }
    }

    public enum Motion {
        /// The system's smooth curve.
        public static let smooth = Easing.cubic(0.32, 0.72, 0, 1)
        public static let morph = Timing(duration: 0.38, easing: smooth)
        /// The scale of hover and take over.
        public static let pose = Timing(duration: 0.22, easing: .cubic(0.2, 0, 0, 1))
        public static let color = Timing(duration: 0.2, easing: .ease)
        public static let glyphIn = Timing(duration: 0.18, easing: .ease)
        public static let glyphInDelay: Double = 0.15
        public static let press: Double = 0.5
        public static let pressScale: CGFloat = 0.9
        public static let ring: Double = 0.6
        public static let ringScale: CGFloat = 0.45
        public static let nudge: Double = 0.45
        public static let typing: Double = 2
        public static let typingStep: CGFloat = 1.4
        public static let drift: Double = 1.8
        public static let driftReach = CGPoint(x: 10, y: 4)
        public static let markIn: Double = 0.34
        public static let markInScale: CGFloat = 0.6
        public static let focusIn: Double = 0.5
        public static let focusInScale: CGFloat = 1.3
        public static let markOut = Timing(duration: 0.2, easing: .cubic(0.4, 0, 1, 1))
        public static let markOutScale: CGFloat = 0.7
        public static let wheel: Double = 2.2
        public static let wave: Double = 2
        public static let waveStagger: Double = 0.2
        public static let arc: Double = 1.6
        public static let pulse: Double = 2.8
        public static let draw = Timing(duration: 0.32, easing: .easeOut)
        public static let drawDelay: Double = 0.26
        /// Done holds for 70 percent of this, then fades out.
        public static let doneFade: Double = 2.4
        /// How long an action state stays after its action before the cursor rests again.
        public static let actionHold: Double = 1.2
    }

    /// The grounds of the renders, which the overlay itself never draws.
    public static func ground(_ theme: PhantomTheme) -> PhantomGround {
        switch theme {
        case .light:
            return PhantomGround(canvas: .hex(0xEEEEF1), canvasDot: .hex(0xCFCFD6), wall: .hex(0xE4E4E9), surface: .hex(0xFFFFFF), text: .hex(0x18181B))
        case .dark:
            return PhantomGround(canvas: .hex(0x0D0D10), canvasDot: .hex(0x202024), wall: .hex(0x1A1A1F), surface: .hex(0x131316), text: .hex(0xECECF1))
        }
    }
}

public enum PhantomTheme: String, CaseIterable, Sendable {
    case light
    case dark
}

/// The colors of the signs: Ruimte's blue while it thinks, needs you (waiting and permission), error, done and
/// paused. Paused is gray, so it never reads as working or as a call for the person.
public enum PhantomTone: String, Sendable {
    case working
    case needs
    case error
    case done
    case paused
}

public struct PhantomGround {
    public var canvas: CGColor
    public var canvasDot: CGColor
    public var wall: CGColor
    public var surface: CGColor
    public var text: CGColor
}

/// One CSS drop shadow.
public struct ShadowStep: Sendable {
    public var y: CGFloat
    public var blur: CGFloat
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
