import Foundation
import Testing

@testable import RuimtePulsar

/// `FormatPortTests` holds every function `@adecore/ui/format` has. This one is the phone's own: a time to the second,
/// which the desktop never writes.
struct FormatTests {
    private let zone = TimeZone(identifier: "Europe/Amsterdam")!

    private func region(_ region: String) -> FormatLocale {
        FormatLocale(region: Locale(identifier: region), language: Locale(identifier: "en"), timeZone: zone)
    }

    @Test func aTimeToTheSecondCountsToTwentyFourOrSaysAMWhereTheRegionDoes() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let at = calendar.date(from: DateComponents(year: 2026, month: 9, day: 19, hour: 8, minute: 5, second: 9))!
        #expect(Format.clockSeconds(at, in: region("nl_NL")) == "08:05:09")
        #expect(Format.clockSeconds(at, in: region("en_US")) == "08:05:09 AM")
    }
}
