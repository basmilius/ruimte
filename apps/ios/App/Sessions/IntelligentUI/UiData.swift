import Foundation
import RuimtePulsar

/// Numbers as a block shows them. A tone, never the renderer, says whether a change is good.
enum UiFormat {
    static func number(_ value: Double, locale: Locale = .current) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).locale(locale))
    }

    /// A percent sign hugs the number; every other unit stands apart from it.
    static func withUnit(_ text: String, _ unit: String?) -> String {
        guard let unit, !unit.isEmpty else { return text }
        return unit == "%" ? text + unit : "\(text) \(unit)"
    }

    /// `value` in percent, so 25 reads as 25%.
    static func percent(_ value: Double, locale: Locale = .current) -> String {
        (value / 100).formatted(.percent.precision(.fractionLength(0...1)).locale(locale))
    }

    static func duration(milliseconds: Double, locale: Locale = .current) -> String {
        let duration = Duration.milliseconds(Int64(max(0, min(milliseconds, 1e15)).rounded()))
        let allowed: Set<Duration.UnitsFormatStyle.Unit> =
            milliseconds < 1000 ? [.milliseconds] : [.hours, .minutes, .seconds]
        return duration.formatted(
            .units(allowed: allowed, width: .abbreviated, maximumUnitCount: 2, fractionalPart: .hide)
                .locale(locale))
    }

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

struct UiTableColumn: Equatable {
    enum Kind: String { case text, number, bytes, duration, date, file, tag }

    let key: String
    let title: String
    let unit: String?
    let kind: Kind

    var numeric: Bool { [.number, .bytes, .duration].contains(kind) }

    /// Rows shown before a person asks for all of them.
    static let rowsShown = 50
    /// Columns a table without Column children takes from its rows.
    private static let derived = 8

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
        for row in rows {
            for key in row.keys.sorted() where !keys.contains(key) && keys.count < derived { keys.append(key) }
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
            if let number = value.numberValue, number.isFinite { return .date(number) }
            if let string = value.stringValue, let date = parseDate(string) {
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

    static let maxSeries = 6
    static let maxRows = 60

    let labels: [String]
    let series: [Series]
    /// The range the axis covers, from zero or below it, never empty.
    let min: Double
    let max: Double
    /// Whether rows past `maxRows` were left out.
    let truncated: Bool

    /// Nil when there is no row or no series, which draws the fallback.
    init?(_ chart: UiNode) {
        let data = chart.props["data"]?.arrayValue?.compactMap(\.objectValue) ?? []
        let rows = Array(data.prefix(Self.maxRows))
        var keys: [String] = []
        for row in rows {
            for key in row.keys.sorted()
            where key != "label" && !keys.contains(key) && keys.count < Self.maxSeries
                && row[key]?.numberValue?.isFinite == true
            {
                keys.append(key)
            }
        }
        guard !rows.isEmpty, !keys.isEmpty else { return nil }
        let series = keys.map { key in
            Series(key: key, values: rows.map { $0[key]?.numberValue.flatMap { $0.isFinite ? $0 : nil } })
        }
        labels = rows.map { row in
            if let string = row["label"]?.stringValue { return string }
            if let number = row["label"]?.numberValue { return UiFormat.number(number) }
            return ""
        }
        let kind = chart.string("kind")
        let extents: [Double] =
            kind == "stacked"
            ? labels.indices.map { index in series.reduce(0) { $0 + Swift.max(0, $1.values[index] ?? 0) } }
            : series.flatMap { $0.values.compactMap { $0 } }
        let low = Swift.min(0, extents.min() ?? 0)
        let high = Swift.max(0, extents.max() ?? 0)
        self.series = series
        min = low
        max = high == low ? low + 1 : high
        truncated = data.count > rows.count
    }

    /// The highest value and where it stands, which a screen reader hears as the main point.
    var top: (label: String, series: String, value: Double)? {
        var best: (label: String, series: String, value: Double)?
        for entry in series {
            for (index, value) in entry.values.enumerated() {
                if let value, best == nil || value > best!.value {
                    best = (labels[index], entry.key, value)
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

    /// Nil for a block without queries.
    static func of(block: JSONValue, readings: [String: JSONValue], reading: Bool) -> Self? {
        let queries = block["queries"]?.objectValue ?? [:]
        guard !queries.isEmpty else { return nil }
        let names = queries.keys.sorted()
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
            reason: failed.flatMap { readings[$0]?["reason"]?.stringValue })
    }
}
