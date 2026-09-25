import ComputerUseCore
import CoreGraphics
import Testing

struct ClippingTests {
    private let window = CGRect(x: 0, y: 0, width: 800, height: 600)
    /// A settings pane from y 100 to 400, as Chromium reports it scrolled halfway down.
    private let pane = CGRect(x: 100, y: 100, width: 400, height: 300)
    private let above = CGRect(x: 120, y: 40, width: 360, height: 21)
    private let visible = CGRect(x: 120, y: 200, width: 360, height: 21)
    private let straddling = CGRect(x: 120, y: 386, width: 360, height: 14)
    private let below = CGRect(x: 120, y: 400, width: 360, height: 0)
    private let belowToo = CGRect(x: 120, y: 400, width: 200, height: 0)

    @Test func anElementClippedToNothingIsOffscreen() {
        #expect(Clipping.isOffscreen(below, within: window))
        #expect(Clipping.isOffscreen(CGRect(x: 800, y: 100, width: 0, height: 21), within: window))
        #expect(Clipping.isOffscreen(CGRect(x: 900, y: 100, width: 40, height: 21), within: window))
        #expect(Clipping.isOffscreen(CGRect(x: 100, y: 100, width: 360, height: 1), within: window))
        #expect(!Clipping.isOffscreen(visible, within: window))
        #expect(!Clipping.isOffscreen(straddling, within: window))
    }

    @Test func givesWhatIsOutOfViewAFifthOfTheLines() {
        #expect(Clipping.offscreenLines(of: 500) == 100)
        #expect(Clipping.offscreenLines(of: 3) == 1)
    }

    @Test func revealsTheFirstElementPastTheFarEdge() {
        let frames: [CGRect?] = [above, visible, straddling, below, belowToo]
        #expect(Clipping.revealTarget(frames, in: pane, direction: .down) == 3)
    }

    @Test func revealsTheLastElementBeforeTheNearEdge() {
        let frames: [CGRect?] = [CGRect(x: 120, y: 10, width: 360, height: 21), above, visible, below]
        #expect(Clipping.revealTarget(frames, in: pane, direction: .up) == 1)
    }

    @Test func revealsSideways() {
        let right = CGRect(x: 500, y: 200, width: 0, height: 21)
        let left = CGRect(x: 60, y: 200, width: 40, height: 21)
        let frames: [CGRect?] = [left, visible, right]
        #expect(Clipping.revealTarget(frames, in: pane, direction: .right) == 2)
        #expect(Clipping.revealTarget(frames, in: pane, direction: .left) == 0)
    }

    @Test func revealsNothingWhenAllShows() {
        #expect(Clipping.revealTarget([visible, straddling, nil], in: pane, direction: .down) == nil)
        #expect(Clipping.revealTarget([visible, nil], in: pane, direction: .up) == nil)
    }

    @Test func looksInTheNearestContainerFirst() {
        let elements = [
            Clipping.Laid(depth: 0, frame: window),
            Clipping.Laid(depth: 1, frame: pane),
            Clipping.Laid(depth: 2, frame: visible),
            Clipping.Laid(depth: 3, frame: straddling),
            Clipping.Laid(depth: 2, frame: below),
            Clipping.Laid(depth: 1, frame: CGRect(x: 600, y: 600, width: 100, height: 0)),
        ]
        #expect(Clipping.revealTarget(in: elements, containers: [1, 0], direction: .down) == 4)
        #expect(Clipping.revealTarget(in: elements, containers: [3, 0], direction: .down) == 5)
    }

    @Test func skipsAContainerWithoutArea() {
        let elements = [
            Clipping.Laid(depth: 0, frame: CGRect(x: 0, y: 600, width: 800, height: 0)),
            Clipping.Laid(depth: 1, frame: visible),
        ]
        #expect(Clipping.revealTarget(in: elements, containers: [0], direction: .down) == nil)
    }
}
