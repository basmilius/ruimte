import CoreGraphics
import Testing

@testable import Ruimte

@Suite struct DrawingToolbarTests {
    @Test func everyToolHasOnePlaceInTheBar() {
        for tool in DrawingTool.allCases {
            #expect(DrawingSlot.allCases.filter { $0.tools.contains(tool) }.count == 1, "\(tool)")
        }
        #expect(DrawingSlot.slot(of: .ellipse) == .shape)
        #expect(DrawingSlot.slot(of: .select) == .hand)
    }

    @Test func aPlaceReturnsToTheToolLastUsedThere() {
        #expect(DrawingSlot.shape.tool(remembered: [:]) == .rect)
        #expect(DrawingSlot.shape.tool(remembered: [.shape: .diamond]) == .diamond)
        #expect(DrawingSlot.shape.tool(remembered: [.shape: .pen]) == .rect)
    }

    @Test func snappingPutsAPointOnTheGridOnlyWhenOn() {
        let point = CGPoint(x: 13, y: -3)
        #expect(DrawingSnap.point(point, enabled: false) == point)
        #expect(DrawingSnap.point(point, enabled: true) == CGPoint(x: 16, y: 0))
    }
}
