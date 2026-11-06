import Foundation

/// Where a format reads what a person set: the region writes the notation (order, separators, the clock) and the
/// language writes the words (a month, a weekday, "ago"). On iOS both come from the system, as `FormatSource` hands
/// them to `@adecore/ui/format` on the desktop.
public struct FormatLocale: Sendable {
    public var region: Locale
    public var language: Locale
    public var timeZone: TimeZone

    public init(region: Locale, language: Locale, timeZone: TimeZone = .current) {
        self.region = region
        self.language = language
        self.timeZone = timeZone
    }

    /// The region iOS was set to and the language the app runs in, which an English app on a Dutch iPhone reads as
    /// `en_NL` and English.
    public static var current: FormatLocale {
        FormatLocale(region: .current, language: Locale(identifier: Bundle.main.preferredLocalizations.first ?? "en"))
    }
}

/// Every number, date, time and duration a person reads, written as `@adecore/ui/format` writes it on the desktop.
/// The function names follow that module without its `format` prefix, and `FormatPortTests` holds each of them to what
/// the module writes.
public enum Format {
    // MARK: Numbers

    /// A count as a region groups one: `1,234,567` there, `1.234.567` here.
    public static func number(_ value: Double, in locale: FormatLocale = .current) -> String {
        // `Math.round`, which rounds a half up, also below zero, and leaves a negative zero where a small negative lands.
        var whole = (value + 0.5).rounded(.down)
        if whole == 0, value < 0 { whole = -0.0 }
        return whole.formatted(.number.precision(.fractionLength(0)).locale(locale.region))
    }

    /// The same, to one decimal, where the fraction is the part that means something.
    public static func decimal(_ value: Double, in locale: FormatLocale = .current) -> String {
        rounded(value, decimals: 1, in: locale)
    }

    /// Always `decimals` places, so values that follow each other keep one width: `1,0` and `1,5`.
    public static func fixed(_ value: Double, decimals: Int, in locale: FormatLocale = .current) -> String {
        value.formatted(
            .number.precision(.fractionLength(decimals)).rounded(rule: .toNearestOrAwayFromZero).locale(locale.region))
    }

    /// At most `decimals` places, trailing zeros dropped: `39`, `1,95`.
    public static func rounded(_ value: Double, decimals: Int, in locale: FormatLocale = .current) -> String {
        value.formatted(
            .number.precision(.fractionLength(0...decimals)).rounded(rule: .toNearestOrAwayFromZero)
                .locale(locale.region))
    }

    /// Percent as Activity Monitor writes it, from 0 to 100: a decimal under ten, where the difference still shows.
    public static func percent(_ value: Double, in locale: FormatLocale = .current) -> String {
        "\(value < 10 ? decimal(value, in: locale) : number(value, in: locale))%"
    }

    /// An amount in the currency it is already in, with the plain symbol in every region: `$ 5.480,96`, never
    /// `US$ 5.480,96`.
    public static func money(
        _ value: Double, currency: String, maximumFractionDigits: Int? = nil, in locale: FormatLocale = .current
    ) -> String {
        var style = FloatingPointFormatStyle<Double>.Currency(code: currency, locale: locale.region)
            .presentation(.narrow).rounded(rule: .toNearestOrAwayFromZero)
        if let maximumFractionDigits, maximumFractionDigits > 0 {
            style = style.precision(
                .fractionLength(min(defaultFractionDigits(currency), maximumFractionDigits)...maximumFractionDigits))
        }
        return value.formatted(style)
    }

    /// The places a currency is written with unless asked otherwise: two for a dollar, none for a yen.
    private static func defaultFractionDigits(_ currency: String) -> Int {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        return formatter.minimumFractionDigits
    }

    /// Dollars to three significant digits, for amounts from a fraction of a cent to tens of dollars in one list.
    public static func usdSignificant(_ value: Double, in locale: FormatLocale = .current) -> String {
        value.formatted(
            .currency(code: "USD").presentation(.narrow).precision(.significantDigits(1...3))
                .rounded(rule: .toNearestOrAwayFromZero).locale(locale.region))
    }

    /// `1.2M`, `412K`, `640`: a token count is read as a size, not counted.
    public static func tokens(_ value: Double, in locale: FormatLocale = .current) -> String {
        let whole = (value + 0.5).rounded(.down)
        if whole >= 1_000_000 {
            let millions = whole >= 10_000_000 ? (whole / 1_000_000).rounded() : whole / 1_000_000
            return "\(decimal(millions, in: locale))M"
        }
        if whole >= 1_000 {
            let thousands = whole >= 10_000 ? (whole / 1_000).rounded() : whole / 1_000
            return "\(decimal(thousands, in: locale))K"
        }
        return number(whole, in: locale)
    }

    private static let byteUnits = ["B", "KB", "MB", "GB", "TB"]

