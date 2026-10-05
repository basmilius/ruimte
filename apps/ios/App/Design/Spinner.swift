import SwiftUI

/// Work in progress as the desktop draws it: three dots that leap over each other, in the foreground style around
/// them, on the steps of an icon (12, 14, 16 or 20). With Reduce Motion they stand still.
struct Spinner: View {
    var size: CGFloat = 16
    /// What runs, read by VoiceOver. Left out where the words beside it already say so, which hides the spinner.
    var label: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    var body: some View {
        let motion = SpinnerMotion(size: size)
        TimelineView(.animation(paused: reduceMotion || !visible || scenePhase != .active)) { context in
            let time = reduceMotion ? nil : context.date.timeIntervalSinceReferenceDate
            Canvas { graphics, _ in
                for step in 0..<3 {
                    let center = motion.center(of: step, at: time)
                    let dot = CGRect(
                        x: center.x - motion.dot / 2, y: center.y - motion.dot / 2, width: motion.dot,
                        height: motion.dot)
                    graphics.fill(Path(ellipseIn: dot), with: .foreground)
                }
            }
        }
        .frame(width: size, height: size)
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .accessibilityElement()
        .accessibilityLabel(label ?? "")
        .accessibilityAddTraits(.isImage)
        .accessibilityHidden(label == nil)
    }
}

/// The geometry and timing of the desktop's `.spinner` in `@adecore/ui/theme.css`, in points for its
/// pixels. That spinner is Leap from loading-dev (https://github.com/jakubkrehel/loading), MIT, Copyright (c) 2026
/// Jakub Krehel. Each dot turns half a circle over the other two around the middle of its hop, then slides back one
/// gap at a time; the three are a third of a cycle apart, so at every moment one dot is in the air.
struct SpinnerMotion: Equatable {
    static let duration: TimeInterval = 1.8

    let size: CGFloat
    let dot: CGFloat
    let gap: CGFloat
    /// The left edge of the hop, the span one dot crosses.
    let left: CGFloat
    let top: CGFloat

    init(size: CGFloat) {
        self.size = size
        dot = (size * 0.22).rounded()
        gap = ((size - dot) / 2).rounded(.down)
        left = size - dot - gap * 2
        top = ((size - dot) / 2).rounded()
    }

    /// Where dot `step` (0, 1 or 2) has its center `time` seconds into the clock, or at rest without a time.
    func center(of step: Int, at time: TimeInterval?) -> CGPoint {
        let middle = CGPoint(x: left + gap + dot / 2, y: top + dot / 2)
        guard let time else {
            return CGPoint(x: left + dot / 2 + CGFloat(step) * gap, y: middle.y)
        }
        let (turn, shift) = keyframe(Self.phase(of: step, at: time))
        // A clockwise turn in a frame whose y points down, so the dot arcs over the top.
        let angle = turn * .pi
        return CGPoint(x: middle.x - gap * cos(angle) + shift, y: middle.y - gap * sin(angle))
    }

    /// How far into its cycle dot `step` is, from 0 to 1. CSS starts each with a negative delay of `(step - 3) / 3`.
    static func phase(of step: Int, at time: TimeInterval) -> Double {
        let cycle = time / duration + Double(3 - step) / 3
        return cycle - cycle.rounded(.down)
    }

    /// The half turn done (0 to 1) and the slide back (0 to minus two gaps) at `phase`, eased per stretch as CSS eases
    /// between keyframes.
    func keyframe(_ phase: Double) -> (turn: Double, shift: CGFloat) {
        let landed = 0.3333
        let halfway = 0.6666
        if phase < landed {
            return (Self.easeInOut(phase / landed), 0)
        }
        if phase < halfway {
            return (1, -gap * Self.easeInOut((phase - landed) / (halfway - landed)))
        }
        return (1, -gap - gap * Self.easeInOut((phase - halfway) / (1 - halfway)))
    }

    /// CSS `ease-in-out`, `cubic-bezier(0.42, 0, 0.58, 1)`.
    static func easeInOut(_ progress: Double) -> Double {
        let clamped = min(1, max(0, progress))
        let bezier = { (along: Double, first: Double, second: Double) -> Double in
            let rest = 1 - along
            return 3 * rest * rest * along * first + 3 * rest * along * along * second + along * along * along
        }
        var low = 0.0
        var high = 1.0
        var along = clamped
        for _ in 0..<40 {
            let x = bezier(along, 0.42, 0.58)
            if abs(x - clamped) < 1e-7 {
                break
            }
            if x < clamped { low = along } else { high = along }
            along = (low + high) / 2
        }
        return bezier(along, 0, 1)
    }
}
