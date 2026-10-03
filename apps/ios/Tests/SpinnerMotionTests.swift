import XCTest

@testable import Ruimte

final class SpinnerMotionTests: XCTestCase {
    func testTheGeometryRoundsAsTheDesktopsCSSDoes() {
        let twelve = SpinnerMotion(size: 12)
        XCTAssertEqual([twelve.dot, twelve.gap, twelve.left, twelve.top], [3, 4, 1, 5])
        let fourteen = SpinnerMotion(size: 14)
        XCTAssertEqual([fourteen.dot, fourteen.gap, fourteen.left, fourteen.top], [3, 5, 1, 6])
        let sixteen = SpinnerMotion(size: 16)
        XCTAssertEqual([sixteen.dot, sixteen.gap, sixteen.left, sixteen.top], [4, 6, 0, 6])
        let twenty = SpinnerMotion(size: 20)
        XCTAssertEqual([twenty.dot, twenty.gap, twenty.left, twenty.top], [4, 8, 0, 8])
    }

    func testAtRestTheDotsStandInTheirThreeSlots() {
        let motion = SpinnerMotion(size: 12)
        XCTAssertEqual(motion.center(of: 0, at: nil), CGPoint(x: 2.5, y: 6.5))
        XCTAssertEqual(motion.center(of: 1, at: nil), CGPoint(x: 6.5, y: 6.5))
        XCTAssertEqual(motion.center(of: 2, at: nil), CGPoint(x: 10.5, y: 6.5))
    }

    func testTheDotsStartATurnApartInTheSlotsTheyRestIn() {
        let motion = SpinnerMotion(size: 16)
        for step in 0..<3 {
            assertClose(motion.center(of: step, at: 0), motion.center(of: step, at: nil))
        }
    }

    func testTheFirstDotLeapsOverTheTopWhileTheOthersSlideBack() {
        let motion = SpinnerMotion(size: 16)
        let middle = SpinnerMotion.duration * 0.3333 / 2
        assertClose(motion.center(of: 0, at: middle), CGPoint(x: 8, y: 2))
        let landed = SpinnerMotion.duration * 0.3333
        assertClose(motion.center(of: 0, at: landed), motion.center(of: 2, at: nil))
        assertClose(motion.center(of: 1, at: landed), motion.center(of: 0, at: nil))
        assertClose(motion.center(of: 2, at: landed), motion.center(of: 1, at: nil))
    }

    func testOneCycleBringsEveryDotBack() {
        let motion = SpinnerMotion(size: 14)
        for step in 0..<3 {
            assertClose(motion.center(of: step, at: 0.4), motion.center(of: step, at: 0.4 + SpinnerMotion.duration))
        }
    }

    func testEaseInOutIsCSSs() {
        XCTAssertEqual(SpinnerMotion.easeInOut(0), 0, accuracy: 1e-6)
        XCTAssertEqual(SpinnerMotion.easeInOut(0.5), 0.5, accuracy: 1e-6)
        XCTAssertEqual(SpinnerMotion.easeInOut(1), 1, accuracy: 1e-6)
        // cubic-bezier(0.42, 0, 0.58, 1) at a quarter, as a browser computes it.
        XCTAssertEqual(SpinnerMotion.easeInOut(0.25), 0.1291, accuracy: 1e-3)
        XCTAssertEqual(SpinnerMotion.easeInOut(0.75), 0.8709, accuracy: 1e-3)
    }

    private func assertClose(_ actual: CGPoint, _ expected: CGPoint, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(actual.x, expected.x, accuracy: 0.01, file: file, line: line)
        XCTAssertEqual(actual.y, expected.y, accuracy: 0.01, file: file, line: line)
    }
}
