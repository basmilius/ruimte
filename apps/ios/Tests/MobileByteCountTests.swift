import XCTest

@testable import Ruimte

final class MobileByteCountTests: XCTestCase {
    private let english = Locale(identifier: "en_US")

    func testASizeIsDividedByTheSameKilobyteAsTheDesktop() {
        XCTAssertEqual(mobileByteCount(0, locale: english), "0 B")
        XCTAssertEqual(mobileByteCount(900, locale: english), "900 B")
        XCTAssertEqual(mobileByteCount(500_000, locale: english), "488 KB")
        XCTAssertEqual(mobileByteCount(1024, locale: english), "1 KB")
        XCTAssertEqual(mobileByteCount(1536, locale: english), "1.5 KB")
    }

    func testTheDecimalStopsAboveTenAndTheWholeFlagDropsItAltogether() {
        XCTAssertEqual(mobileByteCount(10 * 1024, locale: english), "10 KB")
        XCTAssertEqual(mobileByteCount(1_572_864, locale: english), "1.5 MB")
        XCTAssertEqual(mobileByteCount(1536, whole: true, locale: english), "2 KB")
    }

    func testAnAttachmentKeepsItsDecimalsForMegabytesOnly() {
        XCTAssertEqual(mobileAttachmentSize(1536, locale: english), "2 KB")
        XCTAssertEqual(mobileAttachmentSize(1_572_864, locale: english), "1.5 MB")
    }

    func testASizeTheMachineNeverReportedSaysSo() {
        XCTAssertEqual(mobileByteCount(nil, locale: english), "Unavailable")
        XCTAssertEqual(mobileByteCount(Double.nan, locale: english), "Unavailable")
        XCTAssertEqual(mobileByteCount(-1, locale: english), "Unavailable")
    }
}
