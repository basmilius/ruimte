import ComputerUseCore
import CoreGraphics

/// How "working" looks: 3a is the default of the design.
public enum WorkingStyle: String, CaseIterable, Sendable {
    /// 3a: a drop with three dots.
    case dots
    /// 3b: a drop with a turning arc.
    case arc
    /// 3c: the arrow sways around its tip.
    case sway
}

/// The five motions of the dots of 3a. The cursor takes the next one each time it starts working, so it never looks stuck on a loop.
public enum DotMotion: String, CaseIterable, Sendable {
    case wave
    case fade
    case grow
    case orbit
    case gather

    public static func rotating(_ turn: Int) -> DotMotion {
        allCases[((turn % allCases.count) + allCases.count) % allCases.count]
    }
}

/// What sits inside the form.
public enum PhantomGlyph: Sendable {
    case question
    case check
    case dots
    case arc
    case pause
    case pulse
}

/// What the cursor draws around itself.
public enum PhantomEffect: Sendable {
    case ring(size: CGFloat)
    case halo
    case hoverRing
    case viewfinder
    case chevrons
    case card
}

/// How the form itself moves.
public enum PhantomShapeMotion: Sendable {
    case breathe
    case press
    case shake
    case sway
}

public enum PhantomLabelKind: Sendable {
    case text
    /// A dot that pulses, for a state that goes on until someone acts.
    case pulsing
    /// The words shine, and the dot pulses.
    case shining
    /// The typed text appears letter by letter behind a caret.
    case typed
}

/// The state table of the design: form, color, glyph, effect, motion and label of every state.
public struct PhantomLook: Sendable {
    public var form: PhantomForm
    public var tone: PhantomTone
    public var glyph: PhantomGlyph?
    public var effect: PhantomEffect?
    public var motion: PhantomShapeMotion?
    public var label: PhantomLabelKind?
    /// Hollow and a little smaller: present, but it touches nothing.
    public var ghost = false
    public var scale: CGFloat = 1
    public var fillOpacity: CGFloat = 1
    /// Fades out a while after it arrives.
    public var fades = false

    public static func of(_ state: PhantomState, working: WorkingStyle = .dots) -> PhantomLook {
        switch state {
        case .idle:
            return PhantomLook(form: .arrow, tone: .accent, motion: .breathe)
        case .move:
            return PhantomLook(form: .arrow, tone: .accent)
        case .hover:
            return PhantomLook(form: .arrow, tone: .accent, effect: .hoverRing, scale: OverlayStyle.Cursor.hoverScale)
        case .click:
            return PhantomLook(form: .arrow, tone: .accent, effect: .ring(size: OverlayStyle.Cursor.clickRing), motion: .press, label: .text)
        case .drag:
            return PhantomLook(form: .arrow, tone: .accent, effect: .card)
        case .type:
            return PhantomLook(form: .arrow, tone: .accent, label: .typed)
        case .scroll:
            return PhantomLook(form: .arrow, tone: .accent, effect: .chevrons, label: .text)
        case .look:
            return PhantomLook(form: .arrow, tone: .accent, effect: .viewfinder, label: .text)
        case .think:
            switch working {
            case .dots:
                return PhantomLook(form: .dot, tone: .accent, glyph: .dots, label: .shining)
            case .arc:
                return PhantomLook(form: .dot, tone: .accent, glyph: .arc, label: .shining)
            case .sway:
                return PhantomLook(form: .arrow, tone: .accent, motion: .sway, label: .shining)
            }
        case .waiting:
            return PhantomLook(form: .dot, tone: .needs, glyph: .pulse, effect: .halo, label: .pulsing)
        case .permission:
            return PhantomLook(form: .dot, tone: .needs, glyph: .question, label: .text)
        case .error:
            return PhantomLook(form: .arrow, tone: .error, motion: .shake, label: .text)
        case .done:
            return PhantomLook(form: .dot, tone: .done, glyph: .check, label: .text, fades: true)
        case .takeover:
            return PhantomLook(form: .arrow, tone: .muted, label: .text, ghost: true, scale: OverlayStyle.Cursor.takeoverScale)
        case .paused:
            return PhantomLook(form: .small, tone: .muted, glyph: .pause, label: .text)
        case .tap:
            return PhantomLook(form: .finger, tone: .accent, effect: .ring(size: OverlayStyle.Cursor.tapRing), label: .text, fillOpacity: OverlayStyle.Cursor.tapFillOpacity)
        }
    }

    /// The mini cursor of the session bar shows what the agent is, not each action it takes.
    public static func markState(_ state: PhantomState) -> PhantomState {
        switch state {
        case .move, .hover, .click, .drag, .type, .scroll, .look, .error:
            return .idle
        default:
            return state
        }
    }
}
