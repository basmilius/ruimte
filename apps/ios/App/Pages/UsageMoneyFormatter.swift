import Foundation
import RuimtePulsar

struct UsageMoneyFormatter {
    let locale: Locale
    let preferredCurrency: String
    let currencyCode: String
    let rateDate: String?
    private let factor: Double

    init(locale: Locale, rate: JSONValue?) {
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

    var explanation: String? {
        if preferredCurrency == "EUR", currencyCode == "USD" {
            return "Showing US dollars until a euro exchange rate is available."
        }
        if let rateDate { return "Converted to euros at the ECB rate of \(rateDate)." }
        return nil
    }

    func amount(usd: Double) -> Double { usd * factor }
    func string(usd: Double) -> String { string(amount: amount(usd: usd)) }

    func string(amount: Double) -> String {
        let digits = amount != 0 && abs(amount) < 0.01 ? 2...4 : 2...2
        return amount.formatted(.currency(code: currencyCode).locale(locale).precision(.fractionLength(digits)))
    }
}
