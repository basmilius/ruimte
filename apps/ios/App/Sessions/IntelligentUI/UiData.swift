import Foundation
import RuimtePulsar

/// Numbers as a block shows them. A tone, never the renderer, says whether a change is good.
enum UiFormat {
    static func number(_ value: Double) -> String { Format.rounded(value, decimals: 2) }

    /// A percent sign hugs the number; every other unit stands apart from it.
    static func withUnit(_ text: String, _ unit: String?) -> String {
        guard let unit, !unit.isEmpty else { return text }
        return unit == "%" ? text + unit : "\(text) \(unit)"
    }

    /// `value` in percent, so 25 reads as 25%.
    static func percent(_ value: Double) -> String { Format.percent(value) }

    static func duration(milliseconds: Double) -> String { Format.duration(milliseconds: milliseconds) }

    static func moment(milliseconds: Double) -> Date { Date(timeIntervalSince1970: milliseconds / 1000) }

    static func domain(_ address: String) -> String {
        guard let host = URL(string: address)?.host() else { return address }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    static func baseName(_ path: String) -> String {
        var trimmed = path
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        return trimmed.split(separator: "/").last.map(String.init) ?? path
    }
}

enum UiTextLimit {
    /// The longest start of `text` within `limit` UTF-16 units, which is how the interpreter counts a TextField's
    /// characters, without cutting a character in two.
    static func clamp(_ text: String, to limit: Int) -> String {
        guard text.utf16.count > limit else { return text }
        var kept = ""
        var used = 0
        for character in text {
            let units = String(character).utf16.count
            if used + units > limit { break }
            kept.append(character)
            used += units
        }
        return kept
    }
}

/// The moment an Event's `at` names, read as `parseUiEventTime` in `@adecore/intelligent-ui` does.
struct UiEventTime: Equatable {
    enum Kind: Equatable { case time, date, dateTime }

    let kind: Kind
    let date: Date
    /// No offset was given: `date` holds the parts as written in UTC and is written in UTC, so no zone or clock
    /// change moves them. Otherwise it is a real instant, written in the reader's zone.
    let written: Bool
    /// A lone time that wrote seconds shows them; a date-time shows its minutes only.
    let seconds: Bool

    private static let pattern = try! NSRegularExpression(
        pattern:
            #"^(?:([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,9})?)?|([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,9})?)?(Z|[+-][0-9]{2}:[0-9]{2})?)?)\z"#
    )

    private static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    /// Nil when `at` is no `HH:MM[:SS]`, `YYYY-MM-DD` or date-time with an optional offset, or names a day or a time
    /// that does not exist.
    init?(_ at: String) {
        let range = NSRange(at.startIndex..., in: at)
        guard let match = Self.pattern.firstMatch(in: at, range: range) else { return nil }
        func part(_ index: Int) -> Int? {
            Range(match.range(at: index), in: at).flatMap { Int(at[$0]) }
        }
        func validClock(_ hour: Int, _ minute: Int, _ second: Int) -> Bool {
            hour <= 23 && minute <= 59 && second <= 59
        }
        let calendar = Self.utc
        if let hour = part(1), let minute = part(2) {
            let second = part(3) ?? 0
            guard validClock(hour, minute, second),
                let date = calendar.date(
                    from: DateComponents(year: 2000, month: 1, day: 1, hour: hour, minute: minute, second: second))
            else { return nil }
            self.init(kind: .time, date: date, written: true, seconds: part(3) != nil)
            return
        }
        // The desktop reads a year under 100 as 19xx, which then differs from the one written.
        guard let year = part(4), year >= 100, let month = part(5), let day = part(6),
            let calendarDay = calendar.date(from: DateComponents(year: year, month: month, day: day)),
            calendar.dateComponents([.year, .month, .day], from: calendarDay)
                == DateComponents(year: year, month: month, day: day)
        else { return nil }
        guard let hour = part(7), let minute = part(8) else {
            self.init(kind: .date, date: calendarDay, written: true, seconds: false)
            return
        }
        let second = part(9) ?? 0
        guard validClock(hour, minute, second),
            let instant = calendar.date(
                from: DateComponents(
                    year: year, month: month, day: day, hour: hour, minute: minute, second: second))
        else { return nil }
        guard let zone = Range(match.range(at: 10), in: at).map({ String(at[$0]) }) else {
            self.init(kind: .dateTime, date: instant, written: true, seconds: false)
            return
        }
        guard let offset = Self.offsetMinutes(zone) else { return nil }
        self.init(
            kind: .dateTime, date: instant.addingTimeInterval(-Double(offset) * 60), written: false, seconds: false)
    }

