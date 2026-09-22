import Foundation

public struct UsageMoneyFormatter: Sendable {
    public let locale: Locale
    public let preferredCurrency: String
    public let currencyCode: String
    public let rateDate: String?
    private let factor: Double

    public init(locale: Locale, rate: JSONValue?) {
        self.locale = locale
        preferredCurrency = locale.currency?.identifier == "EUR" ? "EUR" : "USD"
        // usage.summary prices are USD; an absent or invalid rate must never relabel those amounts as euros.
        if preferredCurrency == "EUR", rate?["currency"]?.stringValue == "EUR",
            let value = rate?["rate"]?.numberValue, value.isFinite, value > 0
        {
            currencyCode = "EUR"
            factor = value
            rateDate = rate?["date"]?.stringValue
        } else {
            currencyCode = "USD"
            factor = 1
            rateDate = nil
        }
    }

    public var explanation: String? {
        if preferredCurrency == "EUR", currencyCode == "USD" {
            return "Showing US dollars until a euro exchange rate is available."
        }
        if let rateDate { return "Converted to euros at the ECB rate of \(rateDate)." }
        return nil
    }

    public func amount(usd: Double) -> Double { usd * factor }
    public func string(usd: Double) -> String { string(amount: amount(usd: usd)) }

    public func string(amount: Double) -> String {
        let digits = amount != 0 && abs(amount) < 0.01 ? 2...4 : 2...2
        return amount.formatted(.currency(code: currencyCode).locale(locale).precision(.fractionLength(digits)))
    }
}
