import Foundation
import XCTest

/// Reads the String Catalogs from the source tree, since a compiled bundle no longer says which keys lack a language.
final class LocalizationTests: XCTestCase {
    private static let catalogs = [
        "App/Localizable.xcstrings",
        "App/InfoPlist.xcstrings",
        "Extensions/ActivityWidget/Localizable.xcstrings",
        "Extensions/ActivityWidget/InfoPlist.xcstrings",
        "Extensions/NotificationService/Localizable.xcstrings",
        "Extensions/NotificationService/InfoPlist.xcstrings",
        "Packages/RuimtePulsar/Sources/RuimtePulsar/Localizable.xcstrings",
        "Packages/RuimteTransport/Sources/RuimteTransport/Localizable.xcstrings",
    ]

    func testEveryStringHasADutchTranslation() throws {
        for path in Self.catalogs {
            let strings = try Self.strings(path)
            let missing = strings.filter { _, entry in Self.translatable(entry) && Self.dutch(entry).isEmpty }
            XCTAssertEqual(missing.keys.sorted(), [], "\(path) has keys without Dutch")
        }
    }

    func testDutchKeepsThePlaceholdersOfTheEnglish() throws {
        for path in Self.catalogs {
            for (key, entry) in try Self.strings(path) where Self.translatable(entry) {
                let dutch = Self.dutch(entry)
                let placeholders = Set(dutch.flatMap(Self.placeholders))
                XCTAssertEqual(placeholders, Set(Self.placeholders(key)), "\(path): \"\(key)\" reads \(dutch) in Dutch")
            }
        }
    }

    func testTheAppHasStringsAtAll() throws {
        XCTAssertGreaterThan(try Self.strings("App/Localizable.xcstrings").count, 100)
    }

    private static func strings(_ path: String) throws -> [String: [String: Any]] {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent(path))
        let catalog = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap(catalog["strings"] as? [String: [String: Any]])
    }

    private static func translatable(_ entry: [String: Any]) -> Bool {
        entry["shouldTranslate"] as? Bool != false && entry["extractionState"] as? String != "stale"
    }

    /// Every Dutch text of an entry, one per plural form; empty when Dutch is missing or unfinished.
    private static func dutch(_ entry: [String: Any]) -> [String] {
        let localizations = entry["localizations"] as? [String: Any]
        guard let dutch = localizations?["nl"] as? [String: Any] else {
            return []
        }
        return texts(dutch) ?? []
    }

    private static func texts(_ localization: [String: Any]) -> [String]? {
        if let unit = localization["stringUnit"] as? [String: Any] {
            guard unit["state"] as? String == "translated", var value = unit["value"] as? String, !value.isEmpty else {
                return nil
            }
            let substitutions = localization["substitutions"] as? [String: [String: Any]] ?? [:]
            for (name, substitution) in substitutions {
                guard texts(substitution) != nil, let argument = substitution["argNum"] as? Int,
                    let specifier = substitution["formatSpecifier"] as? String
                else {
                    return nil
                }
                value = value.replacingOccurrences(of: "%#@\(name)@", with: "%\(argument)$\(specifier)")
            }
            return [value]
        }
        guard let variations = localization["variations"] as? [String: [String: [String: Any]]] else {
            return nil
        }
        var values: [String] = []
        for cases in variations.values {
            guard cases["other"] != nil else {
                return nil
            }
            for variation in cases.values {
                guard let found = texts(variation) else {
                    return nil
                }
                values += found
            }
        }
        return values.isEmpty ? nil : values
    }

    /// The format specifiers by the argument they read, so a plural form that spells out its count still matches.
    private static func placeholders(_ text: String) -> [String] {
        let pattern = try? NSRegularExpression(pattern: "%(?:(\\d+)\\$)?(?:ll|l)?([@dfiu])")
        let range = NSRange(text.startIndex..., in: text)
        let matches = pattern?.matches(in: text, range: range) ?? []
        var next = 0
        var found: [(Int, String)] = []
        for match in matches {
            let kind = Range(match.range(at: 2), in: text).map { String(text[$0]) } ?? ""
            if let position = Range(match.range(at: 1), in: text).flatMap({ Int(text[$0]) }) {
                found.append((position, kind))
            } else {
                next += 1
                found.append((next, kind))
            }
        }
        return found.map { "\($0.0)\($0.1)" }
    }
}
