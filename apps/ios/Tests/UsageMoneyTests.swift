import Foundation
import RuimtePulsar
import XCTest

@testable import Ruimte

final class UsageMoneyTests: XCTestCase {
    private func rate(_ value: Double = 0.8, currency: String = "EUR") -> JSONValue {
        .object([
            "currency": .string(currency), "rate": .number(value), "date": .string("2026-09-15"),
            "fetchedAt": .number(0),
        ])
    }

    func testEuroSelectionUsesRegionEvenWhenTheLanguageIsEnglish() {
        for identifier in ["nl_NL", "en_NL", "de_DE", "fr_FR", "en_IE"] {
            let money = UsageMoneyFormatter(locale: Locale(identifier: identifier), rate: rate())
            XCTAssertEqual(money.preferredCurrency, "EUR", identifier)
            XCTAssertEqual(money.currencyCode, "EUR", identifier)
            XCTAssertEqual(money.amount(usd: 12.5), 10, accuracy: 0.0001)
        }
    }

    func testNonEuroRegionsShowUnconvertedDollars() {
        for identifier in ["en_US", "nl_US", "en_GB", "de_CH", "ja_JP"] {
            let money = UsageMoneyFormatter(locale: Locale(identifier: identifier), rate: rate())
            XCTAssertEqual(money.currencyCode, "USD", identifier)
            XCTAssertEqual(money.amount(usd: 12.5), 12.5, accuracy: 0.0001)
            XCTAssertNil(money.explanation)
        }
    }

    func testMissingOrInvalidRateKeepsDollarAmountsAndExplainsTheFallback() {
        let invalid: [JSONValue?] = [nil, .null, rate(0), rate(-1), rate(.infinity), rate(.nan), rate(currency: "GBP")]
        for value in invalid {
            let money = UsageMoneyFormatter(locale: Locale(identifier: "nl_NL"), rate: value)
            XCTAssertEqual(money.currencyCode, "USD")
            XCTAssertEqual(money.amount(usd: 10), 10)
            XCTAssertNotNil(money.explanation)
            XCTAssertFalse(money.string(usd: 10).contains("€"))
        }
    }

    func testFormattingRespectsRegionalSeparatorsAndCurrencyPlacement() {
        let dutch = UsageMoneyFormatter(locale: Locale(identifier: "nl_NL"), rate: rate(1))
        XCTAssertEqual(dutch.string(usd: 1234.5).replacingOccurrences(of: "\u{00a0}", with: " "), "€ 1.234,50")
        let german = UsageMoneyFormatter(locale: Locale(identifier: "de_DE"), rate: rate(1))
        XCTAssertEqual(german.string(usd: 1234.5).replacingOccurrences(of: "\u{00a0}", with: " "), "1.234,50 €")
        let american = UsageMoneyFormatter(locale: Locale(identifier: "en_US"), rate: rate())
        XCTAssertEqual(american.string(usd: 1234.5), "$1,234.50")
    }

    func testChartAmountsAndLabelsApplyTheSameRateExactlyOnce() {
        let money = UsageMoneyFormatter(locale: Locale(identifier: "nl_NL"), rate: rate())
        let chartAmount = money.amount(usd: 12.5)
        XCTAssertEqual(chartAmount, 10)
        XCTAssertEqual(money.string(amount: chartAmount), money.string(usd: 12.5))
        XCTAssertTrue(money.string(usd: 0.005).contains("0,004"))
        XCTAssertTrue(money.string(usd: 0).contains("0,00"))
        XCTAssertEqual(money.rateDate, "2026-09-15")
    }
}
