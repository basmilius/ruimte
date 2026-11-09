import AppKit
import ComputerUseCore
import Foundation
import Phantom
import Testing

struct OutlineTests {
    @Test func everyFormIsTheSameNumberOfPointsClockwiseFromItsTopLeft() {
        for form in PhantomForm.allCases {
            let points = form.outline.points
            #expect(points.count == PhantomOutline.count, "\(form)")
            var area: CGFloat = 0
            for index in points.indices {
                let next = points[(index + 1) % points.count]
                area += points[index].x * next.y - next.x * points[index].y
            }
            #expect(area > 0, "\(form) runs counterclockwise")
            let lowest = points.map { $0.x + $0.y }.min()!
            #expect(points[0].x + points[0].y == lowest, "\(form)")
        }
    }

    @Test func pointsAreSpreadEvenlyAlongTheOutline() {
        let points = PhantomForm.dot.outline.points
        let gaps = points.indices.map { index in
            let next = points[(index + 1) % points.count]
            return hypot(next.x - points[index].x, next.y - points[index].y)
        }
        // A chord over a curve is a little shorter than its arc; corners cut a step shorter still.
        #expect(gaps.max()! - gaps.min()! < 0.05)
    }

    @Test func theArrowStartsAtItsTip() {
        let tip = PhantomForm.arrow.outline.points[0]
        #expect(abs(tip.x - 4) < 0.001)
        #expect(abs(tip.y - 3.5) < 0.001)
    }

    @Test func theHandAndTheBeamCenterOnTheHotspot() {
        for form in [PhantomForm.hand, .beam] {
            let points = form.outline.points
            let middle = CGPoint(
                x: (points.map(\.x).min()! + points.map(\.x).max()!) / 2,
                y: (points.map(\.y).min()! + points.map(\.y).max()!) / 2
            )
            #expect(abs(middle.x - 4) < 0.6, "\(form)")
            #expect(abs(middle.y - 3.5) < 0.6, "\(form)")
        }
        let beam = PhantomForm.beam.outline.points
        #expect(abs(beam.map(\.y).max()! - beam.map(\.y).min()! - 16.2) < 0.01)
    }

    @Test func anOutlineReadsBackFromItsPath() {
        let outline = PhantomForm.hand.outline
        #expect(PhantomOutline(cgPath: outline.cgPath) == outline)
        #expect(PhantomOutline(cgPath: PhantomForm.arrow.path) == nil)
    }

    @Test func aMorphMovesEachPointToItsPartner() {
        let from = PhantomForm.arrow.outline
        let to = PhantomForm.hand.outline
        #expect(PhantomOutline.interpolate(from, to, 0) == from)
        let end = PhantomOutline.interpolate(from, to, 1)
        #expect(zip(end.points, to.points).allSatisfy { abs($0.x - $1.x) < 0.0001 && abs($0.y - $1.y) < 0.0001 })
        let half = PhantomOutline.interpolate(from, to, 0.5)
        #expect(abs(half.points[7].x - (from.points[7].x + to.points[7].x) / 2) < 0.0001)
    }
}

struct TravelTests {
    @Test func theDurationGrowsWithTheDistanceBetweenItsBounds() {
        #expect(PhantomTravel.duration(distance: 0) == 0.42)
        #expect(abs(PhantomTravel.duration(distance: 30) - 0.51) < 0.0001)
        #expect(abs(PhantomTravel.duration(distance: 210) - 0.81) < 0.0001)
        #expect(PhantomTravel.duration(distance: 2000) == 1)
    }

    @Test func theCurveBowsUpTheScreenWhicheverWayItGoes() {
        let left = CGPoint(x: 100, y: 300)
        let right = CGPoint(x: 400, y: 300)
        for (start, end) in [(left, right), (right, left)] {
            let control = PhantomTravel.control(from: start, to: end)
            #expect(abs(control.x - 250) < 0.0001)
            #expect(abs(control.y - (300 - 0.18 * 300)) < 0.0001)
        }
        let down = PhantomTravel.control(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 0, y: 100))
        #expect(down.y == 50)
    }

    @Test func theCurveRunsFromStartToEnd() {
        let start = CGPoint(x: 10, y: 20)
        let end = CGPoint(x: 210, y: 120)
        #expect(PhantomTravel.point(from: start, to: end, progress: 0) == start)
        #expect(PhantomTravel.point(from: start, to: end, progress: 1) == end)
        #expect(PhantomTravel.point(from: start, to: start, progress: 0.5) == start)
    }
}

struct MarkPlacementTests {
    @Test func aMarkKeepsItsClearanceFromTheNotch() {
        let style = OverlayStyle.Mark.self
        let radius: CGFloat = 4
        let frame = style.place(style.wheel, radius: radius)
        let corner = CGPoint(x: frame.minX + radius, y: frame.minY + radius)
        let distance = hypot(corner.x - style.notch.x, corner.y - style.notch.y) - radius
        #expect(abs(distance - style.clearance) < 0.0001)
    }
}

struct LookTests {
    @Test func colorSitsOnlyInTheSigns() {
        for state in PhantomState.allCases {
            let look = PhantomLook.of(state)
            if look.tone != nil {
                #expect(look.glyph != nil || look.mark != nil, "\(state)")
            }
        }
        #expect(PhantomLook.of(.error).mark == .alert)
        #expect(PhantomLook.of(.drag).form == .hand)
        #expect(PhantomLook.of(.type).form == .beam)
    }
}

@MainActor
struct MenuBarTests {
    @Test func theArrowFollowsTheMenuBarsColor() {
        #expect(MenuBarLook.arrow.isTemplate)
        #expect(MenuBarLook.arrow.size.height == 14)
    }

    @Test func theHeadWidensForALongTitleAndKeepsItsTileAtTheTop() {
        let head = MenuHeadView()
        head.update(title: "Ruimte is using Mail", line: "Reading the inbox · 2:14", state: .think)
        let narrow = head.frame.size
        #expect(narrow.width == 260)
        head.update(title: "Ruimte is using Microsoft Outlook in the background, all afternoon", line: "Ready · 2:15", state: .idle)
        #expect(head.frame.width > narrow.width)
        #expect(head.frame.height == narrow.height)
    }
}

@MainActor
struct SnapshotTests {
    @Test func everyStateDraws() {
        for state in PhantomState.allCases {
            #expect(PhantomSnapshot.state(state, options: PhantomSnapshot.Options()) != nil, "\(state)")
        }
        #expect(PhantomSnapshot.sheet(options: PhantomSnapshot.Options()) != nil)
    }

    /// A drawn cursor has dark pixels under its hotspot's fill and leaves the far corner of the tile alone.
    @Test func theCursorIsGraphite() throws {
        var options = PhantomSnapshot.Options()
        options.scale = 1
        let image = try #require(PhantomSnapshot.state(.idle, options: options))
        let pixel = try #require(Self.pixel(image, x: 66 + 6, y: 48 + 6))
        #expect(pixel.red < 0.2 && pixel.green < 0.2 && pixel.blue < 0.2)
    }

    static func pixel(_ image: CGImage, x: Int, y: Int) -> (red: CGFloat, green: CGFloat, blue: CGFloat)? {
        var bytes = [UInt8](repeating: 0, count: 4)
        guard let context = CGContext(data: &bytes, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            return nil
        }
        context.draw(image, in: CGRect(x: -x, y: y - image.height + 1, width: image.width, height: image.height))
        return (CGFloat(bytes[0]) / 255, CGFloat(bytes[1]) / 255, CGFloat(bytes[2]) / 255)
    }
}
