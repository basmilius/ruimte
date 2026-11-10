import Foundation
import RuimtePulsar

public struct UsageMoneyFormatter: Sendable {
    public let locale: Locale
    public let preferredCurrency: String
    public let currencyCode: String
    public let rateDate: String?
    private let factor: Double

    /// `currency` is the one a person picked, else the region's: euros in a euro region, dollars anywhere else.
    public init(locale: Locale, rate: UsageRate?, currency: String? = nil) {
        self.locale = locale
        preferredCurrency = currency ?? (locale.currency?.identifier == "EUR" ? "EUR" : "USD")
        // usage.summary prices are USD; an absent or invalid rate must never relabel those amounts as euros.
        if preferredCurrency == "EUR", let rate, rate.currency == "EUR", rate.rate.isFinite, rate.rate > 0 {
            currencyCode = "EUR"
            factor = rate.rate
            rateDate = rate.date
        } else {
            currencyCode = "USD"
            factor = 1
            rateDate = nil
        }
    }

    /// The rate the widget snapshot kept, which is stored as it came.
    public init(locale: Locale, storedRate: JSONValue?, currency: String? = nil) {
        self.init(locale: locale, rate: try? storedRate?.decoded(as: UsageRate.self), currency: currency)
    }

    public var explanation: String? {
        if preferredCurrency == "EUR", currencyCode == "USD" {
            return String(localized: "Showing US dollars until a euro exchange rate is available.", bundle: .module)
        }
        if let rateDate { return String(localized: "Converted to euros at the ECB rate of \(rateDate).", bundle: .module) }
        return nil
    }

    public func amount(usd: Double) -> Double { usd * factor }
    public func string(usd: Double) -> String { string(amount: amount(usd: usd)) }

    public func string(amount: Double) -> String {
        Format.money(
            amount, currency: currencyCode, maximumFractionDigits: amount != 0 && abs(amount) < 0.01 ? 4 : 2,
            in: FormatLocale(region: locale, language: locale))
    }
}