    /// A size the way a person says it: whole bytes up to a kilobyte, one decimal above that under ten. `whole` is
    /// for a column that only has room for a round number.
    public static func bytes(_ bytes: Double, whole: Bool = false, in locale: FormatLocale = .current) -> String {
        var value = max(0, bytes)
        var unit = 0
        while value >= 1024, unit < byteUnits.count - 1 {
            value /= 1024
            unit += 1
        }
        let decimals = unit > 0 && !whole && value < 10
        return "\(decimals ? decimal(value, in: locale) : number(value, in: locale)) \(byteUnits[unit])"
    }

    // MARK: Durations

    private static let second = 1000.0
    private static let minute = 60 * second
    private static let hour = 60 * minute
    private static let day = 24 * hour

    /// How long something took, at the coarsest unit that still says something: `30 s`, `5 min`, `1.5 h`.
    public static func duration(milliseconds: Double, in locale: FormatLocale = .current) -> String {
        let seconds = max(0, (milliseconds / second + 0.5).rounded(.down))
        if seconds < 60 { return "\(number(seconds, in: locale)) s" }
        let minutes = (seconds / 60 + 0.5).rounded(.down)
        if minutes < 60 { return "\(number(minutes, in: locale)) min" }
        return "\(decimal(minutes / 60, in: locale)) h"
    }

    /// How long a window still has, tight enough for the end of a bar: `4d 3h`, `12h 8m`, `9m`.
    public static func countdown(milliseconds: Double, in locale: FormatLocale = .current) -> String {
        let left = max(0, milliseconds)
        if left >= day {
            let days = (left / day).rounded(.down)
            return
                "\(number(days, in: locale))d \(number((left.truncatingRemainder(dividingBy: day)) / hour, in: locale))h"
        }
        if left >= hour {
            let hours = (left / hour).rounded(.down)
            let minutes = left.truncatingRemainder(dividingBy: hour) / minute
            return "\(number(hours, in: locale))h \(number(minutes, in: locale))m"
        }
        return "\(number(max(1, (left / minute + 0.5).rounded(.down)), in: locale))m"
    }

    /// How long something has been running, to two units: `12s`, `2m 5s`, `3h 20m`. A call that took a fraction of
    /// a second still took some, so only a clock that runs ahead of the start reads as `0s`.
    public static func elapsedShort(milliseconds: Double, in locale: FormatLocale = .current) -> String {
        let seconds = milliseconds <= 0 ? 0 : max(1, Int((milliseconds / second + 0.5).rounded(.down)))
        let write = { (value: Int) in number(Double(value), in: locale) }
        if seconds < 60 { return "\(write(seconds))s" }
        if seconds < 3600 {
            let rest = seconds % 60
            return rest == 0 ? "\(write(seconds / 60))m" : "\(write(seconds / 60))m \(write(rest))s"
        }
        let minutes = seconds % 3600 / 60
        return minutes == 0 ? "\(write(seconds / 3600))h" : "\(write(seconds / 3600))h \(write(minutes))m"
    }

    /// A stopwatch that is watched while it runs: `00:14`, and `1:02:03` once it passes an hour.
    public static func clockDuration(milliseconds: Double, in locale: FormatLocale = .current) -> String {
        let seconds = max(0, Int((milliseconds / second).rounded(.down)))
        let pad = { (value: Int) in value < 10 ? "0\(value)" : "\(value)" }
        let clock = "\(pad(seconds % 3600 / 60)):\(pad(seconds % 60))"
        return seconds >= 3600 ? "\(number(Double(seconds / 3600), in: locale)):\(clock)" : clock
    }

    /// How long ago something was, short enough for the right edge of a row: `3m ago`, `3 min. geleden`.
    public static func ago(milliseconds: Double, in locale: FormatLocale = .current) -> String {
        let past = max(0, milliseconds)
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale.language
        formatter.unitsStyle = .abbreviated
        if past < minute {
            formatter.dateTimeStyle = .named
            return formatter.localizedString(from: DateComponents(second: 0))
        }
        formatter.dateTimeStyle = .numeric
        if past < hour { return formatter.localizedString(from: DateComponents(minute: -Int(past / minute))) }
        if past < day { return formatter.localizedString(from: DateComponents(hour: -Int(past / hour))) }
        return formatter.localizedString(from: DateComponents(day: -Int(past / day)))
    }

    // MARK: Dates and times

    /// `08:05`, or `08:05 AM` in a region that counts to twelve.
    public static func clock(_ date: Date, in locale: FormatLocale = .current) -> String {
        dateTime(date, Date.FormatStyle().hour(.twoDigits(amPM: .abbreviated)).minute(.twoDigits), in: locale)
    }

