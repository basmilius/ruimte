import XCTest

@testable import Ruimte

/// The expected stars are what `starsOf` in `apps/client/src/ui/eclipse-stars.ts` returns for the same seed.
final class EclipseTests: XCTestCase {
    func testTheAboutSeedLaysOutTheDesktopsStars() {
        let stars = EclipseStar.field(count: 58, seed: 132)
        XCTAssertEqual(
            Array(stars.prefix(3)),
            [
                EclipseStar(
                    left: 35, top: 46.1, size: 1, tone: .cool, alpha: 0.48, glint: false, duration: 5, delay: -5),
                EclipseStar(
                    left: 5.5, top: 81.4, size: 1, tone: .white, alpha: 0.42, glint: false, duration: 5, delay: -2),
                EclipseStar(
                    left: 90.4, top: 58.2, size: 1, tone: .cool, alpha: 0.27, glint: false, duration: 5, delay: -3),
            ])
        XCTAssertEqual(
            stars.last,
            EclipseStar(left: 56.8, top: 44.8, size: 1, tone: .cool, alpha: 0.39, glint: false, duration: 6, delay: -5))
        assertSummary(of: stars, glints: 9, tones: [34, 14, 10], large: 7, sum: 6035.06)
    }

    func testTheWelcomeSeedLaysOutTheDesktopsStars() {
        let stars = EclipseStar.field(count: 46, seed: 202)
        XCTAssertEqual(
            Array(stars.prefix(3)),
            [
                EclipseStar(
                    left: 12.9, top: 96.3, size: 1, tone: .white, alpha: 0.27, glint: false, duration: 5, delay: -3),
                EclipseStar(
                    left: 27.4, top: 10.8, size: 1, tone: .white, alpha: 0.4, glint: false, duration: 5, delay: -4),
                EclipseStar(
                    left: 11.7, top: 94.3, size: 1, tone: .white, alpha: 0.21, glint: true, duration: 7, delay: -4),
            ])
        XCTAssertEqual(
            stars.last,
            EclipseStar(left: 26.6, top: 2.9, size: 1, tone: .white, alpha: 0.23, glint: false, duration: 5, delay: -7))
        assertSummary(of: stars, glints: 8, tones: [31, 8, 7], large: 6, sum: 4809.83)
    }

    func testAKeyframeSwingsOutAndBackEased() {
        XCTAssertEqual(EclipseMotion.swing(0, duration: 4, delay: 0), 0, accuracy: 0.0001)
        XCTAssertEqual(EclipseMotion.swing(1, duration: 4, delay: 0), 0.5, accuracy: 0.0001)
        XCTAssertEqual(EclipseMotion.swing(2, duration: 4, delay: 0), 1, accuracy: 0.0001)
        XCTAssertEqual(EclipseMotion.swing(0, duration: 4, delay: -2), 1, accuracy: 0.0001)
        XCTAssertLessThan(EclipseMotion.swing(0.4, duration: 4, delay: 0), 0.1)
    }

    func testASpinTurnsBothWays() {
        XCTAssertEqual(EclipseMotion.turn(35, period: 70), 180, accuracy: 0.0001)
        XCTAssertEqual(EclipseMotion.turn(55, period: -110), -180, accuracy: 0.0001)
    }

    private func assertSummary(
        of stars: [EclipseStar], glints: Int, tones: [Int], large: Int, sum: Double, line: UInt = #line
    ) {
        XCTAssertEqual(stars.filter(\.glint).count, glints, line: line)
        XCTAssertEqual(
            [EclipseStar.Tone.white, .cool, .warm].map { tone in stars.filter { $0.tone == tone }.count }, tones,
            line: line)
        XCTAssertEqual(stars.filter { $0.size == 2 }.count, large, line: line)
        let total = stars.reduce(0) { $0 + $1.left + $1.top + $1.alpha + $1.duration + $1.delay }
        XCTAssertEqual(total, sum, accuracy: 0.00005, line: line)
    }
}
