import Foundation
import Testing

@testable import RuimtePulsar

/// Holds `Format` to `Fixtures/ports-format.json`, which `packages/contracts/scripts/generate-port-format.ts` writes by
/// calling `@adecore/ui/format` on every case, so the phone writes what the desktop writes.
struct FormatPortTests {
    private let zone = TimeZone(identifier: "Europe/Amsterdam")!

    private func fixture() throws -> [JSONValue] {
        let url = try #require(Bundle.module.url(forResource: "ports-format", withExtension: "json"))
        return try #require(try JSONValue.decode(Data(contentsOf: url))["cases"]?.arrayValue)
    }

    private func date(_ arguments: [JSONValue], _ index: Int = 0) -> Date {
        Date(timeIntervalSince1970: (arguments[index].numberValue ?? 0) / 1000)
    }

    /// What the phone writes for a case, or nil for a function the fixture names and `Format` lacks.
    private func written(_ fn: String, _ arguments: [JSONValue], in locale: FormatLocale) -> String? {
        let value = arguments.first?.numberValue ?? 0
        switch fn {
        case "number": return Format.number(value, in: locale)
        case "decimal": return Format.decimal(value, in: locale)
        case "fixed": return Format.fixed(value, decimals: Int(arguments[1].numberValue ?? 0), in: locale)
        case "rounded": return Format.rounded(value, decimals: Int(arguments[1].numberValue ?? 0), in: locale)
        case "percent": return Format.percent(value, in: locale)
        case "money":
            return Format.money(
                value, currency: arguments[1].stringValue ?? "", maximumFractionDigits: arguments.count > 2 ? Int(arguments[2].numberValue ?? 0) : nil,
                in: locale)
        case "usdSignificant": return Format.usdSignificant(value, in: locale)
        case "tokens": return Format.tokens(value, in: locale)
        case "bytes": return Format.bytes(value, whole: arguments[1].boolValue == true, in: locale)
        case "duration": return Format.duration(milliseconds: value, in: locale)
        case "elapsedShort": return Format.elapsedShort(milliseconds: value, in: locale)
        case "countdown": return Format.countdown(milliseconds: value, in: locale)
        case "clockDuration": return Format.clockDuration(milliseconds: value, in: locale)
        case "ago": return Format.ago(milliseconds: value, in: locale)
        case "clock": return Format.clock(date(arguments), in: locale)
        case "weekdayClock": return Format.weekdayClock(date(arguments), in: locale)
        case "hour": return Format.hour(date(arguments), in: locale)
        case "day": return Format.day(date(arguments), in: locale)
        case "dayWithYear": return Format.dayWithYear(date(arguments), in: locale)
        case "weekdayDay": return Format.weekdayDay(date(arguments), in: locale)
        case "dayClock": return Format.dayClock(date(arguments), in: locale)
        case "dayClockWithYear": return Format.dayClockWithYear(date(arguments), in: locale)
        case "numericDate": return Format.numericDate(date(arguments), in: locale)
        case "moment": return Format.moment(date(arguments), now: date(arguments, 1), in: locale)
        case "isSameDay": return "\(Format.isSameDay(date(arguments), date(arguments, 1), in: locale))"
        default: return nil
        }
    }

    @Test func everyFunctionWritesWhatTheDesktopWrites() throws {
        let all = try fixture()
        #expect(all.count > 4000)
        var mismatches: [String] = []
        var functions = Set<String>()
        for entry in all {
            let fn = try #require(entry["fn"]?.stringValue)
            functions.insert(fn)
            let locale = FormatLocale(
                region: Locale(identifier: (entry["region"]?.stringValue ?? "").replacingOccurrences(of: "-", with: "_")),
                language: Locale(identifier: entry["language"]?.stringValue ?? "en"), timeZone: zone)
            let expected = entry["result"]?.stringValue ?? "\(entry["result"]?.boolValue == true)"
            let arguments = entry["args"]?.arrayValue ?? []
            let actual = written(fn, arguments, in: locale)
            if actual != expected {
                mismatches.append(
                    "\(fn) \(arguments.map { "\($0)" }.joined(separator: ",")) \(entry["region"]?.stringValue ?? "")/\(entry["language"]?.stringValue ?? ""): \(actual ?? "nil") != \(expected)"
                )
            }
        }
        #expect(functions.count == 25)
        #expect(mismatches.isEmpty, "\(mismatches.count) differ: \(mismatches.prefix(400).joined(separator: "\n"))")
    }
}
