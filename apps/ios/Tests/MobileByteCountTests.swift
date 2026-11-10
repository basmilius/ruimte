import RuimtePulsar
import RuimteShared
import XCTest

@testable import Ruimte

final class MobileByteCountTests: XCTestCase {
    private let english = FormatLocale(region: Locale(identifier: "en_US"), language: Locale(identifier: "en"))

    func testTheNativeSizeForwardsBytesWholeAndLocale() {
        XCTAssertEqual(mobileByteCount(500_000, locale: english), "488 KB")
        XCTAssertEqual(mobileByteCount(1536, whole: true, locale: english), "2 KB")
        let dutch = FormatLocale(region: Locale(identifier: "nl_NL"), language: Locale(identifier: "nl"))
        XCTAssertEqual(mobileByteCount(1536, locale: dutch), "1,5 KB")
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
