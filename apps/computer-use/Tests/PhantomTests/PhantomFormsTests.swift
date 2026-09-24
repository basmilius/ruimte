import ComputerUseCore
import CoreGraphics
import Foundation
import Phantom
import Testing

struct PhantomFormsTests {
    /// The path strings of the design, `M x y` then four `C x1 y1 x2 y2 x y`.
    static let design: [PhantomForm: [CGFloat]] = [
        .arrow: [4, 3.5, 9.5, 5.83, 15, 8.17, 20.5, 10.5, 18.17, 11.5, 15.83, 12.5, 13.5, 13.5, 12.5, 15.83, 11.5, 18.17, 10.5, 20.5, 8.33, 14.83, 6.17, 9.17, 4, 3.5],
        .dot: [4, 3.5, 7.33, 4.22, 10.65, 4.94, 13.98, 5.66, 19.48, 6.85, 21.4, 13.72, 17.31, 17.59, 13.21, 21.46, 6.46, 19.15, 5.58, 13.59, 5.06, 10.22, 4.53, 6.86, 4, 3.5],
        .small: [4, 3.5, 6.66, 4.42, 9.31, 5.33, 11.97, 6.25, 15.18, 7.35, 16.05, 11.49, 13.56, 13.8, 11.07, 16.11, 7.02, 14.93, 6.15, 11.65, 5.43, 8.93, 4.72, 6.22, 4, 3.5],
        .finger: [-3.07, -3.57, 0.83, -7.48, 7.17, -7.48, 11.07, -3.57, 14.98, 0.33, 14.98, 6.67, 11.07, 10.57, 7.17, 14.48, 0.83, 14.48, -3.07, 10.57, -6.98, 6.67, -6.98, 0.33, -3.07, -3.57],
    ]

    static func numbers(_ path: PhantomPath) -> [CGFloat] {
        [path.start.x, path.start.y] + path.segments.flatMap { [$0.control1.x, $0.control1.y, $0.control2.x, $0.control2.y, $0.end.x, $0.end.y] }
    }

    @Test(arguments: PhantomForm.allCases)
    func matchesTheDesign(_ form: PhantomForm) throws {
        let expected = try #require(Self.design[form])
        let actual = Self.numbers(form.path)
        #expect(actual.count == expected.count)
        for (value, target) in zip(actual, expected) {
            #expect(abs(value - target) < 0.0001)
        }
    }

    @Test(arguments: PhantomForm.allCases)
    func isFourCubicsThatClose(_ form: PhantomForm) {
        let path = form.path
        #expect(path.segments.count == 4)
        #expect(path.segments.last?.end == path.start)
        #expect(PhantomPath(cgPath: path.cgPath) == path)
    }

    @Test func pointedFormsStartAtTheHotspot() {
        for form in [PhantomForm.arrow, .dot, .small] {
            #expect(form.path.start == OverlayStyle.Cursor.hotspot)
        }
        #expect(PhantomForm.finger.path.start.x < OverlayStyle.Cursor.hotspot.x)
    }

    @Test func morphsPointByPointAndOvershoots() {
        let arrow = PhantomForm.arrow.path
        let dot = PhantomForm.dot.path
        #expect(PhantomPath.interpolate(arrow, dot, 0) == arrow)
        #expect(PhantomPath.interpolate(arrow, dot, 1) == dot)
        let beyond = PhantomPath.interpolate(arrow, dot, 1.2)
        let end = arrow.segments[0].end
        let target = dot.segments[0].end
        #expect(abs(beyond.segments[0].end.x - (end.x + (target.x - end.x) * 1.2)) < 0.0001)
    }
}

struct PhantomLookTests {
    @Test func formsFollowTheStateTable() {
        let forms: [PhantomState: PhantomForm] = [
            .idle: .arrow, .move: .arrow, .hover: .arrow, .click: .arrow, .drag: .arrow, .type: .arrow, .scroll: .arrow, .look: .arrow,
            .think: .dot, .waiting: .dot, .permission: .dot, .error: .arrow, .done: .dot, .takeover: .arrow, .paused: .small, .tap: .finger,
        ]
        for state in PhantomState.allCases {
            #expect(PhantomLook.of(state).form == forms[state])
        }
        #expect(PhantomLook.of(.think, working: .sway).form == .arrow)
    }

    @Test func colorsFollowTheStatusFamily() {
        let tones: [PhantomState: PhantomTone] = [.waiting: .needs, .permission: .needs, .error: .error, .done: .done, .takeover: .muted, .paused: .muted]
        for state in PhantomState.allCases {
            #expect(PhantomLook.of(state).tone == (tones[state] ?? .accent))
        }
    }