    /// `08:05:09`, for a time that was written to the second.
    public static func clockSeconds(_ date: Date, in locale: FormatLocale = .current) -> String {
        dateTime(
            date, Date.FormatStyle().hour(.twoDigits(amPM: .abbreviated)).minute(.twoDigits).second(.twoDigits),
            in: locale)
    }

    /// A time far enough off that its day is part of the answer: `Sat 08:05`.
    public static func weekdayClock(_ date: Date, in locale: FormatLocale = .current) -> String {
        dateTime(
            date, Date.FormatStyle().weekday(.abbreviated).hour(.twoDigits(amPM: .abbreviated)).minute(.twoDigits),
            in: locale)
    }

    /// An hour of the day on its own, for the foot of a chart: `08`, or `8 AM` where that is the clock.
    public static func hour(_ date: Date, in locale: FormatLocale = .current) -> String {
        dateTime(date, Date.FormatStyle().hour(.defaultDigits(amPM: .abbreviated)), in: locale)
    }

    /// `19 Sep`, the short date a row falls back to once "days ago" stops meaning anything.
    public static func day(_ date: Date, in locale: FormatLocale = .current) -> String {
        dateTime(date, Date.FormatStyle().day().month(.abbreviated), in: locale)
    }

    /// The same date with the year, for anything older than the one we are in.
    public static func dayWithYear(_ date: Date, in locale: FormatLocale = .current) -> String {
        dateTime(date, Date.FormatStyle().day().month(.abbreviated).year(), in: locale)
    }

    /// `Sat 19 Sep`.
    public static func weekdayDay(_ date: Date, in locale: FormatLocale = .current) -> String {
        dateTime(date, Date.FormatStyle().weekday(.abbreviated).day().month(.abbreviated), in: locale)
    }

    /// `19 Sep, 08:05`: a moment that is not today, to the minute.
    public static func dayClock(_ date: Date, in locale: FormatLocale = .current) -> String {
        dateTime(date, Date.FormatStyle().day().month(.abbreviated).hour(.twoDigits(amPM: .abbreviated)).minute(.twoDigits), in: locale)
    }

    /// `19 Sep 2025, 08:05`: a moment of another year.
    public static func dayClockWithYear(_ date: Date, in locale: FormatLocale = .current) -> String {
        dateTime(
            date,
            Date.FormatStyle().day().month(.abbreviated).year().hour(.twoDigits(amPM: .abbreviated)).minute(.twoDigits),
            in: locale)
    }

    /// All numbers, as a form would print it: `19-9-2026` here, `9/19/2026` in the United States.
    public static func numericDate(_ date: Date, in locale: FormatLocale = .current) -> String {
        dateTime(date, Date.FormatStyle().day().month(.defaultDigits).year(), in: locale)
    }

    /// Whether two instants fall on the same day, in the zone of whoever is reading.
    public static func isSameDay(_ first: Date, _ second: Date, in locale: FormatLocale = .current) -> Bool {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = locale.timeZone
        return calendar.isDate(first, inSameDayAs: second)
    }

    /// The time alone for something today, its day as well once it was not.
    public static func moment(_ date: Date, now: Date = .now, in locale: FormatLocale = .current) -> String {
        isSameDay(date, now, in: locale) ? clock(date, in: locale) : dayClock(date, in: locale)
    }

    private static let wordFields: Set<AttributeScopes.FoundationAttributes.DateFieldAttribute.Field> = [
        .month, .weekday, .amPM, .era,
    ]

    /// A date written the way the region writes one, with its words lifted from the language: `19 Sep` in English
    /// against a Dutch region, `19 sep` once the app is Dutch too. `formatDateTime` in `@adecore/ui/format`.
    private static func dateTime(_ date: Date, _ style: Date.FormatStyle, in locale: FormatLocale) -> String {
        var notation = style
        notation.locale = locale.region
        notation.timeZone = locale.timeZone
        let parts = date.formatted(notation.attributed)
        guard parts.runs.contains(where: { $0.dateField.map(wordFields.contains) == true }) else {
            return plainSpaces(String(parts.characters))
        }
        var language = style
        language.locale = locale.language
        language.timeZone = locale.timeZone
        let words = date.formatted(language.attributed)
        var word: [AttributeScopes.FoundationAttributes.DateFieldAttribute.Field: String] = [:]
        for run in words.runs {
            if let field = run.dateField, word[field] == nil { word[field] = String(words[run.range].characters) }
        }
        return plainSpaces(
            parts.runs.map { run in
                if let field = run.dateField, wordFields.contains(field), let replacement = word[field] {
                    return replacement
                }
                return String(parts[run.range].characters)
            }.joined())
    }

    /// CLDR 42 puts a narrow no-break space before `AM`; the desktop's engine writes a plain one, and so does this.
    private static func plainSpaces(_ text: String) -> String {
        text.replacingOccurrences(of: "\u{202F}", with: " ")
    }
}
