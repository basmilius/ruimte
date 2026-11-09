import ComputerUseCore
import CoreGraphics

/// How "working" looks: three dots in the drop, or a turning arc.
public enum WorkingStyle: String, CaseIterable, Sendable {
    case dots
    case arc
}

/// What sits inside the form.
public enum PhantomGlyph: Sendable {
    case check
    case handLines
}

/// A sign beside the arrow, grown out of its notch.
public enum PhantomMark: Hashable, Sendable {
    /// Four white rounded corners that focus from outside in.
    case look
    /// A white wheel with a dot that runs the way it scrolls.
    case scroll
    /// A disc with a sign in it: white for working, in its tone for the rest.
    case disc(PhantomDisc)
}

public enum PhantomDisc: String, Sendable {
    /// White, with dark dots that wave.
    case dots
    /// White, with a dark arc that turns.
    case arc
    /// Amber, with a white dot that pulses.
    case waiting
    /// Amber, with a white question mark.
    case permission
    /// Red, with a white exclamation mark.
    case alert
    /// Gray, with two white bars.
    case paused
}

/// How the form itself moves.
public enum PhantomBeat: Sendable {
    case press
    case nudge
    /// The text cursor steps on, as letters that appear.
    case typing
    case fade
}

/// The state table of the design (8a): form, sign color, glyph, mark, ring and motion of every state.
public struct PhantomLook: Sendable {
    public var form: PhantomForm
    /// The color of the glyph or mark; nil is white.
    public var tone: PhantomTone?
    public var glyph: PhantomGlyph?
    public var mark: PhantomMark?
    /// The radius of the white ring around the hotspot.
    public var ring: CGFloat?
    public var beat: PhantomBeat?
    /// The hand drifts to and fro, as something being dragged.
    public var drift = false
    /// Hollow and a little smaller: present, but it touches nothing.
    public var ghost = false
    public var scale: CGFloat = 1
    public var fillOpacity: CGFloat = 1
    public var rimWidth = OverlayStyle.Cursor.rimWidth

    public static func of(_ state: PhantomState, working: WorkingStyle = .dots) -> PhantomLook {
        let style = OverlayStyle.Cursor.self
        switch state {
        case .idle, .move:
            return PhantomLook(form: .arrow)
        case .hover:
            return PhantomLook(form: .arrow, scale: style.hoverScale)
        case .click:
            return PhantomLook(form: .arrow, ring: style.clickRing, beat: .press)
        case .drag:
            return PhantomLook(form: .hand, glyph: .handLines, drift: true, rimWidth: style.handRimWidth)
        case .type:
            return PhantomLook(form: .beam, beat: .typing, rimWidth: style.beamRimWidth)
        case .scroll:
            return PhantomLook(form: .arrow, mark: .scroll)
        case .look:
            return PhantomLook(form: .arrow, mark: .look)
        case .think:
            return PhantomLook(form: .arrow, mark: .disc(working == .arc ? .arc : .dots))
        case .waiting:
            return PhantomLook(form: .arrow, tone: .needs, mark: .disc(.waiting))
        case .permission:
            return PhantomLook(form: .arrow, tone: .needs, mark: .disc(.permission))
        case .error:
            return PhantomLook(form: .arrow, tone: .error, mark: .disc(.alert), beat: .nudge)
        case .done:
            return PhantomLook(form: .dot, tone: .done, glyph: .check, beat: .fade)
        case .takeover:
            return PhantomLook(form: .arrow, ghost: true, scale: style.takeoverScale, rimWidth: style.rimWidth * style.ghostRimScale)
        case .paused:
            return PhantomLook(form: .arrow, tone: .paused, mark: .disc(.paused))
        case .tap:
            return PhantomLook(form: .finger, ring: style.tapRing, fillOpacity: style.tapFillOpacity)
        }
    }

    /// The cursor in the menu's head shows what the agent is, not each action it takes.
    public static func markState(_ state: PhantomState) -> PhantomState {
        switch state {
        case .move, .hover, .click, .drag, .type, .scroll, .look, .error:
            return .idle
        default:
            return state
        }
    }
}
