import Foundation
import Testing

@testable import RuimtePulsar

@Test func usageWidgetDayIsTheDayOfTheGivenTimeZone() throws {
    let late = Date(timeIntervalSince1970: 1_790_031_600)
    #expect(UsageWidgetSnapshot.day(of: late, in: try #require(TimeZone(identifier: "UTC"))) == "2026-09-21")
    #expect(
        UsageWidgetSnapshot.day(of: late, in: try #require(TimeZone(identifier: "Europe/Amsterdam"))) == "2026-09-22")
}