    private init(kind: Kind, date: Date, written: Bool, seconds: Bool) {
        self.kind = kind
        self.date = date
        self.written = written
        self.seconds = seconds
    }

    /// The minutes east of UTC that `Z` or `+02:00` stand for, or nil for an offset no zone has: -12:00 to +14:00.
    private static func offsetMinutes(_ zone: String) -> Int? {
        if zone == "Z" { return 0 }
        guard let hours = Int(zone.dropFirst().prefix(2)), let minutes = Int(zone.suffix(2)) else { return nil }
        let offset = (zone.first == "-" ? -1 : 1) * (hours * 60 + minutes)
        return minutes > 59 || offset < -12 * 60 || offset > 14 * 60 ? nil : offset
    }

    /// What the row shows: a time as the region's clock, a date or date-time with its year once it is not this one.
    /// Text that names no moment stays as written.
    static func text(_ at: String, now: Date = .now, in locale: FormatLocale = .current) -> String {
        guard let moment = Self(at) else { return at }
        return moment.text(now: now, in: locale)
    }

    func text(now: Date = .now, in locale: FormatLocale = .current) -> String {
        var zoned = locale
        if written { zoned.timeZone = TimeZone(identifier: "UTC")! }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zoned.timeZone
        var reader = Calendar(identifier: .gregorian)
        reader.timeZone = locale.timeZone
        let withYear = calendar.component(.year, from: date) != reader.component(.year, from: now)
        switch kind {
        case .time: return seconds ? Format.clockSeconds(date, in: zoned) : Format.clock(date, in: zoned)
        case .date: return withYear ? Format.dayWithYear(date, in: zoned) : Format.day(date, in: zoned)
        case .dateTime:
            return withYear ? Format.dayClockWithYear(date, in: zoned) : Format.dayClock(date, in: zoned)
        }
    }
}

struct UiTableColumn: Equatable {
    enum Kind: String { case text, number, bytes, duration, date, file, tag }

    let key: String
    let title: String
    let unit: String?
    let kind: Kind

    var numeric: Bool { [.number, .bytes, .duration].contains(kind) }

    /// Rows shown before a person asks for all of them.
    static let rowsShown = 50
    /// The Column children whose key some row has, each key once. A table without columns takes the keys of its
    /// rows, as numbers when every value there is one. Empty when nothing is usable, which draws the fallback.
    static func of(_ table: UiNode) -> [Self] {
        let rows = table.props["rows"]?.arrayValue?.compactMap(\.objectValue) ?? []
        let declared = table.children(of: "Column")
        if !declared.isEmpty {
            var seen: Set<String> = []
            return declared.compactMap { column in
                guard let key = column.string("key"), !seen.contains(key),
                    rows.isEmpty || rows.contains(where: { $0[key] != nil })
                else { return nil }
                seen.insert(key)
                return Self(
                    key: key, title: column.string("title") ?? key, unit: column.string("unit"),
                    kind: column.string("as").flatMap(Kind.init(rawValue:)) ?? .text)
            }
        }
        var keys: [String] = []
        // A row's keys reach the app without the order the agent wrote them in, so a derived table sorts them.
        for row in rows {
            for key in row.keys.sorted() where !keys.contains(key) { keys.append(key) }
        }
        return keys.map { key in
            let values = rows.compactMap { $0[key] }.filter { $0 != .null }
            let numeric = !values.isEmpty && values.allSatisfy { $0.numberValue?.isFinite == true }
            return Self(key: key, title: key, unit: nil, kind: numeric ? .number : .text)
        }
    }
}

/// What one cell shows, decided before drawing so a value of the wrong kind never reaches a formatter.
enum UiTableCell: Equatable {
    case empty
    case text(String)
    case number(Double, UiTableColumn.Kind)
    /// Milliseconds since the epoch.
    case date(Double)
    case file(String)
    case tag(String)

    /// A duration is in milliseconds and a date is milliseconds since the epoch or an ISO string.
    static func of(_ value: JSONValue?, column: UiTableColumn) -> Self {
        guard let value, value != .null, value != .string("") else { return .empty }
        switch column.kind {
        case .number, .bytes, .duration:
            if let number = numberOf(value) { return .number(number, column.kind) }
            return .text(textOf(value))
        case .date:
            if let number = value.numberValue, number.isFinite, abs(number) <= dateRange { return .date(number) }
            if let string = value.stringValue, let date = parseDate(string),
                abs(date.timeIntervalSince1970 * 1000) <= dateRange
            {
                return .date(date.timeIntervalSince1970 * 1000)
            }
            return .text(textOf(value))
        case .file:
            return value.stringValue.map(Self.file) ?? .text(textOf(value))
        case .tag:
            return .tag(textOf(value))
        case .text:
            return .text(textOf(value))
        }
    }