    @Test func labelsOnlyOnAnActionOrWhileWaiting() {
        for state in [PhantomState.idle, .move, .hover, .drag] {
            #expect(PhantomLook.of(state).label == nil)
        }
        #expect(PhantomLook.of(.type).label == .typed)
        #expect(PhantomLook.of(.think).label == .shining)
        #expect(PhantomLook.of(.waiting).label == .pulsing)
    }

    @Test func orderIsTheDesigns() {
        #expect(PhantomState.allCases.map(\.rawValue) == ["idle", "move", "hover", "click", "drag", "type", "scroll", "look", "think", "waiting", "permission", "error", "done", "takeover", "paused", "tap"])
    }

    @Test func takeoverIsHollowAndSmaller() {
        let look = PhantomLook.of(.takeover)
        #expect(look.ghost)
        #expect(look.scale == 0.86)
    }

    @Test func workingRotatesThroughTheDotMotions() {
        #expect((0..<6).map { DotMotion.rotating($0) } == [.wave, .fade, .grow, .orbit, .gather, .wave])
    }

    @Test func theBarMarkShowsTheAgentNotEachAction() {
        #expect(PhantomLook.markState(.click) == .idle)
        #expect(PhantomLook.markState(.error) == .idle)
        #expect(PhantomLook.markState(.think) == .think)
        #expect(PhantomLook.markState(.paused) == .paused)
    }
}

struct LabelPlacementTests {
    let size = CGSize(width: 120, height: 26)

    @Test func sitsDownAndRightOfTheHotspot() {
        let room = CGRect(x: -500, y: -400, width: 1000, height: 800)
        let placed = LabelPlacement.place(size: size, room: room)
        #expect(placed.origin == OverlayStyle.Label.offset)
        #expect(!placed.flippedLeft && !placed.flippedUp)
        #expect(LabelPlacement.place(size: size, room: nil).origin == OverlayStyle.Label.offset)
    }

    @Test func flipsLeftAtTheRightEdge() {
        let room = CGRect(x: -900, y: -400, width: 1000, height: 800)
        let placed = LabelPlacement.place(size: size, room: room)
        #expect(placed.flippedLeft)
        #expect(placed.origin.x == -OverlayStyle.Label.offset.x - size.width)
        #expect(placed.origin.y == OverlayStyle.Label.offset.y)
    }

    @Test func flipsUpAtTheBottomEdge() {
        let room = CGRect(x: -500, y: -700, width: 1000, height: 720)
        let placed = LabelPlacement.place(size: size, room: room)
        #expect(placed.flippedUp)
        #expect(placed.origin.y == -OverlayStyle.Label.offset.y - size.height)
    }

    @Test func staysWhenTheOtherSideHasNoRoomEither() {
        let room = CGRect(x: -20, y: -400, width: 100, height: 800)
        #expect(!LabelPlacement.place(size: size, room: room).flippedLeft)
    }
}

struct EasingTests {
    @Test func matchesTheEndsAndOvershoots() {
        let spring = Easing.cubic(0.34, 1.56, 0.64, 1)
        #expect(spring.progress(0) == 0)
        #expect(spring.progress(1) == 1)
        #expect((0...20).map { spring.progress(CGFloat($0) / 20) }.max()! > 1)
        #expect(abs(Easing.linear.progress(0.3) - 0.3) < 0.0001)
    }

    @Test func stepsJumpAtTheEndOfEachStep() {
        let steps = Easing.steps(4)
        #expect(steps.progress(0.2) == 0)
        #expect(steps.progress(0.25) == 0.25)
        #expect(steps.progress(0.99) == 0.75)
        #expect(steps.progress(1) == 1)
    }

    @Test func keyframesInterpolateBetweenTheirOffsets() {
        let track = Track.keyframes("opacity", duration: 1, [(0, 0), (0.5, 1), (1, 0)], easing: .linear)
        #expect((track.value(at: 0.25) as? NSNumber)?.doubleValue == 0.5)
        #expect((track.value(at: 2) as? NSNumber)?.doubleValue == 0)
        let loop = Track.keyframes("opacity", duration: 1, [(0, 0), (1, 1)], easing: .linear, repeats: true, delay: 0.25)
        #expect(abs(((loop.value(at: 0) as? NSNumber)?.doubleValue ?? -1) - 0.75) < 0.0001)
    }
}