    /// The furthest a JavaScript Date reaches from the epoch either way, in milliseconds, as on the desktop.
    private static let dateRange = 8.64e15

    private static func numberOf(_ value: JSONValue) -> Double? {
        if let number = value.numberValue { return number.isFinite ? number : nil }
        if let string = value.stringValue?.trimmingCharacters(in: .whitespaces), !string.isEmpty,
            let number = Double(string), number.isFinite
        {
            return number
        }
        return nil
    }

    static func textOf(_ value: JSONValue) -> String {
        switch value {
        case .string(let string): return string
        case .number(let number):
            return number.rounded() == number && abs(number) < 1e15 ? String(Int64(number)) : String(number)
        case .bool(let bool): return bool ? "true" : "false"
        case .null: return "null"
        case .object, .array:
            return (try? value.encoded()).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        }
    }

    private static func parseDate(_ string: String) -> Date? {
        let full = ISO8601DateFormatter()
        full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = full.date(from: string) { return date }
        full.formatOptions = [.withInternetDateTime]
        if let date = full.date(from: string) { return date }
        full.formatOptions = [.withFullDate]
        return full.date(from: string)
    }
}

/// The series a chart can draw: every key besides `label` with a finite number in some row, the first six.
struct UiChartData: Equatable {
    struct Series: Equatable {
        let key: String
        /// One per label, nil where a row has no number for this series.
        let values: [Double?]
    }

    /// Every row and every numeric series of a chart's data, whatever a drawing can hold.
    struct Values: Equatable {
        let labels: [String]
        let series: [Series]
    }

    static let maxSeries = 6
    static let maxRows = 60

    let labels: [String]
    let series: [Series]
    /// What it is drawn as: stacked data with a negative value stands side by side as bars.
    let kind: String
    /// The range the axis covers, from zero or below it, never empty.
    let min: Double
    let max: Double
    /// Whether rows past `maxRows` were left out.
    let truncated: Bool
    /// The rows of the data, drawn or not.
    let total: Int
    /// The numeric series past the first six, which only the values hold.
    let omitted: [String]
    let values: Values

    /// Nil when there is no row or no series, or when the numbers are too large to scale, which draws the fallback.
    init?(_ chart: UiNode) {
        let data = chart.props["data"]?.arrayValue?.compactMap(\.objectValue) ?? []
        let rows = Array(data.prefix(Self.maxRows))
        let keys = Self.numericKeys(rows)
        guard !rows.isEmpty, !keys.isEmpty else { return nil }
        let drawn = Self.values(rows, keys: Array(keys.prefix(Self.maxSeries)))
        let negative = drawn.series.contains { $0.values.contains { ($0 ?? 0) < 0 } }
        let requested = chart.string("kind") ?? "bar"
        let kind = requested == "stacked" && negative ? "bar" : requested
        let extents: [Double] =
            kind == "stacked"
            ? drawn.labels.indices.map { index in drawn.series.reduce(0) { $0 + ($1.values[index] ?? 0) } }
            : drawn.series.flatMap { $0.values.compactMap { $0 } }
        let low = Swift.min(0, extents.min() ?? 0)
        let high = Swift.max(0, extents.max() ?? 0)
        guard Self.range(low, high) != nil else { return nil }
        labels = drawn.labels
        series = drawn.series
        self.kind = kind
        min = low
        max = high == low ? low + 1 : high
        truncated = data.count > rows.count
        total = data.count
        let all = Self.numericKeys(data)
        omitted = all.filter { key in !drawn.series.contains { $0.key == key } }
        values = Self.values(data, keys: all)
    }

    /// The rounded ends of a value axis, or nil when no drawing can scale to them: the span has to be finite and above
    /// zero, and so does one over it, which rules out a subnormal span as well.
    static func range(_ low: Double, _ high: Double) -> ClosedRange<Double>? {
        let bottom = low < 0 ? -niceCeiling(-low) : 0
        let top = high > 0 ? niceCeiling(high) : bottom == 0 ? 1 : 0
        let span = top - bottom
        return span > 0 && span.isFinite && (1 / span).isFinite ? bottom...top : nil
    }

    /// A round number at or above `value`, for the end of an axis: 1, 2, 2.5 or 5 times a power of ten.
    static func niceCeiling(_ value: Double) -> Double {
        guard value > 0 else { return 0 }
        let power = pow(10, floor(log10(value)))
        return ([1, 2, 2.5, 5, 10].first { $0 * power >= value } ?? 10) * power
    }

    // A row's keys reach the app without the order the agent wrote them in, so each row's keys are sorted.
    private static func numericKeys(_ rows: [[String: JSONValue]]) -> [String] {
        var keys: [String] = []
        for row in rows {
            for key in row.keys.sorted()
            where key != "label" && !keys.contains(key) && row[key]?.numberValue?.isFinite == true {
                keys.append(key)
            }
        }
        return keys
    }

    private static func values(_ rows: [[String: JSONValue]], keys: [String]) -> Values {
        Values(
            labels: rows.map { row in
                if let string = row["label"]?.stringValue { return string }
                if let number = row["label"]?.numberValue { return UiTableCell.textOf(.number(number)) }
                return ""
            },
            series: keys.map { key in
                Series(key: key, values: rows.map { $0[key]?.numberValue.flatMap { $0.isFinite ? $0 : nil } })
            })
    }

    /// The highest value of all the data, drawn or not, and where it stands, which a screen reader hears as the main point.
    var top: (label: String, series: String, value: Double)? {
        var best: (label: String, series: String, value: Double)?
        for entry in values.series {
            for (index, value) in entry.values.enumerated() {
                if let value, best == nil || value > best!.value {
                    best = (values.labels[index], entry.key, value)
                }
            }
        }
        return best
    }
}

/// What the footer of a block that reads live data says about its last reading.
struct UiLiveStatus: Equatable {
    enum State: Equatable { case fresh, reading, failed, refused }

    let state: State
    /// What the block reads, by the names a person knows them by.
    let sources: [String]
    /// The oldest reading that succeeded; nil when nothing was read yet.
    let readAt: Date?
    /// The source that failed or was refused.
    let source: String?
    let reason: String?

    /// Nil for a block without queries. `order` names them as the block declares them.
    static func of(block: JSONValue, order: [String], readings: [String: JSONValue], reading: Bool) -> Self? {
        let queries = block["queries"]?.objectValue ?? [:]
        guard !queries.isEmpty else { return nil }
        let names = order.filter { queries[$0] != nil }
        let failed = names.first { name in
            readings[name].map { $0["state"] != .string("fresh") } ?? false
        }
        let freshTimes = names.compactMap { name -> Double? in
            guard let value = readings[name], value["state"] == .string("fresh") else { return nil }
            return value["readAt"]?.numberValue
        }
        let state: State =
            reading
            ? .reading
            : failed.flatMap { readings[$0]?["state"]?.stringValue == "refused" ? .refused : .failed } ?? .fresh
        return Self(
            state: state,
            sources: names.map { queries[$0]?["source"]?.stringValue ?? $0 },
            readAt: freshTimes.min().map(UiFormat.moment(milliseconds:)),
            source: failed.map { queries[$0]?["source"]?.stringValue ?? $0 },
            reason: failed.flatMap { UiReason.text(readings[$0]) })
    }
}

/// Why a reading failed or a link stayed plain, in the person's language where this version knows the daemon's code,
/// and as the daemon wrote it for any other code.
enum UiReason {
    static func text(_ reading: JSONValue?) -> String? {
        text(code: reading?["code"]?.stringValue, reason: reading?["reason"]?.stringValue)
    }

    static func text(code: String?, reason: String?) -> String? {
        switch code {
        case "access-unavailable": String(localized: "The access of the chat that wrote this is no longer available.")
        case "block-stale": String(localized: "This block changed since it was drawn.")
        case "busy": String(localized: "Too many live blocks reading.")
        case "link-unchecked": String(localized: "This link has to be checked again.")
        case "link-unsupported": String(localized: "This is not a link the machine can open.")
        case "links-unsupported": String(localized: "The machine does not open links from blocks.")
        case "no-unique-match": String(localized: "The source found no single match for that name.")
        case "outside-project": String(localized: "This is outside the project the agent wrote this in.")
        case "query-undeclared": String(localized: "This block does not read that source.")
        case "refresh-limit": String(localized: "This source reads at most once every ten seconds.")
        case "result-too-large": String(localized: "What the source returned is too large.")
        case "snapshot-too-large": String(localized: "The first readings were too large to keep.")
        case "source-unregistered": String(localized: "The machine does not know this source.")
        case "stale-read": String(localized: "Read the source again before you choose.")
        case "target-unavailable": String(localized: "What this points to is no longer available.")
        case "timed-out": String(localized: "The source took too long to answer.")
        case "unreadable": String(localized: "Could not read the source.")
        default: reason
        }
    }
}
